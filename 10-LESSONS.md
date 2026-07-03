# 10 · Lessons — Skills to Learn & Lessons-Learned Log

Two parts:
1. **Skills & concepts to learn** while building — a study map so the build doubles as targeted upskilling for the target roles.
2. **Lessons-learned log** — a running template to fill in as you go (this is gold in interviews: "what was hard / what would you change").

---

## Part 1 — Skills & concepts to learn

Tagged by confidence to fill in as you self-assess: ⬜ new · 🟨 some · 🟩 strong.

### AI / LLM engineering
- [ ] LLM **tool-use / function calling** loop design (reason → call → observe → act) — ⬜/🟨/🟩
- [ ] **Claude (Anthropic) SDK** specifics: messages API, tool use, streaming, prompt caching
- [ ] **Provider abstraction** (Claude primary + OpenAI fallback) without leaking provider details
- [ ] **Multi-agent orchestration** patterns: routing, sequential, parallel, hierarchical, reflection, critique, hand-off ([Accelirate](https://www.accelirate.com/llm-agent-orchestration/))
- [ ] **RAG**: chunking, embeddings, pgvector retrieval, citation grounding, avoiding hallucination
- [ ] **Evals**: building datasets, scoring correctness, regression-testing prompts
- [ ] **LLM cost & latency control**: model tiering, caching, batching, token accounting
- [ ] **Prompt/guardrail design**: scoping agents to non-diagnostic tasks, refusal handling
- [ ] **AI safety**: PHI redaction/de-identification before model calls

### Healthcare / domain
- [ ] **FHIR R4** resources: `Patient`, `Appointment`, `Slot`, `Observation`, Bundles, search params ([medblocks](https://medblocks.com/blog/what-is-fhir))
- [ ] **HAPI FHIR** test server usage; optionally self-hosting the JPA server via Docker ([hapifhir.io](https://hapifhir.io/))
- [ ] **SMART-on-FHIR** auth concepts (even if only scaffolded)
- [ ] **HIPAA** safeguards: access control, audit controls, integrity, transmission security; BAAs ([HIPAA Journal](https://www.hipaajournal.com/hipaa-compliance-for-saas/))

### Backend / platform
- [ ] **NestJS**: modules, DI, guards, interceptors, WebSocket gateway
- [ ] **FastAPI**: async, Pydantic models, dependency injection, auto docs
- [ ] **Inter-service communication** patterns (REST + queue) and boundaries
- [ ] **Multi-tenancy**: Pool + **Postgres RLS**; schema/DB isolation trade-offs ([developers.dev](https://www.developers.dev/tech-talk/multi-tenant-database-architecture-a-guide-to-isolation-patterns-and-scaling-trade-offs.html))
- [ ] **RBAC** modeling and enforcement
- [ ] **Queues** with BullMQ/Redis: producers, workers, retries, dead-letter
- [ ] **Caching** strategy (FHIR reads, sessions, retrieval)
- [ ] **Append-only audit logging** design

### Automation
- [ ] **n8n**: nodes, webhooks, credentials, AI nodes, self-hosting, exporting workflows as code ([n8n](https://n8n.io/))
- [ ] Designing the **app ↔ n8n contract** (who owns what)

### Frontend
- [ ] **shadcn/ui + Tailwind** design-system discipline
- [ ] **TanStack Query** server-state, optimistic updates
- [ ] **Streaming UIs** (WebSocket/SSE) for live agent traces
- [ ] **Data-dense UX**: virtualized tables, dashboards (Recharts/Tremor)
- [ ] **Accessibility** to WCAG 2.2 AA (Radix, ARIA live regions, contrast)

### DevOps / delivery
- [ ] **Docker Compose** multi-service local stacks
- [ ] **GitHub Actions** CI/CD (lint, typecheck, test, deploy)
- [ ] **Deploy targets**: Vercel + Fly.io/Render
- [ ] **Observability**: OpenTelemetry traces, Prometheus/Grafana metrics, structured logs
- [ ] **ADRs** and technical writing

### Suggested learning order
1. FHIR basics + HAPI (unblocks the domain) →
2. Claude tool-use loop (the core AI skill) →
3. NestJS + FastAPI service boundary →
4. n8n webhook integration →
5. Multi-tenancy + RLS + RBAC + audit →
6. RAG + evals →
7. Analytics + observability →
8. Deploy + harden.

---

## Part 2 — Lessons-learned log (fill in as you build)

> Keep entries short and honest. The "what I'd do differently" column is the highest-value interview material. Copy the template row per learning.

### Template
```
### [Date] — [Short title]
- Phase: 
- Context / what I was doing:
- Problem / what surprised me:
- What I tried:
- What worked / final approach:
- What I'd do differently next time:
- Interview soundbite (1 sentence):
```

### Running log

#### 2026-__-__ — (example) FHIR appointment writes were harder than reads
- Phase: 1
- Context: Implementing `reschedule_appointment` against HAPI.
- Problem: _(fill in — e.g., resource versioning / conditional update semantics)_
- What I tried: _…_
- What worked: _…_
- What I'd do differently: _…_
- Interview soundbite: _"I learned FHIR writes require careful version/conditional handling, so I added optimistic-concurrency handling in the client."_

#### 2026-__-__ — 
- Phase: 
- Context: 
- Problem: 
- What I tried: 
- What worked: 
- What I'd do differently: 
- Interview soundbite: 

#### 2026-__-__ — 
- Phase: 
- Context: 
- Problem: 
- What I tried: 
- What worked: 
- What I'd do differently: 
- Interview soundbite: 

---

## Decisions I changed my mind on (log)
Track pivots — showing you can revise decisions with evidence is a maturity signal.

| Date | Original decision | Changed to | Why |
|------|-------------------|-----------|-----|
| | | | |
| | | | |

---

## Metrics to capture for the case study
Fill these in by launch — concrete numbers make the portfolio post land.

- [ ] Lines of code / services / test coverage %
- [ ] Avg cost per resolved task (Claude tokens → $)
- [ ] p95 task latency (excl. LLM)
- [ ] # of FHIR resource types integrated
- [ ] # agents / workflows shipped
- [ ] Eval scores (agent correctness before/after prompt iterations)
- [ ] Build time (weeks, hours/week)
- [ ] Demo engagement (video views, demo sessions) after launch
