import {
  Activity,
  BarChart3,
  Bot,
  CreditCard,
  Database,
  Inbox,
  LayoutDashboard,
  ScrollText,
  Settings,
  Workflow,
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/cn";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", to: "/" },
  { icon: Bot, label: "Agents", to: "/agents" },
  { icon: Inbox, label: "Tasks", to: "/tasks" },
  { icon: Workflow, label: "Workflows", to: "/workflows" },
  { icon: Database, label: "FHIR Explorer", to: "/fhir" },
  { icon: BarChart3, label: "Analytics", to: "/analytics" },
  { icon: ScrollText, label: "Audit Log", to: "/audit" },
  { icon: CreditCard, label: "Billing", to: "/billing" },
  { icon: Settings, label: "Settings", to: "/settings" },
];

export function Sidebar({ openTaskCount }: { openTaskCount?: number }) {
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
          <NavLink
            key={item.label}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border border-border bg-surface-2 font-medium text-text"
                  : "border border-transparent text-muted hover:bg-surface-2 hover:text-text",
              )
            }
          >
            <item.icon className="size-4 shrink-0" strokeWidth={2} />
            <span className="flex-1 text-left">{item.label}</span>
            {item.label === "Tasks" && openTaskCount ? (
              <span className="rounded-full border border-border bg-surface-1 px-1.5 text-xs tabular-nums text-muted">
                {openTaskCount}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
          <div className="flex size-7 items-center justify-center rounded-full border border-border-strong bg-surface-1 text-xs font-semibold">
            P
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">Priya Nair</div>
            {/* No auth yet — this is the seeded demo persona, not a session. */}
            <div className="truncate text-[11px] text-muted">Admin · demo</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
