# 08 · Build Plan (Phased Roadmap)

**Approach: vertical-slice-first.** Instead of building all the backend, then all the frontend, we ship **one agent working end-to-end** as early as possible (UI → API → Claude → n8n → FHIR → analytics), then widen. This de-risks integration early and gives a demoable artifact by Week 4 — the thing recruiters actually click.

**Assumptions:** solo developer, ~10–15 hrs/week (working full-time), ~13-week build + ~2-week launch/apply. Adjust dates to your pace; the *sequence* matters more than the calendar.

**Cadence:** each phase ends with a **demoable increment**, a short **demo note/GIF**, and a commit tagged `phase-N`.

---

## Phase 0 — Foundations (Week 1)
**Goal:** repo, stack, and "hello world" across every service.

| Deliverable | Detail |
|-------------|--------|
| Monorepo scaffold | pnpm + Turborepo; `apps/web`, `apps/api`, `apps/ai`, `packages/*` |
| Docker Compose stack | Postgres+pgvector, Redis, n8n, api, ai, web all `up` with one command |
| CI skeleton | GitHub Actions: install, lint, typecheck, test on push |
| Health checks | `/health` on api + ai; web renders shell; n8n reachable |
| ADR-001/002 written | Record Vite-split and polyglot-backend decisions |

**Exit:** `docker compose up` brings the whole stack online locally.

---

## Phase 1 — Vertical Slice: Scheduling Agent end-to-end (Weeks 2–4) ⭐
**Goal:** one agent does a real job through the full stack. This is the single most important phase.

| Deliverable | Detail |
|-------------|--------|
| Auth + single tenant | Login, JWT/session, one seeded tenant + admin user |
| FHIR client package | Typed R4 client hitting HAPI sandbox; read `Patient`/`Appointment`/`Slot` |
| Claude tool-use loop | FastAPI AI service: reason → call `find_availability`/`reschedule` tools → act |
| n8n workflow | "Reschedule appointment" workflow: read slot → write `Appointment` → confirm |
| Task intake + queue | API enqueues task (BullMQ); worker calls AI service |
| Trace persistence + stream | Persist `traces`; stream steps to UI over WebSocket |
| Minimal dashboard | One agent card + Task Inbox + live Trace Viewer |
| Cost capture | Record token usage → `llm_usage`/`cost_usd` |

**Exit (Build Goal B1):** type "move my Thursday appointment" → watch the agent reschedule it in HAPI FHIR, live, with a visible trace and a cost figure. **This is the demo backbone.**

---

## Phase 2 — Multi-tenancy, RBAC & Audit (Weeks 5–6)
**Goal:** turn the slice into a real multi-tenant, governed app.

| Deliverable | Detail |
|-------------|--------|
| Multi-tenancy | `tenant_id` everywhere + Postgres RLS policies (ADR-005) |
| Tenant switcher | Seed 2–3 synthetic clinics; switch in UI |
| RBAC | Admin/Clinician/Coordinator/Viewer; NestJS guards; nav gating |
| Audit log | Append-only `audit_log`; record every action/tool call/data access |
| Audit UI | Filterable, exportable audit table |
| Encryption + secrets | TLS locally, secrets via env/secret manager; document posture |

**Exit:** log in as different roles across different tenants; data is isolated; everything is audited.

---

## Phase 3 — Agents #2 and #3 + Orchestration (Weeks 7–8)
**Goal:** deliver the full three-agent fleet and the orchestration story.

| Deliverable | Detail |
|-------------|--------|
| Follow-up Agent | n8n scheduled sequence; templated post-visit check-ins |
| Document Q&A Agent | Ingest synthetic docs → pgvector RAG → answers **with citations** |
| Orchestrator | Route incoming tasks to the right agent (routing pattern) |
| Hand-off / escalation | Confidence/scope check → human queue; UI queue view |
| Reflection step | Self-check before high-stakes writes (safety) |
| Model fallback | Claude primary → OpenAI on failure, behind provider interface (ADR-003) |
| PHI redaction | De-identify before LLM calls (safety module) |

**Exit:** three agents deployable per tenant; tasks route correctly; escalations and fallback work.

---

## Phase 4 — Analytics, Observability & Polish (Weeks 9–11)
**Goal:** the "senior signal" layer — metrics, cost, and a product-grade UI.

