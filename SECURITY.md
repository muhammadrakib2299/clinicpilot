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

These are real and deliberate, tracked in [`09-TODO.md`](./docs/project/09-TODO.md). Listing
them is the point: a security file that claims no weaknesses is less useful than
one that names them.

| Gap | Status |
|---|---|
| **The session token is in `localStorage`.** A script injected into the page could read it, where an httpOnly cookie could not. The SPA and the API are separate origins by design ([ADR-001](./docs/adr/ADR-001-vite-split-frontend.md)), so a cookie session needs `SameSite=None`, CORS credentials and CSRF protection on every mutation — real work, done alongside TLS. Mitigated only by a 12-hour expiry | Phase 5 |
| **No TLS locally.** Everything in `docker compose` speaks plain HTTP on the loopback interface. A self-signed certificate would add a browser warning and no security; the real transport boundary is the deployment edge | Phase 5 |
| **No token revocation.** Sessions are stateless JWTs, so signing out discards the client's copy and nothing else. A leaked token stays valid until it expires | Phase 2.5 |
| **Audit writes are best-effort.** The database guarantees an entry cannot be *altered*, not that one exists — a failed write is logged loudly rather than rolling back the action it was recording | Phase 4 |
| **No PHI redaction before model calls.** Patient context reaches Claude unredacted. Acceptable only because the data is synthetic | Phase 3 (ADR-006) |
| **No rate limiting or spend cap.** A deployed demo could be driven to spend real money on model calls | Phase 5 |

## What is in place

Not a compliance claim — just the things that are actually true today.

- **Authentication on every route by default.** One global guard; a controller
  is closed until it explicitly opts out with `@Public()` or `@ServiceOnly()`,
  so forgetting a decorator locks a route down rather than opening it.
- **Four hierarchical roles**, enforced server-side. The SPA hides what a role
  cannot reach, but hiding is not the control — the guard is.
- **Tenant isolation enforced by Postgres**, not by the application
  ([ADR-005](./docs/adr/ADR-005-multi-tenancy-via-row-level-security.md)).
  Row-level security on a `NOSUPERUSER NOBYPASSRLS` role, tenant set per
  transaction. A query that forgets its scope sees nothing rather than
  everything. Verified in CI by a suite that is itself verified: the build
  fails if those tests still pass while RLS is deliberately bypassed.
- **`/api/health` reports whether isolation is actually being enforced**, and
  degrades when it is not. Superusers bypass RLS silently, so the only defence
  against that misconfiguration is to make it visible.
- **An append-only audit log**, enforced by trigger. The database refuses
  `UPDATE` and `DELETE`, and `TRUNCATE` is not granted because it would skip
  the trigger. Reading it needs the admin role; exporting it is itself audited.
- **The `internal/` surface requires a service token**, compared in constant
  time. An unset `SERVICE_TOKEN` refuses every request rather than allowing
  them — the convenient default is the one that ships an open door.
- **Passwords are scrypt-hashed** with per-password salts and cost parameters
  stored in the hash. Login failures are uniform and an unknown email is still
  verified against a decoy, so response time does not answer "does this address
  have an account at this clinic".
- **No secrets in the repository.** `.env` is gitignored; `.env.example` carries
  placeholders only, and CI runs a secrets scan over the history. The Anthropic
  key is read from the environment and is never logged, echoed, or included in
  a trace step.
- **Production refuses to start with development secrets.** A deployment using
  the `.env.example` placeholders boots and serves traffic identically to a
  correct one, so the check is explicit and fatal rather than a startup warning
  nobody reads.
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

## Secrets handling

Every secret is read from the environment; none has a working default. The
gateway will not start without `JWT_SECRET`, and `assertProductionSecrets`
refuses to boot when `NODE_ENV=production` and any of `JWT_SECRET`,
`SERVICE_TOKEN` or `APP_DATABASE_URL` is missing, too short, still a
placeholder, or — in the last case — pointed at the superuser role that
bypasses row-level security.

There is no secret manager yet. For a local stack and a synthetic demo, `.env`
is the right weight; a deployment should inject these from its platform's
secret store rather than from a file, and that is part of the Phase 5 work.

## Dependencies

CI runs a `gitleaks` scan over the repository. `pnpm audit` and `pip-audit` are
not yet wired in — Phase 6. Python dependencies are also unpinned (no
lockfile), which is tracked as debt.
