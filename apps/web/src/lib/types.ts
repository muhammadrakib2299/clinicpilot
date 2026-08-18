/**
 * The small vocabulary the UI shares with the gateway.
 *
 * These lived in `data/mock.ts` alongside the Phase-0 fixtures. The fixtures
 * are gone — every screen reads the API now — but four modules still imported
 * their *types* from a file called "mock", which is a misleading place for the
 * only part of it that was ever real.
 *
 * They are hand-written rather than generated because they are enums the
 * database owns, mirrored in `shared-types` on the server side; the honest fix
 * is generating the client from the gateway's OpenAPI schema, which
 * `09-TODO.md` still carries as open debt.
 */

/** Whether an agent is taking work. */
export type AgentStatus = "active" | "degraded" | "paused";

/** Which of the three agents. */
export type AgentKind = "scheduling" | "followup" | "docqa";

/** One step in an agent run, as `traces.kind` stores it. */
export type TraceKind =
  | "reason"
  | "reflection"
  | "tool_call"
  | "observation"
  | "action"
  | "escalation";

/**
 * Where one drafted follow-up got to, as `messages.status` stores it.
 *
 * `sent` is a claim about this system, not about a patient's phone — the
 * carrier in this repo is a stand-in, and the row records which one it was.
 * Anything rendering this must show `deliveryChannel` beside it.
 */
export type MessageStatus = "drafted" | "sent" | "failed";
