"""The reason → tool → observe → act loop.

Written by hand rather than using the SDK's tool runner. The runner would drive
the same cycle in less code, but the product *is* the trace: every model call
and every tool call has to become a numbered, costed step, and a hand-written
loop makes that mapping explicit instead of threading it through per-turn
hooks. It also keeps the loop free of any beta dependency.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.agents.trace import TraceSink, TraceStep
from app.llm.pricing import TokenUsage, cost_usd
from app.llm.provider import (
    AssistantTurn,
    LlmProvider,
    ToolCall,
    ToolDefinition,
    ToolResult,
    ToolResultTurn,
    Turn,
    UserTurn,
)

Outcome = Literal["resolved", "escalated", "failed"]

#: Executes one tool call and returns what the model should observe.
ToolExecutor = Callable[[ToolCall], str]

DEFAULT_MAX_ITERATIONS = 8


@dataclass(frozen=True)
class AgentRun:
    outcome: Outcome
    summary: str
    steps: int
    iterations: int
    usage: TokenUsage
    cost_usd: float


def run_agent(
    *,
    provider: LlmProvider,
    system: str,
    task: str,
    tools: Sequence[ToolDefinition],
    execute: ToolExecutor,
    on_step: TraceSink,
    priced_on: date,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
) -> AgentRun:
    """Drive one task to completion, emitting a trace step for every move."""
    by_name = {tool.name: tool for tool in tools}
    turns: list[Turn] = [UserTurn(text=task)]

    step_no = 0
    totals = _UsageTotals()

    def emit(**kwargs: object) -> None:
        nonlocal step_no
        step_no += 1
        on_step(TraceStep(step_no=step_no, **kwargs))  # type: ignore[arg-type]

    for iteration in range(1, max_iterations + 1):
        response = provider.complete(system=system, turns=turns, tools=list(tools))

        step_cost = cost_usd(response.model, response.usage, on=priced_on)
        totals.add(response.usage, step_cost)

        emit(
            kind="reason",
            label="Reason",
            detail=response.reasoning or response.text or "Planning the next action.",
            content={"stopReason": response.stop_reason, "model": response.model},
            tokens_in=response.usage.input_tokens,
            tokens_out=response.usage.output_tokens,
            cost_usd=step_cost,
            latency_ms=response.latency_ms,
        )

        if not response.wants_tools:
            return AgentRun(
                outcome="resolved",
                summary=response.text,
                steps=step_no,
                iterations=iteration,
                usage=totals.usage,
                cost_usd=totals.cost_usd,
            )

        results: list[ToolResult] = []
        for call in response.tool_calls:
            definition = by_name.get(call.name)
            # A mutation is traced as `action` — that is the distinction an
            # audit reviewer scans for, and what the Trace Viewer highlights.
            mutates = definition.mutates if definition else False

            emit(
                kind="action" if mutates else "tool_call",
                label=f"{'Action' if mutates else 'Tool'} · {call.name}",
                detail=_describe(call),
                content={"toolUseId": call.id, "arguments": call.arguments},
            )

            observation, failed = _run_tool(call, definition, execute)
            results.append(ToolResult(call_id=call.id, content=observation, is_error=failed))

            emit(
                kind="observation",
                label="Observation",
                detail=observation,
                content={"toolUseId": call.id, "isError": failed},
            )

        turns.append(
            AssistantTurn(
                text=response.text,
                tool_calls=response.tool_calls,
                raw_blocks=response.raw_blocks,
            )
        )
        turns.append(ToolResultTurn(results=tuple(results)))

    # Out of iterations with tools still pending. Handing to a human is the
    # correct outcome, not an error: the agent is scoped to non-diagnostic
    # work and a loop that will not converge is exactly what should escalate.
    emit(
        kind="escalation",
        label="Escalation",
        detail=(
            f"Stopped after {max_iterations} iterations without resolving the request. "
            "Routed to the human queue."
        ),
        content={"reason": "max_iterations", "maxIterations": max_iterations},
    )

    return AgentRun(
        outcome="escalated",
        summary=f"Escalated after {max_iterations} iterations.",
        steps=step_no,
        iterations=max_iterations,
        usage=totals.usage,
        cost_usd=totals.cost_usd,
    )


def _run_tool(
    call: ToolCall,
    definition: ToolDefinition | None,
    execute: ToolExecutor,
) -> tuple[str, bool]:
    """Never raise into the loop — a failed tool is something the model can see
    and recover from, so it goes back as an error tool_result rather than
    aborting the run."""
    if definition is None:
        return (f"Unknown tool {call.name!r}. Use one of the tools provided.", True)

    try:
        return (execute(call), False)
    except Exception as exc:  # noqa: BLE001 — deliberately broad, see docstring
        return (f"{type(exc).__name__}: {exc}", True)


def _describe(call: ToolCall) -> str:
    if not call.arguments:
        return call.name
    rendered = ", ".join(f"{key}={value!r}" for key, value in sorted(call.arguments.items()))
    return f"{call.name}({rendered})"


class _UsageTotals:
    def __init__(self) -> None:
        self.usage = TokenUsage()
        self.cost_usd = 0.0

    def add(self, usage: TokenUsage, cost: float) -> None:
        self.usage = TokenUsage(
            input_tokens=self.usage.input_tokens + usage.input_tokens,
            output_tokens=self.usage.output_tokens + usage.output_tokens,
            cache_read_input_tokens=(
                self.usage.cache_read_input_tokens + usage.cache_read_input_tokens
            ),
            cache_creation_input_tokens=(
                self.usage.cache_creation_input_tokens + usage.cache_creation_input_tokens
            ),
        )
        self.cost_usd += cost
