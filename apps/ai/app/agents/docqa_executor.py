"""Executes the Document Q&A Agent's one tool.

Embeds the query here and searches in Postgres, which is the split ADR-008
established for FHIR and the same reasoning applies: the data is tenant-scoped
behind row-level security, and the only part that *must* happen in this process
is the embedding, because ingest and query have to come from identical code.
"""

from __future__ import annotations

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


def make_docqa_executor(documents: GatewayDocuments, embedder: Embedder):
    """Bind the tool surface to a corpus and an embedder."""

    def execute(call: ToolCall) -> str:
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

        hits = documents.search(
            embedding=embedder.embed([query])[0],
            embedding_model=embedder.name,
            limit=_limit(call.arguments),
        )

        return _render(hits) if hits else NO_MATCHES

    return execute


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
