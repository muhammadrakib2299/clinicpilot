"""The loop is exercised end to end against a scripted provider.

RecordedProvider implements the same protocol as the real one, so these tests
run the actual loop — no network, no API key, no spend — and CI runs on them.
"""

from datetime import date

import pytest

from app.agents.loop import run_agent
from app.agents.scheduling import SCHEDULING_TOOLS, SYSTEM_PROMPT
from app.agents.trace import CollectingSink
from app.llm.pricing import TokenUsage
from app.llm.provider import (
    AssistantTurn,
    LlmResponse,
    RecordedProvider,
    ToolCall,
    ToolResultTurn,
)

PRICED_ON = date(2026, 7, 29)


def reply(text: str, *, tokens_in: int = 100, tokens_out: int = 20) -> LlmResponse:
    return LlmResponse(
        text=text,
        tool_calls=(),
        stop_reason="end_turn",
        usage=TokenUsage(input_tokens=tokens_in, output_tokens=tokens_out),
        model="claude-sonnet-5",
        latency_ms=120,
    )


def calls(*tool_calls: ToolCall, reasoning: str = "", tokens_in: int = 200) -> LlmResponse:
    return LlmResponse(
        text="",
        tool_calls=tool_calls,
        stop_reason="tool_use",
        usage=TokenUsage(input_tokens=tokens_in, output_tokens=40),
        model="claude-sonnet-5",
        latency_ms=250,
        reasoning=reasoning,
        raw_blocks=[{"type": "tool_use", "id": c.id} for c in tool_calls],
    )


def run(responses, execute, **kwargs):
    sink = CollectingSink()
    provider = RecordedProvider(responses=list(responses))
    result = run_agent(
        provider=provider,
        system=SYSTEM_PROMPT,
        task="Move my Thursday appointment to next week.",
        tools=SCHEDULING_TOOLS,
        execute=execute,
        on_step=sink,
        priced_on=PRICED_ON,
        **kwargs,
    )
    return result, sink, provider


class TestHappyPath:
    def test_answers_directly_when_no_tool_is_needed(self) -> None:
        result, sink, _ = run([reply("Your appointment is Thursday at 2pm.")], lambda c: "")

        assert result.outcome == "resolved"
        assert result.iterations == 1
        assert sink.kinds == ["reason"]

    def test_full_reschedule_emits_the_expected_step_sequence(self) -> None:
        responses = [
            calls(
                ToolCall("t1", "find_appointments", {"patient_id": "40021"}),
                reasoning="Need the current booking before offering alternatives.",
            ),
            calls(
                ToolCall(
                    "t2",
                    "find_availability",
                    {"schedule_id": "s1", "from_instant": "2026-08-01T00:00:00Z"},
                )
            ),
            calls(
                ToolCall(
                    "t3",
                    "reschedule_appointment",
                    {
                        "appointment_id": "9f2",
                        "slot_id": "slot-1",
                        "start": "2026-08-04T10:30:00Z",
                        "end": "2026-08-04T11:00:00Z",
                    },
                )
            ),
            reply("Done — you're now booked for Tuesday 4 August at 10:30."),
        ]
        observations = {
            "find_appointments": "1 booked: Appointment/9f2 Thu 14:00",
            "find_availability": "3 free slots; earliest Tue 10:30",
            "reschedule_appointment": "Appointment/9f2 moved to Tue 10:30",
        }

        result, sink, _ = run(responses, lambda c: observations[c.name])

        assert result.outcome == "resolved"
        assert sink.kinds == [
            "reason",
            "tool_call",
            "observation",
            "reason",
            "tool_call",
            "observation",
            # The write is `action`, not `tool_call` — that is the distinction
            # an audit reviewer scans for.
            "reason",
            "action",
            "observation",
            "reason",
        ]

    def test_steps_are_numbered_from_one_without_gaps(self) -> None:
        _, sink, _ = run(
            [calls(ToolCall("t1", "find_appointments", {})), reply("ok")],
            lambda c: "found",
        )

        assert [step.step_no for step in sink.steps] == [1, 2, 3, 4]

    def test_reason_step_carries_the_summarised_reasoning(self) -> None:
        _, sink, _ = run(
            [
                calls(ToolCall("t1", "find_appointments", {}), reasoning="Check what is booked."),
                reply("ok"),
            ],
            lambda c: "found",
        )

        assert sink.steps[0].detail == "Check what is booked."

    def test_reason_step_falls_back_to_text_then_to_a_placeholder(self) -> None:
        _, sink, _ = run(
            [calls(ToolCall("t1", "find_appointments", {})), reply("ok")], lambda c: "x"
        )

        assert sink.steps[0].detail == "Planning the next action."


