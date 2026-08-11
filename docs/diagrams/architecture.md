# Architecture diagrams

Mermaid source, rendered by GitHub directly. Kept as text rather than exported
images so a diff shows what changed about the system, not that some pixels moved.

These describe **what is built today**, not the target. Planned components are
drawn dashed and labelled.

---

## Request path: a message becomes a rescheduled appointment

```mermaid
flowchart TB
    subgraph browser["Browser"]
        SPA["React SPA<br/><i>Vite · ~70 KB gzipped</i>"]
    end

    subgraph gateway["API gateway · NestJS :8080"]
        TASKS["POST /api/tasks<br/>GET /api/tasks"]
        INT_T["internal/tasks/:id<br/><i>running · traces · complete</i>"]
        INT_F["internal/fhir<br/><i>appointments · slots · reschedule</i>"]
        WS["WebSocket /ws/traces"]
    end

    subgraph ai["AI service · FastAPI :8000"]
        RUN["POST /run"]
        LOOP["Tool-use loop<br/><i>reason → tool → observe → act</i>"]
    end

    WORKER["Queue worker<br/><i>own process · scalable</i>"]

    PG[("PostgreSQL + pgvector<br/><i>tasks · traces · llm_usage</i>")]
    REDIS[("Redis<br/><i>BullMQ: task-runs</i>")]
    CLAUDE["Claude API"]
    HAPI["HAPI FHIR R4 sandbox"]

    SPA -->|"1 submit"| TASKS
    TASKS -->|"2 insert"| PG
    TASKS -->|"3 enqueue<br/>jobId = taskId"| REDIS
    REDIS -->|"4 dequeue"| WORKER
    WORKER -->|"5 POST /run"| RUN
    RUN --> LOOP
    LOOP <-->|"6 messages + tools"| CLAUDE
    LOOP -->|"7 tool calls"| INT_F
    INT_F <-->|"8 read / version-checked write"| HAPI
    LOOP -->|"9 claim · steps · outcome"| INT_T
    INT_T -->|"10 persist"| PG
    INT_T -->|"11 broadcast"| WS
    WS -.->|"12 live steps"| SPA

    classDef planned stroke-dasharray:5 5
```

**The two boundaries that carry the design:**

- The AI service holds no database connection and speaks no FHIR. Steps 7 and 9
  both go through the gateway ([ADR-004](../adr/ADR-004-postgres-ownership-and-drizzle.md),
  [ADR-008](../adr/ADR-008-fhir-access-through-the-gateway.md)), so optimistic
  concurrency exists once and PHI access is auditable in one place.
- Step 9's first call is a *claim*, not a status update. It is refused if
  another run already holds the task, which is what makes the queue's
  at-least-once delivery safe ([ADR-007](../adr/ADR-007-queue-and-worker-topology.md)).

---

## Task lifecycle

The status field is a state machine, and the queue depends on it being one.

```mermaid
stateDiagram-v2
    [*] --> queued: POST /api/tasks
    queued --> running: worker claims it
    running --> resolved: agent finished
    running --> escalated: could not converge<br/>→ human queue
    running --> failed: model unreachable
    failed --> running: retry claims it
    running --> running: refused (409)
    resolved --> [*]
    escalated --> [*]

    note right of running
        Only queued and failed are
        claimable. A second delivery
        of an in-flight task is
        refused, not run twice.
    end note
```

---

## Deployment topology (local, `pnpm up:all`)

```mermaid
flowchart LR
    subgraph compose["docker compose · 7 services"]
        direction TB
        WEB["web<br/><i>nginx :8081</i>"]
        API["api<br/><i>:8080</i>"]
        AISVC["ai<br/><i>:8000</i>"]
        WRK["worker<br/><i>--scale worker=N</i>"]
        PGC[("postgres<br/><i>:5432</i>")]
        RDC[("redis<br/><i>:6379</i>")]
        N8N["n8n<br/><i>:5678 — not yet wired</i>"]
    end

    EXT["HAPI FHIR · Anthropic API"]

    WEB --> API
    API --> PGC
    API --> RDC
    WRK --> RDC
    WRK --> AISVC
    AISVC --> API
    API --> EXT
    AISVC --> EXT

    style N8N stroke-dasharray:5 5
```

Every host port is overridable in `.env`. The scripts pass `--env-file .env`
explicitly, because Compose resolves its env file relative to the compose file
and would otherwise ignore those overrides entirely.
