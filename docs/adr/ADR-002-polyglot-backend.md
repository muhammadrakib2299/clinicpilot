# ADR-002 — Polyglot backend: NestJS gateway + FastAPI AI service

- **Status:** Accepted
- **Date:** 2026-07-29 (decision taken at Phase 0 inception, 2026-07-03)
- **Supersedes / relates to:** [ADR-001](./ADR-001-vite-split-frontend.md)

## Context

ClinicPilot has two backend workloads with genuinely different shapes:

| Workload | Nature |
|----------|--------|
| **Gateway** — auth, multi-tenancy + RLS context, RBAC, audit log, task intake, BullMQ queues, WebSocket trace streaming | Request/response and stateful plumbing. Latency measured in milliseconds. |
| **AI** — Claude tool-use loop, pgvector RAG, PHI redaction, provider fallback, eval harness | Long-running, token-metered, cost-bound. Latency measured in seconds. |

Three options: one TypeScript runtime, one Python runtime, or a split.

## Decision

Split. **NestJS** (`apps/api`) owns the gateway; **FastAPI** (`apps/ai`) owns
everything that touches a model. The web SPA talks only to the gateway; the
gateway calls the AI service over HTTP and the queue.

## Rationale

- **The AI ecosystem is Python-first.** Chunking, embeddings, tokenizers,
  eval frameworks and pgvector tooling are all materially better supported in
  Python. Building RAG and an eval harness in TypeScript means fighting the
  ecosystem for no product gain.
- **The gateway work is where Nest is strongest.** Modules, DI, guards,
  interceptors and the WebSocket gateway map directly onto tenancy, RBAC and
  audit. BullMQ is a Node library, so the queue producer belongs on this side.
- **The seam matches the scaling boundary.** The AI service is cost- and
  latency-bound and will need different concurrency, timeouts and autoscaling
  from the gateway. A split that already exists is cheaper than one retrofitted
  under load.
- **The boundary is typed at both ends.** `packages/shared-types` holds zod
  contracts for the TS side; FastAPI generates OpenAPI for the Python side.

## Consequences

**Accepted costs**

- Two toolchains: pnpm/turbo/ESLint/Jest+Vitest and pip/ruff/pytest. CI runs
  them as two parallel jobs (`.github/workflows/ci.yml`).
- Two container images and two deploy targets.
- Higher onboarding cost for a single-language team.
- **Contract drift** between zod schemas and Pydantic models is the real risk.
  Phase 1 mitigation: generate the client from the AI service's OpenAPI schema
  rather than hand-writing it, and keep a contract test on both sides.
- Small, deliberate duplication at the edges. `WEB_ORIGIN` parsing exists in
  both services; both are unit-tested to behave identically rather than being
  extracted into a shared package that neither runtime can import natively.

**Rejected alternatives**

- *All TypeScript.* Would push RAG, embeddings and evals onto weaker tooling
  precisely where the project is trying to demonstrate depth.
- *All Python.* FastAPI could serve the gateway, but it gives up Nest's
  structural conventions for exactly the layered concerns (guards, interceptors,
  module boundaries) that multi-tenancy and audit need, and it puts the queue on
  the wrong side of the BullMQ ecosystem.

## Revisit if

- The AI service is still thin by the end of Phase 3 — then collapsing it into
  the gateway is cheaper than operating two runtimes.
- Contract drift causes more than one production-shaped bug; that would argue
  for generated clients becoming mandatory rather than advisory.
