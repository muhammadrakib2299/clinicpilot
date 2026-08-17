import type { TraceKind } from "@/lib/types";

/**
 * Colour per trace step kind, shared by the Trace Viewer and the activity feed.
 *
 * Lives outside `components/primitives.tsx` so that file exports components
 * only — a mixed component/constant module breaks React Fast Refresh.
 */
export const TRACE_COLORS: Record<TraceKind, string> = {
  reason: "var(--info)",
  // Deliberately the same warning colour as `escalation`: both are the agent
  // stopping to question itself, and both are what a reviewer scans for.
  reflection: "var(--warning)",
  tool_call: "var(--accent)",
  observation: "var(--muted)",
  action: "var(--success)",
  escalation: "var(--warning)",
};
