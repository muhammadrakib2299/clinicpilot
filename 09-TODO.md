# 09 · TODO (Execution Checklist)

Granular, ordered, ready to execute. Checkboxes map to the phases in [`08-PLAN.md`](./08-PLAN.md). Keep MVP (🟢) items strictly ahead of stretch (🔵) items. Tag commits `phase-N`.

---

## Phase 0 — Foundations ✅ **COMPLETE** (closed out 2026-07-29)
- [x] Create GitHub repo `clinicpilot` (MIT license, README stub) — the
      LICENSE *file* was missing until 2026-08-11 while the badge claimed MIT
- [x] Init pnpm workspace + Turborepo (`turbo.json`, `pnpm-workspace.yaml`)
- [x] Scaffold `apps/web` (Vite + React 18 + TS + Tailwind v4) — ⚠️ hand-rolled
      primitives instead of shadcn/ui; revisit when the component surface grows
- [x] Scaffold `apps/api` (NestJS + TS)
- [x] Scaffold `apps/ai` (FastAPI + Python) — ⚠️ pip + `requirements*.txt`, not
      `uv`/`poetry`; no lockfile yet, so CI resolves fresh each run
- [x] Create `packages/shared-types`, `packages/fhir-client`, `packages/config`
- [x] Write `infra/docker-compose.yml`: postgres+pgvector, redis, n8n, api, ai, web
- [x] `.env.example` with `ANTHROPIC_API_KEY`, DB/Redis/n8n secrets + host port overrides
- [x] Add `/health` endpoints to api + ai; verify all containers reachable
- [x] GitHub Actions: install → lint → typecheck → test (+ build; Python job for ruff/pytest)
- [x] Write ADR-001 (Vite split) and ADR-002 (polyglot backend)
- [x] ✅ Gate: `docker compose up` runs the full stack — **all six services**
      (postgres, redis, n8n, api, ai, web) verified healthy; `/api/health`,
      `/health` and n8n `/healthz` all return 200 from the host

### Phase 0 close-out (not in the original list, needed to make the gate real)
- [x] Regenerate the lockfile across all workspaces (`pnpm build` was failing at root)
- [x] Dockerfiles for web (nginx), api (multi-stage pnpm) and ai (python-slim)
- [x] Healthchecks + health-gated `depends_on` so `up --wait` means "actually ready"
- [x] Overridable host ports so a clone-and-run survives a busy machine
- [x] Test harnesses: Vitest (web, packages), Jest+Supertest (api), pytest (ai)
- [x] **37 tests** — 30 TypeScript across 4 workspaces, 7 Python
- [x] Shared ESLint flat config + TS base in `packages/config`; ruff for Python
- [x] Harden AI-service CORS from `*` to a `WEB_ORIGIN` allowlist, matching the gateway
- [x] Tag `phase-0`

### Known debt carried into Phase 1
- [ ] Pin Python deps with a lockfile (`uv` or pip-tools) — currently unpinned
- [ ] Generate the AI-service client from its OpenAPI schema (ADR-002 drift risk)
- [x] ~~`packages/*` are source-only~~ — resolved: both emit CommonJS with
      declarations, because Nest cannot `require()` an ESM module and the first
      runtime import would have crashed on startup

### Debt added during Phase 1
- [x] ~~`apps/ai/app/agents/demo.py` calls HAPI directly, contradicting
      ADR-008~~ — **paid (2026-08-11).** The adapter and `app/fhir/ids.py` are
      deleted; the AI service reaches FHIR only through the gateway and holds
      no id-normalisation logic of its own
- [ ] `RealtimeService` is an in-process rxjs Subject — becomes Redis pub/sub
      when the gateway runs more than one replica (Phase 4)
- [x] ~~`internal/` routes have no service token~~ — paid 2026-08-11.
      `@ServiceOnly()` puts a constant-time-compared token in front of them,
      and an unset `SERVICE_TOKEN` closes the surface rather than opening it
- [ ] `FhirClient` sets no HTTP timeout. A hanging HAPI hangs the gateway
      request — the sandbox returned `fetch failed` once mid-session and took
      7.8s on a plain read shortly after
