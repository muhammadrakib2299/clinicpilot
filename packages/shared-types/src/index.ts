import { z } from "zod";

/**
 * Contract types shared between the web app and the API gateway.
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
