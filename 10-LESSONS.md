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

> **Convention:** this log is updated at the end of **every** work session — what was built, what broke, and what was decided.

### Running log

#### 2026-07-29 — Phase 0 close-out: the gate was never actually green
- Phase: 0
- Context: Picked the project back up after a 26-day gap to audit real status against
  `08-PLAN` before starting Phase 1. The audit was more useful than expected.
- **Problem — Phase 0 was logged as done, but nothing proved it.** Three of its
  deliverables did not exist and one was actively broken:
  - **`pnpm build` failed at the repo root.** The lockfile contained importers for
    only `.` and `apps/web`; `apps/api`, `shared-types` and `fhir-client` had never
    been installed. Turbo warned `Workspace 'packages/shared-types' not found in
    lockfile` and the API build died on `'nest' is not recognized`. A single
    `pnpm install` fixed it — it had simply never been run after those workspaces
    were added in the last commit of the previous session.
  - **`.github/` was an empty directory.** Git does not track empty directories, so
    the "CI skeleton" deliverable looked present on disk and did not exist in the
    repo at all. Nothing had ever verified a push.
  - **ADR-002 was never written**, and `packages/config` never created.
  - The `lint` scripts in `apps/web` and `apps/api` invoked an `eslint` that was
    not a dependency, and `apps/api` declared `jest --passWithNoTests` without
    depending on jest — so `turbo run lint` and `turbo run test` were silent no-ops
    across the two workspaces holding most of the code.
- What I tried / what worked: rebuilt Phase 0 around its own exit gate. Wrote the
  CI workflow, added test harnesses everywhere (Vitest for web + packages, Jest +
  Supertest for Nest, pytest for FastAPI — **37 tests total**), created
  `packages/config` for shared ESLint/TS config, wrote ADR-002, and built
  Dockerfiles for all three app services so `docker compose up --wait` genuinely
  brings the stack online instead of just the three stateful containers.
- **Gotchas worth keeping:**
  - **nginx in Docker: a custom `default.conf` must declare `listen [::]:80`
    itself.** The image's `10-listen-on-ipv6-by-default.sh` only patches the
    *stock* config, and skips yours. The healthcheck failed with
    `wget: can't connect to remote host: Connection refused` while nginx was
    visibly serving — because `localhost` resolves to `::1` inside the container
    and nothing was listening there. Every healthcheck now targets `127.0.0.1`.
  - **A port collision from an unrelated project killed the stack.** A `wms-redis`
    container from another repo held 6379. Fixed properly rather than locally:
    every host port in compose is now `${VAR:-default}`.
  - **ESLint 9 resolves `eslint.config.js` against the package's `type` field.**
    `apps/api` is CommonJS for Nest's decorator emit, so an ESM config file has to
    be named `eslint.config.mjs`.
  - **`ts-jest` over Vitest for NestJS**, because it runs the real TypeScript
    compiler and therefore honours `emitDecoratorMetadata` — Vitest's esbuild
    transform does not, and DI resolution in tests depends on it.
  - **One thing I could not verify locally:** the n8n image never finished
    pulling over this connection, so its `/healthz` healthcheck is the single
    piece of the stack unproven on my machine. Postgres, Redis, api, ai and web
    were all confirmed healthy with live 200s. Rather than pretend, I dropped
    `--wait` from `pnpm up` so an unverified check cannot block the dev loop, and
    added a compose smoke job to CI that stands the *whole* stack up on every
    push — if `/healthz` is wrong, CI says so on the first run instead of a
    stranger hitting it.
  - **Two of the sample trace steps share the label "Observation"**, so
    `getByText` threw on multiple matches. Switching to per-label occurrence
    counts made the assertion stronger: it now proves all six steps rendered, not
    just all four distinct labels.
- What I'd do differently: **make the gate command the definition of done.** Every
  phase in `08-PLAN` already ends in a one-line exit gate; if I had run
  `docker compose up` and `pnpm build` on 2026-07-03 instead of reasoning that the
  files were all present, none of this would have been discovered 26 days later.
  Files existing is not the same as a system working. Also: run `pnpm install`
  immediately after adding any workspace — a lockfile that silently omits a
  package fails much later and much more confusingly than it should.
- Interview soundbite: *"I audited my own 'finished' foundation phase and found the
  build red, the CI directory empty, and two lint tasks silently passing because
  the linter was never installed — so I rebuilt the phase around its exit gate,
  wired CI across both a Node and a Python toolchain, and made `docker compose up`
  actually stand the whole stack up health-gated rather than just the databases."*

