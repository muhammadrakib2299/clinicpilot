"""Drives one task from `queued` to a terminal state.

This is the seam the HTTP layer and the orchestrator both call. `main.py` above
it does nothing but validate a request and translate errors; everything about
what running a task *means* lives here.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from app.agents import orchestrator
from app.agents.docqa import DOCQA_TOOLS
from app.agents.docqa import SYSTEM_PROMPT as DOCQA_PROMPT
from app.agents.docqa_executor import make_docqa_executor
from app.agents.followup import FOLLOWUP_TOOLS
from app.agents.followup import SYSTEM_PROMPT as FOLLOWUP_PROMPT
from app.agents.followup_executor import make_followup_executor
from app.agents.gateway_sink import GatewayTraceSink
from app.agents.loop import AgentRun, AnswerCheck, ToolExecutor, run_agent
from app.agents.scheduling import SCHEDULING_TOOLS
from app.agents.scheduling import SYSTEM_PROMPT as SCHEDULING_PROMPT
from app.agents.scheduling_executor import make_scheduling_executor
from app.agents.trace import TraceStep
from app.fhir.gateway import GatewayFhir
from app.llm.anthropic_provider import AnthropicProvider
from app.llm.fallback_provider import FallbackProvider
from app.llm.pricing import cost_usd
from app.llm.provider import LlmProvider, ToolDefinition
from app.llm.redacting_provider import RedactingProvider
from app.rag.embedding import Embedder, HashingEmbedder
from app.rag.gateway import GatewayDocuments
from app.safety.redaction import Redactor

DEFAULT_CLINIC_NAME = "your clinic"


class UnknownAgentError(Exception):
    """No agent of that kind is deployed in this service."""


class ProviderUnavailableError(Exception):
    """The service cannot reach a model — usually a missing API key."""


@dataclass(frozen=True)
class ExecutorContext:
    """What an executor needs beyond its tool definitions."""

    fhir: GatewayFhir
    documents: GatewayDocuments
    embedder: Embedder
    clinic_name: str
    task_id: str


@dataclass(frozen=True)
class AgentSpec:
    """What it takes to run one kind of agent."""

    kind: str
    system: str
    tools: Sequence[ToolDefinition]
    build_executor: Callable[[ExecutorContext], ToolExecutor]
    #: Optional. Given the executor this run is using, returns the check to run
    #: on the final answer — the executor is the argument because the check is
    #: usually about what that executor served. Absent for agents whose risk is
    #: in a tool call rather than in what they say.
    answer_check: Callable[[Any], AnswerCheck] | None = None


AGENTS: dict[str, AgentSpec] = {
    "scheduling": AgentSpec(
        kind="scheduling",
        system=SCHEDULING_PROMPT,
        tools=SCHEDULING_TOOLS,
        build_executor=lambda ctx: make_scheduling_executor(ctx.fhir),
    ),
    "followup": AgentSpec(
        kind="followup",
        system=FOLLOWUP_PROMPT,
        tools=FOLLOWUP_TOOLS,
        build_executor=lambda ctx: make_followup_executor(
            ctx.fhir, clinic_name=ctx.clinic_name, task_id=ctx.task_id
        ),
    ),
    "docqa": AgentSpec(
        kind="docqa",
        system=DOCQA_PROMPT,
        tools=DOCQA_TOOLS,
        build_executor=lambda ctx: make_docqa_executor(ctx.documents, ctx.embedder),
        # The only agent with one, because it is the only one whose risk is
        # what it says rather than what it does.
        answer_check=lambda executor: executor.check_answer,
    ),
}


def run_task(
    *,
    task_id: str,
    task_input: str,
    tenant_id: str | None = None,
    agent_kind: str | None = None,
    clinic_name: str = DEFAULT_CLINIC_NAME,
    provider: LlmProvider | None = None,
    fhir: GatewayFhir | None = None,
    documents: GatewayDocuments | None = None,
    embedder: Embedder | None = None,
    sink: GatewayTraceSink | None = None,
    priced_on: date | None = None,
    redact: bool = True,
) -> AgentRun:
    """Run one task, reporting every step and its terminal state to the gateway.

    `agent_kind` is optional. Left out, the orchestrator picks — which is the
    normal path now, because a patient's message does not arrive labelled.
    Passing it explicitly is for a caller that already knows, and for tests.

    The task's status is the caller's contract with the rest of the system: a
    row left `running` because this raised would sit in the inbox forever and
    the Task Inbox would be lying. So a failure is recorded as `failed` before
    it is re-raised for the queue to retry.
    """
    if provider is None:
        provider = _default_provider()

    # Outermost, so a fallback to a second vendor cannot become a path that
    # skips it (ADR-006). Off only for tests that assert on raw prompts.
    if redact:
        provider = RedactingProvider(provider, Redactor())

    owned_fhir = fhir is None
    fhir = fhir or GatewayFhir(tenant_id=tenant_id)
    owned_documents = documents is None
    documents = documents or GatewayDocuments(tenant_id=tenant_id)
    # Cheap to construct and holds no connection, so it is not worth the
    # branching to build one only for the agent that uses it.
    embedder = embedder or HashingEmbedder()
    owned_sink = sink is None
    sink = sink or GatewayTraceSink(task_id, tenant_id=tenant_id)
    priced_on = priced_on or date.today()

    try:
        sink.mark_running()

        try:
            if agent_kind is None:
                routing = _route(provider, task_input, sink, priced_on)

                if routing.escalated:
                    sink.complete("escalated", routing.reason)
                    return AgentRun(
                        outcome="escalated",
                        summary=routing.reason,
                        steps=1,
                        iterations=0,
                        usage=routing.response.usage,
                        cost_usd=cost_usd(
                            routing.response.model, routing.response.usage, on=priced_on
                        ),
                    )

                agent_kind = routing.agent_kind

            spec = AGENTS.get(agent_kind or "")
            if spec is None:
                raise UnknownAgentError(
                    f"No {agent_kind!r} agent is deployed here. "
                    f"Available: {', '.join(sorted(AGENTS))}."
                )

            context = ExecutorContext(
                fhir=fhir,
                documents=documents,
                embedder=embedder,
                clinic_name=clinic_name,
                task_id=task_id,
            )

            executor = spec.build_executor(context)

            result = run_agent(
                provider=provider,
                system=spec.system,
                task=task_input,
                tools=list(spec.tools),
                execute=executor,
                check_answer=spec.answer_check(executor) if spec.answer_check else None,
                on_step=sink,
                priced_on=priced_on,
            )
        except UnknownAgentError:
            # A routing miss, not a run failure. Marking the task `failed` would
            # count it against an agent's success rate for a problem that is
            # ours, so it propagates and the caller decides.
            raise
        except Exception as exc:
            # A tool that raises never gets here — the loop feeds those back to
            # the model. This is the model itself being unreachable, or a bug.
            sink.complete("failed", f"{type(exc).__name__}: {exc}")
            raise

        sink.complete(result.outcome, result.summary)
        return result
    finally:
        if owned_sink:
            sink.close()
        if owned_fhir:
            fhir.close()
        if owned_documents:
            documents.close()


def _route(
    provider: LlmProvider,
    task_input: str,
    sink: GatewayTraceSink,
    priced_on: date,
) -> orchestrator.Routing:
    """Pick an agent, and put the decision on the trace.

    Traced as `reason` rather than a kind of its own. It is a decision the
    system made and should be visible, but it is not a distinct *category* of
    event the way `reflection` is — and a new enum value costs a migration plus
    four definitions kept in step, which is not free enough to spend on a label.
    """
    routing = orchestrator.route(provider=provider, task=task_input)
    step_cost = cost_usd(routing.response.model, routing.response.usage, on=priced_on)

    sink(
        TraceStep(
            step_no=1,
            kind="reason",
            label=f"Routing · {routing.agent_kind or 'escalate'}",
            detail=routing.reason,
            content={"agentKind": routing.agent_kind},
            tokens_in=routing.response.usage.input_tokens,
            tokens_out=routing.response.usage.output_tokens,
            cost_usd=step_cost,
            latency_ms=routing.response.latency_ms,
            model=routing.response.model,
            cache_read_tokens=routing.response.usage.cache_read_input_tokens,
            cache_write_tokens=routing.response.usage.cache_creation_input_tokens,
        )
    )

    return routing


def _default_provider() -> LlmProvider:
    """The primary model, with a cheaper one behind it (ADR-003).

    Checked for a key here rather than letting the SDK raise: compose starts
    this service without one on purpose, so "no key" is a configuration state
    with a clear answer, not an unexpected exception.

    The fallback is a second Anthropic model rather than a second vendor,
    because that is what is configured and reachable — `FallbackProvider` takes
    any `LlmProvider`, so an OpenAI implementation drops in without the loop or
    the accounting changing.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ProviderUnavailableError(
            "ANTHROPIC_API_KEY is not set, so no model call can be made. "
            "Set it in .env and restart the AI service."
        )

    primary = AnthropicProvider()
    fallback_model = os.environ.get("ANTHROPIC_MODEL_FAST")

    if not fallback_model or fallback_model == primary.model:
        return primary

    return FallbackProvider([primary, AnthropicProvider(model=fallback_model)])
