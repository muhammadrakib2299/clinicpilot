# ADR-006 — PHI redaction before any model call

- **Status:** Accepted
- **Date:** 2026-08-11
- **Relates to:** [ADR-003](./ADR-003-provider-fallback.md) (the other provider
  decorator), [ADR-008](./ADR-008-fhir-access-through-the-gateway.md) (what the
  AI service is allowed to see at all)

## Context

The Scheduling Agent sends a patient's message, and the results of FHIR
lookups, to a third-party model. Anthropic's API is not a HIPAA-covered
disclosure path without a BAA, and this project's whole premise is that it is
shaped like something a clinic could actually run.

The data here is synthetic, so nothing is at stake today. The decision is about
where the boundary *goes*, because a boundary retrofitted after the fact is one
that half the code paths route around.

## Decision

**Reversible pseudonymisation, applied by a provider decorator, not by a step
in the agent loop.**

`RedactingProvider` wraps any `LlmProvider`. Outbound turns are rewritten so
identifiers become stable placeholders (`[PHONE_1]`); inbound text, reasoning
and tool arguments are restored before anything else sees them.

## Rationale

### A decorator, not a loop step

A step inside `run_agent` protects the calls that loop makes today. A decorator
protects every call anything ever makes through that provider — including the
ones added next year by someone who has not read this file. The redaction
boundary should be structural, not procedural.

It also composes: `RedactingProvider(FallbackProvider([...]))` puts redaction
outermost so failing over to a second vendor cannot become a path that skips
it. Ordering them the other way would leave exactly that hole.

### Pseudonyms, not deletion

`[REDACTED] called about [REDACTED]` is unusable — the model cannot tell one
person from two, and neither can the reader. Stable placeholders let the agent
reason coherently about someone it cannot identify, and the mapping lets the
reply be restored before a human reads it. Tool arguments are restored too:
tools act on the real world, and a literal `[PHONE_1]` reaching one would be
worse than not redacting at all.

### Exact match for names, patterns for structured identifiers

No regex finds names without also finding ordinary words, and a redactor with
false positives corrupts the request it is protecting. Names are removed by
exact match against values the system already holds — which it usually does,
because they came out of a FHIR resource it fetched.

Everything with structure — email, telephone, SSN, NHS number, postcode — is
pattern-matched, and every pattern requires that structure. None matches a bare
run of digits, because a bare run of digits in this system is a FHIR resource
id.

### Dates are not touched

This is a scheduling product. Dates and times are the payload, and redacting
them would break the agent outright while looking like caution. A date of birth
is removed through the known-values path, where it is unambiguous.

## Consequences

**Accepted costs**

- **This is not Safe Harbor de-identification.** Under §164.514(b)(2) a medical
  record number is an identifier, and FHIR resource ids are not redacted —
  the agent addresses everything by id, so removing them removes the agent.
  Acceptable only because every id refers to synthetic data on a public
  sandbox. Production needs an internal-id mapping layer so the model sees a
  token meaningless outside this system. Named in `SECURITY.md` rather than
  implied.
- **Names are missed when the caller does not know them.** A patient who types
  a relative's name into a free-text message is not protected. Real coverage
  needs NER, which is a model call to protect a model call.
- **The mapping is per-run, in memory.** Correct for isolation — two patients'
  mappings in one object is the leak this exists to prevent — but it means
  restoration cannot happen after the run ends, so a trace step is stored
  redacted or restored, never both.
- **A second pass over every turn.** Negligible against a model call, but it is
  work done on every request.

**Unexpectedly free**

ADR-008's decision to return flat projections rather than raw FHIR resources
already keeps names and telephone numbers out of tool results: the gateway
returns `id`, `status`, `start`, `end`, `description` and nothing else. A
choice made for a different reason turned out to be the largest single
reduction in PHI reaching the model.

## Revisit if

- A BAA is in place, at which point the trade-off changes — though minimisation
  is still worth keeping.
- An agent needs to reason about a name (a Follow-up Agent addressing someone
  by it), which needs the restore boundary pushed to the point of delivery
  rather than the point of reply.
- NER becomes cheap enough to run locally, which would close the free-text
  names gap properly.
