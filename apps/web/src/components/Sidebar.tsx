import {
  LayoutDashboard,
  Bot,
  Inbox,
  Workflow,
  Database,
  BarChart3,
  ScrollText,
  CreditCard,
  Settings,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/cn";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Bot, label: "Agents" },
  { icon: Inbox, label: "Tasks", badge: 3 },
  { icon: Workflow, label: "Workflows" },
  { icon: Database, label: "FHIR Explorer" },
  { icon: BarChart3, label: "Analytics" },
  { icon: ScrollText, label: "Audit Log" },
  { icon: CreditCard, label: "Billing" },
  { icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-1">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex size-7 items-center justify-center rounded-md border border-border-strong bg-surface-2">
          <Activity className="size-4 text-accent" strokeWidth={2.5} />
        </div>
        <span className="text-sm font-semibold tracking-tight">ClinicPilot</span>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        {NAV.map((item) => (
          <button
            key={item.label}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              item.active
                ? "border border-border bg-surface-2 font-medium text-text"
                : "border border-transparent text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            <item.icon className="size-4 shrink-0" strokeWidth={2} />
            <span className="flex-1 text-left">{item.label}</span>
            {item.badge && (
              <span className="rounded-full border border-border bg-surface-1 px-1.5 text-xs tabular-nums text-muted">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
          <div className="flex size-7 items-center justify-center rounded-full border border-border-strong bg-surface-1 text-xs font-semibold">
            P
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">Priya Nair</div>
            <div className="truncate text-[11px] text-muted">Admin</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
