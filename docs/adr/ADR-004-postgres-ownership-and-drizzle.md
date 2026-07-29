# ADR-004 — The gateway owns Postgres; Drizzle is the ORM

- **Status:** Accepted
- **Date:** 2026-07-29
- **Relates to:** [ADR-002](./ADR-002-polyglot-backend.md) (polyglot split), ADR-005 (RLS, planned)

## Context

Two decisions were outstanding and are entangled, so they are recorded together.

**Who talks to Postgres.** ADR-002 split the backend across two runtimes, and
both have a claim on the database. The AI service *produces* trace steps as the
Claude tool-use loop runs; the gateway *serves* them to the Trace Viewer and
owns tasks, tenancy and audit. The obvious default — give both a connection
pool — is not obviously right.

**Which ORM.** `05-TECH-STACK.md` names PostgreSQL and pgvector but never picks
a data-access library, so nothing was written down before the first table
existed.

## Decision

**The API gateway is the sole writer to Postgres.** The AI service holds no
database connection. It posts each trace step back to the gateway over HTTP,
which persists it and broadcasts it over the WebSocket in the same handler.

**Drizzle ORM**, with migrations as committed SQL generated from the schema.

## Rationale

### Gateway owns the database

- **Tenancy has one enforcement point.** Phase 2 sets a tenant context per
  transaction so RLS can filter (ADR-005). Two runtimes means two places that
  can forget to set it, and the failure mode of forgetting is cross-tenant data
  leakage in a healthcare app. One writer means one place to get right and one
  place to audit.
- **The fan-out point already exists.** The gateway must broadcast trace steps
  over WebSocket regardless. Having it also do the insert makes persist-and-
  broadcast a single atomic-ish handler instead of a database write in one
  process and a push in another with no ordering guarantee between them.
- **It keeps the AI service stateless**, which is the premise ADR-002 used to
  justify scaling the two independently.

The cost is an HTTP hop per trace step. Accepted: steps are seconds apart
because each one waits on a model call or a FHIR round trip, so the hop is
noise against the latency already in the loop.

### Drizzle over Prisma and TypeORM

- **RLS is the deciding factor.** Phase 2 needs `SET LOCAL app.tenant_id`
  inside the same transaction as the query. Drizzle hands you the connection
  and a transaction primitive, so that is ordinary code. Prisma abstracts the
  connection away and pushes you to `$executeRaw` alongside its own pooling —
  workable, but fighting the tool at exactly the layer that matters most here.
- **Migrations are reviewable DDL.** `drizzle-kit generate` emits SQL that
  lands in the diff. When the RLS policies and the append-only trigger arrive,
  they are readable in review rather than hidden behind a schema-diff engine.
- **Types without codegen.** `$inferSelect` / `$inferInsert` derive from the
  schema, so there is no generated client to keep in sync or check in.
- TypeORM was the third option: it integrates neatly with Nest DI, but its
  types are weaker and its migration behaviour has a long history of surprises.

## Consequences

**Accepted costs**

- **`drizzle-kit push` is banned in this repo.** It is convenient precisely
  because it skips the DDL review. `db:generate` then `db:migrate`, always.
- **`packages/*` must emit CommonJS.** `apps/api` is CommonJS for Nest's
  decorator metadata and cannot `require()` an ESM module, so shared-types and
  fhir-client build to CJS with declarations. This closed the "source-only
  packages" debt logged in `09-TODO.md`.
- **The AI service cannot query trace history.** It doesn't need to today —
  the loop carries its own context — but a future eval harness wanting to read
  past runs would go through the gateway's API rather than the database.
- Money is stored as `numeric`, never a float. Per-step costs are fractions of
  a cent summed thousands of times for the cost dashboard, and "the invoice
  doesn't match the traces" is not a bug worth having.

## Revisit if

- **Phase 3 RAG makes the hop expensive.** Document Q&A retrieves from pgvector
  on every question. If proxying embeddings reads through the gateway becomes
  the bottleneck, a **read-only** connection from the AI service is the first
  thing to try — read-only keeps the single-writer property that motivated this.
- **Trace volume makes per-step HTTP wasteful.** Batching steps within a run is
  the cheaper fix and should be tried before giving the AI service a pool.
