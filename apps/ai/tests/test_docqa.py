"""The Document Q&A Agent: retrieval, and what it does when retrieval fails.

This agent writes nothing, so there is no `mutates` tool and the pre-write
self-check never fires for it. Its whole risk surface is the answer, which
makes "what happens when the corpus does not cover the question" the most
important behaviour in the file.
"""

from __future__ import annotations

import json
from datetime import date

import httpx
import pytest

from app.agents.docqa import DEFAULT_SEARCH_LIMIT, DOCQA_TOOLS, SEARCH_DOCUMENTS
from app.agents.docqa_executor import NO_MATCHES, make_docqa_executor
from app.agents.runner import run_task
from app.agents.trace import TraceStep
from app.llm.pricing import TokenUsage
from app.llm.provider import LlmResponse, RecordedProvider, ToolCall
from app.rag.embedding import EMBEDDING_DIMENSIONS, HashingEmbedder
from app.rag.gateway import GatewayDocuments

BASE = "http://gateway.test"
PRICED_ON = date(2026, 8, 11)


def hit(citation: str, text: str, *, heading: str | None = "Cancelling", score: float = 0.62):
    return {
        "citation": citation,
        "documentTitle": "Appointments",
        "heading": heading,
        "text": text,
        "score": score,
    }


def gateway(handler) -> GatewayDocuments:
    transport = httpx.MockTransport(handler)
    return GatewayDocuments(base_url=BASE, client=httpx.Client(transport=transport))


def executor_returning(hits: list[dict], captured: list[dict] | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if captured is not None:
            captured.append(json.loads(request.content))
        return httpx.Response(200, json=hits)

    return make_docqa_executor(gateway(handler), HashingEmbedder())


def call(name: str = "search_documents", **arguments) -> ToolCall:
    return ToolCall(id="tu-1", name=name, arguments=arguments)


class TestToolSurface:
    def test_the_agent_has_exactly_one_tool(self) -> None:
        # It answers from retrieved text and nothing else. Any second tool is
        # another thing it could answer from without a citation.
        assert [tool.name for tool in DOCQA_TOOLS] == ["search_documents"]

    def test_nothing_it_can_call_changes_anything(self) -> None:
        # No `mutates` tool means the pre-write self-check never runs here,
        # which is correct — and is why the answer itself has to be checked.
        assert all(tool.mutates is False for tool in DOCQA_TOOLS)

    def test_the_schema_tells_the_model_retrieval_is_lexical(self) -> None:
        # The mitigation for a lexical embedder is a rephrase, and the model is
        # the only thing that can do it. It has to be told.
        description = SEARCH_DOCUMENTS.description.lower()

        assert "words rather than meaning" in description
        assert "more than once" in description


class TestSearching:
    def test_the_query_is_embedded_here_and_searched_there(self) -> None:
        sent: list[dict] = []
        execute = executor_returning([hit("opening-hours#1", "We open at eight.")], sent)

        execute(call(query="opening hours"))

        assert len(sent[0]["embedding"]) == EMBEDDING_DIMENSIONS
        assert sent[0]["embeddingModel"] == HashingEmbedder().name
        assert sent[0]["limit"] == DEFAULT_SEARCH_LIMIT

    def test_results_lead_with_the_citation_handle(self) -> None:
        execute = executor_returning(
            [hit("appointments#3", "Call the main line to cancel.", heading="Cancelling")]
        )

        observation = execute(call(query="cancel appointment"))

        assert observation.startswith("[appointments#3] Appointments · Cancelling")
        assert "Call the main line to cancel." in observation

    def test_results_close_by_restating_how_to_cite(self) -> None:
        # The most likely failure is citing something plausible instead of
        # something given, so the instruction sits next to the handles.
        execute = executor_returning([hit("appointments#3", "Anything.")])

        assert "exactly as written above" in execute(call(query="cancel"))

    def test_a_passage_with_no_heading_still_renders(self) -> None:
        execute = executor_returning([hit("preamble#1", "Some text.", heading=None)])

        assert execute(call(query="text")).startswith("[preamble#1] Appointments (match")

    def test_the_match_score_is_shown(self) -> None:
        # The model is told how good a match is so it can decline a weak one,
        # rather than treating everything returned as equally authoritative.
        execute = executor_returning([hit("appointments#3", "Anything.", score=0.11)])

        assert "(match 0.11)" in execute(call(query="cancel"))

    def test_a_requested_limit_is_passed_through(self) -> None:
        sent: list[dict] = []
        executor_returning([], sent)(call(query="parking", limit=3))

        assert sent[0]["limit"] == 3

    def test_an_absurd_limit_is_clamped_rather_than_refused(self) -> None:
        # The gateway caps it at 20 and would reject 500, turning a slightly
        # greedy search into a failed one. A judgement about breadth is not a
        # mistake worth a round trip.
        sent: list[dict] = []
        executor_returning([], sent)(call(query="parking", limit=500))

        assert sent[0]["limit"] == 10

    def test_a_nonsense_limit_falls_back_to_the_default(self) -> None:
        sent: list[dict] = []
        executor_returning([], sent)(call(query="parking", limit="lots"))

        assert sent[0]["limit"] == DEFAULT_SEARCH_LIMIT


class TestWhenRetrievalFindsNothing:
    def test_it_says_what_to_do_next_rather_than_just_reporting_failure(self) -> None:
        # "No results" reads to a model as "the answer is no". With a lexical
        # index the correct next move is usually another search, so the
        # observation names it.
        observation = executor_returning([])(call(query="parking"))

        assert observation == NO_MATCHES
        assert "different words" in observation
        assert "do not cover this" in observation

    def test_a_query_with_no_searchable_terms_is_refused(self) -> None:
        # It would embed to a zero vector, and cosine distance against one is
        # NaN — Postgres returns rows in whatever order it produced them, which
        # is a ranked-looking answer to a question that was never asked.
        with pytest.raises(ValueError, match="no searchable terms"):
            executor_returning([])(call(query="the and of"))

    def test_an_empty_query_is_refused(self) -> None:
        with pytest.raises(ValueError, match="required"):
            executor_returning([])(call(query="   "))

    def test_an_undeclared_tool_says_so_instead_of_failing_silently(self) -> None:
        assert "not implemented" in executor_returning([])(call(name="delete_everything"))


class TestThroughTheRunner:
    """The agent as the runner assembles it, with a scripted model."""

    def run(self, responses: list[LlmResponse], hits: list[dict]):
        sink = FakeSink()

        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=hits)

        result = run_task(
            task_id="t-1",
            task_input="How much notice do I need to cancel?",
            agent_kind="docqa",
            provider=RecordedProvider(responses=responses),
            sink=sink,
            fhir=object(),
            documents=gateway(handler),
            priced_on=PRICED_ON,
            redact=False,
        )
        return result, sink

    def test_it_searches_then_answers_with_a_citation(self) -> None:
        result, sink = self.run(
            responses=[
                tool_use("search_documents", {"query": "cancellation notice"}),
                answer("Please give 24 hours' notice. [appointments#3]"),
            ],
            hits=[hit("appointments#3", "Please give at least 24 hours' notice.")],
        )

        assert result.outcome == "resolved"
        assert "[appointments#3]" in result.summary

    def test_the_search_is_traced_as_a_tool_call_not_an_action(self) -> None:
        # Nothing was changed. Trace Viewer highlights actions and an audit
        # reviewer scans for them; a read that claims to be one is noise.
        _, sink = self.run(
            responses=[
                tool_use("search_documents", {"query": "cancellation"}),
                answer("Twenty-four hours. [appointments#3]"),
            ],
            hits=[hit("appointments#3", "Please give at least 24 hours' notice.")],
        )

        kinds = [step.kind for step in sink.steps]
        assert "tool_call" in kinds
        assert "action" not in kinds

    def test_the_agent_is_given_only_its_own_tool(self) -> None:
        provider = RecordedProvider(responses=[answer("I will look that up.")])

        run_task(
            task_id="t-1",
            task_input="what are your opening hours?",
            agent_kind="docqa",
            provider=provider,
            sink=FakeSink(),
            fhir=object(),
            documents=gateway(lambda _request: httpx.Response(200, json=[])),
            priced_on=PRICED_ON,
            redact=False,
        )

        assert provider.calls[0]["tools"] == ["search_documents"]


