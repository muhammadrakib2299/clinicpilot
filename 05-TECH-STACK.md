# 05 · Tech Stack (Finalized)

Selection criteria, in priority order for a **job-landing portfolio project**:
1. **Signal** — technologies that appear in the target job descriptions (React, TypeScript, Node, Python, LLMs, Docker, Postgres, FHIR).
2. **Credibility** — production-shaped choices a senior engineer would defend.
3. **Velocity** — a solo developer can ship an MVP in ~12 weeks.
4. **Demonstrability** — easy to run, deploy, and show live.

---

## The finalized stack (one line)

**React 18 + TypeScript + Vite + Tailwind/shadcn (web) · NestJS API gateway + Python FastAPI AI service · Claude (Anthropic) primary LLM w/ OpenAI fallback · self-hosted n8n · PostgreSQL + pgvector + Redis/BullMQ · FHIR R4 via HAPI · Docker Compose → Fly.io/Render + Vercel · GitHub Actions.**

---

## Layer-by-layer rationale

### Frontend

| Choice | Why | Alternatives considered |
|--------|-----|-------------------------|
| **React 18 + TypeScript** | Highest-demand front-end pairing; TS shows engineering rigor | Vue/Svelte (less job demand); Angular (heavier) |
| **Vite** | Fast dev/build; standard for modern React | Next.js — see note below |
| **Tailwind + shadcn/ui** | The current "serious SaaS" aesthetic; accessible Radix primitives; ownable code | MUI (heavier/opinionated), Chakra, Mantine |
| **TanStack Query + Zustand** | Best-in-class server-state + light client-state | Redux Toolkit (more boilerplate) |
| **Recharts / Tremor** | Declarative dashboards fast | Chart.js, visx (lower-level), Nivo |
| **SSE/WebSocket** | Stream live agent traces (the signature UX) | Polling (worse UX) |

> **Vite vs Next.js:** Vite + a separate API keeps a **clean frontend/backend boundary**, which better demonstrates full-stack API design than a Next.js monolith. Next.js is a fine alternative and is noted as such; the split is a deliberate architectural signal. (An ADR records this.)

### Backend — two services, on purpose

A **polyglot backend** is a deliberate showcase of both Node and Python — two stacks that appear across the target roles.

| Service | Tech | Responsibility | Why |
|---------|------|----------------|-----|
| **API Gateway** | **Node.js + NestJS + TypeScript** | Auth, RBAC, tenancy, CRUD, audit, WebSocket, orchestration entrypoint | NestJS gives enterprise structure (modules, DI, guards) that reads as senior-level; shares types with the React app |
| **AI / Agent Service** | **Python + FastAPI** | LLM calls, tool-use loop, RAG, embeddings, evals, PHI redaction | Python is the lingua franca of AI/ML; FastAPI is fast, typed, and auto-documents (`/docs`) |

