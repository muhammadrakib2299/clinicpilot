# Contributing

This is a portfolio project, so the bar it holds itself to is "would this pass
review on a team I want to work on." Contributions and corrections are welcome
on that basis — especially bug reports, because several of the best findings in
`10-LESSONS.md` came from someone running the quickstart and watching it fail.

## Setup

Follow [the README's local setup](./README.md#run-it-locally). Four processes
for full-loop development:

```bash
pnpm up:infra    # Postgres + Redis + n8n
pnpm api         # gateway
pnpm worker      # queue worker
pnpm web         # SPA
cd apps/ai && uvicorn app.main:app --reload --port 8000
```

Without the worker, tasks are created and enqueued but nothing consumes them.

## Before you push

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
cd apps/ai && pytest && ruff check . && ruff format --check .
```

CI runs exactly this, plus a compose smoke test that builds every image and
probes the running stack. **Run the container build before assuming local green
means anything** — that smoke test has caught two bugs that passed every local
check, both times because the repo layout is not the container layout.

## Tests

The convention here is that a test name states the behaviour and a comment
states why it matters, particularly when the reason is a bug that actually
happened:

```ts
it("matches through Drizzle's wrapper, where the driver error is the cause", () => {
  // Drizzle 0.45 throws DrizzleQueryError wrapping the pg error, so a
  // top-level `code` check silently misses every constraint violation and
  // they all surface as 500s.
```

Two rules worth keeping:

- **Test the function, not the module constant.** A test asserting on a value
  computed at import time is really asserting on the environment it ran in. One
  did exactly that here for two weeks before anyone noticed.
- **Agent behaviour is tested against `RecordedProvider`**, which implements the
  same protocol as the real one. Tests exercise the actual loop with no network,
  no API key and no spend. Nothing in CI calls a model.

## Commits

Small, individually green, conventional prefix (`feat`, `fix`, `docs`, `test`,
`refactor`, `build`, `ci`, `infra`). The body should explain *why* — the diff
already shows what. If a change reverses an earlier decision, say so and say
what changed your mind.

## Architecture decisions

Anything that constrains future work gets an ADR in [`docs/adr/`](./docs/adr/):
Context → Decision → Rationale → Consequences → Revisit if.

**Consequences must name what the decision costs.** An ADR with no downsides
listed is a sales pitch, not a record. Numbers are assigned in acceptance order
and never reused; a reserved number stays unwritten until the work is done,
because an ADR written in advance records an intention rather than a decision.

## The lessons log

`10-LESSONS.md` is updated at the end of every working session: what was built,
what broke, what was decided. Entries are written honestly, including the ones
where the mistake was mine — that file is the most useful thing in the repo for
its actual purpose, and it only works if it is not curated.

## Data

**Synthetic only.** Every fixture targets the public HAPI FHIR sandbox and no
part of this project may be pointed at real patient data — see
[SECURITY.md](./SECURITY.md).
