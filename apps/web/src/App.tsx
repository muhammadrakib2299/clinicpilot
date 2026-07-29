import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { TraceDrawer } from "@/components/TraceDrawer";
import { DashboardPage } from "@/pages/DashboardPage";
import { NotBuiltPage } from "@/pages/NotBuiltPage";
import { TasksPage } from "@/pages/TasksPage";

/** Screens the sidebar advertises but that Phase 1 does not implement. */
const PLACEHOLDERS = [
  {
    path: "/agents",
    title: "Agents",
    phase: "Phase 3",
    description:
      "Per-agent configuration, versioning and start/stop. Today the fleet is seeded and its live stats are on the Dashboard.",
  },
  {
    path: "/workflows",
    title: "Workflows",
    phase: "Phase 1–3",
    description:
      "n8n workflow runs and their history. n8n is running in the stack at :5678, but no workflow is wired to an agent yet.",
  },
  {
    path: "/fhir",
    title: "FHIR Explorer",
    phase: "Phase 4",
    description:
      "Browse Patients, Appointments and Slots with a raw resource viewer. The typed FHIR client exists and the agent uses it; there is no browsing UI.",
  },
  {
    path: "/analytics",
    title: "Analytics",
    phase: "Phase 4",
    description:
      "Charts for tasks over time, success vs escalation, and spend per agent. The underlying data is already recorded in traces and llm_usage.",
  },
  {
    path: "/audit",
    title: "Audit Log",
    phase: "Phase 2",
    description:
      "Append-only record of every action, tool call and data access, filterable and exportable. Arrives with RBAC and row-level security.",
  },
  {
    path: "/billing",
    title: "Billing",
    phase: "Phase 2.5",
    description:
      "Plans, Stripe checkout, usage-vs-quota and metering. Spend is already tracked per model call; nothing is enforced or charged.",
  },
  {
    path: "/settings",
    title: "Settings",
    phase: "Phase 2",
    description: "Organisation, team and integration settings. Requires auth, which is not built.",
  },
];

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-bg text-text">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            theme={theme}
            onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          />
          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<DashboardPage onOpenTask={setOpenTaskId} />} />
              <Route path="/tasks" element={<TasksPage onOpenTask={setOpenTaskId} />} />
              {PLACEHOLDERS.map((page) => (
                <Route
                  key={page.path}
                  path={page.path}
                  element={
                    <NotBuiltPage
                      title={page.title}
                      phase={page.phase}
                      description={page.description}
                    />
                  }
                />
              ))}
              <Route
                path="*"
                element={
                  <NotBuiltPage
                    title="Not found"
                    phase="404"
                    description="That page does not exist. Use the sidebar to get back."
                  />
                }
              />
            </Routes>
          </main>
        </div>
        <TraceDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      </div>
    </BrowserRouter>
  );
}
