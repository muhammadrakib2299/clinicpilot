"""Routing, and the half that matters: refusing to route.

A router that must always choose sends "I've had chest pain since this morning"
to the scheduling agent, which has no clinical tool, will not answer a clinical
question, and will spend four iterations discovering that. The tests below care
more about what escalates than about what routes.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.agents import orchestrator
from app.agents.runner import run_task
from app.agents.trace import TraceStep
from app.llm.pricing import TokenUsage
from app.llm.provider import LlmResponse, RecordedProvider, ToolCall

PRICED_ON = date(2026, 8, 11)


def reply(text: str) -> LlmResponse:
    return LlmResponse(
        text=text,
        tool_calls=(),
        stop_reason="end_turn",
        usage=TokenUsage(input_tokens=120, output_tokens=4),
        model="claude-sonnet-5",
        latency_ms=80,
    )


class FakeSink:
    def __init__(self) -> None:
        self.steps: list[TraceStep] = []
        self.status: str | None = None
        self.outcome: str | None = None
        self.reason: str | None = None

    def __call__(self, step: TraceStep) -> None:
        self.steps.append(step)

    def mark_running(self) -> None: ...

    def complete(self, status: str, outcome: str | None, reason: str | None = None) -> None:
        self.status = status
        self.outcome = outcome
        self.reason = reason

    def close(self) -> None: ...


class TestInterpret:
    @pytest.mark.parametrize("kind", ["scheduling", "followup", "docqa"])
    def test_each_lane(self, kind: str) -> None:
        assert orchestrator.interpret(kind) == kind

    def test_case_and_punctuation_do_not_matter(self) -> None:
        assert orchestrator.interpret("Scheduling.") == "scheduling"
        assert orchestrator.interpret("**FOLLOWUP**") == "followup"

    def test_the_explicit_escalate_token(self) -> None:
        assert orchestrator.interpret("ESCALATE") is None

    @pytest.mark.parametrize(
        "text",
        ["", "   ", "I am not sure", "billing", "It depends on what they meant"],
    )
    def test_anything_else_goes_to_a_human(self, text: str) -> None:
        # Escalating a routine message costs someone reading it. Misrouting a
        # clinical one costs an administrative agent trying to book an
        # appointment for chest pain. Not symmetrical.
        assert orchestrator.interpret(text) is None

    def test_a_lane_that_merely_appears_in_prose_does_not_count(self) -> None:
        # Only the first word is read, so a hedging paragraph escalates even
        # when it mentions a lane.
        assert orchestrator.interpret("This might be scheduling, or maybe not") is None


class TestPrompt:
    def test_every_lane_is_described_to_the_model(self) -> None:
        for kind in orchestrator.ROUTES:
            assert kind in orchestrator.SYSTEM

    def test_the_prompt_names_what_must_escalate(self) -> None:
        for topic in ["symptom", "medication", "urgent", "emergency", "complaint"]:
            assert topic in orchestrator.SYSTEM.lower()

    def test_it_says_which_way_to_err(self) -> None:
        assert "when in doubt" in orchestrator.SYSTEM.lower()


class TestRoute:
    def test_returns_the_lane_and_the_response_that_chose_it(self) -> None:
        provider = RecordedProvider(responses=[reply("scheduling")])

        routing = orchestrator.route(provider=provider, task="move my appointment")

        assert routing.agent_kind == "scheduling"
        assert routing.escalated is False
        assert routing.response.usage.input_tokens == 120

    def test_an_escalation_explains_itself_with_what_the_router_said(self) -> None:
        provider = RecordedProvider(responses=[reply("ESCALATE")])

        routing = orchestrator.route(provider=provider, task="my chest hurts")

        assert routing.escalated is True
        assert "handing to a human" in routing.reason
        assert "ESCALATE" in routing.reason

    def test_the_router_is_given_no_tools(self) -> None:
        # It classifies. A router that can call tools is an agent.
        provider = RecordedProvider(responses=[reply("docqa")])

        orchestrator.route(provider=provider, task="what should I bring?")

        assert provider.calls[0]["tools"] == []


class TestRoutingInsideARun:
    def run(self, router_says: str, then=None):
        sink = FakeSink()
        responses = [reply(router_says), *(then or [])]
        result = run_task(
            task_id="t-1",
            task_input="I need to move my appointment",
            provider=RecordedProvider(responses=responses),
            sink=sink,
            fhir=object(),
            priced_on=PRICED_ON,
            redact=False,
        )
        return result, sink

    def test_a_routed_task_runs_the_chosen_agent(self) -> None:
        result, sink = self.run("scheduling", then=[reply("Your appointment is Thursday.")])

        assert result.outcome == "resolved"
        assert sink.steps[0].label == "Routing · scheduling"

    def test_an_escalated_task_never_reaches_an_agent(self) -> None:
        result, sink = self.run("ESCALATE")

        assert result.outcome == "escalated"
        assert sink.status == "escalated"
        # One step: the routing decision. No agent ran, so no reasoning,
        # no tools, and nothing was spent pretending otherwise.
        assert len(sink.steps) == 1

    def test_the_routing_decision_is_traced_and_costed(self) -> None:
        # It is a model call. Leaving it off the trace would make the run's
        # cost disagree with the sum of its steps.
        _, sink = self.run("scheduling", then=[reply("done")])

        step = sink.steps[0]
        assert step.kind == "reason"
        assert step.content == {"agentKind": "scheduling"}
        assert step.cost_usd is not None and step.cost_usd > 0
        assert step.model == "claude-sonnet-5"

    def test_an_escalation_still_costs_what_the_router_cost(self) -> None:
        result, _ = self.run("ESCALATE")

        assert result.cost_usd > 0
        assert result.iterations == 0

    def test_every_lane_the_router_can_pick_now_has_an_agent(self) -> None:
        # This used to assert the opposite for `docqa`, which was routable and
        # unbuilt. Now the router's lanes and the registry match exactly, and
        # this is what stops them drifting apart again.
        from app.agents.runner import AGENTS

        assert set(orchestrator.ROUTES) == set(AGENTS)

    def test_an_agent_this_service_does_not_deploy_is_refused(self) -> None:
        # The mechanism still matters with nothing currently missing: a caller
        # naming an agent that is not here gets a clear error rather than the
        # nearest agent quietly taking the work. Named explicitly, because the
        # router itself cannot produce an unknown lane — a word it does not
        # recognise escalates instead.
        from app.agents.runner import UnknownAgentError

        with pytest.raises(UnknownAgentError, match="billing"):
            run_task(
                task_id="t-1",
                task_input="refund my last visit",
                agent_kind="billing",
                provider=RecordedProvider(responses=[]),
                sink=FakeSink(),
                fhir=object(),
                priced_on=PRICED_ON,
                redact=False,
            )

    def test_naming_an_agent_skips_the_router_entirely(self) -> None:
        sink = FakeSink()

        run_task(
            task_id="t-1",
            task_input="x",
            agent_kind="scheduling",
            provider=RecordedProvider(responses=[reply("done")]),
            sink=sink,
            fhir=object(),
            priced_on=PRICED_ON,
            redact=False,
        )

        assert not any(s.label.startswith("Routing") for s in sink.steps)


class TestTheEscalationReason:
    """Which of the three escalation paths fired, for the human queue to label.

    Optional at every layer on purpose: the gateway queues a human on the
    *status*, and the reason only labels the row. Making it required would turn
    "we did not categorise this" into "we did not tell anyone".
    """

    def sink_after(self, responses: list[LlmResponse], fhir_override: object = None) -> FakeSink:
        sink = FakeSink()
        run_task(
            task_id="t-1",
            task_input="I have had chest pain since this morning",
            provider=RecordedProvider(responses=responses),
            sink=sink,
            fhir=fhir_override or object(),
            priced_on=PRICED_ON,
            redact=False,
        )
        return sink

    def test_a_router_refusal_is_reported_as_router(self) -> None:
        assert self.sink_after([reply("ESCALATE")]).reason == "router"

    def test_a_resolved_run_reports_no_reason(self) -> None:
        sink = self.sink_after([reply("scheduling"), reply("Booked for Tuesday.")])

        assert sink.status == "resolved"
        assert sink.reason is None

    def test_running_out_of_iterations_is_reported_as_max_iterations(self) -> None:
        from app.agents.loop import DEFAULT_MAX_ITERATIONS

        wants_tool = LlmResponse(
            text="",
            tool_calls=(ToolCall("t1", "find_appointments", {"patient_id": "1"}),),
            stop_reason="tool_use",
            usage=TokenUsage(input_tokens=100, output_tokens=10),
            model="claude-sonnet-5",
        )

        class Stalled:
            """A gateway that answers, so the loop keeps going and never converges."""

            def find_appointments(self, **_kwargs: object) -> list:
                return []

        sink = self.sink_after(
            [reply("scheduling"), *([wants_tool] * DEFAULT_MAX_ITERATIONS)],
            fhir_override=Stalled(),
        )

        assert sink.status == "escalated"
        assert sink.reason == "max_iterations"
