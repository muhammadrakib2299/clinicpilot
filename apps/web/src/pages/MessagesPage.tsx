import { useMemo, useState } from "react";
import { FlaskConical, MessageSquare, Search, ShieldCheck } from "lucide-react";

import { Card, EmptyState, KpiTile, RefreshControl, Skeleton } from "@/components/primitives";
import { listMessages, messageStatusOf, type MessageSummary } from "@/lib/api";
import type { MessageStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/cn";

const STATUS_STYLE: Record<MessageStatus, string> = {
  drafted: "text-muted",
  sent: "text-success",
  failed: "text-danger",
};

const FILTERS: Array<{ label: string; value: MessageStatus | undefined }> = [
  { label: "All", value: undefined },
  { label: "Waiting", value: "drafted" },
  { label: "Delivered", value: "sent" },
  { label: "Failed", value: "failed" },
];

/**
 * Everything the Follow-up Agent has said to a patient.
 *
 * `GET /api/messages` has shipped since Phase 3 and nothing rendered it, which
 * meant the entire output of one of the three agents was invisible inside the
 * product it belongs to. You could watch the agent draft a message in a trace
 * and then have no way to ask what became of it.
 *
 * Two things this screen is careful about, because the rest of the system was
 * careful about them and a UI is where that care usually gets thrown away:
 *
 *  - **`sent` is not "a patient received a text".** The carrier in this repo is
 *    a stand-in and every row records which channel it was handed to. The
 *    status is always rendered with that channel beside it, and the note below
 *    the list is driven by the data rather than hardcoded — wire a real carrier
 *    up and it stops appearing on its own.
 *  - **The agent cannot write in its own words.** Every row names the approved
 *    template it filled. That is the governance story, and it is only legible
 *    if the template id is on screen next to the text it produced.
 */
export function MessagesPage() {
  // The n8n delivery sweep runs every five minutes, so a drafted message
  // becomes sent somewhere between page loads. Polling on the same order of
  // magnitude means you see it move without reloading.
  const { data, error, loading, updatedAt, reload } = useApi(() => listMessages(200), [], {
    pollMs: 30_000,
  });
  const [status, setStatus] = useState<MessageStatus | undefined>(undefined);
  const [query, setQuery] = useState("");

  // Memoised, not `data ?? []` inline: three memos below depend on it, and a
  // fresh array every render would defeat all of them.
  const messages = useMemo(() => data ?? [], [data]);

  const counts = useMemo(() => {
    const tally = { drafted: 0, sent: 0, failed: 0 };
    for (const message of messages) tally[messageStatusOf(message)] += 1;
    return tally;
  }, [messages]);

  // Which carriers actually handled anything. Drives the stand-in note rather
  // than a hardcoded disclaimer, so it tells the truth about whatever is wired
  // up at the time.
  const channels = useMemo(
    () => [
      ...new Set(
        messages.map((m) => m.deliveryChannel).filter((c): c is string => Boolean(c)),
      ),
    ],
    [messages],
  );
  const simulated = channels.includes("simulated");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return messages.filter((message) => {
      if (status && messageStatusOf(message) !== status) return false;
      if (!needle) return true;
      return (
        message.body.toLowerCase().includes(needle) ||
        message.patientRef.toLowerCase().includes(needle) ||
        message.templateId.toLowerCase().includes(needle)
      );
    });
  }, [messages, status, query]);

  const filtered = Boolean(status || query.trim());

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Patient Messages</h1>
          <p className="text-sm text-muted">
            What the Follow-up Agent drafted, and what the delivery workflow did with it.
          </p>
        </div>
        <RefreshControl updatedAt={updatedAt} busy={loading} onRefresh={reload} />
      </div>

      {error && (
        <Card className="border-danger/40 p-4 text-sm text-danger">
          Could not reach the API: {error}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile
          label="Waiting to go out"
          value={String(counts.drafted)}
          hint="The n8n sweep picks these up every five minutes"
        />
        <KpiTile
          label="Handed to a channel"
          value={String(counts.sent)}
          hint={channels.length ? `via ${channels.join(", ")}` : "No deliveries yet"}
        />
        <KpiTile
          label="Failed"
          value={String(counts.failed)}
          hint={
            counts.failed
              ? "Not retried automatically — somebody has to act"
              : "Nothing has failed delivery"
          }
        />
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search message text, patient reference or template"
            placeholder="Search text, patient or template…"
            className="w-full rounded-md border border-border bg-surface-2 py-1.5 pl-8 pr-3 text-sm placeholder:text-muted focus:border-border-strong"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.label}
              onClick={() => setStatus(filter.value)}
              aria-pressed={status === filter.value}
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

        <span className="ml-auto font-mono text-xs text-muted tnum">
          {shown.length} of {messages.length}
        </span>
      </Card>

      {/*
        A real list, because that is what it is: a screen reader announces the
        count and lets you jump between items instead of walking a run of
        anonymous divs. `role="list"` is explicit because Tailwind's preflight
        sets `list-style: none`, and that alone is enough for some browsers to
        drop the list semantics it would otherwise infer.
      */}
      <ul role="list" className="space-y-3">
        {shown.map((message) => (
          <li key={message.id}>
            <MessageCard message={message} />
          </li>
        ))}
      </ul>

      {loading && !data && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}

      {!loading && shown.length === 0 && !error && (
        <EmptyState
          icon={filtered ? Search : MessageSquare}
          title={filtered ? "Nothing matches that" : "No patient messages yet"}
        >
          {filtered
            ? "Try another status, or clear the search."
            : "The Follow-up Agent writes here when it drafts a check-in. Send it a task from the Dashboard, then watch the row move from waiting to delivered."}
        </EmptyState>
      )}

      <div className="space-y-2">
        {/*
          Data-driven rather than a fixed disclaimer. `simulated` is a real
          value in `messages.delivery_channel`, recorded so that `sent` says
          what happened instead of implying a text somebody received. If a real
          carrier is ever wired in, this line disappears by itself.
        */}
        {simulated && (
          <p className="flex items-start gap-2 text-xs text-muted">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-medium text-text">No patient received any of these.</strong>{" "}
              The delivery workflow hands messages to a stand-in carrier that records the attempt
              and nothing else. Every row says which channel it was given to, so{" "}
              <span className="font-mono">sent</span> is a claim about this system rather than
              about a phone.
            </span>
          </p>
        )}
        <p className="flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            The agent cannot write to a patient in its own words. It chooses one of four approved
            templates and supplies the values that fill it — the template named on each row is the
            whole of what was said.
          </span>
        </p>
      </div>
    </div>
  );
}

