# Architecture Decision Records

Each ADR captures one decision, the alternatives weighed, and what it costs us.
Numbered in the order the decision was accepted, never renumbered.

| # | Decision | Status | Phase |
|---|----------|--------|-------|
| [001](./ADR-001-vite-split-frontend.md) | Vite SPA + separate API, not a Next.js monolith | Accepted | 0 |
| [002](./ADR-002-polyglot-backend.md) | Polyglot backend: NestJS gateway + FastAPI AI service | Accepted | 0 |
| 003 | Provider abstraction: Claude primary, OpenAI fallback | Planned | 1–3 |
| [004](./ADR-004-postgres-ownership-and-drizzle.md) | The gateway owns Postgres; Drizzle is the ORM | Accepted | 1 |
| 005 | Multi-tenancy via Postgres row-level security | Planned | 2 |
| 006 | PHI redaction boundary before any model call | Planned | 3 |
| 007 | Queue and worker topology (BullMQ) | Planned | 1 |
| [008](./ADR-008-fhir-access-through-the-gateway.md) | FHIR access goes through the gateway | Accepted | 1 |

003, 005, 006 and 007 are reserved to match references already in `08-PLAN.md`,
`09-TODO.md` and `06-ARCHITECTURE-SCALABILITY.md`. Accepted decisions take the
next free number, so 004 and 008 are out of phase order — numbers record
acceptance order, not planning order.

## Format

Context → Decision → Rationale → Consequences → Revisit if.

"Consequences" must name what the decision costs, not just what it buys — an
ADR with no downsides listed is a sales pitch, not a record.
