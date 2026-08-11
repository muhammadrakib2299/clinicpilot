"""`POST /run` — the endpoint that makes the agent reachable from the product.

Until this existed the loop could only be driven from a CLI script, so a task
created in the dashboard was never executed at all. These tests cover the
contract the queue worker will depend on in Phase 3: a run reports its own
outcome, and a failure never leaves a task stuck `running`.
"""

from __future__ import annotations

from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient

from app.agents import runner
from app.agents.gateway_sink import GatewayTraceSink, TaskNotRunnableError
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
            agent_kind="scheduling",
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
            agent_kind="scheduling",
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
                agent_kind="scheduling",
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
            agent_kind="scheduling",
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
            run_task(
                task_id="t-1",
                task_input="x",
                agent_kind="scheduling",
                sink=FakeSink(),
                fhir=object(),
            )

    def test_closes_a_sink_it_created_but_not_one_it_was_given(self) -> None:
        sink = FakeSink()

        run_task(
            task_id="t-1",
            task_input="x",
            agent_kind="scheduling",
            provider=RecordedProvider(responses=[reply("done")]),
            sink=sink,
            fhir=object(),
            priced_on=PRICED_ON,
        )

        assert sink.closed is False


class TestRunEndpoint:
    def test_health_advertises_which_agents_are_deployed(self) -> None:
        body = TestClient(app).get("/health").json()

        assert body["agents"] == ["followup", "scheduling"]

    def test_health_advertises_the_lanes_the_router_knows(self) -> None:
        # `docqa` is a lane the router can pick and an agent this service
        # cannot run. Listing both makes that gap visible rather than a
        # surprise at runtime.
        body = TestClient(app).get("/health").json()

        assert body["routes"] == ["docqa", "followup", "scheduling"]
        assert set(body["routes"]) - set(body["agents"]) == {"docqa"}

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

    def test_leaves_the_agent_unset_so_the_orchestrator_picks(self, monkeypatch) -> None:
        # The old default was "scheduling", which meant nothing was ever routed.
        seen: dict = {}

        def fake_run(**kwargs: object):
            seen.update(kwargs)
            raise UnknownAgentError("stop here")

        monkeypatch.setattr("app.main.run_task", fake_run)
        TestClient(app).post("/run", json={"taskId": "t-1", "input": "x"})

        assert seen["agent_kind"] is None

    def test_an_explicit_agent_kind_is_still_honoured(self, monkeypatch) -> None:
        seen: dict = {}

        def fake_run(**kwargs: object):
            seen.update(kwargs)
            raise UnknownAgentError("stop here")

        monkeypatch.setattr("app.main.run_task", fake_run)
        TestClient(app).post("/run", json={"taskId": "t-1", "input": "x", "agentKind": "followup"})

        assert seen["agent_kind"] == "followup"


def test_the_registry_holds_the_agents_this_service_can_actually_run() -> None:
    # `docqa` is deliberately absent: it is seeded in the fleet and nameable by
    # the router, but not built. A task routed to it escalates rather than
    # being quietly handled by whichever agent happened to be nearest.
    assert set(runner.AGENTS) == {"scheduling", "followup"}


class TestClaimingTheTask:
    """`mark_running` is the one call in the sink where failure is fatal.

    Losing a trace step costs an observability record. Failing to claim the
    task means another run already holds it — carrying on would spend a second
    conversation moving an appointment that is already being moved.
    """

    def sink_against(self, handler) -> GatewayTraceSink:
        client = httpx.Client(transport=httpx.MockTransport(handler))
        return GatewayTraceSink("t-1", base_url="http://gateway.test", client=client)

    def test_a_claim_that_succeeds_is_silent(self) -> None:
        sink = self.sink_against(lambda request: httpx.Response(201, json={"status": "running"}))

        sink.mark_running()  # must not raise

    def test_a_409_stops_the_run(self) -> None:
        sink = self.sink_against(
            lambda request: httpx.Response(
                409, json={"message": "Task t-1 was claimed by another run."}
            )
        )

        with pytest.raises(TaskNotRunnableError, match="claimed by another run"):
            sink.mark_running()

    def test_an_unreachable_gateway_stops_the_run_too(self) -> None:
        # Every useful thing the run would do goes through the gateway, so
        # proceeding would burn tokens producing nothing anyone can see.
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        with pytest.raises(TaskNotRunnableError, match="could not reach the gateway"):
            self.sink_against(refuse).mark_running()

    def test_a_refused_claim_does_not_mark_the_task_failed(self) -> None:
        # The task belongs to the run that holds it. Writing `failed` here
        # would clobber a healthy run's status from outside.
        class RefusingSink(FakeSink):
            def mark_running(self) -> None:
                raise TaskNotRunnableError("already running")

        sink = RefusingSink()

        with pytest.raises(TaskNotRunnableError):
            run_task(
                task_id="t-1",
                task_input="x",
                agent_kind="scheduling",
                provider=RecordedProvider(responses=[reply("done")]),
                sink=sink,
                fhir=object(),
                priced_on=PRICED_ON,
            )

        assert sink.status is None

    def test_the_endpoint_reports_a_refused_claim_as_409(self, monkeypatch) -> None:
        def fake_run(**kwargs: object):
            raise TaskNotRunnableError("Task t-1 is running, not runnable.")

        monkeypatch.setattr("app.main.run_task", fake_run)

        response = TestClient(app).post("/run", json={"taskId": "t-1", "input": "x"})

        # Must be 409 and not 502: the worker treats 502 as retryable, and
        # retrying a claim conflict is the double-run this all exists to stop.
        assert response.status_code == 409
