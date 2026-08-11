"""The self-check before a high-stakes write.

Motivated by a real incident: an early run wrote a malformed slot reference
onto a live appointment and the FHIR server accepted it, because nothing
between the model and the write asked whether the values were real.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.agents import reflection
from app.agents.loop import run_agent
from app.agents.scheduling import SCHEDULING_TOOLS, SYSTEM_PROMPT
from app.agents.trace import CollectingSink
from app.llm.pricing import TokenUsage
from app.llm.provider import LlmResponse, RecordedProvider, ToolCall

PRICED_ON = date(2026, 8, 11)

WRITE = ToolCall(
    "t1",
    "reschedule_appointment",
    {
        "appointment_id": "137240399",
        "slot_id": "137240396",
        "start": "2026-08-18T10:30:00Z",
        "end": "2026-08-18T11:00:00Z",
    },
)


def reply(text: str) -> LlmResponse:
    return LlmResponse(
        text=text,
        tool_calls=(),
        stop_reason="end_turn",
        usage=TokenUsage(input_tokens=200, output_tokens=10),
        model="claude-sonnet-5",
        latency_ms=90,
    )


def wants(call: ToolCall) -> LlmResponse:
    return LlmResponse(
        text="",
        tool_calls=(call,),
        stop_reason="tool_use",
        usage=TokenUsage(input_tokens=300, output_tokens=40),
        model="claude-sonnet-5",
        raw_blocks=[{"type": "tool_use", "id": call.id}],
    )


class TestInterpretingTheVerdict:
    def test_approve(self) -> None:
        assert reflection.interpret("APPROVE")[0] is True

    def test_approve_with_trailing_commentary(self) -> None:
        approved, _ = reflection.interpret("APPROVE\nEverything checks out.")

        assert approved is True

    def test_block_carries_the_reason(self) -> None:
        approved, detail = reflection.interpret("BLOCK: the 09:00 slot was never offered")

        assert approved is False
        assert detail == "the 09:00 slot was never offered"

    def test_block_with_no_reason_still_blocks(self) -> None:
        approved, detail = reflection.interpret("BLOCK")

        assert approved is False
        assert detail == "No reason given."

    @pytest.mark.parametrize(
        "text",
        ["", "   ", "I think this is probably fine", "Sure, go ahead!", "APPROVED?"],
    )
    def test_anything_unparseable_fails_closed(self, text: str) -> None:
        # The safe direction, and not a dead end: the block is fed back as an
        # error result and the model gets another turn. A spurious block costs
        # one iteration; a spurious approval costs a wrong write.
        approved, detail = reflection.interpret(text)

        assert approved is False
        assert "did not return a verdict" in detail

    def test_the_verdict_is_case_insensitive(self) -> None:
        assert reflection.interpret("approve")[0] is True
        assert reflection.interpret("block: no")[0] is False


class TestReview:
    def test_the_reviewer_gets_the_observations_not_the_conversation(self) -> None:
        # Asking the model to review its own reasoning inside the context that
        # produced it mostly gets agreement. A fresh context with just the
        # evidence is the point.
        provider = RecordedProvider(responses=[reply("APPROVE")])

        reflection.review(
            provider=provider,
            task="move my Thursday appointment",
            observations=["find_availability -> Slot id=137240396: 2026-08-18T10:30:00Z"],
            call=WRITE,
        )

        sent = provider.calls[0]["turns"][0].text
        assert "137240396" in sent
        assert "move my Thursday appointment" in sent
        assert provider.calls[0]["tools"] == []

    def test_it_is_a_separate_system_prompt(self) -> None:
        provider = RecordedProvider(responses=[reply("APPROVE")])

        reflection.review(provider=provider, task="t", observations=[], call=WRITE)

        assert provider.calls[0]["system"] != SYSTEM_PROMPT
        assert "safety reviewer" in provider.calls[0]["system"]

    def test_no_observations_yet_is_stated_rather_than_left_blank(self) -> None:
        provider = RecordedProvider(responses=[reply("BLOCK: nothing was looked up")])

        result = reflection.review(provider=provider, task="t", observations=[], call=WRITE)

        assert "(nothing yet)" in provider.calls[0]["turns"][0].text
        assert result.approved is False


def run_with_write(verdict: str, executed: list[str]):
    sink = CollectingSink()
    provider = RecordedProvider(responses=[wants(WRITE), reply(verdict), reply("All done.")])

    def execute(call: ToolCall) -> str:
        executed.append(call.name)
        return "Rescheduled appointment id=137240399 to 2026-08-18T10:30:00Z."

    result = run_agent(
        provider=provider,
        system=SYSTEM_PROMPT,
        task="move my Thursday appointment",
        tools=SCHEDULING_TOOLS,
        execute=execute,
        on_step=sink,
        priced_on=PRICED_ON,
    )
    return result, sink


class TestInTheLoop:
    def test_an_approved_write_runs(self) -> None:
        executed: list[str] = []

        _, sink = run_with_write("APPROVE", executed)

        assert executed == ["reschedule_appointment"]
        assert sink.kinds == ["reason", "reflection", "action", "observation", "reason"]

    def test_a_blocked_write_never_reaches_the_tool(self) -> None:
        # The whole point. The observation the model sees is the objection.
        executed: list[str] = []

        _, sink = run_with_write("BLOCK: that slot was never offered", executed)

        assert executed == []
        assert "action" not in sink.kinds
        assert "that slot was never offered" in sink.steps[-2].detail

    def test_the_block_is_fed_back_so_the_model_can_correct_itself(self) -> None:
        executed: list[str] = []

        result, sink = run_with_write("BLOCK: made-up time", executed)

        # Same recovery path a failing tool already uses — the run continues.
        assert result.outcome == "resolved"
        observation = next(s for s in sink.steps if s.kind == "observation")
        assert observation.content == {"toolUseId": "t1", "isError": True}

    def test_the_check_is_costed_like_any_other_model_call(self) -> None:
        # It is an extra call per write. Leaving it off the bill would
        # understate spend exactly where someone is deciding whether the
        # safety is worth paying for.
        result, sink = run_with_write("APPROVE", [])

        step = next(s for s in sink.steps if s.kind == "reflection")
        assert step.cost_usd is not None and step.cost_usd > 0
        assert step.model == "claude-sonnet-5"
        # And it is included in the run total, not accounted separately.
        assert result.cost_usd == pytest.approx(sink.total_cost_usd, abs=1e-9)

    def test_the_reflection_step_records_its_verdict_in_content(self) -> None:
        _, sink = run_with_write("APPROVE", [])

        step = next(s for s in sink.steps if s.kind == "reflection")
        assert step.content == {
            "toolUseId": "t1",
            "approved": True,
            "tool": "reschedule_appointment",
        }

    def test_it_can_be_turned_off(self) -> None:
        # Off for tests that assert on raw prompts, and for a deployment that
        # decides the extra call is not worth it.
        executed: list[str] = []
        sink = CollectingSink()

        run_agent(
            provider=RecordedProvider(responses=[wants(WRITE), reply("done")]),
            system=SYSTEM_PROMPT,
            task="t",
            tools=SCHEDULING_TOOLS,
            execute=lambda c: executed.append(c.name) or "ok",
            on_step=sink,
            priced_on=PRICED_ON,
            reflect_before_writes=False,
        )

        assert "reflection" not in sink.kinds
        assert executed == ["reschedule_appointment"]
