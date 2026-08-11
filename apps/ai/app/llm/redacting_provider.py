"""A provider that de-identifies everything on its way to the model (ADR-006).

Implemented as a decorator around `LlmProvider` rather than as a step in the
loop, and that is the whole design. A redaction step inside the loop protects
the calls the loop makes today; a decorator protects every call anything ever
makes through this provider, including the ones added next year by someone who
has not read this file.

It composes with `FallbackProvider` in either order. Wrap redaction outermost —
`RedactingProvider(FallbackProvider([...]))` — so a fallback to a second vendor
cannot become a path that skips it.
"""

from __future__ import annotations

from dataclasses import replace

from app.llm.provider import (
    AssistantTurn,
    LlmProvider,
    LlmResponse,
    ToolCall,
    ToolDefinition,
    ToolResult,
    ToolResultTurn,
    Turn,
    UserTurn,
)
from app.safety.redaction import Redactor


class RedactingProvider:
    """Redacts outbound turns, restores inbound text and tool arguments."""

    def __init__(self, inner: LlmProvider, redactor: Redactor) -> None:
        self._inner = inner
        self._redactor = redactor

    @property
    def name(self) -> str:
        return f"redacted:{self._inner.name}"

    @property
    def model(self) -> str:
        return self._inner.model

    @property
    def redactor(self) -> Redactor:
        return self._redactor

    def complete(
        self,
        *,
        system: str,
        turns: list[Turn],
        tools: list[ToolDefinition],
        max_tokens: int = 16_000,
    ) -> LlmResponse:
        response = self._inner.complete(
            system=system,
            turns=[self._redact_turn(turn) for turn in turns],
            tools=tools,
            max_tokens=max_tokens,
        )

        # Restore on the way back so the trace, the summary and the tool
        # arguments all carry real values. The model itself never saw them.
        return replace(
            response,
            text=self._redactor.restore(response.text),
            reasoning=self._redactor.restore(response.reasoning),
            tool_calls=tuple(
                ToolCall(
                    id=call.id,
                    name=call.name,
                    arguments=self._redactor.restore_deep(call.arguments),  # type: ignore[arg-type]
                )
                for call in response.tool_calls
            ),
        )

    def _redact_turn(self, turn: Turn) -> Turn:
        if isinstance(turn, UserTurn):
            return UserTurn(text=self._redactor.redact(turn.text))

        if isinstance(turn, ToolResultTurn):
            # Where most PHI actually enters: a FHIR search result carries the
            # patient's name and telephone number straight into the prompt.
            return ToolResultTurn(
                results=tuple(
                    ToolResult(
                        call_id=result.call_id,
                        content=self._redactor.redact(result.content),
                        is_error=result.is_error,
                    )
                    for result in turn.results
                )
            )

        if isinstance(turn, AssistantTurn):
            # `raw_blocks` is echoed back untouched and is safe to leave alone:
            # the model produced it having only ever seen placeholders, so it
            # contains placeholders. `text` is re-redacted because `complete`
            # restored it on the way out, and this is the path back in.
            return AssistantTurn(
                text=self._redactor.redact(turn.text),
                tool_calls=turn.tool_calls,
                raw_blocks=turn.raw_blocks,
            )

        return turn
