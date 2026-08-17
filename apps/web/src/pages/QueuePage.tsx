import { useState } from "react";

import { Card, RefreshControl } from "@/components/primitives";
import {
  acknowledgeEscalation,
  listEscalations,
  resolveEscalation,
  type EscalationStatus,
  type EscalationSummary,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/cn";

/**
 * What the agent was doing when it gave up, in words a person can act on.
 *
 * The stored value is an enum for querying; this is the sentence. `unspecified`
 * is not a bug — the queue entry is written on the task's status alone, so a
 * run that did not categorise itself still reaches a human.
 */
const REASON: Record<EscalationSummary["reason"], { label: string; detail: string }> = {
  router: {
    label: "Not routable",
    detail: "The orchestrator would not send this to any agent — usually clinical or urgent.",
  },
  max_iterations: {
    label: "Did not converge",
    detail: "The agent ran out of steps without finishing the job.",
  },
  answer_check: {
    label: "Unverifiable answer",
    detail: "The agent's answer cited a passage it never retrieved, twice.",
  },
  unspecified: {
    label: "Escalated",
    detail: "The run escalated without saying which check fired.",
  },
};

const STATUS_STYLE: Record<EscalationStatus, string> = {
  open: "text-warning",
  acknowledged: "text-info",
  resolved: "text-success",
};

const FILTERS: Array<{ label: string; value: EscalationStatus | undefined }> = [
  { label: "Open", value: "open" },
  { label: "Being worked", value: "acknowledged" },
  { label: "Resolved", value: "resolved" },
  { label: "All", value: undefined },
];

/**
 * The human queue.
 *
 * Escalation has worked since Phase 1 — the router refuses to route, the loop
 * gives up after eight iterations, an unverifiable answer is not delivered.
 * Until now all three ended as a task marked `escalated` in an inbox nobody was
 * watching. This is where a person picks it up.
 */
export function QueuePage({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const { can } = useAuth();
  const [status, setStatus] = useState<EscalationStatus | undefined>("open");
  // Slower than the inbox: a queue two people are working needs to notice
  // somebody else claiming a row, but escalations arrive in minutes, not
  // seconds.
  const { data, error, loading, updatedAt, reload } = useApi(
    () => listEscalations(status),
    [status],
    { pollMs: 20_000 },
  );
  const entries = data ?? [];

  // Coordinator and above. A viewer still sees the backlog — hiding it from
  // the people standing at the desk is the wrong default for a queue.
  const canAct = can("coordinator");

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Human queue</h1>
          <p className="text-sm text-muted">
            Work the agents handed back. Click a row to replay what it did before giving up.
          </p>
        </div>
        <RefreshControl updatedAt={updatedAt} busy={loading} onRefresh={reload} />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            onClick={() => setStatus(filter.value)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              status === filter.value
                ? "border-border-strong bg-surface-2 font-medium text-text"
                : "border-border text-muted hover:text-text",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error && (
        <Card className="border-danger/40 p-4 text-sm text-danger">
          Could not reach the API: {error}
        </Card>
      )}

      <div className="space-y-3">
        {entries.map((entry) => (
          <EscalationCard
            key={entry.id}
            entry={entry}
            canAct={canAct}
            onOpenTask={onOpenTask}
            onChanged={reload}
          />
        ))}
      </div>

      {loading && <p className="text-xs text-muted">Loading the queue…</p>}
      {!loading && entries.length === 0 && !error && (
        <Card className="p-6 text-center text-sm text-muted">
          {status === "open"
            ? "Nothing waiting. Every escalation has been picked up."
            : "Nothing here."}
        </Card>
      )}
    </div>
  );
}

function EscalationCard({
  entry,
  canAct,
  onOpenTask,
  onChanged,
}: {
  entry: EscalationSummary;
  canAct: boolean;
  onOpenTask: (taskId: string) => void;
  onChanged: () => void;
}) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const reason = REASON[entry.reason];

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      setResolving(false);
      setNote("");
      onChanged();
    } catch (cause) {
      // Most likely a 409: somebody else claimed it between this page loading
      // and the click. Showing it beats a button that silently does nothing.
      setFailure(cause instanceof Error ? cause.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
              {reason.label}
            </span>
            <span
              className={cn(
                "font-mono text-xs font-medium uppercase",
                STATUS_STYLE[entry.status],
              )}
            >
              {entry.status}
            </span>
            <span className="font-mono text-xs text-muted tnum">
              {new Date(entry.createdAt).toLocaleString()}
            </span>
            {entry.agentName && <span className="text-xs text-muted">· {entry.agentName}</span>}
          </div>

          <p className="mt-2 text-sm">{entry.taskInput}</p>
          <p className="mt-1 text-xs text-muted">{entry.summary}</p>
          <p className="mt-1 text-xs text-muted/70">{reason.detail}</p>

          {entry.acknowledgedBy && entry.status !== "resolved" && (
            <p className="mt-2 text-xs text-info">Being worked by {entry.acknowledgedBy}</p>
          )}

          {entry.status === "resolved" && (
            <p className="mt-2 text-xs text-success">
              Resolved by {entry.resolvedBy ?? "someone since removed"} — {entry.resolution}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={() => onOpenTask(entry.taskId)}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted hover:text-text"
          >
            View trace
          </button>

          {canAct && entry.status === "open" && (
            <button
              disabled={busy}
              onClick={() => run(() => acknowledgeEscalation(entry.id))}
              className="rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 text-xs hover:text-text disabled:opacity-50"
            >
              I'll take it
            </button>
          )}

          {canAct && entry.status !== "resolved" && (
            <button
              disabled={busy}
              onClick={() => setResolving((open) => !open)}
              className="rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 text-xs hover:text-text disabled:opacity-50"
            >
              Resolve
            </button>
          )}
        </div>
      </div>

      {resolving && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim()) void run(() => resolveEscalation(entry.id, note.trim()));
          }}
        >
          {/* Required, and the server requires it too. An escalation closed
              with no note leaves the queue tidy and the question — what
              happened to this patient's message — unanswerable. */}
          <input
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What did you do? e.g. 'Called the patient, booked them for Thursday'"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm focus:border-border-strong"
          />
          <button
            type="submit"
            disabled={busy || !note.trim()}
            className="rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {busy ? "Saving…" : "Close it"}
          </button>
        </form>
      )}

      {failure && <p className="mt-2 text-xs text-danger">{failure}</p>}
    </Card>
  );
}
