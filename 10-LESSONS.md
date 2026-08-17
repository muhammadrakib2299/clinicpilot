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

#### 2026-08-17 — The frontend audit: a design doc I had not been holding myself to
- Phase: 4 (started early — the design-system and accessibility items)
- Context: Read every file in `apps/web` looking for gaps before adding
  features to it. The code was good and the comments were honest. What it was
  not, was the thing `04-UI-UX.md` describes.
- **The finding that made the point: light mode was failing contrast, and had
  been since Phase 0.** `:root[data-theme="light"]` redefined the surfaces and
  the accent but not `--success`, `--warning`, `--danger` or `--info`, so those
  four fell through to the dark theme's values and rendered on white. Emerald-500
  on `#ffffff` measures **2.5:1**; amber-500 measures **2.2:1**; the AA floor for
  text is 4.5:1. These are not decorative — every task status, every escalation
  label and every mutating action in the audit log is coloured text. Half the app
  failed WCAG in a theme the doc calls "a full first-class alternative" with
  colours it calls "WCAG-checked in both themes."
- **The lesson is not "check contrast". It is that a design document describes
  intent, and nothing in the pipeline was comparing intent to output.** Four
  colours were simply never written. No test asserted it, no linter knew, and it
  is invisible in dark mode — which is the default, which is what I develop in.
  The same gap produced the rest of the list: `.grid-backdrop` sat in `index.css`
  since Phase 0 as a "signature detail" with **no caller**; the type scale said
  12px minimum and twelve places rendered at 10 or 11; "Radix/shadcn primitives
  give correct roles and focus management out of the box" was written about
  hand-rolled primitives that give none of it.
- Problem: the Trace Viewer — the thing `04-UI-UX.md` calls the single most
  memorable part of the demo — covered the viewport, dimmed the page behind it
  and had `role` on nothing, no `aria-modal`, no Escape, no focus trap, no focus
  restore, and a backdrop only a mouse could dismiss. A keyboard user could open
  it and tab straight out into the dashboard underneath with no way back. The
  Task Inbox was worse: every row was `<tr onClick>`, which is not a control at
  all — not focusable, no role, no Enter — so the only thing the page exists to
  do could not be done without a mouse.
- **The shell had no breakpoint in it anywhere.** A `w-60 shrink-0` sidebar
  inside `flex h-screen overflow-hidden` is 64% of a 375px viewport, spent on
  navigation, permanently. The app was desktop-only and nothing in it said so.
- What I tried: fixing the *stated* rule rather than the symptom, in every case.
  A single `:focus-visible` rule that nothing may opt out of, rather than
  patching the five inputs that paired `outline-none` with a 1.2:1 border
  change. One sidebar styled by breakpoint rather than a second copy for
  mobile — a duplicate would double every nav link in the accessibility tree.
  Closed-on-mobile is `invisible`, not merely translated off-screen, because a
  translated element is still focusable.
- **What the browser found that the tests could not.** I ran the UI against a
  stub gateway that speaks no WebSocket, opened a resolved task, and got
  "Connecting to the trace stream…" and an empty panel — while the complete
  trace sat one HTTP request away. The backfill lived *inside* the socket's
  `open` handler, making the stream a precondition for reading a **past** run,
  which it never was. Any proxy, firewall or gateway restart that blocked the
  upgrade turned every historical trace into a blank drawer. Forty passing tests
  never saw it, because the fake socket in the suite always opens.
- What worked: **13 commits, each individually green**, 28 → 40 tests. Two of
  the new tests are harness fixes rather than features — the suite kept one
  `localStorage` and one `history` for the whole file, so a test that toggled
  the theme or clicked a nav link silently decided the starting state for every
  test after it. That only looked fine because the tests that navigate happened
  to sit last.
- **Also deleted: the last fixture.** `data/mock.ts` was 119 lines of Phase-0
  invention that four modules still imported *types* from, and the agent card
  was rendering `<Sparkline data={[1, 2, 2, 3, 3, 4]} />` — six made-up numbers
  drawn as a trend line, directly above three tiles built specifically to report
  only what the system measures. Replaced with a bar assembled from figures the
  gateway actually returns.
- What I'd do differently: verify the design doc's own claims the day I write
  them down. "WCAG-checked in both themes" was aspirational when written and
  became false the moment the light block was authored incomplete — and it then
  sat in the repo as an assertion for six weeks. A doc that describes intent
  needs the same treatment as a test that cannot fail.
- Interview soundbite: *"I audited my own frontend against the design system I'd
  written for it and found the light theme had been failing WCAG contrast since
  day one — four status colours were never redefined, so they inherited values
  tuned for a near-black canvas and rendered at 2.2:1 on white. It was invisible
  because dark is the default and that's what I develop in. Then I ran the UI
  against a gateway with no WebSocket and found the trace viewer showed nothing
  for finished runs, because the HTTP backfill was gated behind the socket
  opening — forty passing tests never caught it, because the fake socket in the
  suite always opens."*

#### 2026-08-12 — Three silent failures between me and a working n8n workflow
- Phase: 3
- Context: The last unbuilt thing in Phase 3. n8n had been in the stack since
  Phase 0 with nothing wired to it, and the Follow-up Agent composed approved
  messages that sat at `drafted` forever.
