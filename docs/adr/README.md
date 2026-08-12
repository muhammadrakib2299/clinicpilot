# Architecture Decision Records

Each ADR captures one decision, the alternatives weighed, and what it costs us.
Numbered in the order the decision was accepted, never renumbered.

| # | Decision | Status | Phase |
|---|----------|--------|-------|
| [001](./ADR-001-vite-split-frontend.md) | Vite SPA + separate API, not a Next.js monolith | Accepted | 0 |
| [002](./ADR-002-polyglot-backend.md) | Polyglot backend: NestJS gateway + FastAPI AI service | Accepted | 0 |
| [003](./ADR-003-provider-fallback.md) | Provider abstraction with fallback | Accepted | 3 |
| [004](./ADR-004-postgres-ownership-and-drizzle.md) | The gateway owns Postgres; Drizzle is the ORM | Accepted | 1 |
| [005](./ADR-005-multi-tenancy-via-row-level-security.md) | Multi-tenancy via Postgres row-level security | Accepted | 2 |
| [006](./ADR-006-phi-redaction-before-model-calls.md) | PHI redaction boundary before any model call | Accepted | 3 |
| [007](./ADR-007-queue-and-worker-topology.md) | Queue and worker topology (BullMQ) | Accepted | 1 |
| [008](./ADR-008-fhir-access-through-the-gateway.md) | FHIR access goes through the gateway | Accepted | 1 |
| [009](./ADR-009-lexical-embeddings-behind-an-interface.md) | Lexical embeddings behind an interface, not a second vendor | Accepted | 3 |

001–008 were reserved in advance; 009 is the first written because a decision
needed recording rather than because a number was waiting for it. 004, 007 and
008 are out of phase order because numbers record acceptance order, not planning
order — they were reserved early to match references in `08-PLAN.md`,
`09-TODO.md` and `06-ARCHITECTURE-SCALABILITY.md`, and each stayed unwritten
until the work it describes was built.

**That rule is the reason this set is worth reading.** An ADR written in
advance records an intention; the point of the format is to record what was
actually chosen and what it cost. Several of these say something different
from what the plan predicted, which is the whole value.

## Format

Context → Decision → Rationale → Consequences → Revisit if.

"Consequences" must name what the decision costs, not just what it buys — an
ADR with no downsides listed is a sales pitch, not a record.
