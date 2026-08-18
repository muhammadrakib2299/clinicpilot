import {
  Activity,
  BarChart3,
  Bot,
  BookText,
  CreditCard,
  Database,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  ScrollText,
  Settings,
  Workflow,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import type { UserRole } from "@clinicpilot/shared-types/roles";

import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";

/**
 * `minRole` hides a destination the API would refuse anyway.
 *
 * Hiding is not the enforcement — the guard on the server is. This exists so
 * the nav does not advertise a door that opens onto a 403, which is the same
 * reason the unbuilt screens render an honest "not built yet" page rather than
 * being silently absent.
 */
const NAV: Array<{
  icon: typeof LayoutDashboard;
  label: string;
  to: string;
  minRole?: UserRole;
}> = [
  { icon: LayoutDashboard, label: "Dashboard", to: "/" },
  { icon: Bot, label: "Agents", to: "/agents" },
  { icon: Inbox, label: "Tasks", to: "/tasks" },
  { icon: LifeBuoy, label: "Human queue", to: "/queue" },
  // What two of the three agents draw on and produce. Both APIs shipped in
  // Phase 3 with no screen at all, which made the Follow-up Agent's entire
  // output invisible inside the product it is part of.
  { icon: MessageSquare, label: "Patient messages", to: "/messages" },
  { icon: BookText, label: "Knowledge base", to: "/knowledge" },
  { icon: Workflow, label: "Workflows", to: "/workflows" },
  { icon: Database, label: "FHIR Explorer", to: "/fhir" },
  { icon: BarChart3, label: "Analytics", to: "/analytics" },
  { icon: ScrollText, label: "Audit Log", to: "/audit", minRole: "admin" },
  { icon: CreditCard, label: "Billing", to: "/billing", minRole: "admin" },
  { icon: Settings, label: "Settings", to: "/settings", minRole: "admin" },
];

const INITIALS = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

/**
 * One sidebar, two layouts.
 *
 * Not two components and not two renders — a second copy for mobile would put
 * every nav link in the document twice, which doubles them for a screen reader
 * as surely as it does for `getByRole`.
 *
 * Closed-on-mobile is `invisible`, not just translated off-screen. An element
 * pushed out of the viewport with `translate` is still focusable and still in
 * the accessibility tree, so tabbing from the page content would walk into a
 * menu nobody can see. `visibility: hidden` removes it from both, and unlike
 * `display: none` it still animates.
 */
export function Sidebar({
  openEscalations,
  open = false,
  onNavigate,
}: {
  openEscalations?: number;
  open?: boolean;
  onNavigate?: () => void;
}) {
  const { user, can } = useAuth();
  const visible = NAV.filter((item) => !item.minRole || can(item.minRole));
  return (
    <aside
      id="sidebar"
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface-1",
        "transition-[transform,visibility] duration-200 ease-out",
        "lg:static lg:z-auto lg:w-60 lg:shrink-0 lg:visible lg:translate-x-0",
        open ? "visible translate-x-0" : "invisible -translate-x-full",
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="flex size-7 items-center justify-center rounded-md border border-border-strong bg-surface-2">
          <Activity className="size-4 text-accent" strokeWidth={2.5} />
        </div>
        <span className="text-sm font-semibold tracking-tight">ClinicPilot</span>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {visible.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.to === "/"}
            onClick={onNavigate}
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
            {/* The one number in the nav, because it is the one that means
                somebody has to do something. It is styled as a warning rather
                than as a neutral count for the same reason. */}
            {item.to === "/queue" && openEscalations ? (
              <span className="rounded-full border border-warning/40 bg-surface-1 px-1.5 text-xs font-medium tabular-nums text-warning">
                {openEscalations}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
          <div className="flex size-7 items-center justify-center rounded-full border border-border-strong bg-surface-1 text-xs font-semibold">
            {user ? INITIALS(user.name) : "?"}
          </div>
          <div className="min-w-0 flex-1">
            {/* A real session now, not the seeded persona this used to hardcode. */}
            <div className="truncate text-xs font-medium">{user?.name ?? "Not signed in"}</div>
            <div className="truncate text-xs capitalize text-muted">{user?.role}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
