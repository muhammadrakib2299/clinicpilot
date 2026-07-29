import { Card } from "@/components/primitives";
import { listTasks, type Task } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/cn";

const STATUS_STYLE: Record<Task["status"], string> = {
  queued: "text-muted",
  running: "text-info",
  resolved: "text-success",
  escalated: "text-warning",
  failed: "text-danger",
};

export function TasksPage({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const { data, error, loading, reload } = useApi(listTasks, []);
  const tasks = data ?? [];

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Task Inbox</h1>
          <p className="text-sm text-muted">
            Every task submitted to the fleet. Click one to replay its trace.
          </p>
        </div>
        <button
          onClick={reload}
          className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-text"
        >
          Refresh
        </button>
      </div>

      {error && (
        <Card className="border-danger/40 p-4 text-sm text-danger">
          Could not reach the API: {error}
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Outcome</th>
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
                  <td className="max-w-[24rem] truncate px-4 py-3">{task.input}</td>
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

        {loading && <p className="p-4 text-xs text-muted">Loading tasks…</p>}
        {!loading && tasks.length === 0 && !error && (
          <p className="p-4 text-xs text-muted">
            No tasks yet. Send a message from the Dashboard to create one.
          </p>
        )}
      </Card>

      {/* Honest about the gap rather than leaving the user to discover it. */}
      <p className="text-xs text-muted">
        Tasks stay <span className="font-mono">queued</span> until an agent run is triggered — the
        queue worker is not built yet. Run{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">
          python -m app.agents.demo
        </code>{" "}
        to drive one.
      </p>
    </div>
  );
}
