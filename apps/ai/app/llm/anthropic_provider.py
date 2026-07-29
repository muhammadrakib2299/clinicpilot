"""Anthropic implementation of `LlmProvider`."""

from __future__ import annotations

import os
import time
from typing import Any

import anthropic

from app.llm.pricing import TokenUsage
from app.llm.provider import (
    AssistantTurn,
    LlmResponse,
    ToolCall,
    ToolDefinition,
    ToolResultTurn,
    Turn,
    UserTurn,
)

DEFAULT_MODEL = "claude-sonnet-5"


class AnthropicProvider:
    """Claude via the official SDK.

    Adaptive thinking is on with `display="summarized"`. The summary is not a
    nicety here: it becomes the `reason` step in the Trace Viewer, which is the
    whole point of the product. The raw chain of thought is never returned by
    the API on any model — a summary is the most that exists.
    """

    name = "anthropic"

    def __init__(
        self,
        *,
        model: str | None = None,
        client: anthropic.Anthropic | None = None,
        effort: str = "medium",
    ) -> None:
        self.model = model or os.environ.get("ANTHROPIC_MODEL") or DEFAULT_MODEL
        self.effort = effort
        self._client = client or anthropic.Anthropic()

    def complete(
        self,
        *,
        system: str,
        turns: list[Turn],
        tools: list[ToolDefinition],
        max_tokens: int = 16_000,
    ) -> LlmResponse:
        started = time.monotonic()

        response = self._client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=_to_wire(turns),
            tools=[_tool_to_wire(tool) for tool in tools],
            thinking={"type": "adaptive", "display": "summarized"},
            output_config={"effort": self.effort},
        )

        latency_ms = int((time.monotonic() - started) * 1000)
        return _from_wire(response, latency_ms)


def _tool_to_wire(tool: ToolDefinition) -> dict[str, Any]:
    return {
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.input_schema,
    }


def _to_wire(turns: list[Turn]) -> list[dict[str, Any]]:
    """Translate neutral turns into Anthropic's messages array."""
    messages: list[dict[str, Any]] = []

    for turn in turns:
        if isinstance(turn, UserTurn):
            messages.append({"role": "user", "content": turn.text})

        elif isinstance(turn, AssistantTurn):
            # Echo the provider's own blocks back untouched. Reconstructing them
            # from `text` would drop thinking blocks and tool_use ids, and the
            # API rejects a modified thinking block outright.
            content = turn.raw_blocks if turn.raw_blocks is not None else turn.text
            messages.append({"role": "assistant", "content": content})

        elif isinstance(turn, ToolResultTurn):
            # Every result for a turn goes in ONE user message. Splitting them
            # across messages trains the model to stop calling tools in parallel.
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": result.call_id,
                            "content": result.content,
                            **({"is_error": True} if result.is_error else {}),
                        }
                        for result in turn.results
                    ],
                }
            )

    return messages


def _from_wire(response: Any, latency_ms: int) -> LlmResponse:
    text_parts: list[str] = []
    reasoning_parts: list[str] = []
    tool_calls: list[ToolCall] = []

    for block in response.content:
        kind = getattr(block, "type", None)
        if kind == "text":
            text_parts.append(block.text)
        elif kind == "thinking":
            # Empty unless display="summarized"; harmless to collect either way.
            reasoning_parts.append(getattr(block, "thinking", "") or "")
        elif kind == "tool_use":
            tool_calls.append(
                ToolCall(id=block.id, name=block.name, arguments=dict(block.input or {}))
            )

    return LlmResponse(
        text="\n".join(part for part in text_parts if part).strip(),
        tool_calls=tuple(tool_calls),
        stop_reason=response.stop_reason,
        usage=TokenUsage.from_response(response.usage),
        model=response.model,
        raw_blocks=response.content,
        latency_ms=latency_ms,
        reasoning="\n".join(part for part in reasoning_parts if part).strip(),
    )
