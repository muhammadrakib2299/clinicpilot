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