- **The design question was which workflow to build**, and the answer involved
  not building the one the plan named. `09-TODO` has had *"n8n reschedule
  appointment workflow"* open since Phase 1 — but ADR-008 made the gateway the
  single owner of FHIR access precisely because a second implementation wrote a
  malformed `Slot/Slot/…` reference onto a live appointment. Routing a
  reschedule through n8n would add a **third** path to a FHIR write with its own
  copy of the optimistic-concurrency rules. So I built the workflow n8n is
  actually good at — a scheduled sweep over work the gateway already owns — and
  wrote down why the other one should be struck rather than left open forever.
- **Problems / what surprised me:** every one of them failed *silently*.
  - **Git Bash rewrote the container path.** `--input=/workflows` reached n8n as
    `C:/Program Files/Git/workflows`, and the import printed
    "Importing 0 workflows... Successfully imported 0 workflows" and exited 0.
    A success message for having done nothing. This repo has already been bitten
    by the same MSYS rewrite once — there is a comment about it in
    `jest.integration.config.cjs` — and I still lost ten minutes to it. `//workflows`
    survives the rewrite and still resolves inside the container.
  - **A workflow with no `id` is duplicated, not updated.** Three imports, three
    workflows, all called "Follow-up delivery", and I spent a round executing
    the stale one and wondering why my new node was not there. There is no
    `delete:workflow` in the CLI, so the duplicates are still sitting in my
    local n8n. The import script now refuses a workflow without a fixed id.
  - **`--activeState=fromJson` is rejected outside queue mode**, and imports are
    deactivated by default — so the workflow imported cleanly and then never
    ran. Activation is a separate call *and* a restart, because schedule
    triggers are registered at startup.
  - **`$env` is blocked inside nodes by default in n8n 2.x**, which the workflow
    reports as `access to env vars denied` only at execution time.
- What worked: **verifying by execution rather than by import succeeding.** Every
  one of those four would have passed a "the JSON is committed and imports
  without error" check. What settled it was running the thing and looking at the
  database: two clinics enumerated, three messages moved to `sent`, one of them
  Riverside's — which is what proves the per-tenant loop rather than a lucky
  single-tenant pass. Then I seeded one more message, left it alone, and watched
  the schedule fire at 12:05:28 and deliver it unattended.
- **The honesty problem, and how it was solved.** There is no Twilio account, so
  "delivered" would have been a lie — and the `message_status` comment I wrote in
  an earlier session had explicitly warned against "pretending `sent` when
  nothing was". The fix was not to avoid `sent` but to record *what channel*:
  `delivery_channel = 'simulated'` makes the row a statement about what happened
  instead of an implication about a phone. Swapping the Set node for a real SMS
  node changes that one value and nothing else. Same shape as ADR-003 and
  ADR-009 — build the seam, do not fake the vendor — for the third time.
- A scheduled job has no session and therefore no tenant, which turned out to be
  the most interesting constraint in the workflow. Enumerating clinics through a
  deliberately un-scoped `internal/tenants` endpoint and then making one RLS-
  scoped pass each is the only option that neither bypasses RLS nor silently
  stops covering a clinic somebody adds later.
- What I'd do differently: check the container's view of an argument before
  believing a CLI that reports success. `docker exec ... ls //workflows` would
  have cost five seconds and saved the whole first detour.
- Interview soundbite: *"Four separate things failed silently between committing
  an n8n workflow and having one that runs — a shell rewriting the container
  path so the import found nothing and still exited 0, missing ids duplicating
  the workflow instead of updating it, activation being refused outside queue
  mode, and env access blocked inside nodes. All four would have passed 'it
  imports without error'. I only found them because I insisted on watching the
  schedule fire and then checking the rows it changed."*

#### 2026-08-12 — Escalation had worked for weeks and told nobody
- Phase: 3
- Context: Closing the last Phase 3 item — the `escalations` table and the human
  queue screen. Escalation itself was already built three times over: the router
  refuses to route, the loop gives up after eight iterations, an answer that
  cites a passage it never read is not delivered.
- **Problem:** all three did the same thing at the end — set the task's status to
  `escalated` and stop. Nothing was notified, nothing was assigned, and nothing
  recorded whether a person ever looked. The feature was *correct and useless*,
  which is a worse failure mode than broken: broken gets noticed. It looked
  finished in the TODO, in the trace viewer, and in the tests.
- **The design call that mattered:** the queue row is written by the **gateway**,
  inside the same transaction that marks the task escalated — not by the AI
  service in a second call. Escalation already fires from three places and will
  fire from more, and a caller that has to remember a second request is one that
  will eventually forget. The symptom of forgetting would be a patient's message
  nobody hears about, which is precisely what the table exists to prevent.
  So the AI service supplies the *reason* and cannot supply the row's existence,
  and `unspecified` is a valid reason for exactly that purpose. There is a test
  called "queues even when the caller does not say why".
