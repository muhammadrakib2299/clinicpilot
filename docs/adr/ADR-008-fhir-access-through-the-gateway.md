# ADR-008 — FHIR access goes through the gateway

- **Status:** Accepted
- **Date:** 2026-07-29
- **Relates to:** [ADR-002](./ADR-002-polyglot-backend.md), [ADR-004](./ADR-004-postgres-ownership-and-drizzle.md)

## Context

The Scheduling Agent's tools read appointments, list slots and write a
reschedule. The loop that calls those tools runs in the Python AI service, but
the typed FHIR client — including its optimistic-concurrency handling — is
TypeScript, in `packages/fhir-client`.

So the tool executor either calls FHIR directly from Python, or calls the
gateway and lets the existing client do the work. The first live agent run used
a throwaway Python adapter to prove the loop; this decides where it lives
permanently.

## Decision

**The gateway exposes a narrow internal FHIR API and the AI service's tool
executor calls it over HTTP.** The AI service holds no FHIR credentials and
speaks no FHIR.

## Rationale

- **Optimistic concurrency should exist once.** `rescheduleAppointment` re-reads
  the resource, sends its version as a weak-ETag `If-Match`, and maps 409/412 to
  a conflict the caller must handle. Reimplementing that in Python is exactly
  the kind of subtle logic that drifts — and where drift means silently
  overwriting someone else's booking.
- **PHI access has to be auditable in one place.** HIPAA audit controls mean
  recording every data access, and `06-ARCHITECTURE` puts `audit_log` in the
  gateway. Two services reading patient data means two places to instrument and
  two places to forget.
- **It matches the boundary already drawn.** ADR-004 made the gateway the sole
  owner of Postgres for the same reason: one enforcement point beats two. FHIR
  credentials, and later SMART-on-FHIR tokens, belong on the same side.
- **The throwaway adapter already showed the failure mode.** Written quickly in
  Python, it built a reference `Slot/Slot/137240396` and wrote it to a live
  appointment. The TypeScript client would not have — a second implementation is
  a second set of these.

## Consequences

**Accepted costs**

- **An HTTP hop per tool call.** Same trade as ADR-004 and the same answer: the
  loop already waits seconds on each model call, so the hop is noise.
- **The gateway grows an internal API surface** that only the AI service calls.
  It must be authenticated as a service-to-service caller, not exposed publicly.
- **A tool failure is now two failures away** — FHIR may fail, or the gateway
  may. Both surface to the agent as an error `tool_result`, which the loop
  already handles, but the error text has to stay legible enough for the model
  to act on. The live run showed it self-correcting from a raw 400, so this is a
  real requirement rather than a hypothetical.

**Not a consequence**

- PHI redaction (ADR-006) is unaffected. It belongs immediately before the model
  call, which is in the AI service regardless of where the data came from.

## Revisit if

- The AI service needs FHIR data on a path where the extra hop's latency is
  visible to a user — voice being the obvious candidate, since a caller hears
  every hundred milliseconds.
- pgvector retrieval for Document Q&A (Phase 3) ends up wanting the same
  treatment; that would be the point to reconsider both together rather than
  drift into a per-case rule.
