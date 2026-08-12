"""Turning text into the vector pgvector searches by.

**What this is, plainly: lexical retrieval, not semantic retrieval.** It is the
hashing trick — features hashed into a fixed-width vector, sublinear term
frequency, L2 normalised so cosine similarity is a dot product. A query matches
a passage when they share vocabulary. A paraphrase that shares none will not
match, and no amount of describing it as "embeddings" changes that.

Why not a real embedding model. Anthropic does not serve one — the documented
route is a second vendor (Voyage), and this project has one key. ADR-003
already made this call for the model fallback: an untested path to a vendor
nobody has credentials for is worse than an honest local one, because it looks
like a feature in the repo and fails the first time anyone runs it. So
`Embedder` is a Protocol with one implementation, and a real provider drops in
by satisfying it — the ingest path, the search path, the gateway contract and
the schema all stay as they are.

What makes the gap survivable is that the *caller* is a language model. The
agent can search three times with three phrasings, which is exactly the
substitution a dense embedding would have made internally. It costs an extra
round trip and it is visible in the trace, which is a fair trade for a
dependency this project cannot honestly claim to have tested.

Two properties are load-bearing and easy to break:

- **The hash must be stable across processes.** Python's built-in `hash()` is
  salted per interpreter run, so vectors written by an ingest today would not
  be comparable to a query embedded after the next restart. Retrieval would
  return the wrong rows and no error, which is the worst failure this file
  could have. `blake2b` is used instead, and a test asserts the vector is
  identical under a different `PYTHONHASHSEED`.
- **The vector must be normalised.** pgvector's cosine distance handles
  magnitude, but a zero vector gives NaN and orders results arbitrarily, so
  text with no usable terms is reported as unsearchable rather than embedded.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Sequence
from typing import Protocol

#: Must equal `EMBEDDING_DIMENSIONS` in packages/shared-types. Nothing
#: structural ties a Python constant to a TypeScript one, so the gateway
#: validates the length it receives and rejects a mismatch by name — a wrong
#: number fails at the boundary rather than as a driver error at INSERT.
#:
#: Here the number means something specific: **it is a collision budget**, not a
#: model's output width. Every distinct term and bigram in the corpus is hashed
#: into one of these buckets, so too few buckets means unrelated text scoring
#: as similar. 384 measurably did: see the note in shared-types, and
#: `tests/test_ingest.py`, which is the eval that caught it.
EMBEDDING_DIMENSIONS = 1024

Vector = list[float]

_TOKEN = re.compile(r"[a-z0-9]+")

#: Deliberately short. A long stoplist is a way to accidentally delete the
#: content word in a short query — "what to bring" is three stopwords and one
#: noun, and the query still has to work.
_STOPWORDS = frozenset(
    # noqa justified: as a list literal this is sixty quoted strings, and the
    # thing a reviewer needs to check is which words are in it.
    """
    a an the and or but if of to in on at for from by with about as is are was
    were be been being do does did have has had i you we they it this that
    please can could would should will my your our their me us them there
    """.split()  # noqa: SIM905
)


class Embedder(Protocol):
    """What ingest and search both need. One implementation today."""

    #: Recorded on every chunk and used to filter search, so vectors from two
    #: different models are never compared. Include the dimension: changing it
    #: changes the vectors, and the name is what makes that visible.
    name: str
    dimensions: int

    def embed(self, texts: Sequence[str]) -> list[Vector]: ...


class HashingEmbedder:
    """Signed feature hashing over word unigrams and bigrams.

    Signed rather than plain counting: a second hash bit decides whether a
    feature adds or subtracts. Two features that collide then cancel as often
    as they compound, which keeps collision noise centred on zero instead of
    inflating every bucket they land in.
    """

    def __init__(self, dimensions: int = EMBEDDING_DIMENSIONS) -> None:
        if dimensions <= 0:
            raise ValueError("dimensions must be positive")
        self.dimensions = dimensions
        self.name = f"hashing-v1-{dimensions}"

    def embed(self, texts: Sequence[str]) -> list[Vector]:
        return [self.embed_one(text) for text in texts]

    def embed_one(self, text: str) -> Vector:
        """One L2-normalised vector. All zeros when the text has no terms."""
        vector = [0.0] * self.dimensions

        for feature, count in _counts(features(text)).items():
            bucket, sign = _bucket(feature, self.dimensions)
            # Sublinear term frequency: the tenth "appointment" in a passage
            # says much less than the second, and raw counts let one long
            # section dominate purely by being long.
            vector[bucket] += sign * (1.0 + math.log(count))

        return _normalise(vector)


def features(text: str) -> list[str]:
    """The terms a passage is indexed by: unigrams, plus adjacent bigrams.

    Bigrams matter more here than they would in general search, because clinic
    vocabulary is full of pairs whose halves are ambiguous alone — "blood test",
    "opening hours", "repeat prescription".

    They are formed *after* stopword removal, so "results of the test" and
    "test results" both yield `result_test`-shaped evidence rather than only
    matching when the filler words line up. The cost is that two words either
    side of a removed one look adjacent; in this vocabulary that is a better
    trade than missing the pair entirely.
    """
    words = _TOKEN.findall(text.lower())
    kept = [_stem(word) for word in words if word not in _STOPWORDS and len(word) > 1]

    # strict=False is the point: the shifted list is one shorter by design.
    bigrams = [f"{first}_{second}" for first, second in zip(kept, kept[1:], strict=False)]
    return kept + bigrams


def _stem(word: str) -> str:
    """Crude suffix stripping, and crude is enough — but not unbounded.

    A stemmer here only has to be *consistent*: the same function runs over the
    document at ingest and over the query at search, so "morn" being wrong as
    linguistics costs nothing as long as both sides produce it.

    What it costs when a rule is too eager is real, though, and a test caught
    it: stripping "ing" from any word over four letters turns "bring" into
    "br", which then collides with every other two-letter fragment in the
    corpus. The length guards are set so the shortest possible stem is four
    characters. Past tense is left alone entirely — "cancelled" would stem to
    "cancell" and still miss "cancel", so the rule buys nothing and risks the
    same class of damage.
    """
    # 'ies' first, and rewritten rather than stripped: "policies" -> "policy"
    # matches the singular, where "polic" would match neither form.
    if word.endswith("ies") and len(word) > 4:
        return f"{word[:-3]}y"
    if word.endswith("ing") and len(word) > 6:
        return word[:-3]
    # "address" is not a plural. Without the guard it becomes "addres", which
    # is consistent but needlessly collides with anything else ending in -ss.
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        return word[:-1]
    return word


def _counts(items: Sequence[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        counts[item] = counts.get(item, 0) + 1
    return counts


def _bucket(feature: str, dimensions: int) -> tuple[int, int]:
    """Which slot a feature lands in, and whether it adds or subtracts.

    blake2b rather than `hash()`, which is salted per process — see the module
    docstring. This is the single line that decides whether vectors written
    last week are comparable to a query embedded today.
    """
    digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
    value = int.from_bytes(digest, "big")
    return value % dimensions, 1 if (value >> 63) & 1 else -1


def _normalise(vector: Vector) -> Vector:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0.0:
        return vector
    return [value / norm for value in vector]


def is_searchable(text: str) -> bool:
    """Whether a query has anything to match on.

    A query of only stopwords embeds to zeros, and cosine distance against a
    zero vector is NaN — Postgres would return rows in whatever order it
    happened to produce them. Callers check this and say so instead.
    """
    return bool(features(text))
