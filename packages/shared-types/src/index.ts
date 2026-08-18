import { z } from "zod";

import { USER_ROLES, type UserRole as UserRoleName } from "./roles";

/**
 * Wire contracts for the API gateway — the public surface the web app calls,
 * and the `internal/` surface the AI service calls (ADR-004, ADR-008).
 * Zod schemas are the single source of truth; TS types are inferred.
 */

export const AgentStatus = z.enum(["active", "degraded", "paused"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

/**
 * `reflection` is the agent being checked rather than trusted — a distinct
 * thing from `reason`, and the one an audit reviewer most wants to find next
 * to an `action`.
 *
 * Two shapes wear it. Before a high-stakes write it is a second model call
 * given the observations rather than the conversation. Before an answer is
 * delivered it is a mechanical check on what that answer cites, which spends
 * no tokens. Both are the system declining to take the agent's word for it,
 * which is what makes them one kind rather than two.
 */
export const TraceKind = z.enum([
  "reason",
  "reflection",
  "tool_call",
  "observation",
  "action",
  "escalation",
]);
export type TraceKind = z.infer<typeof TraceKind>;

export const AgentKind = z.enum(["scheduling", "followup", "docqa"]);
export type AgentKind = z.infer<typeof AgentKind>;

/**
 * How many floats a document embedding has.
 *
 * A wire constant rather than a database detail, because the vector is
 * produced in Python and stored by TypeScript, and the two ends have to agree
 * before Postgres gets a chance to complain. The gateway checks incoming
 * vectors against it so a mismatch is a 400 naming both lengths, rather than a
 * raw `expected 1024 dimensions, not 384` from the driver.
 *
 * **1024 was measured, not chosen.** This started at 384 because that is a
 * familiar sentence-transformer width — which was the wrong way to think about
 * it. With feature hashing the dimension is not a property of a model, it is a
 * collision budget, and 384 buckets was too few: a retrieval eval over the
 * seeded corpus put a chaperones passage above the cancellation policy for
 * "how do I cancel my appointment", purely because one query term collided with
 * one term in a short passage. Top-1 accuracy went from 16/18 to 18/18 at 768,
 * and 1024 is the next power of two, leaving headroom as a corpus grows.
 *
 * It is also the width of the obvious real embedding model to swap in, which
 * makes that swap a re-ingest rather than a migration.
 *
 * Changing it means a migration and a full re-ingest — existing vectors are not
 * convertible to a different width. See the `document_chunks` schema comment,
 * and `0007_embedding_dimensions.sql`, which is that prediction coming true.
 */
export const EMBEDDING_DIMENSIONS = 1024;

export const PlanCode = z.enum(["free", "pro", "clinic", "enterprise"]);
export type PlanCode = z.infer<typeof PlanCode>;

/**
 * Built from `USER_ROLES` so the list exists once.
 *
 * The list and `roleAtLeast` live in `./roles`, which imports nothing — the
 * SPA needs them and must not pull zod into the browser bundle to get them.
 * Import from `@clinicpilot/shared-types/roles` on the client; the root export
 * here is for the server, which parses with these schemas anyway.
 */
export const UserRole = z.enum(USER_ROLES);
// Value and type under one name, matching every other schema in this file. It
// has to be an alias rather than a re-export, because a re-export would
// collide with the const above instead of merging with it.
export type UserRole = UserRoleName;

export { USER_ROLES, roleAtLeast } from "./roles";

export const LoginInput = z.object({
  email: z.string().trim().min(1, "email is required").max(320),
  password: z.string().min(1, "password is required").max(1024),
  /** Optional: which membership to activate. Defaults to the first one. */
  tenantId: z.string().uuid().optional(),
});
export type LoginInput = z.infer<typeof LoginInput>;

/** Body of `POST /api/auth/switch-tenant`. */
export const SwitchTenantInput = z.object({
  tenantId: z.string().uuid(),
});
export type SwitchTenantInput = z.infer<typeof SwitchTenantInput>;

/** A tenant the signed-in user belongs to, and their role in it. */
export interface TenantMembership {
  tenantId: string;
  tenantName: string;
  role: UserRole;
}

/** What `GET /api/auth/me` returns — the SPA's whole notion of a session. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  role: UserRole;
  memberships: TenantMembership[];
}

/** Query for `GET /api/audit`. */
export const AuditQuery = z.object({
  actor: z.string().trim().max(320).optional(),
  action: z.string().trim().max(100).optional(),
  resourceType: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

/**
 * The same shape before defaults are applied — every field optional.
 *
 * What a caller *sends*, as opposed to what the server ends up with. The SPA
 * builds filters incrementally and should not have to invent a `limit` it does
 * not care about.
 */
export type AuditQueryInput = z.input<typeof AuditQuery>;

/** Where a task arrived from. Voice is a Phase 5+ stretch but reserved here. */
export const TaskChannel = z.enum(["web", "sms", "voice", "email"]);
export type TaskChannel = z.infer<typeof TaskChannel>;

/**
 * `resolved` and `escalated` are both terminal successes of a kind — the agent
 * either finished the job or correctly handed it to a human. `failed` is the
 * only outcome that means something went wrong.
 */
export const TaskStatus = z.enum(["queued", "running", "resolved", "escalated", "failed"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Agent = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  kind: AgentKind,
  status: AgentStatus,
  configJson: z.record(z.unknown()).default({}),
});
export type Agent = z.infer<typeof Agent>;

export const TraceStep = z.object({
  kind: TraceKind,
  label: z.string(),
  detail: z.string(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  costUsd: z.number().optional(),
  latencyMs: z.number().optional(),
});
export type TraceStep = z.infer<typeof TraceStep>;

/** Body of `POST /api/tasks` — what the Task Inbox submits. */
export const CreateTaskInput = z.object({
  agentKind: AgentKind,
  input: z.string().min(1, "a task needs something to act on").max(4000),
  channel: TaskChannel.default("web"),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

/**
 * One trace step posted back by the AI service (ADR-004).
 *
 * `stepNo` is assigned by the producer, not the database: the agent loop knows
 * the true ordering of its own steps, and a server-side counter would reorder
 * them under concurrent posts. The unique (task_id, step_no) index turns a
 * duplicate into a write error rather than a scrambled Trace Viewer.
 */
export const AppendTraceInput = z.object({
  stepNo: z.number().int().positive(),
  kind: TraceKind,
  label: z.string().min(1),
  detail: z.string(),
  content: z.record(z.unknown()).nullish(),
  tokensIn: z.number().int().nonnegative().nullish(),
  tokensOut: z.number().int().nonnegative().nullish(),
  costUsd: z.number().nonnegative().nullish(),
  latencyMs: z.number().int().nonnegative().nullish(),
  /** Present only on steps that made a model call, so spend reconciles. */
  model: z.string().nullish(),
  cacheReadTokens: z.number().int().nonnegative().nullish(),
  cacheWriteTokens: z.number().int().nonnegative().nullish(),
});
export type AppendTraceInput = z.infer<typeof AppendTraceInput>;

/**
 * Why an agent handed a task to a human.
 *
 * `unspecified` is what makes the escalation row mandatory rather than
 * conditional. The gateway queues one whenever a task completes as
 * `escalated`; a caller that does not say why still gets queued, because a
 * missing reason must never become a missing queue entry.
 */
export const EscalationReason = z.enum([
  "router",
  "max_iterations",
  "answer_check",
  "unspecified",
]);
export type EscalationReason = z.infer<typeof EscalationReason>;

/** Terminal state reported when an agent run finishes. */
export const CompleteTaskInput = z.object({
  status: z.enum(["resolved", "escalated", "failed"]),
  outcome: z.string().max(4000).nullish(),
  /**
   * Only meaningful alongside `status: "escalated"`, and optional even then.
   * The AI service knows which of its three escalation paths fired; the
   * gateway does not, and should not have to infer it from the outcome text.
   */
  escalationReason: EscalationReason.optional(),
});
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;

// ── The human queue ─────────────────────────────────────────────────────────

export const EscalationStatus = z.enum(["open", "acknowledged", "resolved"]);
export type EscalationStatus = z.infer<typeof EscalationStatus>;

/** Query for `GET /api/escalations`. */
export const EscalationQuery = z.object({
  /** Omitted means every status — the queue defaults to what is outstanding. */
  status: EscalationStatus.optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type EscalationQuery = z.infer<typeof EscalationQuery>;
export type EscalationQueryInput = z.input<typeof EscalationQuery>;

/**
 * Body of `POST /api/escalations/:id/resolve`.
 *
 * The note is required, and that is the whole point of the endpoint. An
 * escalation closed with no record of what was done leaves the queue tidy and
 * the question — "what happened to this patient's message?" — unanswerable,
 * which is the one thing a queue exists to prevent.
 */
export const ResolveEscalationInput = z.object({
  resolution: z
    .string()
    .trim()
    .min(1, "say what was done — an escalation closed with no note answers nothing later")
    .max(2000),
});
export type ResolveEscalationInput = z.infer<typeof ResolveEscalationInput>;

/** One row of the queue, with enough of its task to triage without opening it. */
export interface EscalationSummary {
  id: string;
  taskId: string;
  reason: EscalationReason;
  summary: string;
  status: EscalationStatus;
  /** The patient's original message. */
  taskInput: string;
  taskChannel: string;
  agentName: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
}

// ── Internal FHIR API (ADR-008) ─────────────────────────────────────────────
//
// The gateway owns FHIR access; the AI service calls these instead of speaking
// FHIR itself. Every field here is ultimately filled in by a language model, so
// the schemas are written to be tolerant of the forms a model actually produces
// and strict about the ones that would corrupt data.

/**
 * A FHIR resource id, tolerant of a `ResourceType/` prefix.
 *
 * Models pass ids both ways: asked for an Appointment id, Claude supplied
 * `Appointment/137240399` because that is the form it had just read out of a
 * search result. The old Python adapter concatenated that into
 * `/Appointment/Appointment/137240399` and 400'd — and in the slot case wrote a
 * malformed `Slot/Slot/…` reference that HAPI happily accepted. Normalising
 * here means the gateway has exactly one definition of "an id", and it is the
 * one every caller crosses.
 *
 * The error message names both forms deliberately. A tool schema that shows
 * only the right answer leaves the model guessing about what it got wrong.
 *
 * A leading slash is forgiven, a trailing one is not, and the asymmetry is on
 * purpose: `Appointment/` is a prefix with the id missing, and forgiving the
 * slash would read it as the id `Appointment` and go looking that up. A 404 on
 * a resource nobody asked for is a worse failure than a rejected argument.
 */
export const FhirId = z
  .string()
  .transform((value) => value.trim().replace(/^\/+/, ""))
  .pipe(
    z
      .string()
      // Charset and length are the R4 spec's own: [A-Za-z0-9-.]{1,64}. The
      // optional prefix is the only concession, and `Patient/1/_history/2`
      // fails it rather than silently resolving to version 2.
      .regex(
        /^(?:[A-Za-z]+\/)?[A-Za-z0-9\-.]{1,64}$/,
        "expected a bare FHIR id such as '137240399' — a 'Appointment/137240399' prefix is accepted, anything else is not",
      ),
  )
  .transform((value) => value.split("/").pop()!);

/**
 * ISO 8601 instant. Offsets are allowed as well as `Z`.
 *
 * Validated rather than passed through because a malformed bound does not fail
 * loudly downstream: a `start=ge<garbage>` search param is ignored by the
 * server, which then returns *every* slot — a wrong answer that looks like a
 * working query.
 */
const Instant = z.string().datetime({ offset: true });

/**
 * Search result sizes are capped. `_count` reaches the model's context window,
 * so an unbounded value is a token-spend and latency hazard, not just a big
 * response.
 */
const ResultCount = z.coerce.number().int().positive().max(50);

/**
 * The appointment statuses the scheduling agent can filter on — a subset of
 * R4's fourteen. The agent handles logistics, so `entered-in-error` and the
 * clinical-workflow states are deliberately not offered.
 */
export const AppointmentStatusFilter = z.enum([
  "booked",
  "pending",
  "arrived",
  "fulfilled",
  "cancelled",
]);
export type AppointmentStatusFilter = z.infer<typeof AppointmentStatusFilter>;

/** Query for `GET internal/fhir/appointments`. */
export const FindAppointmentsQuery = z.object({
  patientId: FhirId,
  status: AppointmentStatusFilter.optional(),
  count: ResultCount.default(20),
});
export type FindAppointmentsQuery = z.infer<typeof FindAppointmentsQuery>;

/** Query for `GET internal/fhir/slots`. */
export const FindFreeSlotsQuery = z.object({
  scheduleId: FhirId,
  from: Instant,
  count: ResultCount.default(10),
});
export type FindFreeSlotsQuery = z.infer<typeof FindFreeSlotsQuery>;

/**
 * Body of `POST internal/fhir/appointments/reschedule`.
 *
 * The appointment id travels in the body rather than the path on purpose. It
 * arrives from a model that prefixes ids about half the time, and
 * `/appointments/Appointment/137240399/reschedule` matches no route — the
 * caller would get a bare 404 instead of the id error it could actually act on.
 * This surface is RPC for one machine caller, not a public REST API, and
 * robustness at the boundary is worth more here than route aesthetics.
 */
export const RescheduleAppointmentInput = z
  .object({
    appointmentId: FhirId,
    slotId: FhirId,
    start: Instant,
    end: Instant,
    comment: z.string().max(500).optional(),
  })
  // A backwards interval is the one malformed write FHIR servers do not reliably
  // reject, and it lands on a real patient's calendar.
  .refine((input) => Date.parse(input.end) > Date.parse(input.start), {
    path: ["end"],
    message: "end must be after start",
  });
export type RescheduleAppointmentInput = z.infer<typeof RescheduleAppointmentInput>;

/**
 * Body of `POST internal/messages` — one recorded follow-up.
 *
 * The rendered body, not a template id and values. The gateway does not own
 * the templates and should not be re-rendering them: what it stores is what
 * the patient would receive, which is the thing anyone asks about later.
 */
export const RecordMessageInput = z.object({
  patientRef: FhirId,
  appointmentRef: FhirId.optional(),
  templateId: z.string().min(1).max(100),
  body: z.string().min(1).max(2000),
  taskId: z.string().uuid().optional(),
});
export type RecordMessageInput = z.infer<typeof RecordMessageInput>;

export interface MessageSummary {
  id: string;
  patientRef: string;
  templateId: string;
  body: string;
  status: string;
  /** Which channel it was handed to. Null while it is still `drafted`. */
  deliveryChannel: string | null;
  deliveredAt: string | null;
  deliveryError: string | null;
  createdAt: string;
}

/**
 * Body of `POST internal/messages/:id/delivery` — what the n8n workflow reports
 * back after handing a message to a channel.
 *
 * A discriminated union rather than an optional error field, so a failure
 * cannot be reported without saying what went wrong. `channel` is required on
 * both: "which channel failed" is the first question, and a failure with no
 * channel names nothing to fix.
 */
export const RecordDeliveryInput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("sent"),
    channel: z.string().trim().min(1).max(60),
  }),
  z.object({
    status: z.literal("failed"),
    channel: z.string().trim().min(1).max(60),
    error: z.string().trim().min(1, "say what failed").max(1000),
  }),
]);
export type RecordDeliveryInput = z.infer<typeof RecordDeliveryInput>;

/** Query for `GET internal/messages/pending`. */
export const PendingMessagesQuery = z.object({
  /** Capped: one sweep should not try to deliver a whole backlog at once. */
  limit: z.coerce.number().int().positive().max(100).default(25),
});
export type PendingMessagesQuery = z.infer<typeof PendingMessagesQuery>;

/**
 * A clinic, as the scheduled workflow sees it.
 *
 * Deliberately id and name only. This is the one list in the system that is
 * not scoped to a tenant, so it carries as little as it possibly can.
 */
export interface TenantRef {
  id: string;
  name: string;
}

// ── Documents and retrieval ─────────────────────────────────────────────────
//
// The AI service chunks and embeds; the gateway stores and searches. The split
// is not arbitrary: embedding has to produce *identical* vectors at ingest and
// at query time, and two implementations in two languages is exactly the
// arrangement that wrote a malformed `Slot/Slot/…` reference in Phase 1.

/**
 * A vector on the wire.
 *
 * The length check is the whole point of validating this at all. Postgres
 * rejects a wrong-length vector too, but at INSERT, after a document has been
 * read, chunked and embedded, and with a driver error that says nothing about
 * which side is wrong.
 */
const Embedding = z
  .array(z.number().finite())
  .length(
    EMBEDDING_DIMENSIONS,
    `an embedding must have exactly ${EMBEDDING_DIMENSIONS} dimensions — a different length means the AI service and the schema disagree about the model`,
  );

/**
 * Which embedder produced a vector.
 *
 * Carried on ingest *and* on search, and search filters by it. Cosine distance
 * between vectors from two different models is not an error — it is a
 * plausible float, so retrieval would keep returning rows and keep being wrong.
 */
const EmbeddingModel = z.string().trim().min(1).max(100);

/** One passage as it crosses the wire. */
export const IngestChunkInput = z.object({
  ordinal: z.number().int().positive(),
  heading: z.string().max(300).nullish(),
  text: z.string().min(1).max(8000),
  embedding: Embedding,
});
export type IngestChunkInput = z.infer<typeof IngestChunkInput>;

/**
 * Body of `POST internal/documents`.
 *
 * Ingest replaces a document rather than appending to it: re-running it after
 * an edit must not leave the old passages behind for the retriever to rank
 * against the new ones. `slug` is what makes that identity work, so it is
 * constrained to something safe to print inside a citation.
 */
export const IngestDocumentInput = z.object({
  slug: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "a slug is lowercase words joined by single hyphens, e.g. 'opening-hours' — it is shown to patients inside citations",
    )
    .max(80),
  title: z.string().trim().min(1).max(200),
  source: z.string().trim().max(500).nullish(),
  embeddingModel: EmbeddingModel,
  chunks: z.array(IngestChunkInput).min(1).max(1000),
});
export type IngestDocumentInput = z.infer<typeof IngestDocumentInput>;

/**
 * How similar a passage must be to come back at all.
 *
 * Nearest-neighbour search always returns neighbours. Without a floor, a
 * question the corpus does not cover still yields the configured number of
 * passages — they are simply the least irrelevant ones — and the model is then
 * holding five plausible-looking documents and a question it cannot answer
 * from them. That is the standard way a retrieval system produces a confident
 * wrong answer, and it needs no bug to happen.
 *
 * 0.05 discards passages that share essentially no vocabulary with the query.
 * It is a noise floor, not a relevance guarantee: clearing it means a passage
 * has *something* in common, not that it answers anything.
 */
const DEFAULT_MIN_SCORE = 0.05;

/** Body of `POST internal/documents/search`. */
export const SearchDocumentsInput = z.object({
  embedding: Embedding,
  embeddingModel: EmbeddingModel,
  /** Capped: every chunk returned lands in the model's context window. */
  limit: z.coerce.number().int().positive().max(20).default(5),
  minScore: z.coerce.number().min(0).max(1).default(DEFAULT_MIN_SCORE),
});
export type SearchDocumentsInput = z.infer<typeof SearchDocumentsInput>;

/**
 * One retrieved passage.
 *
 * `citation` is `slug#ordinal` — assembled by the gateway rather than by the
 * agent, so the only citations in existence are ones that came back from a
 * real row. That is what makes verifying an answer's citations meaningful.
 */
export interface RetrievedChunk {
  citation: string;
  documentTitle: string;
  heading: string | null;
  text: string;
  /** Cosine similarity in [-1, 1]; 1 is identical. */
  score: number;
}

/** What `GET /api/documents` returns — the corpus, without its vectors. */
export interface DocumentSummary {
  id: string;
  slug: string;
  title: string;
  source: string | null;
  chunkCount: number;
  embeddingModel: string | null;
  updatedAt: string;
}

/**
 * One UTC day in the analytics series.
 *
 * Every day in the window gets a row, including the ones with no activity.
 * Grouping rows by date only ever returns days that *have* rows, and a series
 * assembled from that silently omits the quiet ones — which draws a week of
 * three scattered tasks as three adjacent bars and makes an idle system look
 * busy.
 */
export interface AnalyticsDay {
  /** `YYYY-MM-DD`, bucketed in UTC so the series does not move with server TZ. */
  date: string;
  tasks: number;
  resolved: number;
  escalated: number;
  failed: number;
  costUsd: number;
}

/** Per-agent totals over the same window. */
export interface AnalyticsAgent {
  agentId: string;
  name: string;
  kind: string;
  tasks: number;
  resolved: number;
  escalated: number;
  failed: number;
  /** Null rather than 0 when nothing has finished — "no data" is not "0%". */
  successRate: number | null;
  escalationRate: number | null;
  costUsd: number;
  costPerResolved: number | null;
}

/** Spend split by model, which is where the ADR-003 fallback becomes visible. */
export interface AnalyticsModel {
  model: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  costUsd: number;
}

/**
 * End-to-end task latency: enqueue to final status.
 *
 * Wall clock, so it includes queue wait and model time. That is the number a
 * person waiting on the answer experiences, and naming it precisely matters
 * more than making it flattering — `10-LESSONS` asks for p95 "excluding LLM",
 * which this is not and does not claim to be.
 */
export interface AnalyticsLatency {
  p50Ms: number | null;
  p95Ms: number | null;
  /** Finished tasks the percentiles were computed over. */
  samples: number;
}

/** What `GET /api/analytics` returns. */
export interface AnalyticsSummary {
  /** Length of the window in days, inclusive of today. */
  days: number;
  /** First UTC day in the series, `YYYY-MM-DD`. */
  from: string;
  daily: AnalyticsDay[];
  agents: AnalyticsAgent[];
  models: AnalyticsModel[];
  latency: AnalyticsLatency;
  /**
   * The one business KPI `08-PLAN` asks for that this system actually
   * measures. "No-show delta" and "calls deflected" are not here because
   * nothing records appointment attendance or inbound calls, and inventing
   * them is the mistake the KPI tiles already corrected once.
   */
  followUps: { drafted: number; sent: number; failed: number };
  totals: {
    tasks: number;
    resolved: number;
    escalated: number;
    failed: number;
    costUsd: number;
    costPerResolved: number | null;
    modelCalls: number;
    tokensIn: number;
    tokensOut: number;
  };
}

/**
 * What the gateway returns for an appointment.
 *
 * A projection, not the FHIR resource. ADR-008 says the AI service speaks no
 * FHIR; handing it a raw R4 `Appointment` would make that false in practice,
 * because the tool executor would have to know where `start` lives and how
 * `participant` nests. Widen this as agents need more, not in anticipation.
 */
export interface AppointmentSummary {
  id: string;
  status: string;
  start: string | null;
  end: string | null;
  description: string | null;
}

/** What the gateway returns for a free slot. */
export interface SlotSummary {
  id: string;
  start: string;
  end: string;
}
