import { z } from "zod";

/**
 * Wire contracts for the API gateway — the public surface the web app calls,
 * and the `internal/` surface the AI service calls (ADR-004, ADR-008).
 * Zod schemas are the single source of truth; TS types are inferred.
 */

export const AgentStatus = z.enum(["active", "degraded", "paused"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const TraceKind = z.enum(["reason", "tool_call", "observation", "action", "escalation"]);
export type TraceKind = z.infer<typeof TraceKind>;

export const AgentKind = z.enum(["scheduling", "followup", "docqa"]);
export type AgentKind = z.infer<typeof AgentKind>;

export const PlanCode = z.enum(["free", "pro", "clinic", "enterprise"]);
export type PlanCode = z.infer<typeof PlanCode>;

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

/** Terminal state reported when an agent run finishes. */
export const CompleteTaskInput = z.object({
  status: z.enum(["resolved", "escalated", "failed"]),
  outcome: z.string().max(4000).nullish(),
});
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;

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