> **Why two services (not one)?** It (a) demonstrates service-boundary design and inter-service communication, (b) puts AI work where the AI ecosystem lives (Python), and (c) lets the AI service scale independently (it's the CPU/latency-heavy part). Trade-off — added complexity — is acknowledged in an ADR; a single Node service is the simpler alternative for a team that wants one language.

### AI / LLM — **Claude primary**

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Primary model** | **Claude (Anthropic)** — Sonnet-class for agents, Haiku-class for cheap/high-volume steps | Target jobs reference Claude; strong tool-use & long-context reasoning; **Anthropic is the only major foundation model available across all three HIPAA-compliant clouds (AWS Bedrock, Google Vertex, Azure) and signs BAAs** ([Paubox](https://www.paubox.com/blog/anthropic-brings-claude-ai-to-healthcare-with-hipaa-tools)) — directly on-narrative for healthcare |
| **Fallback model** | **OpenAI (GPT-class)** behind a provider interface | Reliability + shows provider-agnostic design; justified as failover, not primary |
| **Agent pattern** | Claude **tool-use** loop (reason → tool → observe → act) | Canonical, defensible agent architecture |
| **RAG** | pgvector embeddings + retrieval for Document Q&A | Keeps the vector store in Postgres (one fewer moving part) |
| **Healthcare hook** | Note Anthropic's **FHIR Agent Skills** + PubMed connector for HIPAA orgs ([Anthropic](https://www.anthropic.com/news/healthcare-life-sciences)) | Reinforces the domain fit in the docs/interview |

**Why Claude over OpenAI as primary:** target roles name Claude; Claude's tool-use and long context suit multi-step agent workflows; and Anthropic's healthcare/HIPAA posture (BAA across all three clouds) makes the *story* coherent for a healthcare product. OpenAI is retained as a **configurable fallback** to demonstrate resilient, vendor-neutral engineering rather than lock-in.

### Automation — n8n

| Choice | Why | Alternatives |
|--------|-----|--------------|
| **Self-hosted n8n** | Fulfills the workflow requirement; 400+ integrations; native AI nodes; keeps workflows/credentials/payloads inside our boundary (a HIPAA plus) ([n8n](https://n8n.io/)) | Temporal (more code-centric, steeper), Zapier/Make (SaaS, no self-host, weaker for PHI), custom queue-only (loses the visual/auditable win) |

n8n is the **transparent, extensible automation layer**: agents *decide*, n8n *executes* the multi-step side effects (FHIR writes, SMS, escalations), and each workflow is visual and auditable — a strong differentiator vs a black-box agent.

### Interoperability — FHIR

| Choice | Why |
|--------|-----|
| **FHIR R4** as the EHR data model | The actual global healthcare interoperability standard; uses REST + JSON so it's developer-friendly ([medblocks](https://medblocks.com/blog/what-is-fhir)) |
| **HAPI FHIR public test server (R4)** for the demo | Free, public, standards-compliant sandbox — build a full FHIR API/app quickly; **synthetic data only** ([hapifhir.io](https://hapifhir.io/)) |
| **Pluggable EHR adapter interface** | Abstracts FHIR now; documents an Epic/Cerner-shaped path later — shows extensible design |

> Optionally self-host the HAPI FHIR JPA server via Docker for offline demos; default is the public sandbox.

### Data & infrastructure

| Choice | Why | Alternatives |
|--------|-----|--------------|
| **PostgreSQL** | Reliable relational core; healthcare-grade; great tenancy support (schemas + RLS) | MySQL (weaker RLS/JSON), Mongo (loses relational integrity we want) |
| **pgvector** | Vector search inside Postgres → one datastore for RAG | Pinecone/Qdrant/Weaviate (extra infra; noted as scale-out option) |
| **Redis + BullMQ** | Caching (FHIR reads, sessions) + durable job queues for agent tasks & workflow triggers | RabbitMQ/SQS (heavier for a portfolio) |
| **Docker + Docker Compose** | One-command local stack; the DevOps signal hiring managers look for ([Medium](https://medium.com/@santosh.rout.cr7/ml-engineer-portfolio-projects-that-will-get-you-hired-in-2025-d1f2e20d6c79)) | Bare-metal (poor demo story) |
| **Deploy: Vercel (web) + Fly.io/Render (services, n8n, Postgres, Redis)** | Cheap, fast, real public demo URL | AWS ECS/K8s (overkill for a solo demo; mention as scale path) |
| **CI: GitHub Actions** | Lint, typecheck, test, build, deploy on push | CircleCI/GitLab CI |
| **Auth: Auth.js/Clerk or custom JWT + OIDC scaffolding** | Multi-tenant auth + RBAC without reinventing crypto | Custom-only (more risk) |
| **Observability: OpenTelemetry + Prometheus/Grafana (or Logtail) + structured logs** | Traces, metrics, audit; proves ops maturity | Console logs only (weak signal) |

---

## Stack summary table

| Concern | Technology |
|---------|-----------|
| Web app | React 18, TypeScript, Vite, Tailwind, shadcn/ui, TanStack Query, Recharts |
| API gateway | Node.js, NestJS, TypeScript |
| AI service | Python, FastAPI, Anthropic SDK, OpenAI SDK (fallback) |
| LLM | Claude (primary), OpenAI (fallback) |
| Automation | n8n (self-hosted) |
| Interop | FHIR R4, HAPI FHIR test server |
| Database | PostgreSQL + pgvector |
| Cache / queue | Redis + BullMQ |
| Auth | JWT/OIDC, RBAC |
| Containerization | Docker, Docker Compose |
| CI/CD | GitHub Actions |
| Hosting | Vercel + Fly.io/Render |
| Observability | OpenTelemetry, Prometheus/Grafana, structured logging |

---

## Architecture Decision Records (to write during the build)

Keeping short ADRs in `/docs/adr` is itself a hiring signal. Planned:

- **ADR-001** — Vite + separate API vs Next.js monolith
- **ADR-002** — Polyglot backend (NestJS + FastAPI) vs single service
- **ADR-003** — Claude primary + OpenAI fallback behind a provider interface
- **ADR-004** — n8n for workflow execution vs custom queue-only
- **ADR-005** — Multi-tenancy model: shared DB + RLS (+ schema/DB isolation upgrade path)
- **ADR-006** — pgvector vs dedicated vector DB