#### 2026-07-03 — Phase 0: monorepo foundation, dashboard shell & repo published
- Phase: 0
- Context: Scaffolded the whole project and shipped the Fleet Overview UI, then published to GitHub.
- What was built:
  - pnpm + Turborepo monorepo: `apps/web` (Vite+React18+TS+Tailwind v4), `apps/api` (NestJS skeleton + `/api/health`), `apps/ai` (FastAPI skeleton + `/health`), `packages/shared-types` (zod), `packages/fhir-client` (FHIR R4 + EHR adapter interface).
  - `infra/docker-compose.yml`: Postgres+pgvector, Redis, n8n; pgvector init SQL.
  - Web: "Clinical Futurism" **no-gradient** design tokens (dark default + light theme), Fleet Overview (KPI tiles, agent cards, SaaS plan-usage quota widget, live activity) and the streaming **Trace Viewer** drawer.
  - Docs: added `11-SAAS-PRODUCTIZATION.md`, no-gradient design system in `04-UI-UX.md`, ADR-001.
- Problems / what surprised me:
  - **pnpm 10 blocks post-install scripts by default** → Vite's `esbuild` binary didn't install and the build would fail. Fix: `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }` in root `package.json`, then reinstall.
  - **GitHub contributions require the commit author email to match a verified email on the GitHub account.** My first commit used a placeholder email and would NOT have counted. Fix: rebuilt history authored as `muhammad.rakib2299@gmail.com`.
- What worked: web builds clean (`tsc -b` + `vite build`, 0 errors, ~53 KB gzip JS); dev server returns HTTP 200 at :5173. History split into **16 logical commits** and pushed to `main`.
- What I'd do differently: add a placeholder `App.tsx` earlier so every intermediate commit builds in isolation (a couple of mid-sequence web commits reference not-yet-added files).
- Interview soundbite: *"I set the repo up as a pnpm + Turborepo monorepo with a deliberate web/api/ai service split and a design system where depth comes from layered flat surfaces and hairline borders — no gradients — enforced through CSS tokens."*

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
| 2026-07-03 | Multi-tenant app | **Full SaaS product** (plans, Stripe billing, quotas, metering, entitlements) | Wanted it more scalable/sellable; architecture was already multi-tenant so the commercial layer was low-cost to add and is a strong hiring signal |
| 2026-07-03 | Teal accent + generic dark/light theme | **"Clinical Futurism"** no-gradient system, dark default | Requirement: no gradients. Flat layered surfaces + hairline borders read as more precise/futuristic for a control-plane |
| 2026-07-29 | App containers deferred to Phase 5; compose runs infra only | **All six services in compose now**, with `pnpm up` kept as the infra-only dev path | The Phase 0 exit gate literally says "docker compose up brings the whole stack online". Writing three Dockerfiles cost an afternoon and turned an unverifiable claim into a command anyone can run |
| 2026-07-29 | AI service CORS `allow_origins=["*"]` | Explicit `WEB_ORIGIN` allowlist, comma-separated | A wildcard is the wrong default for a service whose Phase 1 job is forwarding patient context to a model — and browsers ignore `allow_credentials` alongside `*`, so it was not even buying convenience |
| 2026-07-29 | Fixed host ports in docker-compose | `${VAR:-default}` on every host port | An unrelated project's Redis container held 6379 and the stack refused to start. Clone-and-run should not require the machine to be clean |
| 2026-07-29 | `packages/*` would need a dist build step | Source-only (`main` → `src/index.ts`) for now | Nothing consumes them across a runtime boundary yet and Vite compiles workspace TS directly. Logged as debt in `09-TODO` for when `apps/api` (CommonJS) imports them |

---

## Metrics to capture for the case study
Fill these in by launch — concrete numbers make the portfolio post land.

- [~] **Lines of code / services / test coverage %** — *as of Phase 0 close-out
  (2026-07-29):* ~1,790 lines of application + infra code against 1,823 lines of
  planning docs. 6 services (web, api, ai, postgres, redis, n8n) across 5
  workspaces. **37 tests** (30 TypeScript, 7 Python); coverage % not yet measured
  — wire `test:cov` thresholds in Phase 6.
  - web 781 · packages 92 · api 58 · ai 47 · infra + CI 347
  - test code 465 lines — *more test code than application code outside the SPA*
- [ ] Avg cost per resolved task (Claude tokens → $)
- [ ] p95 task latency (excl. LLM)
- [ ] # of FHIR resource types integrated — *client written, 0 resources live*
- [ ] # agents / workflows shipped — *0; the 3 agent cards render fixture data*
- [ ] Eval scores (agent correctness before/after prompt iterations)
- [~] **Build time** — Phase 0 spanned 2026-07-03 → 2026-07-29 across 2 working
  sessions (26 elapsed days, ~1 day of actual work; the gap is the honest number
  to quote, not the effort)
- [ ] Demo engagement (video views, demo sessions) after launch