- Same shape as three earlier decisions in this codebase, and I noticed the
  pattern only writing it down: RLS enrolled per table by hand but asserted by a
  list the suite iterates; one global auth guard so a new controller is closed
  by default; redaction as a provider decorator rather than a loop step. Each
  one moves a thing from "remember to do it" to "cannot avoid it".
- **What worked:** requiring a note to resolve. It is one `z.string().min(1)` and
  it is the difference between a queue that is tidy and a queue that answers
  "what happened to this patient's message" six months later. The note is copied
  into `audit_log` as well, because `escalations.resolution` is an ordinary
  updatable column and the audit entry is the copy nobody can rewrite.
- Claiming reuses the concurrency shape from `markRunning`: read, then guard the
  same condition in the UPDATE, because two coordinators can both pass the read
  before either writes. The loser gets a 409 naming the reason rather than a
  silent no-op that looks like success.
- What I'd do differently: build the queue in the same session as the first
  escalation path. Shipping the *check* without the *destination* let three
  features look complete while sharing one hole, and each one made the hole
  cheaper to keep ignoring.
- Interview soundbite: *"Escalation worked from three different code paths and
  every one of them ended by setting a status nobody watched — correct and
  useless. I moved the queue write into the gateway's task-completion
  transaction so no agent path can escalate without queueing: the agent supplies
  the reason and cannot supply the row's existence, and there is a test asserting
  a run that fails to categorise itself still reaches a human."*

#### 2026-08-12 — The eval resized the vectors, and a nonsense query scored higher than a right answer
- Phase: 3
- Context: Building agent three of three — Document Q&A over pgvector, answering
  from clinic documents with a citation on every claim. Anthropic serves no
  embeddings API, so the decision was an `Embedder` Protocol with one honest
  local implementation (feature hashing) rather than a Voyage client nobody
  could execute — the same argument ADR-003 made about OpenAI. Written up as
  [ADR-009](./docs/adr/ADR-009-lexical-embeddings-behind-an-interface.md).
- **Problems / what surprised me:**
  - **I sized the vector like a model, not like a hash table.** 384 dimensions,
    because that is what `all-MiniLM-L6-v2` produces and the number felt
    familiar. That is the wrong instinct entirely: with feature hashing the
    dimension is a **collision budget**, not a property of a model. With ~60
    distinct terms in a chunk and 384 buckets, the chance a given query term
    collides with something in a short passage is around 15%.
  - **And it was not theoretical.** The retrieval eval I wrote — 18 real patient
    questions against the real corpus — failed on two of them immediately. "How
    do I cancel my appointment" ranked a *chaperones* passage above the
    cancellation policy, because one query term collided with one term in a
    short chunk, and short chunks have large per-term weights after
    normalisation. Measured: top-1 is 16/18 at 384 and 512, 18/18 from 768 up.
    Moved to 1024 — the next power of two, with headroom, and the width of the
    obvious real model to swap in, which turns that swap into a re-ingest
    instead of a migration.
  - **A nonsense query outscored a correct one.** Live against the gateway,
    "what were last season's football results" scores **0.18** against the
    test-results document — while "how much notice to cancel an appointment"
    scores **0.17** against exactly the right passage. Both are "correct" cosine
    similarities. They are simply not comparable across queries, because the
    score depends on how many terms each side has as much as on overlap. Any
    plan to use an absolute threshold as a relevance test was wrong, and I would
    have shipped it believing otherwise if I had not printed the numbers.
  - **Nearest-neighbour search always returns neighbours.** Before adding a
    floor, asking something the corpus does not cover returned five passages —
    simply the least irrelevant ones — with nothing marking them as such. That
    is a confident wrong answer with no bug anywhere in it. A `minScore` floor
    fixes the zero-overlap case, and *only* that case. Given the 0.18-vs-0.17
    finding, what actually prevents a bad answer is the prompt's instruction to
    decline and the citation check, not the number.
- What worked:
  - **Writing the eval before trusting the design.** It is 18 parameterised
    cases, ranks in plain Python so it needs no database, and runs in CI. It
    tests something no unit test can — whether this embedder is strong enough
    for the documents this project actually ships. It found the collision bug
    within a minute of existing, and it is the thing that will fail if someone
    rewrites a document in vocabulary nobody searches with.
  - **A migration that a comment predicted.** `0006` says in a comment that
    changing embedding model means "a migration *and* a re-ingest". `0007` is
    that, two commits later. I kept it as a second migration rather than
    rewriting the first, because the sequence is the evidence the design
    anticipated its own change.
  - **Checking the answer, not the action.** The other two agents do damage
    through a `mutates` tool, which the pre-write self-check stands in front of.
    This one writes nothing — its risk is the sentence. So the loop learned an
    optional `check_answer`, and Document Q&A's is a subset test: every citation
    must be one the gateway actually returned this run. No model call, no
    judgement, no tokens. A failure is handed back for one correction and then
    escalates, reusing the same recovery path a failing tool already had.
  - Being explicit about what that check does **not** buy: it does not verify
    every claim has a citation, or that the passage supports the claim. An
    answer with no citations passes, deliberately — "the documents do not cover
    this" is a correct answer with nothing to cite, and requiring one would make
    the honest refusal the single thing this agent could not say.
