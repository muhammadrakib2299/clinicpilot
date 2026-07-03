import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { AgentStatus, TraceKind } from "@/data/mock";

/** Flat, hairline-bordered surface. No shadows-as-depth, no gradients. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface-1", className)}>{children}</div>
  );
}

/** Solid-stroke SVG sparkline — gradient-free. */
export function Sparkline({
  data,
  color = "var(--accent)",
  width = 96,
  height = 28,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data
    .map((d, i) => `${(i * step).toFixed(1)},${(height - ((d - min) / span) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden>
      <polyline points={pts} stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const STATUS_MAP: Record<AgentStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "var(--success)" },
  degraded: { label: "Degraded", color: "var(--warning)" },
  paused: { label: "Paused", color: "var(--muted)" },
};

/** Status is always dot + label (never color alone) — accessibility rule. */
export function StatusPill({ status }: { status: AgentStatus }) {
  const s = STATUS_MAP[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium">
      <span
        className={cn("size-1.5 rounded-full", status === "active" && "animate-pulse-dot")}
        style={{ backgroundColor: s.color }}
      />
      <span className="uppercase tracking-wide" style={{ color: s.color }}>
        {s.label}
      </span>
    </span>
  );
}

export const TRACE_COLORS: Record<TraceKind, string> = {
  reason: "var(--info)",
  tool_call: "var(--accent)",
  observation: "var(--muted)",
  action: "var(--success)",
  escalation: "var(--warning)",
};

/** Quota / progress meter — single solid fill, hairline track. */
export function Meter({ value, max, color = "var(--accent)" }: { value: number; max: number; color?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full border border-border bg-surface-2">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}
