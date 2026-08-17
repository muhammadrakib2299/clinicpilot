import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AgentStatus } from "@/lib/types";

/** Flat, hairline-bordered surface. No shadows-as-depth, no gradients. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface-1", className)}>{children}</div>
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

/**
 * Refresh, and the timestamp that makes it mean something.
 *
 * The screens poll now, so the honest question a bare "Refresh" button leaves
 * unanswered — *how old is what I am looking at?* — has to be on screen too.
 * An absolute clock time rather than "3 minutes ago": it needs no ticking
 * timer to stay true, and a stale-looking wall clock is easier to trust than a
 * relative label that may itself have stopped updating.
 */
export function RefreshControl({
  updatedAt,
  busy,
  onRefresh,
}: {
  updatedAt: Date | null;
  busy?: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {updatedAt && (
        <span className="hidden font-mono text-xs text-muted tnum sm:inline">
          Updated{" "}
          {updatedAt.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      )}
      <button
        onClick={onRefresh}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-text"
      >
        <RefreshCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden />
        Refresh
      </button>
    </div>
  );
}

/**
 * How an agent's finished work split, as one bar.
 *
 * This replaced a `<Sparkline data={[1, 2, 2, 3, 3, 4]} />` on the agent card —
 * six invented numbers drawn as if they were a trend. The gateway does not
 * serve a time series per agent yet (Phase 4 does), so the honest visual is one
 * built from figures it *does* return: `successRate` and `escalationRate`, which
 * are both taken over the same denominator and therefore sum to 1.
 *
 * Two segments, not three: an agent with no finished tasks gets a bare track
 * and a caption, because a full bar of "unknown" reads as data.
 */
export function OutcomeBar({
  successRate,
  escalationRate,
}: {
  successRate: number | null;
  escalationRate: number | null;
}) {
  const known = successRate !== null && escalationRate !== null;
  const resolved = Math.round((successRate ?? 0) * 100);

  return (
    <div>
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full border border-border bg-surface-2"
        role="img"
        aria-label={
          known
            ? `${resolved}% of finished tasks resolved, ${100 - resolved}% escalated`
            : "No finished tasks yet"
        }
      >
        {known && (
          <>
            <div style={{ width: `${resolved}%`, backgroundColor: "var(--success)" }} />
            <div style={{ width: `${100 - resolved}%`, backgroundColor: "var(--warning)" }} />
          </>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted">
        <span>{known ? "Resolved" : "Nothing finished yet"}</span>
        {known && <span>Escalated</span>}
      </div>
    </div>
  );
}

/** Quota / progress meter — single solid fill, hairline track. */
export function Meter({ value, max, color = "var(--accent)" }: { value: number; max: number; color?: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full border border-border bg-surface-2">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}