- **A test caught a hole in a boundary I had just written.** The stemmer stripped
  "ing" from anything over four letters, which turns "bring" into "br" — a
  two-letter fragment colliding with everything. Guards now put the shortest
  stem at four characters, "ies" is rewritten rather than stripped so "policies"
  reaches "policy", and past tense is left alone entirely because "cancelled"
  stems to "cancell" and still misses "cancel", so the rule buys nothing.
- What I'd do differently: print the actual similarity numbers on day one. Every
  wrong belief in this session — the dimension, the threshold, the idea that a
  score means relevance — survived exactly as long as I was reasoning about
  retrieval instead of measuring it.
- Interview soundbite: *"I sized a feature-hashing vector at 384 because that is
  a familiar embedding width, which is the wrong instinct — there the dimension
  is a collision budget, not a model property. A retrieval eval over the real
  corpus caught it: top-1 accuracy was 16/18 at 384 and 18/18 at 768, so I moved
  to 1024 and shipped the migration my own schema comment had predicted. The
  same eval showed a nonsense query scoring 0.18 where a correct answer scored
  0.17, which killed any idea of using an absolute score as a relevance test."*

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

#### 2026-08-11 — Phase 3, safety first: three decorators and a second opinion
- Phase: 3
- Context: Started Phase 3 with the safety layer rather than the two missing
  agents. Redaction, fallback and the self-check all wrap the agent that
  already works, so each is independently useful and none waits on the others.
- **Two of the three turned out to be the same shape, and that was the design
  win.** PHI redaction and model fallback are both `LlmProvider` decorators,
  so they compose: `RedactingProvider(FallbackProvider([...]))`. Redaction
  outermost, deliberately — the other order leaves failing over to a second
  vendor as a path that skips de-identification. A redaction *step* inside the
  loop would have protected today's calls; a decorator protects every call
  anything ever makes through that provider.
- **The hard part of redaction was deciding what to keep.** A redactor that
  removes too much breaks the agent silently: this is a scheduling product, so
  scrubbing dates would produce confident nonsense, and scrubbing FHIR ids
  would remove the agent's ability to address anything. Every pattern requires
  structure — a scheme, a separator, a country code — specifically so none of
  them matches a bare run of digits, because a bare run of digits here is a
  resource id. The tests for what *survives* are as long as the tests for what
  goes.
  - Names are exact-match only. No regex finds names without also finding
    ordinary words, and I would rather miss a name than corrupt the request.
  - It is therefore not Safe Harbor de-identification, since a medical record
    number is an identifier under §164.514(b)(2). Written into the ADR and
    SECURITY.md rather than left implied.
  - One thing was free: ADR-008's flat projections already keep names and phone
    numbers out of tool results. A decision made for a different reason turned
    out to be the single largest reduction in PHI reaching the model.
- **For fallback, the loop is trivial and the classification is the whole
  thing.** 5xx, 429 and timeouts fail over; 401, 400 and 404 never do, because
  the next provider fails identically and slower. Unrecognised errors do not
  either — they might be deterministic. And the status code beats the exception
  class when both exist, because SDKs raise a generic `APIStatusError` for
  anything they do not model, so a 401 can arrive wearing a transient-looking
  name.
- **The self-check fails closed, and the parser is why.** First attempt used
  `startswith("APPROVE")`, which reads "APPROVED?" — a model hedging — as
  approval. Matching the whole first word instead makes hedging a block. A
  spurious block costs one iteration, because it goes back as an error result
  the model can correct from; a spurious approval costs a wrong write to a
  patient's calendar. Those are not symmetrical and the parser should not treat
  them as if they were.
- **An addition error, corrected.** The test badge said 304 where 201 + 14 + 99
  is 314. Nobody would ever have noticed, which is the argument for computing
  it rather than typing it.
- What I'd do differently: reach for the decorator shape sooner. I started
  writing redaction as a step inside `run_agent` and only moved it once
  fallback needed the same seam — at which point both got simpler and the
  composition question ("which one is outermost?") became something I had to
  answer explicitly rather than by accident.
- Interview soundbite: *"PHI redaction and model fallback are both decorators
  around the same provider interface, which forced me to answer which one wraps
  the other. Redaction goes outermost — otherwise failing over to a backup
  model is a code path that skips de-identification, and that is exactly the
  kind of hole you only find in an incident review."*

#### 2026-08-11 — Phase 2: three bugs from asserting instead of verifying
- Phase: 2
- Context: Auth, RBAC, row-level security and an append-only audit log. The
  largest phase so far, and the one where I was wrong most often.
- **Superusers bypass RLS silently, and the compose default user is one.** No
  warning, no error — the policies stay in place and every one is skipped. The
  obvious wiring (reuse `DATABASE_URL`) would have left Phase 2 looking
  complete and enforcing nothing, with the code, the schema and the tests all
  reading correctly. That is worse than having no policies. Hence a separate
  `NOSUPERUSER NOBYPASSRLS` role, and hence `/api/health` reporting
  `tenantIsolation` — the only defence against an invisible failure is to make
  it visible.