function MessageCard({ message }: { message: MessageSummary }) {
  const status = messageStatusOf(message);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("font-mono text-xs font-medium uppercase", STATUS_STYLE[status])}>
          {status === "drafted" ? "waiting" : status}
        </span>

        {/* Never the status on its own. `sent · simulated` is the honest unit. */}
        {message.deliveryChannel && (
          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted">
            {message.deliveryChannel}
          </span>
        )}

        <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium">
          {message.templateId}
        </span>

        <span className="font-mono text-xs text-muted tnum">
          {new Date(message.createdAt).toLocaleString()}
        </span>

        <span className="ml-auto font-mono text-xs text-muted">{message.patientRef}</span>
      </div>

      {/* The body is the point of the row, so it gets normal body type rather
          than the muted small text everything else here uses. */}
      <p className="mt-3 text-sm">{message.body}</p>

      {message.deliveredAt && (
        <p className="mt-2 text-xs text-muted">
          Handed to <span className="font-mono">{message.deliveryChannel ?? "an unnamed channel"}</span>{" "}
          at {new Date(message.deliveredAt).toLocaleString()}
        </p>
      )}

      {message.deliveryError && (
        <p className="mt-2 text-xs text-danger">
          Delivery failed: {message.deliveryError}. It will not be retried automatically — the
          failures a channel produces are mostly ones that would happen again.
        </p>
      )}
    </Card>
  );
}