def tool_use(name: str, arguments: dict) -> LlmResponse:
    return LlmResponse(
        text="",
        tool_calls=(ToolCall(id="tu-1", name=name, arguments=arguments),),
        stop_reason="tool_use",
        usage=TokenUsage(input_tokens=200, output_tokens=30),
        model="claude-sonnet-5",
        latency_ms=90,
    )


def answer(text: str) -> LlmResponse:
    return LlmResponse(
        text=text,
        tool_calls=(),
        stop_reason="end_turn",
        usage=TokenUsage(input_tokens=400, output_tokens=40),
        model="claude-sonnet-5",
        latency_ms=70,
    )


class FakeSink:
    def __init__(self) -> None:
        self.steps: list[TraceStep] = []
        self.status: str | None = None
        self.outcome: str | None = None

    def __call__(self, step: TraceStep) -> None:
        self.steps.append(step)

    def mark_running(self) -> None: ...

    def complete(self, status: str, outcome: str | None) -> None:
        self.status = status
        self.outcome = outcome

    def close(self) -> None: ...


class TestTheAnswerCheck:
    """A citation is the part a reader trusts without checking.

    Which makes a fabricated one worse than no citation at all, and makes this
    the guard that stands in for the pre-write self-check the other two agents
    get. It is mechanical — a subset test, no model call, no judgement.
    """

    def executor(self, served: list[str]):
        execute = executor_returning([hit(citation, "Some text.") for citation in served])
        if served:
            execute(call(query="cancellation notice"))
        return execute

    def test_an_answer_citing_what_it_read_is_accepted(self) -> None:
        execute = self.executor(["appointments#3"])

        assert execute.check_answer("Give 24 hours' notice. [appointments#3]") is None

    def test_an_answer_citing_something_never_returned_is_rejected(self) -> None:
        execute = self.executor(["appointments#3"])

        complaint = execute.check_answer("Cancellations are free. [refunds#7]")

        assert complaint is not None
        assert "[refunds#7]" in complaint

    def test_the_complaint_lists_what_the_agent_may_actually_cite(self) -> None:
        # Actionable, not just a refusal: the model can fix this on the next
        # turn, which is the whole reason it is fed back rather than aborted.
        execute = self.executor(["appointments#3", "opening-hours#1"])

        complaint = execute.check_answer("We are shut on Sundays. [made-up#2]")

        assert "[appointments#3]" in complaint
        assert "[opening-hours#1]" in complaint

    def test_citing_anything_before_searching_is_rejected_and_says_to_search(self) -> None:
        complaint = self.executor([]).check_answer("We open at eight. [opening-hours#1]")

        assert complaint is not None
        assert "Search the documents first" in complaint

    def test_an_answer_with_no_citations_at_all_is_allowed(self) -> None:
        # "The documents do not cover this" is a correct answer with nothing to
        # cite. Requiring a citation would make the honest refusal the one
        # thing the agent could not say.
        execute = self.executor(["appointments#3"])

        assert execute.check_answer("Our documents do not cover parking, sorry.") is None

    def test_passages_from_any_earlier_search_still_count(self) -> None:
        # The agent is told to search several times. A passage read in the
        # first search is legitimately citable in an answer about the third.
        execute = executor_returning([hit("opening-hours#1", "We open at eight.")])
        execute(call(query="opening hours"))
        execute(call(query="something else"))

        assert execute.check_answer("Eight in the morning. [opening-hours#1]") is None


