"""Executes the Document Q&A Agent's one tool, and checks what it answers.

Embeds the query here and searches in Postgres, which is the split ADR-008
established for FHIR and the same reasoning applies: the data is tenant-scoped
behind row-level security, and the only part that *must* happen in this process
is the embedding, because ingest and query have to come from identical code.

The executor is a class rather than a closure because it has to remember
something — every citation it has handed to the model — so that the answer can
be checked against it. See `check_answer`.
"""

from __future__ import annotations

import re
from typing import Any

from app.agents.docqa import DEFAULT_SEARCH_LIMIT
from app.llm.provider import ToolCall
from app.rag.embedding import Embedder, is_searchable
from app.rag.gateway import GatewayDocuments

#: What the model is told when a search matches nothing. It names the recovery
#: rather than just reporting failure, because "no results" reads to a model as
#: "the answer is no" and the correct next move is usually another search.
NO_MATCHES = (
    "No passages matched. Try different words — the ones a policy document "
    "would use rather than the ones the patient used — or, if two or three "
    "phrasings have all come back empty, say the documents do not cover this."
)

#: A citation as the model is asked to write it: `[opening-hours#2]`. The shape
#: is the gateway's, assembled from a real row, which is what makes matching
#: against the set of served handles meaningful rather than cosmetic.
_CITATION = re.compile(r"\[([a-z0-9]+(?:-[a-z0-9]+)*#\d+)\]")


class DocQaExecutor:
    """Searches the corpus, and remembers what it has shown the model."""

    def __init__(self, documents: GatewayDocuments, embedder: Embedder) -> None:
        self._documents = documents
        self._embedder = embedder
        #: Every citation handed to the model in this run. The answer check is
        #: a subset test against it, so this is the run's definition of "a
        #: passage the agent has actually read".
        self.served: set[str] = set()

    def __call__(self, call: ToolCall) -> str:
        if call.name != "search_documents":
            return f"Tool {call.name!r} is declared but not implemented."

        query = str(call.arguments.get("query") or "").strip()
        if not query:
            raise ValueError("the 'query' argument is required")

        # A query of only stopwords embeds to a zero vector, and cosine
        # distance against one is NaN — Postgres would return rows in whatever
        # order it produced them, which is a ranked-looking answer to a
        # question that was never asked.
        if not is_searchable(query):
            raise ValueError(
                f"{query!r} has no searchable terms in it. Search for the "
                "specific thing being asked about."
            )

        hits = self._documents.search(
            embedding=self._embedder.embed([query])[0],
            embedding_model=self._embedder.name,
            limit=_limit(call.arguments),
        )

        self.served.update(str(hit["citation"]) for hit in hits if hit.get("citation"))

        return _render(hits) if hits else NO_MATCHES

    def check_answer(self, answer: str) -> str | None:
        """Refuse an answer citing a passage this run never retrieved.

        The characteristic failure of retrieval-augmented answering is not a
        wrong lookup — it is a confident sentence with a citation attached that
        was never returned by anything. A citation is the part a reader trusts
        without checking, so a fabricated one is worse than no citation at all.

        This is mechanical: no model call, no judgement, a subset test. It runs
        in the loop *before* the answer is accepted, and a failure comes back to
        the model as something it can correct, the same way a failing tool and a
        blocked write already do.

        **What it does not check.** That every claim carries a citation, or that
        the cited passage supports the claim. An answer stating clinic policy
        with no citation at all passes here — because "the documents do not
        cover this, a member of staff will follow up" is a correct answer with
        nothing to cite, and requiring a citation would make the honest refusal
        the one thing the agent could not say. It bounds where citations can
        come from, not whether the answer is right.
        """
        invented = sorted(set(_CITATION.findall(answer)) - self.served)
        if not invented:
            return None

        if self.served:
            available = ", ".join(f"[{citation}]" for citation in sorted(self.served))
            remedy = f"Use only the passages you were given: {available}."
        else:
            remedy = "You have not been given any passages yet. Search the documents first."

        cited = ", ".join(f"[{citation}]" for citation in invented)
        return (
            f"Your answer cites {cited}, which no search in this conversation "
            f"returned. {remedy} If the documents do not answer the question, "
            "say so instead."
        )


def make_docqa_executor(documents: GatewayDocuments, embedder: Embedder) -> DocQaExecutor:
    """Bind the tool surface to a corpus and an embedder."""
    return DocQaExecutor(documents, embedder)


def _limit(arguments: dict[str, Any]) -> int:
    """Clamp rather than reject.

    A model asking for fifty passages has made a judgement about breadth, not a
    mistake worth a round trip to correct — and the gateway would refuse the
    value anyway, turning a slightly greedy search into a failed one.
    """
    raw = arguments.get("limit")
    if raw is None:
        return DEFAULT_SEARCH_LIMIT

    try:
        return max(1, min(10, int(raw)))
    except (TypeError, ValueError):
        return DEFAULT_SEARCH_LIMIT


def _render(hits: list[dict[str, Any]]) -> str:
    """Lay out passages so the citation is impossible to miss or mistype.

    The handle leads each block and is repeated in the instruction line,
    because the single most common way this agent can fail is citing something
    plausible rather than something it was given.
    """
    blocks = [
        f"[{hit['citation']}] {hit.get('documentTitle') or ''}"
        f"{' · ' + hit['heading'] if hit.get('heading') else ''}"
        f" (match {float(hit.get('score', 0)):.2f})\n{hit.get('text', '')}".strip()
        for hit in hits
    ]

    return (
        "\n\n".join(blocks)
        + "\n\nCite these passages by the handle in square brackets, exactly as "
        "written above. Do not cite anything else."
    )