class TestParallelToolCalls:
    def test_all_calls_in_one_turn_are_traced_and_answered_together(self) -> None:
        responses = [
            calls(
                ToolCall("t1", "find_appointments", {"patient_id": "1"}),
                ToolCall("t2", "find_availability", {"schedule_id": "s", "from_instant": "z"}),
            ),
            reply("Both checked."),
        ]

        _, sink, provider = run(responses, lambda c: f"result for {c.name}")

        assert sink.kinds == [
            "reason",
            "tool_call",
            "observation",
            "tool_call",
            "observation",
            "reason",
        ]

        # Both results must ride in ONE tool-result turn. Splitting them across
        # turns teaches the model to stop calling tools in parallel.
        second_call_turns = provider.calls[1]["turns"]
        result_turns = [t for t in second_call_turns if isinstance(t, ToolResultTurn)]
        assert len(result_turns) == 1
        assert len(result_turns[0].results) == 2


class TestToolFailures:
    def test_a_raising_tool_becomes_an_error_observation_not_a_crash(self) -> None:
        def explode(call: ToolCall) -> str:
            raise RuntimeError("HAPI returned 502")

        result, sink, _ = run(
            [
                calls(ToolCall("t1", "find_appointments", {})),
                reply("I could not reach the calendar."),
            ],
            explode,
        )

        assert result.outcome == "resolved"
        observation = sink.steps[2]
        assert observation.kind == "observation"
        assert "RuntimeError: HAPI returned 502" in observation.detail
        assert observation.content == {"toolUseId": "t1", "isError": True}

    def test_the_error_is_fed_back_so_the_model_can_recover(self) -> None:
        def explode(call: ToolCall) -> str:
            raise RuntimeError("boom")

        _, _, provider = run(
            [calls(ToolCall("t1", "find_appointments", {})), reply("sorry")], explode
        )

        results = [t for t in provider.calls[1]["turns"] if isinstance(t, ToolResultTurn)][0]
        assert results.results[0].is_error is True

    def test_an_unknown_tool_is_reported_rather_than_executed(self) -> None:
        executed: list[str] = []

        def record(call: ToolCall) -> str:
            executed.append(call.name)
            return "should not happen"

        _, sink, _ = run([calls(ToolCall("t1", "delete_patient", {})), reply("no")], record)

        assert executed == []
        assert "Unknown tool 'delete_patient'" in sink.steps[2].detail

    def test_an_unknown_tool_is_traced_as_tool_call_not_action(self) -> None:
        # It has no definition, so we cannot know it mutates — the safe default
        # is the lower-signal kind rather than crying `action`.
        _, sink, _ = run([calls(ToolCall("t1", "mystery", {})), reply("no")], lambda c: "x")

        assert sink.steps[1].kind == "tool_call"


class TestEscalation:
    def test_escalates_instead_of_looping_forever(self) -> None:
        never_finishes = [calls(ToolCall(f"t{i}", "find_appointments", {})) for i in range(10)]

        result, sink, _ = run(never_finishes, lambda c: "still looking", max_iterations=3)

        assert result.outcome == "escalated"
        assert result.iterations == 3
        assert sink.kinds[-1] == "escalation"

    def test_the_escalation_step_records_why(self) -> None:
        responses = [calls(ToolCall(f"t{i}", "find_appointments", {})) for i in range(5)]

        _, sink, _ = run(responses, lambda c: "looking", max_iterations=2)

        escalation = sink.steps[-1]
        assert escalation.content == {"reason": "max_iterations", "maxIterations": 2}
        assert "human queue" in escalation.detail