- **Three bugs, one cause: I wrote a comment asserting behaviour I had not
  run.** Each was found by the first live request, not by 117 unit tests.
  - `membershipsFor` queried an RLS-protected table with a `user_id` filter and
    no tenant, with a comment explaining why that was safe. RLS matched nothing
    and every login failed. Fixed by widening the *policy* — a membership is
    visible to its tenant **or** to its owner — rather than stepping around it.
  - The auth guard opened the AsyncLocalStorage scope with
    `storage.run(actor, () => true)`. That scope closes when the callback
    returns, so the controller ran outside it. Guards cannot wrap the handler;
    middleware can. The store had to become a mutable box opened *before* the
    actor exists.
  - `@Header` sets a *response* header. The request decorator is `@Headers`.
    Every internal call would have 400'd.
- **The paranoid default paid for itself the same afternoon.** `currentTenantId()`
  throws with no actor in scope instead of returning a default. The scoping bug
  above therefore surfaced as a loud 500 on the first request. The Phase 1
  version returned a hardcoded demo tenant — the identical bug there would have
  been every user silently reading one clinic's data, with nothing in any log.
- **A test caught a real weakness in my password hashing.** scrypt finishes
  with PBKDF2, whose output blocks are generated independently — so a shorter
  derived key is a *prefix* of the longer one, and verifying against a
  truncated stored hash succeeded. Truncated to one byte, any password had a
  1-in-256 chance. A minimum digest length closes it. I only wrote that test
  because "reject a malformed hash" felt like an obvious case to cover.
- **Packaging, again, at the boundary.** The shared-types package shipped CJS
  only, on a comment saying "Vite consumes CJS without complaint" — true while
  only *types* crossed, because they erase. The first runtime import broke the
  web build. Fixing it dragged zod into the browser: +17 KB gzipped for one
  comparison, in a project that rejected socket.io over 40 KB. Split the roles
  into a dependency-free entry point; back to 73.5 KB.
- **Closing the phase found one more.** Automating the isolation checks meant
  `process.loadEnvFile` in a jest spec — which runs, succeeds, and changes
  nothing the test can see. Jest's node environment hands each file a *copy* of
  `process.env`; that function is a native binding writing to the real process.
  The tests fell back to the default connection URL and failed with "password
  authentication failed", which sends you looking at credentials rather than at
  where they came from. `globalSetup` runs before the sandboxes exist.
  - The fix that mattered more: making the failure message name the host it
    tried. "Auth failed" is not a diagnosis; "auth failed connecting to
    localhost:5432 when .env says 5433" is.
- **A test that cannot fail is worth nothing, so CI proves this one can.** The
  isolation suite has a specific way of becoming vacuous: point it at a
  superuser connection and every assertion still holds while nothing is
  enforced. So CI runs it a second time with RLS deliberately bypassed and
  fails the build if it still passes.
- What I'd do differently: run the thing before writing the comment that
  explains why it works. Every one of these was a confident sentence in a
  docstring next to code that did something else.
- Interview soundbite: *"Postgres superusers bypass row-level security
  silently — no error, policies just skipped — and the default Docker user is
  one. So the gateway connects as an unprivileged role, and the health endpoint
  reports whether isolation is actually being enforced, because the failure it
  detects is otherwise completely invisible."*

#### 2026-08-11 — Closing the loop, and what at-least-once actually costs
- Phase: 1
- Context: BullMQ producer and worker. The end of a session that took the
  project from "the agent works if you run a script" to "type a message and it
  runs".
- **The design question was not the queue, it was the retry.** BullMQ takes
  five minutes to wire up. The real work was deciding what a retry *means* for
  an agent run, because every replay is a live Claude conversation being billed
  and possibly a second write to a patient's calendar.
  - Retry only where the run demonstrably never started. The AI service checks
    its provider *before* it claims the task, which is what makes its 503 safe
    to replay. 400 fails straight to the dead-letter list — it will be just as
    wrong on the third attempt.
  - 502 is the honest edge. The run may have got part way, and replaying it may
    re-spend the tokens it already spent. It is retryable anyway, because a
    transient model timeout is the likeliest failure here and refusing to retry
    would strand real work. That is the at-least-once trade, stated rather than
    hidden.
- **A queue makes duplicate delivery your problem, so the claim is the
  interesting part.** A worker whose connection drops mid-run will retry, and
  it has no way to know the first attempt is still going. So `markRunning`
  stopped being a status update and became a claim: allowed from `queued` or
  `failed`, refused from `running`, `resolved` or `escalated`. The refusal is
  guarded in the `UPDATE` as well as checked before it — two workers can both
  pass the read before either writes, and Postgres serialising the row is what
  decides. On the Python side the matching change is that `mark_running` is now
  the one call in the trace sink where failure is fatal: everything else there
  degrades observability, this one means someone else owns the work.
  - `jobId = taskId` on top of that, so BullMQ refuses a duplicate outright and
    the claim only has to catch what gets past it.
- **`console.log` was the wrong reflex.** The worker is plain Node — no Nest
  app, nothing to inject — so I logged with `console` and picked up three lint
  warnings. Reaching for Nest's `Logger` standalone was better than disabling
  the rule: the worker and the gateway land in the same `pnpm logs` stream, and
  two log formats in one stream is a needless thing to read past.
