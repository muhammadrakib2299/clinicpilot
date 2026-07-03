import { useEffect, useState } from "react";
import { X, Cpu, Wrench, Eye, Zap, TriangleAlert } from "lucide-react";
import { SAMPLE_TRACE, type TraceKind } from "@/data/mock";
import { TRACE_COLORS } from "@/components/primitives";
import { cn } from "@/lib/cn";

const ICONS: Record<TraceKind, typeof Cpu> = {
  reason: Cpu,
  tool_call: Wrench,
  observation: Eye,
  action: Zap,
  escalation: TriangleAlert,
};

/** The signature UX: an agent run streaming step-by-step. Motion is functional. */
export function TraceDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!open) {
      setVisible(0);
      return;
    }
    setVisible(0);
    const t = setInterval(() => {
      setVisible((v) => {
        if (v >= SAMPLE_TRACE.steps.length) {
          clearInterval(t);
          return v;
        }
        return v + 1;
      });
    }, 520);
    return () => clearInterval(t);
  }, [open]);

  if (!open) return null;

  const totalCost = SAMPLE_TRACE.steps
    .slice(0, visible)
    .reduce((a, s) => a + (s.costUsd ?? 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-surface-1">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Agent trace · Scheduling</div>
            <div className="mt-0.5 font-mono text-sm text-text">{SAMPLE_TRACE.task}</div>
          </div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md border border-border bg-surface-2 text-muted hover:text-text"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {SAMPLE_TRACE.steps.slice(0, visible).map((step, i) => {
            const Icon = ICONS[step.kind];
            const color = TRACE_COLORS[step.kind];
            return (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2"
                    style={{ color }}
                  >
                    <Icon className="size-3.5" />
                  </div>
                  {i < visible - 1 && <div className="my-1 w-px flex-1 bg-border" />}
                </div>
                <div className="flex-1 pb-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium" style={{ color }}>
                      {step.label}
                    </span>
                    {step.latencyMs && (
                      <span className="font-mono text-[11px] text-muted tnum">{step.latencyMs}ms</span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs leading-relaxed text-muted">{step.detail}</p>
                  {(step.tokensIn || step.costUsd) && (
                    <div className="mt-1.5 flex gap-3 font-mono text-[11px] text-muted tnum">
                      {step.tokensIn != null && <span>↑{step.tokensIn} ↓{step.tokensOut} tok</span>}
                      {step.costUsd != null && <span>${step.costUsd.toFixed(3)}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {visible < SAMPLE_TRACE.steps.length && (
            <div className="flex items-center gap-2 pl-10 text-xs text-muted">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" />
              streaming…
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs">
          <span className={cn("font-medium", visible >= SAMPLE_TRACE.steps.length ? "text-success" : "text-muted")}>
            {visible >= SAMPLE_TRACE.steps.length ? "✓ Resolved — appointment rescheduled" : "Running…"}
          </span>
          <span className="font-mono text-muted tnum">total cost ${totalCost.toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}
