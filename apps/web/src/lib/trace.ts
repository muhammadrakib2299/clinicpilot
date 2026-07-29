import type { TraceKind } from "@/data/mock";

/**
 * Colour per trace step kind, shared by the Trace Viewer and the activity feed.
 *
 * Lives outside `components/primitives.tsx` so that file exports components
 * only — a mixed component/constant module breaks React Fast Refresh.
 */
export const TRACE_COLORS: Record<TraceKind, string> = {
  reason: "var(--info)",
  tool_call: "var(--accent)",
  observation: "var(--muted)",
  action: "var(--success)",
  escalation: "var(--warning)",
};
