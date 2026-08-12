"""Ingest, and whether the corpus and the embedder actually answer questions.

The second half of this file is the more important one. Every other test in the
suite checks that a component behaves as written; `TestRetrievalOnTheRealCorpus`
checks something no unit test can — that a *lexical* embedder is strong enough
for the documents this project actually ships, against the questions patients
actually ask. It is a small eval harness, and it is the thing that would fail
if the corpus were rewritten in vocabulary nobody searches with.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import httpx
import pytest

from app.rag.chunking import chunk_markdown
from app.rag.embedding import HashingEmbedder
from app.rag.gateway import GatewayDocuments
from app.rag.ingest import (
    DEMO_TENANTS,
    SEED_DOCS,
    ingest_directories,
    ingest_file,
    title_of,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
TENANT_TS = REPO_ROOT / "apps" / "api" / "src" / "common" / "tenant.ts"

embedder = HashingEmbedder()


def recording_gateway(captured: list[dict]) -> GatewayDocuments:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        captured.append(body)
        return httpx.Response(
            200,
            json={
                "id": "doc-1",
                "slug": body["slug"],
                "title": body["title"],
                "source": body.get("source"),
                "chunkCount": len(body["chunks"]),
                "embeddingModel": body["embeddingModel"],
                "updatedAt": "2026-08-12T09:00:00.000Z",
            },
        )

    return GatewayDocuments(
        base_url="http://gateway.test",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


class TestTheDemoTenantIds:
    def test_they_match_the_gateway_definition(self) -> None:
        """The one constant this project duplicates across a language boundary.

        `apps/api/src/common/tenant.ts` is the source of truth — the seed writes
        those ids and RLS scopes to them. A Python copy that drifts would ingest
        a corpus into a tenant nobody can read, and every search would return
        nothing with no error to explain why. So the file is read and compared
        rather than trusted.
        """
        source = TENANT_TS.read_text(encoding="utf-8")
        declared = set(re.findall(r'"([0-9a-f-]{36})"', source))

        assert declared == set(DEMO_TENANTS)

    def test_each_clinic_gets_the_shared_corpus_and_its_own(self) -> None:
        for directories in DEMO_TENANTS.values():
            assert directories[0] == "shared"
            assert len(directories) == 2

    def test_every_named_directory_exists(self) -> None:
        for directories in DEMO_TENANTS.values():
            for name in directories:
                assert (SEED_DOCS / name).is_dir(), f"seed_docs/{name} is missing"


class TestTitles:
    def test_it_prefers_the_document_s_own_heading(self) -> None:
        # Shown next to every citation, so "Repeat prescriptions" beats
        # "repeat-prescriptions" for a patient reading the answer.
        assert title_of("# Repeat prescriptions\n\nBody.", "repeat-prescriptions") == (
            "Repeat prescriptions"
        )

    def test_it_falls_back_to_the_filename(self) -> None:
        assert title_of("No heading here.", "opening-hours") == "Opening hours"

    def test_a_deeper_heading_is_not_mistaken_for_the_title(self) -> None:
        assert title_of("## Section\n\nBody.", "test-results") == "Test results"


class TestIngestingAFile:
    def test_it_sends_chunks_with_vectors_and_the_model_that_made_them(self) -> None:
        sent: list[dict] = []
        ingest_file(
            SEED_DOCS / "shared" / "appointments.md",
            documents=recording_gateway(sent),
            embedder=embedder,
        )

        [payload] = sent
        assert payload["slug"] == "appointments"
        assert payload["title"] == "Appointments"
        assert payload["embeddingModel"] == embedder.name
        assert all(len(chunk["embedding"]) == embedder.dimensions for chunk in payload["chunks"])

    def test_ordinals_arrive_contiguous_from_one(self) -> None:
        sent: list[dict] = []
        ingest_file(
            SEED_DOCS / "shared" / "test-results.md",
            documents=recording_gateway(sent),
            embedder=embedder,
        )

        ordinals = [chunk["ordinal"] for chunk in sent[0]["chunks"]]
        assert ordinals == list(range(1, len(ordinals) + 1))

    def test_an_empty_file_is_an_error_rather_than_an_empty_document(self, tmp_path) -> None:
        # A document with no passages is invisible to retrieval, so storing one
        # would report success for something that answers nothing.
        empty = tmp_path / "nothing.md"
        empty.write_text("   \n\n", encoding="utf-8")

        with pytest.raises(ValueError, match="no passages"):
            ingest_file(empty, documents=recording_gateway([]), embedder=embedder)


class TestIngestingDirectories:
    def test_it_walks_every_markdown_file_in_order(self) -> None:
        sent: list[dict] = []
        stored = ingest_directories(
            [SEED_DOCS / "shared", SEED_DOCS / "northside"],
            tenant_id="tenant-1",
            embedder=embedder,
            documents=recording_gateway(sent),
        )

        slugs = [document["slug"] for document in stored]
        assert "appointments" in slugs
        assert slugs[-1] == "opening-hours", "the clinic's own directory should come last"

    def test_the_source_records_which_directory_a_document_came_from(self) -> None:
        # Two clinics have a file of the same name. "opening-hours.md" alone
        # would not say whose.
        sent: list[dict] = []
        ingest_directories(
            [SEED_DOCS / "riverside"],
            tenant_id="tenant-1",
            embedder=embedder,
            documents=recording_gateway(sent),
        )

        assert sent[0]["source"] == "riverside/opening-hours.md"


class TestRetrievalOnTheRealCorpus:
    """Does this embedder actually find these documents from these questions?

    Ranked in Python rather than Postgres — the ordering is arithmetic either
    way, and needing a database would mean this never ran in CI, where the
    answer matters most. What is real here is the corpus, the chunking and the
    vectors.

    A failure is a signal about the *corpus*, not only the code: it means a
    document has been written in vocabulary nobody would search with.
    """

    @staticmethod
    def corpus() -> list[tuple[str, list[float]]]:
        entries: list[tuple[str, list[float]]] = []

        for directory in ("shared", "northside"):
            for path in sorted((SEED_DOCS / directory).glob("*.md")):
                for chunk in chunk_markdown(path.read_text(encoding="utf-8")):
                    entries.append((path.stem, embedder.embed_one(chunk.text)))

        return entries

    @pytest.mark.parametrize(
        ("question", "expected"),
        [
            ("how do I cancel my appointment", "appointments"),
            ("how much notice do I need to give to cancel", "appointments"),
            ("what happens if I miss an appointment", "appointments"),
            ("can I book a home visit", "appointments"),
            ("do I need to fast before a blood test", "preparing-for-your-visit"),
            ("what should I bring to my appointment", "preparing-for-your-visit"),
            ("do you have an interpreter", "preparing-for-your-visit"),
            ("is there parking at the surgery", "preparing-for-your-visit"),
            ("how do I order a repeat prescription", "repeat-prescriptions"),
            ("how long does a repeat prescription take", "repeat-prescriptions"),
            ("when will my test results be ready", "test-results"),
            ("how do I get my results", "test-results"),
            ("can I see my medical records", "registering-and-records"),
            ("how do I make a complaint", "registering-and-records"),
            ("how do I register with the practice", "registering-and-records"),
            ("are you open on Saturday", "opening-hours"),
            ("what are your opening hours", "opening-hours"),
            ("are you open on bank holidays", "opening-hours"),
        ],
    )
    def test_the_right_document_is_the_nearest_passage(self, question: str, expected: str) -> None:
        query = embedder.embed_one(question)
        ranked = sorted(
            self.corpus(),
            key=lambda entry: -sum(a * b for a, b in zip(query, entry[1], strict=True)),
        )

        assert ranked[0][0] == expected, f"nearest was {ranked[0][0]}"

    def test_a_question_the_corpus_does_not_cover_scores_near_zero(self) -> None:
        # What the gateway's `minScore` floor is for. Without it this would
        # still return five passages, and the model would answer from them.
        query = embedder.embed_one("what were last season's football results")
        best = max(
            sum(a * b for a, b in zip(query, vector, strict=True))
            for _slug, vector in self.corpus()
        )

        assert best < 0.2