- [ ] The enqueue happens just after the task commits, not inside it. A Redis
      outage in that window leaves a task nothing will pick up (the response
      says so via `queued: false`, and the CLI can drive it). The fix is an
      outbox: write the job to Postgres in the same transaction and relay it
- [ ] No reconnect/backoff on the Trace Viewer WebSocket — a dropped socket
      shows `closed` until the drawer is reopened

## Phase 1 — Vertical Slice: Scheduling Agent ⭐ **~90% — the loop is closed**

Sequenced **agent-spine-first**: auth, queue and n8n were deliberately deferred so
a demoable artefact existed sooner. As of 2026-08-11 a message typed into the
dashboard is queued, picked up by a worker, run by the agent against a real FHIR
server, and streamed back step by step. What is left in this phase is n8n and
the auth that Phase 2 owns anyway.

### Auth & data
- [x] DB migrations: `tenants`, `agents`, `tasks`, `traces`, `llm_usage`
      (Drizzle, committed SQL — `users` lands with auth)
- [x] Seed one tenant + the three-agent fleet (idempotent, fixed demo tenant id)
- [x] Login flow (JWT/session) + protected routes — the one-file swap the
      Phase 1 note promised: `currentTenantId()` now reads the request actor
### FHIR
- [x] Build `packages/fhir-client` typed R4 client (HAPI base URL)
- [x] Read `Patient`, `Appointment`, `Slot`; write `Appointment`
- [x] **Optimistic concurrency** — re-read + weak-ETag `If-Match`, 409/412 mapped
      to a conflict error (not in the original list; FHIR writes demanded it)
- [x] Seed synthetic patients/appointments on HAPI — refreshes rather than skips,
      because slot times are relative to today and the sandbox gets wiped
### AI service
- [x] Provider interface (`llm/`) with Anthropic implementation
- [x] Tool definitions: `find_appointments`, `find_availability`, `reschedule_appointment`
- [x] Claude tool-use loop (reason → tool → observe → act) + escalation on
      non-convergence; a failing tool returns an error result the model recovers from
- [x] Persist each step to `traces` with tokens + cost
- [x] **Cost accounting module** — cache-aware, date-bounded rate card, unknown
      model raises rather than pricing at zero
### Automation & queue
- [ ] n8n "reschedule appointment" workflow (read slot → write appt → confirm)
- [ ] Expose n8n webhook; call it from an AI-service tool
- [x] BullMQ producer (API) + worker (consumes → AI service) — **the loop is
      closed.** Producer enqueues on task creation with `jobId = taskId` so a
      double submit cannot double-run; the worker is its own process
      (`--scale worker=3`); retries only failures where the run demonstrably
      never started; and `markRunning` is a claim, so exactly one run can hold
      a task no matter how many times a job is delivered
- [x] AI service HTTP surface (`POST /run`) — drives the loop and reports the
      outcome synchronously, so a queue worker can retry on the answer.
      A failed run is recorded `failed`, never left `running`
- [x] Gateway FHIR endpoints so the AI service stops calling HAPI directly
      (ADR-008) — `internal/fhir` serves appointments, free slots and
      reschedule off the typed client, with ids normalised at the boundary and
      FHIR failures mapped to statuses a model can recover from
### UI
- [x] Fleet Overview with agent cards — **live**, from `GET /api/agents`
- [x] "Simulate message" box — creates a real task
- [x] Trace Viewer streaming steps over WebSocket (+ HTTP backfill so a drawer
      opened mid-run does not start mid-thought)
- [x] Show cost per task, per step
- [x] Task Inbox list view — real table, click a row to replay its trace
- [x] Router (react-router) — nine routes; the eight unbuilt screens render an
      honest "not built yet, Phase N" page instead of a dead nav button
- [x] Replace fixture KPI tiles / agent stats / activity feed with real queries
      (`GET /api/overview`). Tiles now report what the system *measures* —
      tasks, outcomes, spend, tokens — not the invented business outcomes
      ("no-show −4pp", "76% calls deflected") the mock displayed
- [x] ✅ Gate (B1): reschedule works end-to-end, live, with trace + cost —
      **met 2026-07-29**, 3 iterations, 9 steps, $0.0153, appointment moved on HAPI