- **Verified the success path with a stub, because the real one could not
  reach it.** The Anthropic key returns 401, so no real run can succeed right
  now. Rather than declare the worker's happy path "probably fine", I pointed
  it at a fifteen-line stub returning a success payload and watched a task go
  enqueue → dequeue → HTTP → job completed and removed from the queue. The
  branch has now executed at least once.
- **The container caught me again, in the same way, one session later.** I had
  written *"run the container build before assuming local green means
  anything"* in this very log on 29 July. So I ran `pnpm up:all` before
  claiming the queue worked — and the AI service died on import with
  `IndexError`. My new `.env` loader computed the repo root as
  `Path(__file__).parents[3]`, which is correct for `apps/ai/app/env.py` and
  nonsense for `/srv/app/env.py`, where the Dockerfile puts it. 250 unit tests,
  including one specifically checking that path, and none of them could see it,
  because they all ran in the repo layout.
  - Fixed by walking up for `pnpm-workspace.yaml` instead of counting. The
    container now legitimately finds nothing, which is the correct answer
    there, rather than raising.
  - Worth keeping: "how deep am I in the tree" is an assumption, not a fact,
    and the deployment artefact is where it stops being true.
- What I'd do differently: write the claim before the queue, not after. I
  built the producer and worker first and then realised the whole retry story
  was unsound without it — the guard is what makes the retry policy safe to
  choose at all, so it was the real dependency.
- Interview soundbite: *"Adding the queue was five minutes; deciding what a
  retry means took the rest. Every replay is a billed model conversation and
  maybe a second write to a patient's calendar, so I made marking a task
  running into a claim — allowed from queued or failed, refused from running or
  finished, enforced in the UPDATE and not just checked before it, because two
  workers can both pass the read before either writes."*

#### 2026-08-11 — Three bugs found by following my own README
- Phase: 1
- Context: Second half of the session that closed the loop. All three of these
  were found by *running* the documented quickstart rather than reading it —
  and all three had been sitting in a repo whose docs called them done.
- **`pnpm up` never ran my script.** `up` is a built-in pnpm alias for
  `update`, so a script of that name is shadowed. The README's documented way
  to start Postgres, Redis and n8n was silently bumping dependencies instead; I
  watched turbo go 2.3.3 → 2.10.9 and had to revert a lockfile. Renamed to
  `up:infra`. `up:all`, `down` and `logs` were never affected — only the
  one-word name collided.
  - Generalises: a script named after a package-manager verb is a trap, and
    the failure is silent because both things "work".
- **Compose never read the root `.env`.** It resolves its env file relative to
  the compose file, so `-f infra/docker-compose.yml` looked for `infra/.env`,
  which does not exist. Every `${VAR:-default}` took its default and the
  `POSTGRES_PORT=5433` / `REDIS_PORT=6380` overrides in the root `.env` did
  nothing at all. I found it because Redis refused to start — another project
  held 6379, which is the *exact* collision that override exists for, and the
  decision log above records that work as finished. It was half finished: the
  compose file could accept the values, nothing handed them over.
  - Fixed with `--env-file .env` rather than `--project-directory .`, because
    the latter would also move where build contexts and volume mounts resolve.
- **A CORS test that was really testing my shell.** Making the AI service load
  the repo `.env` (the Node half already did) broke
  `test_defaults_to_the_local_web_origin`. The test asserted on the
  module-level `ALLOWED_ORIGINS`, so what it actually asserted was "nothing in
  this environment set `WEB_ORIGIN`" — true for two weeks by luck. It then
  failed locally while still passing in CI, where no `.env` exists, which is
  the inverse of the usual works-on-my-machine and much easier to dismiss.
  Extracted `parse_allowed_origins()` to mirror the gateway's version and
  tested the function with explicit input.
- What I'd do differently: run the quickstart from a cold start at the end of
  every phase, not just read it. Two of these three were in the README, in
  commands I had written and never executed in that exact form.
- Interview soundbite: *"I found three infrastructure bugs by actually running
  my own README. The best one: `pnpm up` is pnpm's built-in `update`, so the
  documented command to start my database was silently upgrading dependencies
  instead — and separately, Docker Compose was ignoring every port override in
  my `.env` because it looks for that file next to the compose file, not at the
  repo root. My notes said both of those were done."*

#### 2026-08-11 — The loop was never closed, and the docs undersold it
- Phase: 1
- Context: Came back after a 13-day gap and audited real status before writing
  anything, the same way the July 29 session started. Then built the gateway
  FHIR endpoints ADR-008 has been asking for since it was written.
- **The audit finding that mattered.** `09-TODO` and the README both describe
  the queue gap as "a created task sits `queued` until a run is triggered by
  hand." That is true and it is not the whole truth. `apps/ai/app/main.py`
  exposes **only `/health`** — there is no endpoint that runs an agent at all —
  and `demo.py` creates its *own* task with a hardcoded message. So the thing
  you type into the dashboard is not merely delayed. It is never run. Two
  sentences of honest-sounding documentation described a smaller problem than
  the one I had.
  - Worth keeping: "triggered by hand" and "unreachable from the product" are
    different claims, and the first is the comfortable way to write the second.