class TestTheAnswerCheckInsideARun:
    def run(self, responses: list[LlmResponse], hits: list[dict]):
        sink = FakeSink()

        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=hits)

        result = run_task(
            task_id="t-1",
            task_input="How much notice do I need to cancel?",
            agent_kind="docqa",
            provider=RecordedProvider(responses=responses),
            sink=sink,
            fhir=object(),
            documents=gateway(handler),
            priced_on=PRICED_ON,
            redact=False,
        )
        return result, sink

    def test_a_bad_citation_is_handed_back_and_the_model_can_fix_it(self) -> None:
        # The same recovery path a failing tool and a blocked write use. A
        # mis-copied handle costs one model call, not a person's afternoon.
        result, sink = self.run(
            responses=[
                tool_use("search_documents", {"query": "cancellation notice"}),
                answer("Give 24 hours' notice. [cancellation-policy#9]"),
                answer("Give 24 hours' notice. [appointments#3]"),
            ],
            hits=[hit("appointments#3", "Please give at least 24 hours' notice.")],
        )

        assert result.outcome == "resolved"
        assert result.summary.endswith("[appointments#3]")

        rejections = [step for step in sink.steps if step.label.startswith("Answer check")]
        assert len(rejections) == 1
        assert rejections[0].kind == "reflection"

    def test_the_rejection_costs_no_tokens_because_it_is_not_a_model_call(self) -> None:
        _, sink = self.run(
            responses=[
                tool_use("search_documents", {"query": "cancellation"}),
                answer("Twenty-four hours. [invented#1]"),
                answer("Twenty-four hours. [appointments#3]"),
            ],
            hits=[hit("appointments#3", "Please give at least 24 hours' notice.")],
        )

        [rejection] = [step for step in sink.steps if step.label.startswith("Answer check")]
        assert rejection.tokens_in is None
        assert rejection.cost_usd is None

    def test_an_agent_that_keeps_inventing_citations_escalates(self) -> None:
        # Rather than delivering it, and rather than burning the whole
        # iteration budget to reach the same conclusion more slowly.
        result, sink = self.run(
            responses=[
                tool_use("search_documents", {"query": "cancellation"}),
                answer("Free cancellation. [refunds#1]"),
                answer("Free cancellation. [refunds#2]"),
            ],
            hits=[hit("appointments#3", "Please give at least 24 hours' notice.")],
        )

        assert result.outcome == "escalated"
        assert sink.status == "escalated"
        assert sink.steps[-1].kind == "escalation"
        assert sink.steps[-1].content == {"reason": "answer_check", "attempts": 2}

    def test_a_clean_answer_is_never_delayed_by_the_check(self) -> None:
        _, sink = self.run(
            responses=[
                tool_use("search_documents", {"query": "cancellation"}),
                answer("Twenty-four hours. [appointments#3]"),
            ],
            hits=[hit("appointments#3", "Please give at least 24 hours' notice.")],
        )

        assert not [step for step in sink.steps if step.label.startswith("Answer check")]
