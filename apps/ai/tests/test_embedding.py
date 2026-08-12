"""The vector half of retrieval.

The properties asserted here are the ones whose absence produces a retriever
that returns rows, raises nothing, and is wrong.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.rag.embedding import (
    EMBEDDING_DIMENSIONS,
    HashingEmbedder,
    features,
    is_searchable,
)

embedder = HashingEmbedder()


def cosine(left: list[float], right: list[float]) -> float:
    # Both are unit vectors of the same length, so the dot product *is* the
    # cosine — and strict=True turns a length mismatch into a failure here
    # rather than a quietly truncated score.
    return sum(a * b for a, b in zip(left, right, strict=True))


def test_the_vector_is_the_length_the_column_expects() -> None:
    assert len(embedder.embed_one("anything at all")) == EMBEDDING_DIMENSIONS


def test_the_model_name_carries_its_dimension() -> None:
    # Search filters on this name. Changing the dimension changes every vector,
    # so it has to change the name too or old chunks stay comparable on paper.
    assert HashingEmbedder(128).name == "hashing-v1-128"
    assert embedder.name == f"hashing-v1-{EMBEDDING_DIMENSIONS}"


def test_vectors_are_unit_length() -> None:
    norm = math.sqrt(sum(value**2 for value in embedder.embed_one("opening hours on a Monday")))

    assert norm == pytest.approx(1.0)


def test_the_same_text_always_gives_the_same_vector() -> None:
    assert embedder.embed_one("repeat prescription") == embedder.embed_one("repeat prescription")


def test_embed_batches_in_order() -> None:
    texts = ["first thing", "second thing", "third thing"]

    assert embedder.embed(texts) == [embedder.embed_one(text) for text in texts]


def test_the_hash_is_stable_across_processes() -> None:
    """The single most important test in this file.

    Python's `hash()` is salted per interpreter run. Used here it would give a
    retriever that works perfectly until the service restarts, after which
    every stored vector is noise relative to every new query — rows still come
    back, ranked wrongly, with no error anywhere. `PYTHONHASHSEED` is forced to
    a different value to prove the salt is not reachable from this code path.
    """
    script = (
        "import json;"
        "from app.rag.embedding import HashingEmbedder;"
        "print(json.dumps(HashingEmbedder().embed_one('cancel my appointment')))"
    )
    root = Path(__file__).resolve().parents[1]

    outputs = {
        seed: subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            check=True,
            cwd=root,
            env={**os.environ, "PYTHONHASHSEED": seed},
        ).stdout
        for seed in ("0", "12345")
    }

    assert json.loads(outputs["0"]) == json.loads(outputs["12345"])
    assert json.loads(outputs["0"]) == embedder.embed_one("cancel my appointment")


def test_shared_vocabulary_ranks_above_unrelated_text() -> None:
    query = embedder.embed_one("how do I cancel my appointment")
    relevant = embedder.embed_one(
        "Cancelling an appointment. Call the main line to cancel an appointment."
    )
    unrelated = embedder.embed_one("Parking is available behind the building.")

    assert cosine(query, relevant) > cosine(query, unrelated)


def test_a_plural_matches_its_singular() -> None:
    # What the crude stemmer buys. Both sides go through the same function, so
    # it only has to be consistent, not linguistically right.
    assert features("opening hours") == features("opening hour")


def test_bigrams_distinguish_a_pair_from_its_halves() -> None:
    assert "blood_test" in features("blood test")


def test_a_short_stoplist_leaves_a_short_query_something_to_match_on() -> None:
    # "what to bring" is mostly function words, and a longer stoplist is how
    # you accidentally delete the only noun in it. "what" is kept deliberately:
    # clinic documents put question words in headings ("What to bring").
    assert features("what to bring") == ["what", "bring", "what_bring"]


def test_the_stemmer_leaves_short_verbs_alone() -> None:
    # Regression: an unguarded "ing" rule stemmed "bring" to "br", which then
    # collided with every other two-letter fragment in the corpus.
    assert features("bring") == ["bring"]
    assert features("booking") == ["book"]
    assert features("policies") == features("policy")


def test_text_with_no_terms_is_reported_rather_than_embedded() -> None:
    # Cosine distance against a zero vector is NaN, and Postgres would order
    # results by it without complaint.
    assert is_searchable("???") is False
    assert is_searchable("the and of") is False
    assert is_searchable("prescriptions") is True

    assert embedder.embed_one("???") == [0.0] * EMBEDDING_DIMENSIONS


def test_a_zero_dimension_embedder_is_refused() -> None:
    with pytest.raises(ValueError, match="positive"):
        HashingEmbedder(0)