### Still fixture in the UI
- [ ] Org switcher, search box (⌘K), notifications bell — chrome with no backing
- [ ] Sidebar persona "Priya Nair" — labelled `Admin · demo`; real once auth lands

## Phase 2 — Multi-tenancy, RBAC & Audit ✅ **COMPLETE** (closed out 2026-08-11)
- [x] Add `tenant_id` to all tenant-scoped tables
- [x] Postgres RLS policies + tenant-context middleware (ADR-005) — on a
      `NOSUPERUSER NOBYPASSRLS` role, because superusers bypass RLS silently;
      `/api/health` reports whether it is actually being enforced
- [x] Seed 2 synthetic clinics; tenant switcher in UI — switching mints a new
      token, since the tenant is a claim inside it
- [x] Roles: Admin/Clinician/Coordinator/Viewer + `memberships` (one table
      with a role enum, not `roles` + `user_roles` — see the schema comment)
- [x] NestJS RBAC guards + policy decorators — one global guard, closed by
      default: a new controller is protected until it opts out
- [x] RBAC-gated navigation in the SPA
- [x] Append-only `audit_log` — enforced by trigger, not convention: the
      database refuses UPDATE and DELETE, and TRUNCATE is not granted because
      it would skip the trigger. Writes on auth, task lifecycle and every FHIR
      access. Individual agent tool calls stay in `traces`, the record built
      for them
- [x] Audit Log UI: filter (actor/resource/action), export CSV — the export is
      itself audited
- [x] Secrets via env; posture documented in `SECURITY.md`. Production refuses
      to boot on placeholder secrets, or on an `APP_DATABASE_URL` that bypasses
      RLS; CI runs a gitleaks scan.
      TLS is **deferred to Phase 5, deliberately** — a self-signed certificate
      on loopback buys a browser warning and no security, and the real
      transport boundary is the deployment edge
- [x] Test: cross-tenant access is blocked by RLS — 14 integration tests
      against a real database as the unprivileged role, run in the CI compose
      job. CI then re-runs them with RLS deliberately bypassed and **fails if
      they still pass**, because a test that cannot fail is worth nothing
- [x] ✅ Gate: roles + tenants + audit all working — **met 2026-08-11.** Each
      of the four roles exercised live: viewer reads but cannot create (403) or
      open the audit log (403), coordinator creates (201), admin sees both. The
      clinician switches between two clinics, role changes clinician to admin,
      and the two tenants' task lists have zero overlap

## Phase 2.5 — SaaS Commercial Layer (see `11-SAAS-PRODUCTIZATION.md`)
- [ ] Rename tenant → **org** model; self-serve signup → create org (Owner)
- [ ] `plans` + `plan_features` (data-driven entitlements) seeded (Free/Pro/Clinic/Enterprise)
- [ ] Central `entitlements.can(org, feature)` check used everywhere (no scattered `if plan===`)
- [ ] Stripe (test mode): Products/Prices per plan; Checkout (upgrade) + Customer Portal
- [ ] Stripe webhooks → sync `subscriptions`; idempotent `billing_events` log
- [ ] Usage metering: Redis counters → reconcile to `usage_counters`; monthly reset job
- [ ] Pre-flight **quota check** before enqueue (over quota → 402 + upsell, not crash)
- [ ] Per-tenant LLM **budget cap** + rate limits at API gateway
- [ ] Metered LLM overage → Stripe metered price
- [ ] Billing & Plan UI: current plan, usage-vs-quota bars, upgrade/manage
- [ ] Team & Invitations UI (invite by email, per-org role, pending invites)
- [ ] ✅ Gate (SaaS MVP): signup → org → Free plan → hit quota → Stripe Checkout (test) → quota lifts, live

