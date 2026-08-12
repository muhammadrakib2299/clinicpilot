# ADR-009 — Lexical embeddings behind an interface, not a second vendor

- **Status:** Accepted
- **Date:** 2026-08-12
- **Relates to:** [ADR-003](./ADR-003-provider-fallback.md) (the same argument
  about untested vendor paths), [ADR-008](./ADR-008-fhir-access-through-the-gateway.md)
  (why retrieval runs in the gateway and embedding runs in the AI service)

## Context

The Document Q&A Agent answers patient questions from clinic documents and
cites the passage each claim came from. That needs a vector for every passage
and a vector for every query, produced by the same function, stored in a
tenant-scoped pgvector column.

Anthropic does not serve an embeddings API. The documented route is a second
vendor — Voyage — and this project holds exactly one key, `ANTHROPIC_API_KEY`.
Nothing in the repo can be tested against a Voyage or OpenAI endpoint, in CI or
by anyone who clones it.

## Decision

**An `Embedder` Protocol with one implementation: signed feature hashing over
word unigrams and bigrams, 1024 dimensions, sublinear term frequency, L2
normalised.** No second vendor, no local model weights, no new dependency.

The docstring's first line says what it is: lexical retrieval, not semantic
retrieval. A query matches a passage when they share vocabulary.

## Rationale

### The same argument ADR-003 already made

ADR-003 declined to ship an OpenAI fallback because there was no key to test it
against, and an untested failover path is worse than none — it looks like a
feature in the repo and fails the first time it is needed. A Voyage client
written blind would be the same artefact: real-looking code, never executed,
between the agent and every answer it gives.

### The gap is one the caller can close

What makes lexical retrieval survivable here is that the thing issuing queries
is a language model. Told that matching is on words rather than meaning — and
it is told, in both the system prompt and the tool description — it searches
again with the vocabulary a policy document would use. That is the substitution
a dense embedding would have made internally. It costs a round trip, and it is
visible in the trace instead of hidden in a vendor's weights.

### The interface is the part that matters

`Embedder` is satisfied by `name`, `dimensions` and `embed(texts)`. A real
provider drops in without the ingest path, the search path, the gateway
contract or the schema changing. `embed` takes a batch because a real provider
bills and rate-limits per request; ingest already calls it that way.

### 1024 was measured, not chosen

This shipped at 384 first, because that is a familiar sentence-transformer
width — which is the wrong way to think about it. With feature hashing the
dimension is not a model's output size, it is a **collision budget**: every
term and bigram in the corpus lands in one of those buckets, and too few means
unrelated text scoring as similar.

A retrieval eval over the seeded corpus caught it immediately. "How do I cancel
my appointment" ranked a chaperones passage above the cancellation policy, on
one colliding term in a short chunk. Top-1 accuracy across 18 real questions:

| Dimensions | Top-1 |
|-----------:|------:|
| 384 | 16/18 |
| 512 | 16/18 |
| 768 | 18/18 |
| 1024+ | 18/18 |

1024 is the next power of two above where it saturates, leaving headroom as a
corpus grows — and it is also the width of the obvious model to swap in, which
turns that swap into a re-ingest rather than a migration.

## Consequences

### What it costs

- **Paraphrase does not work.** "How early should I turn up" will not find "please
  attend ten minutes before". The mitigation is a rephrase by the model, which
  is a real mitigation and not a complete one.
- **Similarity is not comparable across queries.** Measured: a nonsense query
  ("what were the football results") scores 0.18 against the test-results
  document while a correct match scores 0.17. The `minScore` floor is therefore
  only a noise threshold — it removes zero-overlap passages and nothing more.
  What actually prevents a bad answer is the prompt's instruction to decline
  and the citation check in the loop, not the number.
- **No cross-lingual or synonym matching at all**, which a clinic serving a
  multilingual population would need.
- **Anyone reading the repo could mistake it for semantic search.** Hence the
  first line of the module docstring, this ADR, and the README saying so.

### What it buys

- Clone-and-run works with one API key, and CI runs the retrieval eval on every
  push with no network call.
- Ingest and query embed through identical code by construction, which is the
  invariant that silently breaks a vector store when it is violated.
- No second vendor's data-processing terms to reason about for a project whose
  premise is being shaped like something a clinic could run.

## Revisit if

- A real embedding key becomes available — then implement `Embedder` against
  it, re-ingest, and keep the migration only if the width differs from 1024.
- The eval's top-1 accuracy drops as the corpus grows. That is the signal the
  collision budget has been spent, and it is measured rather than guessed.
- Patients start asking things the corpus covers in different words. The failure
  is visible: repeated searches in the trace, ending in "the documents do not
  cover this" for something they plainly do.
