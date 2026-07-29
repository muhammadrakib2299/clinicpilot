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
  - **Slow-link verification gap, and how I handled it.** The n8n image (2.48 GB)
    would not finish pulling while I was working, so for most of the session its
    `/healthz` check was the one piece of the stack I could not prove. Rather
    than claim it, I dropped `--wait` from `pnpm up` so an unverified check could
    not block the dev loop, and added a compose smoke job to CI to prove it on
    push. The pull completed later in the session: n8n reaches healthy and
    `/healthz` returns `{"status":"ok"}`, so `--wait` is restored and **all six
    services are now verified locally**. Worth keeping as a habit — degrade the
    claim to match the evidence, then upgrade it when the evidence arrives.
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

#### 2026-07-29 — The vertical slice closed: agent → FHIR → Postgres → live UI
- Phase: 1
- Context: End of the session that took Phase 1 from an empty schema to a working
  agent. B1's gate is met — type a message, the agent reschedules a real
  appointment on the HAPI sandbox, and every step streams into the Trace Viewer
  with its own token count and cost. 3 iterations, 9 steps, $0.0153.
- **The most valuable bug was found by CI, not by me.** The API image build failed
  with `Cannot find module '@clinicpilot/shared-types'`. It passed locally every
  single time, because my machine had `dist/` left over from an earlier build —
  only a clean context exposed it. `pnpm --filter <pkg> build` builds *only* that
  package; the trailing `...` is what pulls in workspace dependencies.
  - It was **two** bugs. Fixing the build alone would have produced a green image
    that died on first require, because the runtime stage never copied
    `/repo/packages` and every workspace symlink dangled. The compose smoke job I
    added at Phase 0 close-out is the only reason either surfaced before deploy.
- **Two 500s that should have been 4xx.** Both were mine mapping errors lazily:
  - A replayed trace step returned 500. Drizzle 0.45 wraps driver errors, so
    Postgres' `23505` sits on `.cause` — a top-level `code` check misses *every*
    constraint violation. Now walks the cause chain and returns **409**, so a
    retrying client learns it already sent that step instead of hammering a
    request that can never succeed.
  - Lesson: when an ORM wraps errors, verify against the real database. My unit
    test would have passed with the naive check because I wrote the fixture to
    match my assumption, not the driver.
- **A lint rule that would have shipped a runtime crash.** `consistent-type-imports`
  flagged three injected NestJS classes. Obeying it erases them from
  `design:paramtypes`, so Nest cannot resolve the provider — a green build that
  500s on the first request. Disabled for that workspace only, with the reason in
  the config. Auto-fixable does not mean correct.
- **Choosing native `ws` over socket.io.** Rooms and reconnect come free with
  socket.io, but so does ~40 KB on a bundle whose whole pitch is being small. The
  subscription map is about twenty explicit lines; the SPA stayed at ~54 KB
  gzipped and uses the browser's built-in WebSocket. The trade I did *not* make
  well: there is still no reconnect/backoff, which is logged as debt.
- **The backfill-then-stream ordering matters.** A drawer opened mid-run would
  otherwise start mid-thought, because steps already written are never broadcast
  again. Subscribing *before* backfilling — not after — is what closes the gap
  where a step written between the two would be lost. `stepNo` is the dedupe key,
  and it is the same value the database's unique index enforces.
- **A test caught a real robustness bug in the hook**, not just a typo: a
  malformed backfill response crashed the drawer, because my `catch` covered
  rejection but not a payload that resolved fine and was the wrong shape.
- What I'd do differently: run the container build before assuming local green
  means anything. "Works on my machine" had a precise cause here — leftover build
  artefacts — and one clean-context build would have caught it in seconds.
- Interview soundbite: *"My CI compose smoke test caught a packaging bug that
  passed locally every time, because my machine had stale build output the clean
  container didn't. It was actually two bugs — fixing the build alone would have
  shipped an image that built green and died on first require."*

#### 2026-07-29 — Tool descriptions are load-bearing, and I have the numbers
- Phase: 1
- Context: First live run of the Claude tool-use loop — real model, real HAPI,
  the seeded "move my Thursday appointment" scenario.
- **It worked, and then it taught me something.** The agent read the booking,
  listed availability, picked the earliest slot and wrote the change back. But
  the first successful write took **4 iterations and $0.021** because of one
  vague word in a tool schema.
  - I described the parameter as *"FHIR Appointment id"*. The model passed
    `Appointment/137240399` — the exact form it had just read out of the search
    result I gave it. Completely reasonable. My executor built
    `/Appointment/Appointment/137240399` and the server returned 400.
  - Rewriting the description to *"Bare FHIR Appointment id with no
    resource-type prefix — '137240399', not 'Appointment/137240399'"* dropped
    the same task to **3 iterations and $0.016**. A 24% cost reduction and one
    fewer round trip, from a sentence.
  - Lesson generalised: with tool schemas, show the wrong form as well as the
    right one. The model is inferring from context you cannot see.
- **The error-recovery design paid for itself immediately.** I had built the
  loop so a raising tool becomes an error `tool_result` fed back to the model
  rather than aborting the run. On that 400, the model read the error, wrote
  *"the appointment_id parameter should be just the numeric ID without any
  prefix"*, retried, and succeeded — no human, no crash. Worth keeping: a tool
  boundary that reports failure well is worth more than one that never fails.
- **A bug the recovery hid.** The same prefix confusion meant `slot_id` arrived
  as `Slot/137240396` and the adapter wrote the reference `Slot/Slot/137240396`
  onto a live appointment — which HAPI **accepted**. Recovery masked a data
  quality defect. Fixed by normalising ids at the tool boundary rather than
  trusting either the model or the server to object.
