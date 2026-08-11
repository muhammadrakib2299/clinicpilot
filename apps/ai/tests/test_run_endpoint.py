"""`POST /run` — the endpoint that makes the agent reachable from the product.

Until this existed the loop could only be driven from a CLI script, so a task
created in the dashboard was never executed at all. These tests cover the
contract the queue worker will depend on in Phase 3: a run reports its own
outcome, and a failure never leaves a task stuck `running`.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.agents import runner
from app.agents.runner import ProviderUnavailableError, UnknownAgentError, run_task
from app.agents.trace import TraceStep
from app.llm.pricing import TokenUsage
from app.llm.provider import LlmResponse, RecordedProvider, ToolCall
from app.main import app

PRICED_ON = date(2026, 8, 11)


class FakeSink:
    """Stands in for GatewayTraceSink — records the lifecycle calls instead."""

    def __init__(self) -> None:
        self.steps: list[TraceStep] = []
        self.status: str | None = None
        self.outcome: str | None = None
        self.running = False
        self.closed = False

    def __call__(self, step: TraceStep) -> None:
        self.steps.append(step)

    def mark_running(self) -> None:
        self.running = True

    def complete(self, status: str, outcome: str | None) -> None:
        self.status = status
        self.outcome = outcome

    def close(self) -> None:
        self.closed = True


def reply(text: str) -> LlmResponse:
    return LlmResponse(
        text=text,
        tool_calls=(),
        stop_reason="end_turn",
        usage=TokenUsage(input_tokens=100, output_tokens=20),
        model="claude-sonnet-5",
        latency_ms=100,
    )


class TestRunTask:
    def test_marks_the_task_running_before_the_first_model_call(self) -> None:
        sink = FakeSink()

        run_task(
            task_id="t-1",
            task_input="move my appointment",
            provider=RecordedProvider(responses=[reply("done")]),
            sink=sink,
            fhir=object(),  # never touched: this run makes no tool call
            priced_on=PRICED_ON,
        )

        assert sink.running is True

    def test_reports_the_terminal_outcome_to_the_gateway(self) -> None:
        sink = FakeSink()

        result = run_task(
            task_id="t-1",
            task_input="move my appointment",
            provider=RecordedProvider(responses=[reply("Moved to Tuesday 10:30.")]),
            sink=sink,
            fhir=object(),
            priced_on=PRICED_ON,
        )

        assert result.outcome == "resolved"
        assert sink.status == "resolved"
        assert sink.outcome == "Moved to Tuesday 10:30."

    def test_records_failed_rather_than_leaving_the_task_running(self) -> None:
        # A row stuck `running` sits in the inbox forever and the Task Inbox
        # ends up lying about what the system is doing.
        class Exploding:
            name = "exploding"
            model = "none"

            def complete(self, **kwargs: object) -> LlmResponse:
                raise RuntimeError("model unreachable")

        sink = FakeSink()

        with pytest.raises(RuntimeError):
            run_task(
                task_id="t-1",
                task_input="move it",
                provider=Exploding(),
                sink=sink,
                fhir=object(),
                priced_on=PRICED_ON,
            )

        assert sink.status == "failed"
        assert "model unreachable" in (sink.outcome or "")

    def test_a_tool_failure_is_not_a_task_failure(self) -> None:
        # The loop feeds a raising tool back to the model as an observation, so
        # the run can still resolve. Only the model being unreachable fails it.
        class BrokenFhir:
            def find_appointments(self, **kwargs: object) -> list:
                raise RuntimeError("gateway down")

        responses = [
            LlmResponse(
                text="",
                tool_calls=(ToolCall("t1", "find_appointments", {"patient_id": "1"}),),
                stop_reason="tool_use",
                usage=TokenUsage(input_tokens=100, output_tokens=10),
                model="claude-sonnet-5",
            ),
            reply("I could not reach the calendar — a human will follow up."),
        ]
        sink = FakeSink()

        result = run_task(
            task_id="t-1",
            task_input="move it",
            provider=RecordedProvider(responses=responses),
            sink=sink,
            fhir=BrokenFhir(),
            priced_on=PRICED_ON,
        )

        assert result.outcome == "resolved"
        assert sink.status == "resolved"

    def test_rejects_an_agent_kind_that_is_not_deployed(self) -> None:
        with pytest.raises(UnknownAgentError, match="scheduling"):
            run_task(
                task_id="t-1",
                task_input="x",
                agent_kind="radiology",
                provider=RecordedProvider(responses=[reply("hi")]),
                sink=FakeSink(),
                fhir=object(),
            )

    def test_says_what_is_missing_when_there_is_no_api_key(self, monkeypatch) -> None:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        with pytest.raises(ProviderUnavailableError, match="ANTHROPIC_API_KEY"):
            run_task(task_id="t-1", task_input="x", sink=FakeSink(), fhir=object())

    def test_closes_a_sink_it_created_but_not_one_it_was_given(self) -> None:
        sink = FakeSink()

        run_task(
            task_id="t-1",
            task_input="x",
            provider=RecordedProvider(responses=[reply("done")]),
            sink=sink,
            fhir=object(),
            priced_on=PRICED_ON,
        )

        assert sink.closed is False


class TestRunEndpoint:
    def test_health_advertises_which_agents_are_deployed(self) -> None:
        body = TestClient(app).get("/health").json()

        assert body["agents"] == ["scheduling"]

    def test_returns_the_run_result_in_camel_case(self, monkeypatch) -> None:
        def fake_run(**kwargs: object):
            class Result:
                outcome = "resolved"
                summary = "Moved to Tuesday 10:30."
                steps = 9
                iterations = 3
                cost_usd = 0.0153
                usage = TokenUsage(input_tokens=1200, output_tokens=340)

            return Result()

        monkeypatch.setattr("app.main.run_task", fake_run)

        response = TestClient(app).post(
            "/run", json={"taskId": "t-1", "input": "move my Thursday appointment"}
        )

        assert response.status_code == 200
        assert response.json() == {
            "taskId": "t-1",
            "outcome": "resolved",
            "summary": "Moved to Tuesday 10:30.",
            "steps": 9,
            "iterations": 3,
            "costUsd": 0.0153,
            "tokensIn": 1200,
            "tokensOut": 340,
        }

    def test_an_unknown_agent_is_400_not_500(self, monkeypatch) -> None:
        def fake_run(**kwargs: object):
            raise UnknownAgentError("No 'radiology' agent is deployed.")

        monkeypatch.setattr("app.main.run_task", fake_run)

        response = TestClient(app).post(
            "/run", json={"taskId": "t-1", "input": "x", "agentKind": "radiology"}
        )

        assert response.status_code == 400

    def test_a_missing_api_key_is_503_so_a_queue_retries_rather_than_dead_letters(
        self, monkeypatch
    ) -> None:
        def fake_run(**kwargs: object):
            raise ProviderUnavailableError("ANTHROPIC_API_KEY is not set")

        monkeypatch.setattr("app.main.run_task", fake_run)

        response = TestClient(app).post("/run", json={"taskId": "t-1", "input": "x"})

        assert response.status_code == 503

    def test_an_unexpected_failure_is_502_with_the_reason(self, monkeypatch) -> None:
        def fake_run(**kwargs: object):
            raise RuntimeError("anthropic timed out")

        monkeypatch.setattr("app.main.run_task", fake_run)

        response = TestClient(app).post("/run", json={"taskId": "t-1", "input": "x"})

        assert response.status_code == 502
        assert "anthropic timed out" in response.json()["detail"]

    def test_rejects_an_empty_task_input(self) -> None:
        response = TestClient(app).post("/run", json={"taskId": "t-1", "input": ""})

        assert response.status_code == 422

    def test_defaults_the_agent_kind_to_scheduling(self, monkeypatch) -> None:
        seen: dict = {}

        def fake_run(**kwargs: object):
            seen.update(kwargs)
            raise UnknownAgentError("stop here")

        monkeypatch.setattr("app.main.run_task", fake_run)
        TestClient(app).post("/run", json={"taskId": "t-1", "input": "x"})

        assert seen["agent_kind"] == "scheduling"


def test_the_registry_is_the_routing_seam_phase_3_replaces() -> None:
    assert set(runner.AGENTS) == {"scheduling"}
