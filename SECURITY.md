# Security

## What this project is

ClinicPilot is a **portfolio and demonstration project**. It is not a certified
medical device, it is not HIPAA-certified, and it is not deployed against real
patient data. References to HIPAA safeguards throughout the repository describe
**design intent and engineering practice**, not a compliance status.

**Do not point this at real PHI.** Every fixture is synthetic and targets the
public HAPI FHIR sandbox, which is a shared, publicly readable, periodically
wiped test server. Anything written there is world-visible by design.

## Reporting a vulnerability

Open a GitHub issue for anything already visible in the public repository.

For something genuinely sensitive — a credential committed by mistake, a way to
reach another user's data in a deployed demo — email
**mrabbani@combosoft.co.uk** rather than filing publicly, and expect a reply
within a few days. There is no bounty; this is a personal project.

## Known gaps

These are real and deliberate, tracked in [`09-TODO.md`](./09-TODO.md). Listing
them is the point: a security file that claims no weaknesses is less useful than
one that names them.

| Gap | Status |
|---|---|
| **No authentication.** There is no login, no session, and no user model. Every request runs as a single hardcoded demo tenant behind `currentTenantId()` | Phase 2 |
| **`internal/` routes have no service token.** They read and write patient data with no user in the request at all, and must not be publicly reachable before deploy | Phase 2 |
| **No row-level security.** `tenant_id` is on every table and every query filters by it, but nothing at the database enforces that an application bug cannot cross tenants | Phase 2 (ADR-005) |
| **No audit log.** PHI access is instrumented at one call site and written to the application log, which is not an audit trail | Phase 2 |
| **No PHI redaction before model calls.** Patient context reaches Claude unredacted. Acceptable only because the data is synthetic | Phase 3 (ADR-006) |
| **No rate limiting or spend cap.** A deployed demo could be driven to spend real money on model calls | Phase 5 |

## What is in place

Not a compliance claim — just the things that are actually true today.

- **No secrets in the repository.** `.env` is gitignored; `.env.example` carries
  placeholders only. The Anthropic key is read from the environment and is never
  logged, echoed, or included in a trace step.
- **CORS is an explicit allowlist** on both backends, parsed the same way in
  each, and reads from one variable. The AI service used to send `*`; that was
  the wrong default for a service whose job is forwarding patient context to a
  model, and browsers ignore `allow_credentials` alongside it anyway.
- **The AI service holds no database credentials and no FHIR credentials.** It
  reaches both only through the gateway (ADR-004, ADR-008), so there is one
  enforcement point to instrument rather than two to forget.
- **Optimistic concurrency on every FHIR write.** The client re-reads the
  resource and sends its version as a weak-ETag `If-Match`, so a stale write is
  refused rather than silently overwriting someone else's booking.
- **Agent scope is enforced by the tool surface, not by prompt instruction.**
  The Scheduling Agent has no tool that reaches clinical data, so it cannot
  answer a clinical question however the request is phrased. Failure to converge
  escalates to a human rather than guessing.
- **Task runs are claimed.** Exactly one run can hold a task, enforced in the
  database, so duplicate queue delivery cannot repeat a write to a patient
  record.
- **Money is `numeric`, never float**, so cost accounting reconciles exactly.

## Dependencies

`pnpm audit` and `pip-audit` are not yet wired into CI — Phase 6. Python
dependencies are also unpinned (no lockfile), which is tracked as debt.
