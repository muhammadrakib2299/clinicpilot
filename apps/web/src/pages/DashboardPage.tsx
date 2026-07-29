import { AlertTriangle, Pause, Settings2, TrendingUp } from "lucide-react";

import { Card, Sparkline, StatusPill, Meter } from "@/components/primitives";
import { TaskComposer } from "@/components/TaskComposer";
import { getOverview, listAgents, type AgentSummary, type OverviewKpis } from "@/lib/api";
import { TRACE_COLORS } from "@/lib/trace";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/cn";

const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const usd = (value: number | null, digits = 4) =>
  value === null ? "—" : `$${value.toFixed(digits)}`;

function KpiTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold tnum">{value}</div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

function Kpis({ kpis }: { kpis: OverviewKpis }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile
        label="Tasks today"
        value={String(kpis.tasksToday)}
        hint={`${kpis.tasksTotal} all time · ${kpis.tasksOpen} open`}
      />
      <KpiTile
        label="Success rate"
        value={pct(kpis.successRate)}
        hint={`${kpis.resolved} resolved · ${kpis.escalated} escalated`}
      />
      <KpiTile
        label="Cost per resolved task"
        value={usd(kpis.costPerResolvedTask)}
        hint={`${usd(kpis.totalCostUsd, 4)} spent across ${kpis.modelCalls} model calls`}
      />
      <KpiTile
        label="Tokens used"
        value={(kpis.tokensIn + kpis.tokensOut).toLocaleString()}
        hint={`↑${kpis.tokensIn.toLocaleString()} ↓${kpis.tokensOut.toLocaleString()}`}
      />
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 py-2 text-center">
      <div className="font-mono text-sm font-semibold tnum" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function AgentCard({ agent, onOpenTrace }: { agent: AgentSummary; onOpenTrace: () => void }) {
  const hasRun = agent.totalTasks > 0;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{agent.name}</span>
            <StatusPill status={agent.status} />
          </div>
          <div className="mt-1 text-xs text-muted tnum">
            {agent.tasksToday} today · {agent.totalTasks} all time
          </div>
        </div>
        {hasRun && <Sparkline data={[1, 2, 2, 3, 3, 4]} color="var(--accent)" />}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="Success" value={pct(agent.successRate)} color="var(--success)" />
        <Metric label="Escalation" value={pct(agent.escalationRate)} color="var(--warning)" />
        <Metric label="Cost/task" value={usd(agent.costPerTask, 4)} />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onOpenTrace}
          disabled={!hasRun}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-40"
        >
          <TrendingUp className="size-3.5" /> View traces
        </button>
        <button
          disabled
          title="Not built yet"
          className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted opacity-40"
        >
          <Settings2 className="size-3.5" /> Configure
        </button>
        <button
          disabled
          title="Not built yet"
          className="flex items-center justify-center rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-muted opacity-40"
        >
          <Pause className="size-3.5" />
        </button>
      </div>
    </Card>
  );
}

export function DashboardPage({
  onOpenTask,
}: {
  onOpenTask: (taskId: string) => void;
}) {
  const overview = useApi(getOverview, []);
  const agents = useApi(listAgents, []);

  const reloadAll = () => {
    overview.reload();
    agents.reload();
  };

  const error = overview.error ?? agents.error;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Fleet Overview</h1>
          <p className="text-sm text-muted">Live status across your deployed AI agents.</p>
        </div>
        <button
          onClick={reloadAll}
          className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-text"
        >
          Refresh
        </button>
      </div>

      {error && (
        <Card className="flex items-center gap-2 border-danger/40 p-4 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          Could not reach the API: {error}
        </Card>
      )}

      {overview.data && <Kpis kpis={overview.data.kpis} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-muted">Agents</h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {(agents.data ?? []).map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onOpenTrace={() => {
                  void import("@/lib/api").then(({ listTasks }) =>
                    listTasks().then((tasks) => {
                      const match = tasks.find((task) => task.agentId === agent.id);
                      if (match) onOpenTask(match.id);
                    }),
                  );
                }}
              />
            ))}
            {agents.loading && <p className="text-xs text-muted">Loading agents…</p>}
          </div>
        </div>

        <div className="space-y-4">
          <TaskComposer
            onTaskCreated={(taskId) => {
              onOpenTask(taskId);
              reloadAll();
            }}
          />

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Plan usage</h2>
              <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                Clinic
              </span>
            </div>
            <div className="mt-4 space-y-3">
              <Quota
                label="Tasks this month"
                value={overview.data?.kpis.tasksTotal ?? 0}
                max={25000}
              />
              <Quota
                label="LLM budget"
                value={Number((overview.data?.kpis.totalCostUsd ?? 0).toFixed(2))}
                max={500}
                unit="$"
                color="var(--info)"
              />
            </div>
            {/* Quotas are not enforced anywhere yet — Phase 2.5 adds metering. */}
            <p className="mt-3 text-[11px] text-muted">
              Limits are illustrative; enforcement lands with billing.
            </p>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">Live activity</h2>
            <div className="mt-3 space-y-3">
              {(overview.data?.activity ?? []).map((item) => (
                <button
                  key={item.id}
                  onClick={() => onOpenTask(item.taskId)}
                  className="flex w-full gap-2.5 rounded-md border border-transparent p-1.5 text-left hover:border-border hover:bg-surface-2"
                >
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: TRACE_COLORS[item.kind] }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted tnum">
                        {new Date(item.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="text-[11px] font-medium text-muted">{item.agentName}</span>
                    </div>
                    <p
                      className={cn(
                        "truncate text-xs leading-snug",
                        item.kind === "escalation" ? "text-warning" : "text-text",
                      )}
                    >
                      {item.label}
                    </p>
                  </div>
                </button>
              ))}
              {!overview.loading && overview.data?.activity.length === 0 && (
                <p className="text-xs text-muted">
                  No activity yet — send a message to create the first task.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Quota({
  label,
  value,
  max,
  unit = "",
  color,
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
  color?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-text tnum">
          {unit}
          {value.toLocaleString()} / {unit}
          {max.toLocaleString()}
        </span>
      </div>
      <Meter value={value} max={max} color={color} />
    </div>
  );
}
