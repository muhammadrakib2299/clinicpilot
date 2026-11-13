# ClinicPilot

> **One-line pitch:** ClinicPilot is a multi-tenant SaaS control plane that lets healthcare clinics deploy, orchestrate, and monitor a fleet of AI agents (scheduling, patient follow-up, document Q&A) built on n8n workflows and the Claude API — with FHIR/EHR integration, role-based access, and a HIPAA-minded audit trail baked in.

<!-- Test count = what CI ran on 2026-11-13: 276 Node unit + 74 integration
     (Stack job) + 299 Python. Re-count from a green run before changing it. -->

[![CI](https://github.com/muhammadrakib2299/clinicpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/muhammadrakib2299/clinicpilot/actions/workflows/ci.yml)
![status](https://img.shields.io/badge/status-Phase_4_in_progress-blue)
![tests](https://img.shields.io/badge/tests-649_passing-brightgreen)
![license](https://img.shields.io/badge/license-MIT-green)
![frontend](https://img.shields.io/badge/frontend-React_18_+_TypeScript-61DAFB)
![api](https://img.shields.io/badge/api-Node_(NestJS)_+_Python_FastAPI-3776AB)
![llm](https://img.shields.io/badge/LLM-Claude_(Anthropic)-D97757)
![automation](https://img.shields.io/badge/automation-n8n-EA4B71)
![data](https://img.shields.io/badge/db-PostgreSQL_+_pgvector-336791)
![infra](https://img.shields.io/badge/infra-Docker_+_Redis-2496ED)
![standard](https://img.shields.io/badge/interop-FHIR_R4_(HAPI)-FF6F00)

---

## Why this project exists

This is a **portfolio project built to land AI / full-stack engineering jobs and contracts.** It is deliberately shaped like a real, sellable enterprise product rather than a toy: multi-tenant, standards-based (FHIR R4), agent-orchestrated, observable, and compliance-aware. It targets the fastest-growing intersection in tech right now — **agentic AI applied to healthcare**, a market projected to grow from ~$1.1B in 2025 to ~$6.9B by 2030 at a 44% CAGR ([MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/ai-agents-in-healthcare-market-231362627.html)).

The goal is that a hiring manager can read the README in 30 seconds, click a live demo, and immediately see: *"this person can ship a production-shaped, multi-agent, healthcare-grade system."*

---

## Naming

**Chosen name: `ClinicPilot`**
- Evokes a "copilot for the clinic" — an assistant that flies the operational workload while staff stay in command. "Pilot" also nods to *piloting/deploying* agents.
- Clean, pronounceable, brandable, `.io`/`.ai`-friendly, and reads as a serious B2B SaaS product.

**Alternate 1: `CareOrchestra`**
- "Orchestra" directly signals **multi-agent orchestration** (the technical differentiator) and "Care" grounds it in healthcare. Great if the portfolio emphasis is on the orchestration engine.

**Alternate 2: `Medley`**
- Short, memorable, "Med" + "medley of agents." Excellent for a consumer-friendly brand feel, though slightly less descriptive than the other two.

---

## What it is

ClinicPilot is a **dashboard + backend** that gives a clinic:

1. An **Agent Fleet** view — deploy, start/stop, configure, and monitor purpose-built AI agents.
2. A **workflow layer** powered by self-hosted **n8n**, so non-trivial automations (calls to EHR, reminders, escalations) are visual, auditable, and extensible.
3. **FHIR/EHR integration** (demoed against the public **HAPI FHIR R4** test server) so agents can read/write real healthcare resources — Patients, Appointments, Observations.
4. **Real-time analytics** on agent performance, cost, and usage.
5. **RBAC + audit logging** designed with HIPAA safeguards in mind.

The three flagship agents:

| Agent | Job | Core tech |
|-------|-----|-----------|
| **Scheduling Agent** | Books, reschedules, and confirms appointments against the FHIR `Appointment` resource | Claude tool-use + n8n + FHIR |
| **Follow-up Agent** | Post-visit / post-discharge check-ins, medication adherence nudges | Claude + n8n scheduler + templating |
| **Document Q&A Agent** | Answers questions over clinic documents & patient records via RAG | Claude + pgvector + FastAPI |

---

## Live demo

- **Live demo:** _TODO — deploy to Vercel (frontend) + Fly.io/Render (API + n8n) and paste URL here_
- **Demo login:** seeded and working locally — `admin@demo.clinicpilot.io`, `clinician@`, `coordinator@`, `viewer@`, password `clinicpilot`. The role changes what the app lets you do; the login screen lists them.
- **Walkthrough video (2 min):** _TODO — Loom link_
- **Architecture diagram:** [`docs/diagrams/architecture.md`](./docs/diagrams/architecture.md) — request path, task lifecycle, deployment topology

> Demo uses **synthetic data only** against the public HAPI FHIR sandbox. No real PHI is ever processed.

---

## Run it locally

**Prerequisites:** Node 20+, pnpm 10, Python 3.11+, Docker Desktop running.

### 1. Clone, configure, install

```bash
git clone https://github.com/muhammadrakib2299/clinicpilot.git
cd clinicpilot
cp .env.example .env
pnpm install
```

Then open `.env` and set **`ANTHROPIC_API_KEY`** — the agent demo makes real
Claude calls. Everything else works without it.

Also replace **`JWT_SECRET`** and **`SERVICE_TOKEN`** with real values
(`openssl rand -hex 32` for each). The containerised gateway runs with
`NODE_ENV=production`, and refuses to boot on the placeholders that
`.env.example` ships.

> **Port already in use?** Every host port is overridable in `.env`
> (`POSTGRES_PORT`, `REDIS_PORT`, `WEB_PORT`, `API_PORT`, `N8N_PORT`). A machine
> with its own Postgres on 5432 or Redis on 6379 is common — set
> `POSTGRES_PORT=5433` and `REDIS_PORT=6380` and nothing else needs to change.
>
> The `.env` copied in step 1 is required, not optional: Compose resolves its
> env file relative to the compose file, so the scripts pass `--env-file .env`
> explicitly. Without that it silently ignored every override above and bound
> the defaults anyway.

### 2. Start the stack

```bash
pnpm up:all
```

Builds the app images and blocks until every service reports healthy.
First run takes a few minutes; afterwards it is seconds.

### 3. Create the schema and demo data

```bash
pnpm db:migrate     # apply migrations (committed SQL from drizzle-kit)
pnpm db:rls         # create the unprivileged role the gateway connects as
pnpm db:seed        # two demo clinics, their agent fleets, and four users
pnpm fhir:seed      # synthetic scheduling scenario on the HAPI sandbox
```

```bash
pnpm n8n:import     # load workflows/*.json into n8n, activate, restart it
```

`n8n:import` is what makes the Follow-up Agent's messages go anywhere: without
it they are composed, recorded, and left at `drafted`.

`db:rls` is not optional. **Postgres superusers bypass row-level security
silently** — the policies stay in place and every one is skipped — and the
compose default user is a superuser. Without this step tenant isolation is not
enforced, which is why `/api/health` reports `tenantIsolation` and degrades
when it is bypassed:

```bash
curl -s localhost:8080/api/health
# {"status":"ok","dependencies":{"database":"up","tenantIsolation":"enforced"}}
```

All four are safe to re-run. `fhir:seed` *refreshes* rather than skipping,
because slot times are relative to today — re-run it whenever the demo has gone
stale or the public sandbox has been wiped (it is, periodically).

### 4. Open the dashboard

**http://localhost:8081**

| Service | Containerised | Host dev |
|---------|---------------|----------|
| **Web dashboard** | **http://localhost:8081** | http://localhost:5173 |
| API gateway (NestJS) | http://localhost:8080/api/health | same |
| Task inbox (JSON) | http://localhost:8080/api/tasks | same |
| AI service (FastAPI) | http://localhost:8000/health · [`/docs`](http://localhost:8000/docs) | same |
| Queue worker | no port — `pnpm logs` to watch it | `pnpm worker` |
| n8n editor | http://localhost:5678 | same |
| Postgres · Redis | 5432 · 6379 *(or your overrides)* | — |

### 5. Watch an agent run live

Sign in (the login screen lists the demo accounts), then type a message into
**Simulate an inbound message** and press send. That is the whole interaction.

The gateway creates the task and puts it on a Redis queue; the worker picks it
up and calls the AI service; the agent reads the patient's booking, lists free
slots and reschedules the appointment on the live FHIR sandbox. Every step
streams into the Trace Viewer over a WebSocket with its own token count and
dollar cost. A typical run is 3 iterations, 9 steps, about **$0.015**.

The message needs to carry a patient id and a schedule id — the agent has no
tool for looking a patient up by name, deliberately, and will ask rather than
guess. The seeded scenario's current ids are at
`/api/internal/fhir/seeded-scenario`, or use the CLI below, which composes the
message for you.

<details>
<summary>Driving a run from the terminal instead</summary>

```bash
cd apps/ai
python -m venv .venv                      # first time only
.venv/Scripts/activate                    # Windows — *nix: source .venv/bin/activate
pip install -r requirements-dev.txt       # first time only

python -m app.agents.demo                 # seeded "move my Thursday appointment"
python -m app.agents.demo <task-id>       # re-run a specific task

python -m app.rag.ingest --demo           # clinic documents -> pgvector, both clinics
```

`ingest` is what gives the Document Q&A agent anything to answer from: it
chunks, embeds and stores six documents per clinic (43 passages each). Re-run it
after editing one — the gateway replaces a document's passages rather than
appending, so nothing stale is left in the index. Opening hours differ between
the two seeded clinics on purpose, so the same question returns each clinic's
own answer.

A hand crank for the same machine, not a second implementation: it creates a
task through the gateway and calls `POST /run` on the AI service, which is
exactly what the worker does. Useful when the worker is not running, or to
re-run one task without touching the queue.

</details>

### Day-to-day development (hot reload)

Containers are fine for a demo but slow to iterate on. For development, run the
stateful services in Docker and the apps on the host:

```bash
pnpm up:infra      # Postgres+pgvector, Redis, n8n only
pnpm web           # Vite dev server  -> http://localhost:5173
pnpm api           # NestJS in watch mode -> http://localhost:8080
pnpm worker        # queue worker, watch mode

cd apps/ai && uvicorn app.main:app --reload --port 8000
```

All four are needed for a task submitted in the dashboard to run end to end.
Without the worker, tasks are created and enqueued but nothing consumes them.

> This script used to be called `pnpm up`, which does not do what it looks
> like: `up` is pnpm's own alias for `update`, so it shadowed the script and
> quietly bumped dependencies instead of starting Postgres.

### Verify everything

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # 276 tests, 5 workspaces
pnpm test:integration                                    # 74, needs a live database
cd apps/ai && pytest && ruff check .                     # 299 tests
```

### Useful extras

```bash
pnpm db:studio     # Drizzle Studio — browse the database
pnpm logs          # tail all container logs
pnpm down          # stop the stack
```

---

## Documentation index

| # | Doc | What's inside |
|---|-----|---------------|
| — | [`README.md`](./README.md) | You are here |
| 01 | [`01-PROJECT-OVERVIEW.md`](./docs/project/01-PROJECT-OVERVIEW.md) | Problem, users, elevator pitch, end-to-end demo flow |
| 02 | [`02-PURPOSE-GOALS-IMPACT.md`](./docs/project/02-PURPOSE-GOALS-IMPACT.md) | Purpose, SMART goals, impact, and how it lands jobs |
| 03 | [`03-FEATURES.md`](./docs/project/03-FEATURES.md) | MVP vs stretch features + researched suggestions |
| 04 | [`04-UI-UX.md`](./docs/project/04-UI-UX.md) | Screens, IA, design system, accessibility, wireframe |
| 05 | [`05-TECH-STACK.md`](./docs/project/05-TECH-STACK.md) | Finalized stack + rationale + alternatives |
| 06 | [`06-ARCHITECTURE-SCALABILITY.md`](./docs/project/06-ARCHITECTURE-SCALABILITY.md) | Architecture, folder tree, data model, multi-tenancy, scaling |
| 07 | [`07-MARKET-RESEARCH.md`](./docs/project/07-MARKET-RESEARCH.md) | Market demand, competitors, roles, rates, sources |
| 08 | [`08-PLAN.md`](./docs/project/08-PLAN.md) | Phased roadmap, vertical-slice-first |
| 09 | [`09-TODO.md`](./docs/project/09-TODO.md) | Granular execution checklist |
| 10 | [`10-LESSONS.md`](./docs/project/10-LESSONS.md) | Skills to learn + lessons-learned log |
| 11 | [`11-SAAS-PRODUCTIZATION.md`](./docs/project/11-SAAS-PRODUCTIZATION.md) | Commercial SaaS layer: plans, billing, quotas, metering, scale |
| — | [`docs/adr/`](./docs/adr/) | Architecture Decision Records (001, 002, 004, 007, 008 accepted) |
| — | [`docs/diagrams/`](./docs/diagrams/architecture.md) | Request path, task lifecycle, deployment topology (mermaid) |
| — | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Setup, the verify commands, commit and ADR conventions |
| — | [`SECURITY.md`](./SECURITY.md) | Posture, reporting, and an honest list of known gaps |

---

## Project status

**Phase 0 — Foundations: complete.** `docker compose up` brings Postgres+pgvector,
Redis, n8n, the API gateway, the AI service and the SPA online health-gated. CI
runs lint, typecheck, test and build across both toolchains, plus a compose smoke
test that stands the whole stack up and probes it on every push.

**Phase 1 — Scheduling agent vertical slice: the loop is closed.** The agent
works end to end against real Claude and a real FHIR server.

**Phase 2 — Multi-tenancy, RBAC and audit: complete.** Four roles, two clinics,
Postgres row-level security on an unprivileged role, and an append-only audit
log the database will not let the application edit.

**Phase 3 — The full fleet: the three agents are deployed, and hand-off
lands somewhere.** An orchestrator routes an unlabelled patient message to
Scheduling, Follow-up or Document Q&A, or refuses and hands it to a person —
who now has a queue to pick it up from. `/health` reports the router's lanes and
the deployed agents as the same set.

One thing is *not* verified and is not claimed: an end-to-end run of the new
agents against a real model. The `ANTHROPIC_API_KEY` in the local `.env` returns
401, so the whole retrieval path was exercised live against the gateway and a
real pgvector database, and the model call was not.

### Working today

| | |
|---|---|
| **Claude tool-use loop** | reason → tool → observe → act, with escalation when it cannot converge. Verified live |
| **Scheduling agent** | reads bookings, finds free slots, reschedules on the HAPI FHIR sandbox |
| **FHIR R4 client** | typed, with optimistic concurrency — re-reads and sends a weak-ETag `If-Match`, so a stale write is rejected rather than clobbering someone else's booking |
| **FHIR behind the gateway** | `internal/fhir` serves appointments, free slots and reschedule ([ADR-008](./docs/adr/ADR-008-fhir-access-through-the-gateway.md)). Ids are normalised at the boundary and FHIR failures map to statuses an agent can recover from |
| **Cost accounting** | per-step tokens and dollars, cache-aware; `traces` and `llm_usage` reconcile to the microdollar |
| **Trace persistence** | 5 tables, migrations, `tenant_id` everywhere ready for Phase 2 RLS |
| **Live Trace Viewer** | steps stream over a WebSocket as the agent works, with an HTTP backfill so a drawer opened mid-run does not start mid-thought |
| **Task creation** | the *Simulate an inbound message* box creates a real task |
| **`POST /run`** | the AI service runs a task and reports its outcome synchronously, so a queue can retry on the answer. A failed run is recorded `failed`, never left `running` |
| **Queue + worker** | BullMQ over Redis. The gateway enqueues on task creation, a separate worker process consumes and drives the run — `--scale worker=3` is the whole throughput story. Retries only what is worth retrying, and a task can be claimed by exactly one run |
| **Auth + RBAC** | Login, four hierarchical roles, one global guard that closes every route by default. A service token in front of `internal/`, compared in constant time |
| **Tenant isolation** | Postgres RLS on an unprivileged role, tenant set per transaction ([ADR-005](./docs/adr/ADR-005-multi-tenancy-via-row-level-security.md)). Two seeded clinics, and a switcher for the user who belongs to both |
| **Audit log** | Append-only, enforced by trigger — the database refuses UPDATE and DELETE. Filterable, exportable, and the export is itself audited |
| **Isolation, tested** | 33 integration tests as the unprivileged role, over every tenant-scoped table. CI re-runs them with RLS bypassed and fails if they still pass, because a test that cannot fail is worth nothing |
| **PHI redaction** | Identifiers become stable pseudonyms before any model call, restored before a human reads the reply ([ADR-006](./docs/adr/ADR-006-phi-redaction-before-model-calls.md)). A provider decorator, so no code path can route around it |
| **Model fallback** | A second model behind the first, for the failures where retrying elsewhere could plausibly help — and only those ([ADR-003](./docs/adr/ADR-003-provider-fallback.md)) |
| **Self-check before writes** | Mutating tools get a second opinion in a fresh context before they run. Fails closed; a block goes back as an observation the model can correct from |
| **Orchestrator** | One cheap model call routes an unlabelled message to a lane — **or refuses to.** Anything clinical, urgent or unplaceable escalates, and the parser reads only the first bare word, so a hedging paragraph escalates even when it names a lane |
| **Follow-up agent** | Post-visit check-ins and adherence reminders. It **cannot write to a patient in its own words** — it picks one of four approved templates and supplies the values. A clinic can review four templates; it cannot review every sentence a model might generate |
| **Document Q&A agent** | Answers from the clinic's own documents over pgvector, citing the passage each claim came from. Citations are assembled by the gateway out of the row it returned, so the agent can only repeat a handle, never invent one |
| **Verified citations** | The loop refuses an answer citing a passage that run never retrieved, and hands the objection back for one correction before escalating. Mechanical — a subset test, no model call, no tokens |
| **Retrieval that can say no** | Nearest-neighbour search always returns neighbours, so a score floor drops passages sharing no vocabulary with the question. "The documents do not cover this" is a first-class answer rather than a failure |
| **A human queue** | Every escalation lands in a queue somebody works — claim it, close it with a note. The row is written by the *gateway*, in the same transaction that marks the task escalated, so no agent path can escalate without queueing |
| **A scheduled n8n workflow** | Sweeps drafted follow-ups every five minutes and delivers them. It enumerates clinics first and makes one RLS-scoped pass each, because a cron has no session and therefore no tenant ([`workflows/`](./workflows/README.md)) |
| **Knowledge Base screen** | What the Document Q&A agent can cite, counted in **passages** rather than documents — retrieval searches chunks, so a document that ingested with none is invisible to the agent and says so |
| **Patient Messages screen** | Everything the Follow-up Agent drafted, and what became of it. A delivered status is never shown without the channel that took it, because `sent` is a claim about this system and not about a patient's phone |
| **Analytics** | Tasks per day by outcome, spend per day, per-agent and **per-model** breakdowns, and p50/p95 task latency. Every day in the window is drawn including the empty ones, and every chart has a table view so no value is reachable by hover alone |

### Honest about the embedder

Retrieval is **lexical, not semantic** — feature hashing over words and bigrams,
not a dense embedding model ([ADR-009](./docs/adr/ADR-009-lexical-embeddings-behind-an-interface.md)).
Anthropic serves no embeddings API, the documented route is a second vendor, and
this project has one key; shipping a client nobody can execute is the mistake
[ADR-003](./docs/adr/ADR-003-provider-fallback.md) already declined once.

So a query matches when it shares vocabulary with a passage, and the agent is
told that in as many words so it can search again with the words a policy
document would use. `Embedder` is a Protocol — a real provider drops in without
the ingest path, the search path, the gateway contract or the schema changing.

A retrieval eval over the shipped corpus runs in CI with no database and no
network: 18 real patient questions, top-1 accuracy 18/18. It is also what caught
the first version being wrong — see `10-LESSONS.md`.

### Not built yet

**The loop is closed, governed and routed** — sign in, type a message, the
orchestrator picks an agent or a human, the agent runs, and every step of it is
audited under a tenant Postgres enforces. What is left is breadth:

a real delivery channel (the n8n workflow runs, but its carrier node is a
stand-in — `messages.delivery_channel` records `simulated` so the row never
implies a text somebody received) · an inbound n8n webhook so a clinic's own
automations can create tasks · an eval harness with a committed report ·
OpenTelemetry and a metrics exporter · Stripe and quotas · deployment.

Known sharp edges, all tracked in [`09-TODO.md`](./docs/project/09-TODO.md) and
[`SECURITY.md`](./SECURITY.md): the enqueue sits just outside the task's
transaction, so a Redis outage in that window leaves a task needing a manual
nudge; and the JWT lives in `localStorage` rather than an httpOnly cookie, which
is a real XSS exposure and is Phase 5 work alongside TLS.

See [`09-TODO.md`](./docs/project/09-TODO.md) for the live checklist and
[`10-LESSONS.md`](./docs/project/10-LESSONS.md) for what broke along the way.

---

## Tech stack at a glance

**In use today**

**Frontend:** React 18 + TypeScript + Vite + Tailwind v4, hand-rolled primitives, native WebSocket (no client library — the SPA is ~54 KB gzipped)
**Backend:** NestJS API gateway + Python FastAPI AI service ([ADR-002](./docs/adr/ADR-002-polyglot-backend.md))
**AI:** Claude via the Anthropic SDK, hand-written tool-use loop, adaptive thinking
**Data:** PostgreSQL + pgvector, Drizzle ORM with committed SQL migrations ([ADR-004](./docs/adr/ADR-004-postgres-ownership-and-drizzle.md))
**Interop:** FHIR R4 against the public HAPI sandbox ([ADR-008](./docs/adr/ADR-008-fhir-access-through-the-gateway.md))
**Queue:** BullMQ over Redis, worker in its own process
**Infra:** Docker Compose, GitHub Actions CI (Node + Python + a compose smoke test)

**Charts are hand-rolled HTML**, not Recharts, and the number is why: adding
it took the production bundle from **80.4 KB to 193.2 KB gzipped — +112.8 KB for
two column charts.** The same argument already declined socket.io (~40 KB) and
TanStack Query (~13 KB). `05-TECH-STACK` still names Recharts and has not caught
up with the measurement.

**Planned:** an inbound n8n webhook · OpenAI fallback behind the provider
interface · OpenTelemetry + Prometheus · Vercel + Fly.io deployment.

Full rationale in [`05-TECH-STACK.md`](./docs/project/05-TECH-STACK.md).

---

## Disclaimer

ClinicPilot is a **portfolio / demonstration project**. It is **not** a certified medical device and is **not** deployed against real patient data. All HIPAA references describe design intent and engineering practices, not a certification.

[`SECURITY.md`](./SECURITY.md) lists the known gaps explicitly — no auth, no
row-level security, no PHI redaction yet — because a project that talks about
HIPAA safeguards owes the reader a straight answer about which ones exist.

Licensed under the [MIT License](./LICENSE).
