import { useMemo, useState } from "react";
import { Inbox, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Card, EmptyState, RefreshControl, Skeleton } from "@/components/primitives";
import { listAgents, listTasks, type Task } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/cn";

const STATUS_STYLE: Record<Task["status"], string> = {
  queued: "text-muted",
  running: "text-info",
  resolved: "text-success",
  escalated: "text-warning",
  failed: "text-danger",
};

const STATUSES: Task["status"][] = ["queued", "running", "resolved", "escalated", "failed"];

export function TasksPage({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  // The inbox is where you watch a queued task become a running one.
  const { data, error, loading, updatedAt, reload } = useApi(listTasks, [], { pollMs: 10_000 });
  const agents = useApi(listAgents, []);

  /**
   * Status and agent live in the URL; the free-text query does not.
   *
   * The first two are the ones worth linking — "show me everything the
   * Follow-up Agent escalated" is a thing you send to somebody. A half-typed
   * search string is not, and putting every keystroke through the router would
   * fill the history stack with them.
   *
   * The functional updater matters: `?trace=` also lives here, so replacing the
   * whole param set would close an open drawer every time a filter changed.
   */
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");

  const status = params.get("status") ?? "";
  const agentId = params.get("agent") ?? "";

  const setFilter = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const agentNames = useMemo(
    () => new Map((agents.data ?? []).map((agent) => [agent.id, agent.name])),
    [agents.data],
  );

  const tasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data ?? []).filter((task) => {
      if (status && task.status !== status) return false;
      if (agentId && task.agentId !== agentId) return false;
      if (!needle) return true;
      return (
        task.input.toLowerCase().includes(needle) ||
        (task.outcome ?? "").toLowerCase().includes(needle)
      );
    });
  }, [data, status, agentId, query]);

  const filtered = Boolean(status || agentId || query.trim());

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Task Inbox</h1>
          <p className="text-sm text-muted">
            Every task submitted to the fleet. Click one to replay its trace.
          </p>
        </div>
        <RefreshControl updatedAt={updatedAt} busy={loading} onRefresh={reload} />
      </div>

      {error && (
        <Card className="border-danger/40 p-4 text-sm text-danger">
          Could not reach the API: {error}
        </Card>
      )}

      <Card className="flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search messages and outcomes"
            placeholder="Search messages and outcomes…"
            className="w-full rounded-md border border-border bg-surface-2 py-1.5 pl-8 pr-3 text-sm placeholder:text-muted focus:border-border-strong"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Status</span>
          <select
            value={status}
            onChange={(event) => setFilter("status", event.target.value)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm focus:border-border-strong"
          >
            <option value="">Any</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Agent</span>
          <select
            value={agentId}
            onChange={(event) => setFilter("agent", event.target.value)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm focus:border-border-strong"
          >
            <option value="">Any</option>
            {(agents.data ?? []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>

        <span className="ml-auto font-mono text-xs text-muted tnum">
          {tasks.length} of {(data ?? []).length}
        </span>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">
              Tasks submitted to the agent fleet. Open a task to replay its trace.
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Message
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Agent
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Channel
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Created
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Outcome
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => onOpenTask(task.id)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "font-mono text-xs font-medium uppercase",
                        STATUS_STYLE[task.status],
                      )}
                    >
                      {task.status}
                    </span>
                  </td>
                  {/*
                   * The row keeps its click handler because that is what a
                   * mouse expects of a table like this, but a `<tr onClick>` is
                   * invisible to a keyboard: not focusable, no role, no Enter.
                   * The real control is this button, so the row has exactly one
                   * tab stop and its accessible name is the message itself.
                   */}
                  <td className="max-w-[24rem] px-4 py-3">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenTask(task.id);
                      }}
                      className="block max-w-full truncate rounded text-left hover:underline"
                    >
                      {task.input}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                    {agentNames.get(task.agentId) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{task.channel}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted tnum">
                    {new Date(task.createdAt).toLocaleString()}
                  </td>
                  <td className="max-w-[20rem] truncate px-4 py-3 text-xs text-muted">
                    {task.outcome ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && !data && (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-6" />
            ))}
          </div>
        )}
      </Card>

      {!loading && tasks.length === 0 && !error && (
        <EmptyState
          icon={filtered ? Search : Inbox}
          title={filtered ? "Nothing matches those filters" : "No tasks yet"}
        >
          {filtered
            ? "Widen the status or agent filter, or clear the search."
            : "Send a patient message from the Dashboard to create the first one. It is queued, picked up by a worker, and its trace streams back here step by step."}
        </EmptyState>
      )}

      {/* The queue closed this gap; what is left is the failure mode, which is
          worth naming because `queued` looks identical either way. */}
      <p className="text-xs text-muted">
        Tasks are picked up automatically by the queue worker. One that stays{" "}
        <span className="font-mono">queued</span> means no worker is running — start it with{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">pnpm worker</code>, or run a
        single task by hand with{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">
          python -m app.agents.demo &lt;task-id&gt;
        </code>
        .
      </p>
    </div>
  );
}
