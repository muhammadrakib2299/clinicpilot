import { useEffect, useRef } from "react";
import { Cpu, Eye, ShieldCheck, TriangleAlert, Wrench, X, Zap } from "lucide-react";

import type { TraceKind } from "@/data/mock";
import { TRACE_COLORS } from "@/lib/trace";
import { useTraceStream } from "@/lib/useTraceStream";
import { cn } from "@/lib/cn";

const ICONS: Record<TraceKind, typeof Cpu> = {
  reason: Cpu,
  // A shield rather than another brain: `reflection` is the agent checking
  // itself before a write, not more of the thinking that produced it.
  reflection: ShieldCheck,
  tool_call: Wrench,
  observation: Eye,
  action: Zap,
  escalation: TriangleAlert,
};

const TERMINAL = new Set(["resolved", "escalated", "failed"]);

const STATUS_TEXT: Record<string, string> = {
  queued: "Queued…",
  running: "Running…",
  resolved: "✓ Resolved",
  escalated: "⚠ Escalated to a human",
  failed: "✕ Failed",
};

/** Everything a `Tab` can land on, for the trap below. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The signature UX: a real agent run streaming in over a WebSocket. */
export function TraceDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const { steps, status, outcome, connection, totalCostUsd } = useTraceStream(taskId);
  const panel = useRef<HTMLDivElement>(null);

  // Read through a ref rather than depending on it. `onClose` is an inline
  // arrow in the shell, so a new identity every render — as a dependency it
  // would re-run this effect constantly, stealing focus back to the panel on
  // every streamed step and restoring it on every teardown.
  const close = useRef(onClose);
  close.current = onClose;

  /**
   * A modal has to behave like one.
   *
   * This covers the whole viewport and takes over the screen, but it had no
   * dialog role, no Escape, no focus management and a backdrop that only a
   * mouse could reach — so a keyboard user could open it and then tab straight
   * out into the dashboard behind it, with no way back and no way to close.
   */
  useEffect(() => {
    if (!taskId) return;

    const restore = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;

      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      // Wrap at both ends, and pull focus back in if it escaped some other way.
      if (event.shiftKey && (active === first || !panel.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Back to whatever opened it — the table row, the activity item, the
      // queue card — not to the top of the document.
      restore?.focus?.();
    };
  }, [taskId]);

  if (!taskId) return null;

  const done = TERMINAL.has(status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trace-drawer-title"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-surface-1"
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div
              id="trace-drawer-title"
              className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted"
            >
              Agent trace
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] normal-case",
                  connection === "live" ? "text-success" : "text-muted",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    connection === "live" ? "bg-success" : "bg-muted",
                    connection === "live" && !done && "animate-pulse-dot",
                  )}
                />
                {connection === "live" ? "live" : connection}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-xs text-muted">{taskId}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close trace"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-muted hover:text-text"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* The steps arrive one at a time over a socket. Without a live region
            a screen reader is told nothing at all after the drawer opens — the
            single most important thing this app does would be silent.
            `additions` because a step is appended, never rewritten. */}
        <div
          aria-live="polite"
          aria-relevant="additions"
          aria-busy={!done}
          className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5"
        >
          {steps.length === 0 && (
            <div className="pt-8 text-center text-xs text-muted">
              {connection === "live"
                ? "Waiting for the agent's first step…"
                : "Connecting to the trace stream…"}
            </div>
          )}

          {steps.map((step, i) => {
            const Icon = ICONS[step.kind];
            const color = TRACE_COLORS[step.kind];
            return (
              <div key={step.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2"
                    style={{ color }}
                  >
                    <Icon className="size-3.5" />
                  </div>
                  {i < steps.length - 1 && <div className="my-1 w-px flex-1 bg-border" />}
                </div>
                <div className="flex-1 pb-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium" style={{ color }}>
                      {step.label}
                    </span>
                    {step.latencyMs != null && (
                      <span className="shrink-0 font-mono text-[11px] text-muted tnum">
                        {step.latencyMs}ms
                      </span>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
                    {step.detail}
                  </p>
                  {(step.tokensIn != null || step.costUsd != null) && (
                    <div className="mt-1.5 flex gap-3 font-mono text-[11px] text-muted tnum">
                      {step.tokensIn != null && (
                        <span>
                          ↑{step.tokensIn} ↓{step.tokensOut} tok
                        </span>
                      )}
                      {step.costUsd != null && <span>${step.costUsd.toFixed(5)}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {!done && steps.length > 0 && (
            <div className="flex items-center gap-2 pl-10 text-xs text-muted">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" />
              streaming…
            </div>
          )}

          {outcome && (
            <div className="mt-4 rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed">
              {outcome}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs sm:px-5">
          <span
            className={cn(
              "font-medium",
              status === "resolved" && "text-success",
              status === "escalated" && "text-warning",
              status === "failed" && "text-danger",
              !done && "text-muted",
            )}
          >
            {STATUS_TEXT[status] ?? status}
          </span>
          <span className="font-mono text-muted tnum">total cost ${totalCostUsd.toFixed(5)}</span>
        </div>
      </div>
    </div>
  );
}