- **A test caught my normaliser doing the thing it exists to prevent.**
  `FhirId` strips a `ResourceType/` prefix so the model can pass ids either
  way. I also stripped trailing slashes, mirroring the Python helper. That made
  `Appointment/` — a prefix with the id *missing* — parse cleanly to the id
  `Appointment`, which would have gone to HAPI as a lookup for a resource
  nobody asked about. Forgiving a leading slash is safe; forgiving a trailing
  one changes what the input means. The asymmetry is now deliberate and tested.
- **"Speaks no FHIR" had to be made true, not just written down.** ADR-008 says
  the AI service holds no FHIR knowledge. Returning raw R4 `Appointment`
  resources from the gateway would have kept the letter of that and broken the
  substance, because the tool executor would still need to know where `start`
  lives and how `participant` nests. The endpoints return flat projections —
  five fields for an appointment, three for a slot. Widen when an agent needs
  more.
- **Put the id in the body, not the path.** `POST /appointments/:id/reschedule`
  is the better URL right up until the model sends `Appointment/137240399`,
  which matches no route and yields a bare 404 instead of the id error it could
  act on. This is RPC for one machine caller; robustness at a boundary a model
  drives beats REST shape.
- **Verified live, because stubs prove mapping and not much else.** Re-seeded
  the sandbox (slot times are relative to today, so a 13-day-old scenario has
  its "Thursday appointment" in the past), then drove all three endpoints
  against real HAPI with the prefixed ids Claude actually produced. The
  reschedule moved the appointment and wrote `slot: ["Slot/137240396"]` —
  singular. The double-prefixed `Slot/Slot/…` that the throwaway Python adapter
  wrote onto a live appointment is now unreachable through this path.
- What I'd do differently: audit before believing my own status docs, every
  time. This is the second consecutive session where reading the code found
  something the documentation had rounded off in its own favour — and the
  documentation was written by me, one session earlier, in good faith.
- Interview soundbite: *"My own docs said tasks sat queued until triggered by
  hand. Reading the code, the AI service had no run endpoint at all and the
  demo script created its own task — so a message typed into the product was
  never executed, just never reported that way. 'Delayed' and 'unreachable' are
  different bugs, and the comfortable phrasing hid the second one."*

#### 2026-07-29 — I asked myself to click every page, and found eight dead buttons
- Phase: 1
- Context: Asked to walk the whole portal. I had shipped a dashboard that *looked*
  finished and never actually clicked its own navigation.
- **The finding.** No router was installed at all. The nine sidebar items were
  plain `<button>` elements with no `onClick`; Dashboard was hardcoded
  `active: true`. Clicking Agents, Tasks, Workflows, FHIR Explorer, Analytics,
  Audit Log, Billing or Settings did *nothing* — no navigation, no error, no
  console message. An audit of every `<button>` in the codebase: **5 wired, 6
  dead.** The gap between "looks done" and "is done" was eight screens wide.
- **The bigger finding was the numbers.** The KPI tiles read "128 appointments
  booked, +12% vs last week", "no-show rate 11%, −4pp", "76% calls deflected".
  Not one of those is something the product measures. They came from
  `mock.ts` written during the design phase, and they had quietly become a
  claim the system could not back.
  - Replaced with metrics the system genuinely observes: tasks today, success
    rate, cost per resolved task, tokens used. A freshly seeded install now
    shows small honest numbers instead of impressive invented ones.
  - **Inventing an outcome metric is worse than omitting it.** The business KPIs
    return in Phase 4, when there is a baseline to compute a delta against.
- **`null` is not `0`.** A paused agent with no runs shows `—`, not `0%`. "0%
  success" is a specific and damning claim; "no data yet" is the truth. The API
  returns `null` for every rate where the denominator is zero, and the UI
  renders an em dash. Same for cost per task.
- **A page saying "not built" beats a button that does nothing.** Each unbuilt
  screen now renders what it will be, which phase it lands in, and what already
  exists behind it. Identical information to a dead button — but the user learns
  it in one click instead of concluding the app is broken. Buttons that cannot
  work yet (Configure, Pause) are `disabled` with a title, not styled to look live.
- **Right-sizing a dependency.** TanStack Query is on the stack list, but every
  screen here loads once and refreshes on an explicit action — there is no cache
  to invalidate. A ~30-line `useApi` hook covers it. react-router *was* worth its
  cost: bundle went 54 → 70 KB gzipped for nine working routes.
- What I'd do differently: click through my own UI before calling a phase done.
  I described this dashboard as working in two separate summaries before
  actually exercising its navigation.
