"""Provider-neutral conversation types.

ADR-003 puts Claude behind an interface with OpenAI as a fallback, which only
works if the agent loop never handles a provider's wire format. So the loop
speaks in the types below and each provider translates.

The one concession is `AssistantTurn.raw_blocks`: providers need their own
content echoed back byte-for-byte on the next call (Anthropic rejects edited
thinking blocks, and prompt caching is a prefix match that any rewrite
invalidates). The loop carries that payload without ever looking inside it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from app.llm.pricing import TokenUsage


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    input_schema: dict[str, Any]

    # Whether calling this tool changes the world. Read-only lookups are traced
    # as `tool_call`; mutations are traced as `action`, which is what the Trace
    # Viewer highlights and what an audit reviewer scans for.
    mutates: bool = False


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    content: str
    is_error: bool = False


@dataclass(frozen=True)
class UserTurn:
    text: str


@dataclass(frozen=True)
class AssistantTurn:
    text: str
    tool_calls: tuple[ToolCall, ...] = ()
    # Opaque provider payload — echoed back verbatim, never inspected.
    raw_blocks: Any = None


@dataclass(frozen=True)
class ToolResultTurn:
    results: tuple[ToolResult, ...]


Turn = UserTurn | AssistantTurn | ToolResultTurn


@dataclass(frozen=True)
class LlmResponse:
    """One model call's outcome, normalised across providers."""

    text: str
    tool_calls: tuple[ToolCall, ...]
    stop_reason: str
    usage: TokenUsage
    model: str
    raw_blocks: Any = None
    latency_ms: int = 0
    # Summarised reasoning when the provider exposes it. Anthropic never returns
    # the raw chain of thought — only a summary, and only when asked for one.
    reasoning: str = ""

    @property
    def wants_tools(self) -> bool:
        return self.stop_reason == "tool_use" and bool(self.tool_calls)


class LlmProvider(Protocol):
    """What the agent loop needs from a model. Implemented per vendor."""

    name: str
    model: str

    def complete(
        self,
        *,
        system: str,
        turns: list[Turn],
        tools: list[ToolDefinition],
        max_tokens: int = 16_000,
    ) -> LlmResponse: ...


@dataclass
class RecordedProvider:
    """A provider that replays a fixed script of responses.

    Not a mock in the loose sense — it implements the same protocol, so tests
    exercise the real loop end to end without a network call, an API key, or a
    cent of spend. CI runs entirely on this.
    """

    responses: list[LlmResponse]
    name: str = "recorded"
    model: str = "recorded-model"
    calls: list[dict[str, Any]] = field(default_factory=list)

    def complete(
        self,
        *,
        system: str,
        turns: list[Turn],
        tools: list[ToolDefinition],
        max_tokens: int = 16_000,
    ) -> LlmResponse:
        self.calls.append(
            {
                "system": system,
                "turns": list(turns),
                "tools": [tool.name for tool in tools],
                "max_tokens": max_tokens,
            }
        )
        if not self.responses:
            raise AssertionError("RecordedProvider ran out of scripted responses")
        return self.responses.pop(0)
