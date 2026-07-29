# ClinicPilot

> **One-line pitch:** ClinicPilot is a multi-tenant SaaS control plane that lets healthcare clinics deploy, orchestrate, and monitor a fleet of AI agents (scheduling, patient follow-up, document Q&A) built on n8n workflows and the Claude API — with FHIR/EHR integration, role-based access, and a HIPAA-minded audit trail baked in.

[![CI](https://github.com/muhammadrakib2299/clinicpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/muhammadrakib2299/clinicpilot/actions/workflows/ci.yml)
![status](https://img.shields.io/badge/status-Phase_1_in_progress-blue)
![tests](https://img.shields.io/badge/tests-145_passing-brightgreen)
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
- **Demo login:** _TODO — seeded `admin@demo.clinicpilot.io` / read-only `viewer@demo.clinicpilot.io`_
- **Walkthrough video (2 min):** _TODO — Loom link_
- **Architecture diagram:** see [`06-ARCHITECTURE-SCALABILITY.md`](./06-ARCHITECTURE-SCALABILITY.md)

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

> **Port already in use?** Every host port is overridable in `.env`
> (`POSTGRES_PORT`, `REDIS_PORT`, `WEB_PORT`, `API_PORT`, `N8N_PORT`). A machine
> with its own Postgres on 5432 or Redis on 6379 is common — set
> `POSTGRES_PORT=5433` and `REDIS_PORT=6380` and nothing else needs to change.

### 2. Start the stack

```bash
pnpm up:all
```

Builds the three app images and blocks until all six services report healthy.
First run takes a few minutes; afterwards it is seconds.

### 3. Create the schema and demo data

```bash
pnpm db:migrate     # apply migrations (committed SQL from drizzle-kit)
pnpm db:seed        # demo tenant + the three-agent fleet
pnpm fhir:seed      # synthetic scheduling scenario on the HAPI sandbox
```

All three are safe to re-run. `fhir:seed` *refreshes* rather than skipping,
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
| n8n editor | http://localhost:5678 | same |
| Postgres · Redis | 5432 · 6379 *(or your overrides)* | — |

### 5. Watch an agent run live

Open the dashboard, click **View traces** on the Scheduling Agent to leave the
drawer open, then in a second terminal:

```bash
cd apps/ai
python -m venv .venv                      # first time only
.venv/Scripts/activate                    # Windows — *nix: source .venv/bin/activate
pip install -r requirements-dev.txt       # first time only
python -m app.agents.demo
```

The agent reads the patient's booking, lists free slots, reschedules the
appointment on the live FHIR sandbox, and every step streams into the Trace
Viewer over a WebSocket with its own token count and dollar cost. A typical run
is 3 iterations, 9 steps, about **$0.015**.

### Day-to-day development (hot reload)

Containers are fine for a demo but slow to iterate on. For development, run the
stateful services in Docker and the apps on the host:

```bash
pnpm up            # Postgres+pgvector, Redis, n8n only
pnpm web           # Vite dev server  -> http://localhost:5173
pnpm api           # NestJS in watch mode -> http://localhost:8080

cd apps/ai && uvicorn app.main:app --reload --port 8000
```

### Verify everything

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # 89 tests, 5 workspaces
cd apps/ai && pytest && ruff check .                     # 56 tests
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
| 01 | [`01-PROJECT-OVERVIEW.md`](./01-PROJECT-OVERVIEW.md) | Problem, users, elevator pitch, end-to-end demo flow |
| 02 | [`02-PURPOSE-GOALS-IMPACT.md`](./02-PURPOSE-GOALS-IMPACT.md) | Purpose, SMART goals, impact, and how it lands jobs |
| 03 | [`03-FEATURES.md`](./03-FEATURES.md) | MVP vs stretch features + researched suggestions |
| 04 | [`04-UI-UX.md`](./04-UI-UX.md) | Screens, IA, design system, accessibility, wireframe |
| 05 | [`05-TECH-STACK.md`](./05-TECH-STACK.md) | Finalized stack + rationale + alternatives |
| 06 | [`06-ARCHITECTURE-SCALABILITY.md`](./06-ARCHITECTURE-SCALABILITY.md) | Architecture, folder tree, data model, multi-tenancy, scaling |
| 07 | [`07-MARKET-RESEARCH.md`](./07-MARKET-RESEARCH.md) | Market demand, competitors, roles, rates, sources |
| 08 | [`08-PLAN.md`](./08-PLAN.md) | Phased roadmap, vertical-slice-first |
| 09 | [`09-TODO.md`](./09-TODO.md) | Granular execution checklist |
| 10 | [`10-LESSONS.md`](./10-LESSONS.md) | Skills to learn + lessons-learned log |
| 11 | [`11-SAAS-PRODUCTIZATION.md`](./11-SAAS-PRODUCTIZATION.md) | Commercial SaaS layer: plans, billing, quotas, metering, scale |
| — | [`docs/adr/`](./docs/adr/) | Architecture Decision Records (001, 002, 004, 008 accepted) |

---

## Project status

**Phase 0 — Foundations: complete.** `docker compose up` brings Postgres+pgvector,
Redis, n8n, the API gateway, the AI service and the SPA online health-gated. CI
runs lint, typecheck, test and build across both toolchains, plus a compose smoke
test that stands the whole stack up and probes it on every push.

**Phase 1 — Scheduling agent vertical slice: in progress.** The agent works end
to end against real Claude and a real FHIR server.

### Working today

| | |
|---|---|
| **Claude tool-use loop** | reason → tool → observe → act, with escalation when it cannot converge. Verified live |
| **Scheduling agent** | reads bookings, finds free slots, reschedules on the HAPI FHIR sandbox |
| **FHIR R4 client** | typed, with optimistic concurrency — re-reads and sends a weak-ETag `If-Match`, so a stale write is rejected rather than clobbering someone else's booking |
| **Cost accounting** | per-step tokens and dollars, cache-aware; `traces` and `llm_usage` reconcile to the microdollar |
| **Trace persistence** | 5 tables, migrations, `tenant_id` everywhere ready for Phase 2 RLS |
| **Live Trace Viewer** | steps stream over a WebSocket as the agent works, with an HTTP backfill so a drawer opened mid-run does not start mid-thought |
| **Task creation** | the *Simulate an inbound message* box creates a real task |

### Still fixture data

The KPI tiles, agent cards (task counts, success rates, cost/task) and the Live
activity feed render from `apps/web/src/data/mock.ts`. Only the Trace Viewer and
task creation are wired to the backend.

### Not built yet

Auth and RBAC · multi-tenancy RLS · BullMQ queue and worker (so a created task
sits `queued` until an agent run is started against it) · n8n workflows ·
Follow-up and Document Q&A agents · analytics and evals · deployment.

See [`09-TODO.md`](./09-TODO.md) for the live checklist and
[`10-LESSONS.md`](./10-LESSONS.md) for what broke along the way.

---

## Tech stack at a glance

**In use today**

**Frontend:** React 18 + TypeScript + Vite + Tailwind v4, hand-rolled primitives, native WebSocket (no client library — the SPA is ~54 KB gzipped)
**Backend:** NestJS API gateway + Python FastAPI AI service ([ADR-002](./docs/adr/ADR-002-polyglot-backend.md))
**AI:** Claude via the Anthropic SDK, hand-written tool-use loop, adaptive thinking
**Data:** PostgreSQL + pgvector, Drizzle ORM with committed SQL migrations ([ADR-004](./docs/adr/ADR-004-postgres-ownership-and-drizzle.md))
**Interop:** FHIR R4 against the public HAPI sandbox ([ADR-008](./docs/adr/ADR-008-fhir-access-through-the-gateway.md))
**Infra:** Docker Compose, GitHub Actions CI (Node + Python + a compose smoke test)

**Planned:** BullMQ workers · n8n workflows · OpenAI fallback behind the provider
interface · Recharts analytics · TanStack Query · Vercel + Fly.io deployment.

Full rationale in [`05-TECH-STACK.md`](./05-TECH-STACK.md).

---

## Disclaimer

ClinicPilot is a **portfolio / demonstration project**. It is **not** a certified medical device and is **not** deployed against real patient data. All HIPAA references describe design intent and engineering practices, not a certification.
