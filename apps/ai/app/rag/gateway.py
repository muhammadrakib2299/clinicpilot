"""The document corpus, reached through the API gateway.

Retrieval runs in Postgres, not here: the vectors live in a tenant-scoped table
behind row-level security, and pulling a clinic's corpus into this process to
rank it would put every tenant's passages one bug away from each other.

So this service embeds — the one thing it must do, because ingest and query
have to produce vectors from identical code — and asks the gateway which rows
came back.
"""

from __future__ import annotations

from typing import Any

from app.gateway import GatewayClient


class GatewayDocuments(GatewayClient):
    def ingest(
        self,
        *,
        slug: str,
        title: str,
        embedding_model: str,
        chunks: list[dict[str, Any]],
        source: str | None = None,
    ) -> dict[str, Any]:
        """Store one document, replacing any earlier version of it."""
        payload: dict[str, Any] = {
            "slug": slug,
            "title": title,
            "embeddingModel": embedding_model,
            "chunks": chunks,
        }
        if source:
            payload["source"] = source

        return self._request("POST", "/api/internal/documents", json=payload)

    def search(
        self,
        *,
        embedding: list[float],
        embedding_model: str,
        limit: int | None = None,
        min_score: float | None = None,
    ) -> list[dict[str, Any]]:
        """Passages nearest a query vector.

        `min_score` is left to the gateway's default unless a caller has a
        reason: the floor that stops an uncovered question returning the least
        irrelevant passages belongs with the search, not with each caller's
        idea of it.
        """
        payload: dict[str, Any] = {
            "embedding": embedding,
            "embeddingModel": embedding_model,
        }
        if limit is not None:
            payload["limit"] = limit
        if min_score is not None:
            payload["minScore"] = min_score

        return self._request("POST", "/api/internal/documents/search", json=payload)
