# ClinicPilot

> **One-line pitch:** ClinicPilot is a multi-tenant SaaS control plane that lets healthcare clinics deploy, orchestrate, and monitor a fleet of AI agents (scheduling, patient follow-up, document Q&A) built on n8n workflows and the Claude API — with FHIR/EHR integration, role-based access, and a HIPAA-minded audit trail baked in.

[![CI](https://github.com/muhammadrakib2299/clinicpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/muhammadrakib2299/clinicpilot/actions/workflows/ci.yml)
![status](https://img.shields.io/badge/status-Phase_0_complete-blue)
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

## Quickstart

Requires Node 20+, pnpm 10, Python 3.11+ and Docker.

```bash
git clone https://github.com/muhammadrakib2299/clinicpilot.git && cd clinicpilot
cp .env.example .env          # ANTHROPIC_API_KEY is not needed until Phase 1
pnpm install
```

**Everything in containers** — builds the three app images and blocks until every
healthcheck passes:

```bash
pnpm up:all
```

**Or infra in Docker with the apps on the host**, which is the day-to-day loop
because you keep hot reload:

```bash
pnpm up            # Postgres+pgvector, Redis, n8n
pnpm web           # Vite dev server
pnpm api           # NestJS in watch mode

cd apps/ai && python -m venv .venv
.venv/Scripts/activate         # Windows — *nix: source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

| Service | Containerised | Host dev |
|---------|---------------|----------|
| Web dashboard | http://localhost:8081 | http://localhost:5173 |
| API gateway (NestJS) | http://localhost:8080/api/health | same |
| AI service (FastAPI) | http://localhost:8000/health · [`/docs`](http://localhost:8000/docs) | same |
| n8n editor | http://localhost:5678 | same |
| Postgres · Redis | 5432 · 6379 | — |

Every host port above is overridable (`WEB_PORT`, `REDIS_PORT`, …) if it is
already taken on your machine — see [`.env.example`](./.env.example).

### Database and demo data

```bash
pnpm db:migrate     # apply migrations (committed SQL, generated by drizzle-kit)
pnpm db:seed        # one tenant + the three-agent fleet
pnpm fhir:seed      # synthetic scheduling scenario on the HAPI sandbox
```

All three are idempotent. `fhir:seed` *refreshes* rather than skipping, because
slot times are relative to today — re-run it whenever the demo has gone stale or
the public sandbox has been wiped.

### Verify

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # 71 tests, 5 workspaces
cd apps/ai && pytest && ruff check .                     # 56 tests
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
| — | [`docs/adr/`](./docs/adr/) | Architecture Decision Records (001–002 accepted) |

---

## Project status

**Phase 0 — Foundations: complete.** `docker compose up` brings Postgres+pgvector,
Redis, n8n, the API gateway, the AI service and the SPA online health-gated; CI
runs lint, typecheck, test and build across both toolchains on every push.

**Phase 1 — Scheduling agent vertical slice: next.** No database schema, auth or
Claude integration exists yet; the dashboard renders fixture data. See
[`09-TODO.md`](./09-TODO.md) for the live checklist.

---

## Tech stack at a glance

**Frontend:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query + Recharts
**Backend:** Node.js (NestJS) API gateway + Python FastAPI agent/AI service
**AI:** Claude (Anthropic) primary via tool-use; OpenAI as configurable fallback; pgvector for RAG
**Automation:** self-hosted n8n for workflow orchestration
**Data:** PostgreSQL (+ pgvector) + Redis (cache/queues) + BullMQ
**Interop:** FHIR R4 via HAPI FHIR test server
**Infra:** Docker Compose (dev) → containers on Fly.io/Render + Vercel; GitHub Actions CI

Full rationale in [`05-TECH-STACK.md`](./05-TECH-STACK.md).

---

## Disclaimer

ClinicPilot is a **portfolio / demonstration project**. It is **not** a certified medical device and is **not** deployed against real patient data. All HIPAA references describe design intent and engineering practices, not a certification.