## Phase 3 — Agents #2/#3 + Orchestration
- [ ] Follow-up Agent: n8n scheduled sequence + templated check-ins
- [ ] Document Q&A: doc ingest → chunk → embed → `embeddings` (pgvector)
- [ ] RAG retrieval + answers **with citations**
- [ ] Orchestrator: route task → correct agent (routing pattern)
- [ ] Hand-off/escalation: confidence/scope check → `escalations` + queue UI
- [ ] Reflection/self-check before high-stakes FHIR writes
- [ ] Model fallback (Claude → OpenAI) behind provider interface (ADR-003)
- [ ] PHI redaction/de-identification module before LLM calls
- [ ] Test: escalation fires; fallback triggers on simulated failure
- [ ] ✅ Gate: 3 agents deployable, routing + hand-off + fallback work

## Phase 4 — Analytics, Observability & Polish
- [ ] Analytics: tasks/day, success vs escalation per agent (Recharts)
- [ ] Cost analytics: $/resolved task, per agent/tenant, spend charts
- [ ] KPI tiles: no-show delta, calls deflected, follow-ups completed
- [ ] OpenTelemetry tracing api→ai→n8n→fhir
- [ ] Prometheus/Grafana: p50/p95 latency, queue depth, error/cost rate
- [ ] Eval harness: datasets + scoring; commit a results report
- [ ] FHIR Explorer: patient/appt browser + raw resource JSON viewer
- [ ] Design-system pass; dark mode; `prefers-reduced-motion`
- [ ] Accessibility audit (keyboard, contrast, ARIA live regions) → WCAG AA
- [ ] ✅ Gate (B2/B5): MVP complete; metrics + cost visible; UI shipped-grade

## Phase 5 — Deploy & Demo
- [ ] Deploy web to Vercel
- [ ] Deploy api/ai/n8n/postgres/redis to Fly.io/Render
- [ ] Production seed script (synthetic tenants/agents/patients)
- [ ] Seed `admin@demo` + `viewer@demo` accounts
- [ ] Rate limits + demo-reset cron + LLM cost caps
- [ ] Record 2-min Loom walkthrough (follow `01` demo flow)
- [ ] Put live URL + video + demo creds in README
- [ ] ✅ Gate (B3): public demo works from a clean browser

## Phase 6 — Documentation, Tests & Hardening
- [ ] Unit/integration tests → >70% on core services
- [~] Finalize ADRs in `/docs/adr` — 001, 002, 004, 007, 008 accepted.
      003, 005 and 006 stay reserved until the work they describe is built
- [x] Architecture diagram — `docs/diagrams/architecture.md`: request path,
      task lifecycle and deployment topology, mermaid source rather than PNG so
      a diff shows what changed about the system
- [ ] README polish: 30-second clarity, badges, verified quickstart
- [ ] Dependency audit; secrets scan; RLS + PHI-redaction tests
- [x] `CONTRIBUTING.md` + `SECURITY.md` + disclaimers — SECURITY lists the
      six known gaps by name rather than claiming a posture
- [ ] ✅ Gate (B4): CI green; clone-and-run verified by a fresh clone

## Phase 7 — Launch & Apply
- [ ] Write case-study post ("How I built a multi-agent healthcare platform")
- [ ] Cross-post to LinkedIn + dev.to; pin on GitHub profile
- [ ] Update CV, LinkedIn, portfolio site (lead with ClinicPilot)
- [ ] Prepare interview talk track (architecture, scaling, "what was hard")
- [ ] Apply: 20 targeted roles + 10 contracts; track in a sheet
- [ ] Log interview feedback → plan v1.1 (voice channel stretch)
- [ ] ✅ Gate (C1–C5): interviews booked, offers/contracts in pipeline

---

## Stretch backlog (only after M5)
- [ ] 🔵 Voice channel (Twilio) for Scheduling/Follow-up
- [ ] 🔵 Agent versioning + rollback UI
- [ ] 🔵 SSO/MFA (OIDC) real implementation
- [ ] 🔵 Anomaly alerts (cost/error spikes)
- [ ] 🔵 Tenant usage metering + billing view
- [ ] 🔵 Workflow run history unified in-app
- [ ] 🔵 Configurable orchestration modes (sequential/parallel)
- [ ] 🔵 Self-hosted HAPI FHIR JPA option for offline demos
- [ ] 🔵 Exportable PDF reports
- [ ] 🔵 Schema-per-tenant isolation upgrade path (demo one tenant)
