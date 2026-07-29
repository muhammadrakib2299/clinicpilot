import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";

import { createTask } from "@/lib/api";
import { Card } from "@/components/primitives";

const EXAMPLE = "Hi, I need to move my Thursday appointment to next week.";

/**
 * The "simulate an inbound message" box from 09-TODO.
 *
 * Creates a real task through the gateway and hands the id up so the Trace
 * Viewer can subscribe to it. Phase 1 has no queue worker yet, so a task sits
 * `queued` until an agent run is started against it — the drawer opens either
 * way and streams whatever arrives.
 */
export function TaskComposer({ onTaskCreated }: { onTaskCreated: (taskId: string) => void }) {
  const [value, setValue] = useState(EXAMPLE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const task = await createTask(value.trim());
      onTaskCreated(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the API");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">Simulate an inbound message</h2>
      <p className="mt-1 text-xs text-muted">
        Creates a real task and opens the live trace stream.
      </p>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Patient message"
          placeholder="Type a patient message…"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-border-strong"
        />
        <button
          type="submit"
          disabled={submitting || !value.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50"
        >
          <Send className="size-3.5" />
          {submitting ? "Sending…" : "Send"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Card>
  );
}
