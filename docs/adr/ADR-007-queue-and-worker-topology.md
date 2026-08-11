# ADR-007 — Queue and worker topology

- **Status:** Accepted
- **Date:** 2026-08-11
- **Relates to:** [ADR-002](./ADR-002-polyglot-backend.md) (service split),
  [ADR-004](./ADR-004-postgres-ownership-and-drizzle.md) (gateway owns Postgres)

## Context

A task created in the dashboard has to reach the agent loop. Before this, it
did not: the AI service exposed only `/health`, and the only way to run an
agent was a CLI script that created its *own* task and ignored whatever the
user had typed. A message submitted in the product was never executed.

The obvious fix — have the gateway call the AI service inline on `POST /tasks`
— would hold an HTTP request open for the length of a Claude conversation and
lose the task entirely if anything blinked. So: a queue.

Redis is already in the stack. The decisions that actually mattered were not
"which queue" but **where the worker runs**, **what a retry means**, and
**what stops a duplicate delivery from running an agent twice.**

## Decision

**BullMQ over Redis, with the worker as a separate process, at-least-once
delivery, and a database-enforced claim on the task.**

Specifically:

1. The gateway enqueues after the task row commits, with `jobId = taskId`.
2. The worker is its own process from the same image, no fixed container name.
3. Retries are three attempts with exponential backoff, but only for failures
   where replaying is defensible.
4. `markRunning` is a claim, not a status update: allowed from `queued` or
   `failed`, refused with 409 from `running`, `resolved` or `escalated`.

## Rationale

### The worker is a separate process

An agent run holds a connection open for tens of seconds, and workers are the
thing you scale when a backlog builds. Neither is true of the HTTP API. Sharing
a lifecycle would mean scaling one to fix the other, and a wedged run would
consume capacity the gateway needs to serve the dashboard.

It is the same image with a different command, so there is no second build to
keep in sync, and no `container_name`, because a fixed one makes
`docker compose up --scale worker=3` impossible — which is the one thing this
topology exists to allow.

It is plain Node rather than a Nest application. The whole job is: take a job
off a queue, make one HTTP call, interpret the status. There is nothing to
inject. It does borrow Nest's `Logger`, because both processes land in the same
`pnpm logs` stream and two formats there is a needless thing to read past.

### Retries are scoped to what is safe to replay

Every replay is a billed Claude conversation and possibly a second write to a
patient's calendar. So the retry set is chosen, not defaulted:

| Status | Retried | Why |
|---|---|---|
| 503 | yes | The AI service checks its provider *before* claiming the task, so nothing ran and nothing was spent |
| 502, 504, 500, 429, 408 | yes | Transient upstream failure — the likeliest real failure mode |
| 400 | no | A malformed request is exactly as wrong on the third attempt |
| 409 | no | Another run holds the task, or it is finished |

502 is the honest edge. The run may have got part way, so a retry may re-spend
the tokens it already spent. It is retryable anyway, because a transient model
timeout is the single most likely failure here and refusing to retry would
strand real work. That is the at-least-once trade, and the claim below is what
stops the worst version of it.

### The claim is what makes at-least-once safe

A queue makes duplicate delivery the caller's problem. A worker whose
connection drops mid-run will retry, and it has no way to know the first
attempt is still going.

So marking a task running became a claim. It is enforced twice: checked before
the write for a clear error message, and constrained inside the `UPDATE`
because two workers can both pass the read before either writes — Postgres
serialising the row is what actually decides, and the loser gets the 409.

`jobId = taskId` sits in front of that, so BullMQ refuses an outright duplicate
and the claim only has to catch what gets past it.

On the Python side the matching rule is that `mark_running` is the one call in
the trace sink where failure is fatal. Every other call there degrades
observability; this one means someone else owns the work, so the run stops.

## Consequences

**Accepted costs**

- **A lossy window on enqueue.** The job is added after the task row commits,
  not inside the transaction, because a job referencing a row a rolled-back
  transaction never wrote would be picked up and 404 immediately. If Redis is
  unreachable in that window the task exists and nothing will consume it. The
  API says so — the create response carries `queued: false` — and the CLI can
  drive it by hand, but the window is real. The fix is an outbox: write the job
  to Postgres in the same transaction and relay it from there. Logged as debt
  in `09-TODO.md` rather than pretended away.
- **A retried 502 may double-spend.** Bounded by three attempts and by the
  claim, but not eliminated. Making it exact would need an idempotency record
  per run, which is more machinery than the current failure rate justifies.
- **One more process to run in development.** `pnpm worker` alongside `pnpm
  api`, and a task submitted with no worker running sits `queued` looking
  exactly like a task that failed to enqueue. The Task Inbox names both cases.
- **A second Redis client in the gateway.** Small, but it means Redis being
  down now degrades task creation as well as the queue.

**Not a consequence**

- Trace streaming is unaffected. Steps still go gateway → WebSocket (ADR-004);
  the queue moved *who starts the run*, not how progress is reported.

## Alternatives considered

- **Inline call from `POST /tasks`.** Simplest, and wrong: a 30-second HTTP
  request, no retries, and a lost task on any restart.
- **Worker as a Nest provider inside the gateway.** One less process, but ties
  worker scaling to API scaling and lets a run starve the dashboard.
- **`pg-boss` (queue in Postgres).** Genuinely attractive — it would have made
  the enqueue transactional and removed the lossy window above, with one less
  datastore in the critical path. Rejected because Redis is already in the
  stack for caching and rate limiting later, and because BullMQ's retry,
  backoff and dead-letter semantics are better-trodden. If the outbox work
  lands, this is the decision to revisit first.

## Revisit if

- The lossy enqueue window causes a real lost task, in which case do the outbox
  or move to `pg-boss`.
- Runs need to be cancellable from the UI — that needs the worker to watch for
  a signal mid-run, which nothing here supports.
- More than one agent kind is queued and they need separate concurrency or
  priority, at which point one queue per agent kind beats one shared queue.