| Deliverable | Detail |
|-------------|--------|
| Analytics dashboard | Tasks/day, success vs escalation, per agent, filters (Recharts) |
| Cost analytics | $ per resolved task; per-agent/tenant cost; spend charts |
| KPI tiles | No-show delta, calls deflected, follow-ups completed |
| Latency/queue metrics | p50/p95, queue depth; OpenTelemetry + Prometheus/Grafana |
| Eval harness | Datasets + scoring for agent correctness; report in-repo |
| UI polish | Design-system pass, dark mode, accessibility audit (WCAG AA) |
| FHIR Explorer | Patient/appointment browser + raw resource viewer |

**Exit (Build Goals B2, B5):** MVP feature-complete; metrics and cost visible; UI looks shipped.

---

## Phase 5 — Deploy & Demo (Week 12)
**Goal:** a public, clickable, seeded demo.

| Deliverable | Detail |
|-------------|--------|
| Deploy web | Vercel |
| Deploy services | api, ai, n8n, Postgres, Redis on Fly.io/Render |
| Seed script | Synthetic tenants/agents/patients on HAPI sandbox |
| Demo accounts | `admin@` and `viewer@` seeded |
| Walkthrough video | 2-min Loom following the `01-PROJECT-OVERVIEW` demo flow |
| Guardrails | Rate limits, demo-reset job, cost caps on the LLM key |

**Exit (Build Goal B3):** live URL + video in the README; anyone can try it.

---

## Phase 6 — Documentation, Tests & Hardening (Week 13)
**Goal:** make the repo itself a hiring asset.

| Deliverable | Detail |
|-------------|--------|
| Test coverage | >70% on core services (auth, tenancy, orchestrator, tools) |
| ADRs finalized | ADR-001…006 in `/docs/adr` |
| Architecture diagram | Rendered mermaid/PNG in README + `docs/diagrams` |
| README polish | 30-second clarity; badges; quickstart verified from scratch |
| Security pass | Dependency audit, secrets check, RLS test, PHI-redaction test |

**Exit (Build Goal B4):** CI green; docs complete; a stranger can clone-and-run.

---

## Phase 7 — Launch & Apply (Weeks 14–18+)
**Goal:** convert the artifact into interviews and offers.

| Deliverable | Detail |
|-------------|--------|
| Case-study post | "How I built a multi-agent healthcare platform" (dev.to/LinkedIn) |
| Portfolio updates | CV, LinkedIn, portfolio site — lead with ClinicPilot |
| Applications | 20 targeted roles + 10 contracts (see `02` career goals) |
| Interview kit | Architecture talk track, "what was hard," scaling answers |
| Iterate | Fold interview feedback into a v1.1 (e.g., voice channel stretch) |

**Exit (Career Goals C1–C5):** interviews booked; project is the centerpiece of every conversation.

---

## Milestone summary

| Milestone | Week | Gate |
|-----------|------|------|
| ✅ M0 Stack online | 1 | `docker compose up` works — **met 2026-07-29** |
| **M1 Vertical slice** ⭐ | 4 | Scheduling agent end-to-end, live trace |
| M2 Multi-tenant + governed | 6 | RLS + RBAC + audit |
| M3 Full fleet + orchestration | 8 | 3 agents, routing, hand-off, fallback |
| M4 MVP complete | 11 | Analytics, cost, evals, polished UI |
| M5 Live demo | 12 | Public URL + video |
| M6 Hardened + documented | 13 | Tests, ADRs, README |
| M7 Applying | 14+ | Case study + applications out |

---

## Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Scope creep (too many stretch features) | High | Freeze MVP at `03-FEATURES` 🟢 items; stretch only after M5 |
| LLM cost during demo | Medium | Model tiering, caching, cost caps, demo rate limits |
| n8n integration friction | Medium | Start with 1 workflow in Phase 1; webhook contract early |
| FHIR/HAPI sandbox flakiness | Medium | Cache reads; option to self-host HAPI JPA via Docker |
| Time (full-time job) | High | Vertical-slice-first guarantees a demoable artifact by W4 even if later phases slip |
| Over-claiming HIPAA compliance | Medium | Explicit "design intent, not certified" disclaimers |
