import { ArrowDownRight, ArrowUpRight, Settings2, Pause, TrendingUp } from "lucide-react";
import { AGENTS, KPIS, ACTIVITY, type TraceKind } from "@/data/mock";
import { Card, Sparkline, StatusPill, Meter } from "@/components/primitives";
import { TRACE_COLORS } from "@/lib/trace";
import { cn } from "@/lib/cn";

function KpiTile({ kpi }: { kpi: (typeof KPIS)[number] }) {
  const up = kpi.trend === "up";
  const good = kpi.trend === "down" ? kpi.label.includes("No-show") : up; // down no-show is good
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{kpi.label}</div>
      <div className="mt-2 flex items-end justify-between">
        <span className="font-mono text-2xl font-semibold tnum">{kpi.value}</span>
        {kpi.spark && <Sparkline data={kpi.spark} color="var(--muted)" />}
      </div>
      {kpi.delta && (
        <div
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium"
          style={{ color: good ? "var(--success)" : "var(--danger)" }}
        >
          {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {kpi.delta}
          <span className="text-muted">vs last week</span>
        </div>
      )}
    </Card>
  );
}

function AgentCard({ agent, onOpenTrace }: { agent: (typeof AGENTS)[number]; onOpenTrace: () => void }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{agent.name}</span>
            <StatusPill status={agent.status} />
          </div>
          <div className="mt-1 text-xs text-muted tnum">{agent.tasksToday} tasks today</div>
        </div>
        <Sparkline data={agent.spark} color="var(--accent)" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <Metric label="Success" value={`${Math.round(agent.successRate * 100)}%`} color="var(--success)" />
        <Metric label="Escalation" value={`${Math.round(agent.escalationRate * 100)}%`} color="var(--warning)" />
        <Metric label="Cost/task" value={`$${agent.costPerTask.toFixed(3)}`} />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onOpenTrace}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] hover:opacity-90"
        >
          <TrendingUp className="size-3.5" /> View traces
        </button>
        <button className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted hover:text-text">
          <Settings2 className="size-3.5" /> Configure
        </button>
        <button className="flex items-center justify-center rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-muted hover:text-text">
          <Pause className="size-3.5" />
        </button>
      </div>
    </Card>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 py-2">
      <div className="font-mono text-sm font-semibold tnum" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function ActivityDot({ kind }: { kind: TraceKind }) {
  return <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: TRACE_COLORS[kind] }} />;
}

export function FleetOverview({ onOpenTrace }: { onOpenTrace: () => void }) {
  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Fleet Overview</h1>
          <p className="text-sm text-muted">Live status across your deployed AI agents.</p>
        </div>
        <button className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-text">
          Last 7 days
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KPIS.map((k) => (
          <KpiTile key={k.label} kpi={k} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-muted">Agents</h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {AGENTS.map((a) => (
              <AgentCard key={a.id} agent={a} onOpenTrace={onOpenTrace} />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {/* SaaS quota widget — usage vs plan limit */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Plan usage</h2>
              <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                Clinic
              </span>
            </div>
            <div className="mt-4 space-y-3">
              <Quota label="Tasks this month" value={9120} max={25000} />
              <Quota label="LLM budget" value={214} max={500} unit="$" color="var(--info)" />
              <Quota label="Seats" value={7} max={50} color="var(--success)" />
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">Live activity</h2>
            <div className="mt-3 space-y-3">
              {ACTIVITY.map((item) => (
                <button
                  key={item.id}
                  onClick={onOpenTrace}
                  className="flex w-full gap-2.5 rounded-md border border-transparent p-1.5 text-left hover:border-border hover:bg-surface-2"
                >
                  <ActivityDot kind={item.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted tnum">{item.time}</span>
                      <span className="text-[11px] font-medium text-muted">{item.agent}</span>
                    </div>
                    <p className={cn("text-xs leading-snug", item.kind === "escalation" ? "text-warning" : "text-text")}>
                      {item.text}
                    </p>
                  </div>
                </button>
              ))}
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