- Interview soundbite: *"I audited my own dashboard and found eight nav items
  that did nothing and four KPI tiles showing numbers the product doesn't
  measure. I replaced the invented business metrics with operational ones the
  system actually observes, and made 'no data yet' render as an em dash rather
  than 0% — because 0% success is a claim, and I didn't have the data to make it."*

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
| 2026-07-29 | KPI tiles show business outcomes (no-show rate, calls deflected) | **Operational metrics only** — tasks, outcomes, spend, tokens | Those figures came from the design-phase mock and nothing in the product measures them. Small honest numbers beat impressive invented ones; the business KPIs return in Phase 4 when a baseline exists to compute a delta against |
| 2026-07-29 | TanStack Query for data fetching (on the stack list since Phase 0) | **A ~30-line `useApi` hook** | ~13 KB for cache invalidation and refetch policies that no current screen needs — every page loads once and refreshes on an explicit action. Swap it in when a screen actually needs a cache |
| 2026-08-12 | Embedding vectors at 384 dimensions | **1024** | 384 was chosen because it is a familiar sentence-transformer width. With feature hashing the dimension is a collision budget, not a model property: a retrieval eval over the real corpus put a chaperones passage above the cancellation policy on one collision. Top-1 went 16/18 → 18/18 at 768; 1024 is the next power of two and the width of the model most likely to replace it |
| 2026-08-12 | A score threshold would tell relevant results from irrelevant ones | **A noise floor only; the prompt and the citation check do the real work** | Measured: a nonsense query scored 0.18 against the test-results document while a correct match scored 0.17. Cosine similarity over sparse vectors is comparable within one search, not across queries |
| 2026-08-12 | Escalation is done when the agent stops and sets a status | **Done when a person is told, and the queue write is not the agent's job** | Three escalation paths all ended by setting `tasks.status = 'escalated'` and nothing watched it — correct and useless. The row is now written by the gateway inside the task-completion transaction, so no agent path can escalate without queueing |
| 2026-08-12 | n8n would own the "reschedule appointment" workflow (planned since Phase 1) | **The gateway keeps every FHIR write; n8n gets the scheduled sweep instead** | ADR-008 made the gateway the single owner of FHIR access after a second implementation wrote a malformed `Slot/Slot/…` reference onto a live appointment. A reschedule through n8n would be a third path to that write with its own copy of the concurrency rules |
| 2026-08-17 | A ~30-line `useApi` hook is enough; every screen loads once and refreshes on an explicit action (decided 2026-07-29) | **Same hook, plus polling and refetch-on-focus** | Still not TanStack Query — the ~13 KB buys caching this app has no use for. But "every screen refreshes on an explicit action" was a claim about the screens, and the dashboard's own subtitle says "live status". A control plane where the task you submitted finishes and no tile moves until you press a button is telling a small lie in its headline |
| 2026-08-17 | Which trace is open is component state | **It is a URL** (`?trace=<taskId>`) | A trace is a record of something that happened; records get addresses. As state it could not be shared, bookmarked or reloaded, and a walkthrough had to say "click the third row" instead of pasting a link |
| 2026-08-17 | Backfill the trace *after* subscribing, so no step written during the handshake is lost (decided 2026-07-29) | **Backfill immediately *and* on open** | The original reasoning was right and the placement was wrong. Gating HTTP behind the socket made the stream a precondition for reading a finished run — a blocked WebSocket showed an empty drawer for a trace that was fully available. Merging by `stepNo` means doing both costs nothing and keeps the original guarantee |
| 2026-08-17 | Status colours are defined once and the light theme overrides what it needs | **Every semantic token is redefined per theme, or it is a bug** | Four were omitted and inherited dark-tuned values onto white at 2.2–2.5:1. A partial override is indistinguishable from a complete one until someone opens the other theme and measures |

---

## Metrics to capture for the case study
Fill these in by launch — concrete numbers make the portfolio post land.

- [~] **Lines of code / services / test coverage %** — 6 services (web, api, ai,
  postgres, redis, n8n) across 5 workspaces. The web suite is **40 tests**
  (counted 2026-08-17, up from 28). The repo total previously recorded here was
  628, but its own breakdown — 231 + 74 + 299 — sums to 604, so **the total needs
  a recount across all five workspaces rather than another adjustment by
  arithmetic**; that is precisely the mistake this line has already made twice.
  Coverage % still not measured — wire `test:cov` thresholds in Phase 6.
- [~] **Avg cost per resolved task** — **$0.0153** for a full reschedule on
  `claude-sonnet-5` (3 iterations, 9 trace steps). A measured earlier run cost
  $0.0215 before a tool-description fix removed a wasted round trip — **a 24%
  reduction from one sentence of schema documentation.**
- [ ] p95 task latency (excl. LLM) — *per-step latency is captured; not yet aggregated*
- [~] **# of FHIR resource types integrated** — **5 live**: Patient, Practitioner,
  Schedule, Slot, Appointment (read, write, and version-checked update)
- [~] **# agents shipped** — **3 of 3 deployed** (Scheduling, Follow-up,
  Document Q&A), behind an orchestrator that routes to them or refuses and hands
  to a human. Scheduling is the only one proven end to end against a live model.
  **1 n8n workflow**, scheduled and verified firing unattended — it delivers
  follow-ups to a stand-in carrier, and the row records that it was a stand-in
- [ ] Eval scores (agent correctness before/after prompt iterations)
- [~] **Build time** — Phase 0 spanned 2026-07-03 → 2026-07-29 across 2 working
  sessions (26 elapsed days, ~1 day of actual work; the gap is the honest number
  to quote, not the effort)
- [ ] Demo engagement (video views, demo sessions) after launch