- **The agent asked permission, and was right to.** On the first run it stopped
  after finding the slot and asked "would you like me to move it?" — because the
  system prompt says not to pick for the patient when the request is ambiguous,
  and my task text said "pick the earliest slot and confirm". Good behaviour,
  but it means the B1 demo needs either explicit authorisation in the message or
  a second conversational turn. Scoping an agent through its *tool surface and
  prompt* rather than through hope is the point — and it shows up as friction in
  exactly the place it should.
- What I'd do differently: write the tool schema descriptions as if for someone
  who has only ever seen the data in the format your own tools return.
- Interview soundbite: *"One ambiguous word in a tool description cost 24% more
  tokens and an extra round trip — the model passed a prefixed FHIR id because
  that's the form my own search results used. I measured it, tightened the
  schema to show both the right and wrong form, and normalised ids at the tool
  boundary so the adapter stopped being brittle about it."*

#### 2026-07-29 — FHIR writes really were harder than reads (the prediction held)
- Phase: 1
- Context: Building the typed FHIR R4 client the Scheduling Agent needs — read
  appointments, find free slots, reschedule — against the public HAPI sandbox.
- **Problems / what surprised me:**
  - **The sandbox was empty.** `GET /Patient?_count=3` returned a valid
    `searchset` bundle with zero entries. hapi.fhir.org is periodically wiped —
    my own risk register flagged this and I still half-expected fixtures to be
    sitting there. Consequence: the seed script must *create* everything the
    demo touches, and no test may assume pre-existing sandbox data.
  - **`If-Match` must use the weak-ETag form.** FHIR mandates `W/"4"`, not a
    bare `4`; the bare form is rejected. Easy to get wrong because the version
    itself is a plain string in `meta.versionId`.
  - **Two status codes mean the same thing.** A concurrent edit surfaces as
    409 *or* 412 depending on server and code path, so both have to map to the
    same conflict type or half the collisions look like generic failures.
  - **Search params need real URL encoding.** `start=ge2026-07-06T09:00:00+01:00`
    with a raw `+` decodes server-side as a space, the lower bound is silently
    ignored, and you get *every* slot back — a wrong answer that looks like a
    working query. `URLSearchParams` handles it; hand-built query strings do not.
- What worked: verified the whole concurrency path against the live server —
  create returns `versionId=1`, an update carrying `If-Match: W/"1"` succeeds and
  returns `versionId=2`, and replaying that same now-stale `If-Match` is refused
  with **409**. That is the behaviour the agent depends on, proven end to end
  rather than assumed.
- **Design call:** `rescheduleAppointment` re-reads the appointment to get its
  current version instead of trusting a version the caller is holding. The agent
  may have spent several seconds reasoning between looking at the appointment and
  deciding to move it, and that gap is exactly when someone else books the slot.
- What I'd do differently: write the seed *before* the client next time. I built
  read helpers against a server with nothing in it, so the first genuinely
  end-to-end check came later than it should have.
- Interview soundbite: *"FHIR writes need optimistic concurrency, so my client
  re-reads the resource and sends its version as a weak ETag `If-Match` — I
  verified against the live HAPI server that a stale version is rejected with a
  409 rather than silently overwriting someone else's booking."*

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
| 2026-07-29 | Source-only packages (above) | **CommonJS dist build with declarations** | Reversed within the day: the moment `apps/api` imported shared-types, Nest could not `require()` an ESM module. Tests passed only because specs are excluded from the build — the first *runtime* import would have crashed on startup |
| 2026-07-29 | Follow `09-TODO` order: migrations → auth → FHIR → agent | **Agent spine first, auth deferred** | Auth is weeks of work that produces nothing demoable. Skipping to the agent loop met Build Goal B1 in one session; a single hardcoded tenant behind `currentTenantId()` keeps Phase 2's RLS swap to one file |
| 2026-07-29 | socket.io for the trace stream | **Native `ws` + browser WebSocket** | Rooms and reconnect come free with socket.io, but so does ~40 KB on a bundle whose selling point is being ~54 KB. The subscription map is twenty explicit lines; reconnect is logged as debt rather than paid for upfront |
| 2026-07-29 | AI service calls FHIR directly | **Gateway owns FHIR access (ADR-008)** | Optimistic concurrency should exist once, PHI access must be auditable in one place, and the throwaway Python adapter had already written a malformed `Slot/Slot/…` reference the TypeScript client would not have |

---

## Metrics to capture for the case study
Fill these in by launch — concrete numbers make the portfolio post land.

- [~] **Lines of code / services / test coverage %** — 6 services (web, api, ai,
  postgres, redis, n8n) across 5 workspaces. **145 tests** (89 TypeScript,
  56 Python); coverage % not yet measured — wire `test:cov` thresholds in Phase 6.
- [~] **Avg cost per resolved task** — **$0.0153** for a full reschedule on
  `claude-sonnet-5` (3 iterations, 9 trace steps). A measured earlier run cost
  $0.0215 before a tool-description fix removed a wasted round trip — **a 24%
  reduction from one sentence of schema documentation.**
- [ ] p95 task latency (excl. LLM) — *per-step latency is captured; not yet aggregated*
- [~] **# of FHIR resource types integrated** — **5 live**: Patient, Practitioner,
  Schedule, Slot, Appointment (read, write, and version-checked update)
- [~] **# agents shipped** — **1 of 3 working** (Scheduling). Follow-up and
  Document Q&A are seeded `paused`; 0 n8n workflows so far
- [ ] Eval scores (agent correctness before/after prompt iterations)
- [~] **Build time** — Phase 0 spanned 2026-07-03 → 2026-07-29 across 2 working
  sessions (26 elapsed days, ~1 day of actual work; the gap is the honest number
  to quote, not the effort)
- [ ] Demo engagement (video views, demo sessions) after launch