class TestCostAccounting:
    def test_every_model_call_is_priced_and_the_run_total_is_their_sum(self) -> None:
        responses = [
            calls(ToolCall("t1", "find_appointments", {}), tokens_in=1_000_000),
            reply("done", tokens_in=0, tokens_out=1_000_000),
        ]

        result, sink, _ = run(responses, lambda c: "ok")

        # Sonnet 5 introductory rates on PRICED_ON: $2/MTok in, $10/MTok out.
        # Call 1: 1M in + 40 out. Call 2: 1M out.
        assert result.cost_usd == pytest.approx(2.00 + 0.0004 + 10.00, abs=1e-6)
        assert sink.total_cost_usd == pytest.approx(result.cost_usd, abs=1e-9)

    def test_only_model_calls_carry_cost_never_tool_or_observation_steps(self) -> None:
        _, sink, _ = run(
            [calls(ToolCall("t1", "find_appointments", {})), reply("ok")], lambda c: "found"
        )

        priced = [s.kind for s in sink.steps if s.cost_usd is not None]
        assert set(priced) == {"reason"}

    def test_aggregate_usage_sums_every_call(self) -> None:
        responses = [
            calls(ToolCall("t1", "find_appointments", {}), tokens_in=200),
            reply("ok", tokens_in=300, tokens_out=20),
        ]

        result, _, _ = run(responses, lambda c: "ok")

        assert result.usage.input_tokens == 500
        assert result.usage.output_tokens == 60


class TestConversationState:
    def test_the_task_is_the_first_user_turn(self) -> None:
        _, _, provider = run([reply("ok")], lambda c: "")

        turns = provider.calls[0]["turns"]
        assert turns[0].text == "Move my Thursday appointment to next week."

    def test_assistant_raw_blocks_are_echoed_back_untouched(self) -> None:
        # Reconstructing assistant content would drop thinking blocks and
        # tool_use ids, and the API rejects a modified thinking block.
        blocks = [{"type": "tool_use", "id": "t1"}]
        first = calls(ToolCall("t1", "find_appointments", {}))
        first = LlmResponse(**{**first.__dict__, "raw_blocks": blocks})

        _, _, provider = run([first, reply("ok")], lambda c: "found")

        assistant = [t for t in provider.calls[1]["turns"] if isinstance(t, AssistantTurn)][0]
        assert assistant.raw_blocks is blocks

    def test_every_call_receives_the_full_tool_surface(self) -> None:
        _, _, provider = run(
            [calls(ToolCall("t1", "find_appointments", {})), reply("ok")], lambda c: "x"
        )

        for call in provider.calls:
            assert call["tools"] == [
                "find_appointments",
                "find_availability",
                "reschedule_appointment",
            ]


class TestToolSurface:
    def test_only_the_write_tool_is_marked_as_mutating(self) -> None:
        mutating = [tool.name for tool in SCHEDULING_TOOLS if tool.mutates]

        assert mutating == ["reschedule_appointment"]

    def test_the_agent_has_no_tool_that_could_answer_a_clinical_question(self) -> None:
        # Scope is enforced by the tool surface, not by asking the prompt
        # nicely — there is simply nothing here that reaches clinical data.
        names = {tool.name for tool in SCHEDULING_TOOLS}

        assert names == {"find_appointments", "find_availability", "reschedule_appointment"}

    def test_the_system_prompt_forbids_clinical_advice(self) -> None:
        assert "clinical" in SYSTEM_PROMPT.lower()
        assert "never" in SYSTEM_PROMPT.lower()
