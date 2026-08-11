"""Drives one task from `queued` to a terminal state.

This is the seam the HTTP layer and — from Phase 3 — the orchestrator both call.
`main.py` above it does nothing but validate a request and translate errors;
everything about what running a task *means* lives here.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date

from app.agents.gateway_sink import GatewayTraceSink
from app.agents.loop import AgentRun, ToolExecutor, run_agent
from app.agents.scheduling import SCHEDULING_TOOLS, SYSTEM_PROMPT
from app.agents.scheduling_executor import make_scheduling_executor
from app.fhir.gateway import GatewayFhir
from app.llm.anthropic_provider import AnthropicProvider
from app.llm.provider import LlmProvider, ToolDefinition


class UnknownAgentError(Exception):
    """No agent of that kind is deployed in this service."""


class ProviderUnavailableError(Exception):
    """The service cannot reach a model — usually a missing API key."""


@dataclass(frozen=True)
class AgentSpec:
    """What it takes to run one kind of agent.

    A dict of these is the whole of routing for now. Phase 3 replaces the
    lookup with a real orchestrator that picks the agent from the task instead
    of being told; keeping the shape here means that change swaps one function.
    """

    kind: str
    system: str
    tools: Sequence[ToolDefinition]
    build_executor: Callable[[GatewayFhir], ToolExecutor]


AGENTS: dict[str, AgentSpec] = {
    "scheduling": AgentSpec(
        kind="scheduling",
        system=SYSTEM_PROMPT,
        tools=SCHEDULING_TOOLS,
        build_executor=make_scheduling_executor,
    ),
}


def run_task(
    *,
    task_id: str,
    task_input: str,
    tenant_id: str | None = None,
    agent_kind: str = "scheduling",
    provider: LlmProvider | None = None,
    fhir: GatewayFhir | None = None,
    sink: GatewayTraceSink | None = None,
    priced_on: date | None = None,
) -> AgentRun:
    """Run one task, reporting every step and its terminal state to the gateway.

    The task's status is the caller's contract with the rest of the system: a
    row left `running` because this raised would sit in the inbox forever and
    the Task Inbox would be lying. So a failure is recorded as `failed` before
    it is re-raised for the queue to retry.
    """
    spec = AGENTS.get(agent_kind)
    if spec is None:
        raise UnknownAgentError(
            f"No {agent_kind!r} agent is deployed. Available: {', '.join(sorted(AGENTS))}."
        )

    if provider is None:
        provider = _default_provider()

    owned_fhir = fhir is None
    fhir = fhir or GatewayFhir(tenant_id=tenant_id)
    owned_sink = sink is None
    sink = sink or GatewayTraceSink(task_id, tenant_id=tenant_id)

    try:
        sink.mark_running()
        try:
            result = run_agent(
                provider=provider,
                system=spec.system,
                task=task_input,
                tools=list(spec.tools),
                execute=spec.build_executor(fhir),
                on_step=sink,
                priced_on=priced_on or date.today(),
            )
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


def _default_provider() -> LlmProvider:
    # Checked here rather than letting the SDK raise: compose starts this
    # service without a key on purpose, so "no key" is a configuration state
    # with a clear answer, not an unexpected exception.
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ProviderUnavailableError(
            "ANTHROPIC_API_KEY is not set, so no model call can be made. "
            "Set it in .env and restart the AI service."
        )
    return AnthropicProvider()
