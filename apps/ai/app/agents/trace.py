"""Trace steps — the audit record of what an agent did and why.

Kinds mirror `trace_kind` in the gateway's schema and `TraceKind` in
packages/shared-types. Adding one here means adding it in both of those too.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

TraceKind = Literal["reason", "tool_call", "observation", "action", "escalation"]


@dataclass(frozen=True)
class TraceStep:
    step_no: int
    kind: TraceKind
    label: str
    detail: str
    content: dict[str, Any] | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost_usd: float | None = None
    latency_ms: int | None = None

    def to_payload(self) -> dict[str, Any]:
        """Wire shape the gateway persists and broadcasts (ADR-004)."""
        return {
            "stepNo": self.step_no,
            "kind": self.kind,
            "label": self.label,
            "detail": self.detail,
            "content": self.content,
            "tokensIn": self.tokens_in,
            "tokensOut": self.tokens_out,
            "costUsd": self.cost_usd,
            "latencyMs": self.latency_ms,
        }


class TraceSink(Protocol):
    """Where steps go. The gateway HTTP client in prod, a list in tests."""

    def __call__(self, step: TraceStep) -> None: ...


@dataclass
class CollectingSink:
    """Accumulates steps in memory."""

    steps: list[TraceStep] = field(default_factory=list)

    def __call__(self, step: TraceStep) -> None:
        self.steps.append(step)

    @property
    def kinds(self) -> list[str]:
        return [step.kind for step in self.steps]

    @property
    def total_cost_usd(self) -> float:
        return sum(step.cost_usd or 0.0 for step in self.steps)
