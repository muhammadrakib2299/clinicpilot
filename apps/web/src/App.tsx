import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { TraceDrawer } from "@/components/TraceDrawer";
import { AuditPage } from "@/pages/AuditPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotBuiltPage } from "@/pages/NotBuiltPage";
import { TasksPage } from "@/pages/TasksPage";
import { AuthProvider, useAuth } from "@/lib/auth";

/** Screens the sidebar advertises but that this phase does not implement. */
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
    phase: "Phase 3",
    description:
      "n8n workflow runs and their history. n8n is running in the stack at :5678, but no workflow is wired to an agent yet.",
  },
  {
    path: "/fhir",
    title: "FHIR Explorer",
    phase: "Phase 4",
    description:
      "Browse Patients, Appointments and Slots with a raw resource viewer. The typed FHIR client exists and the agent uses it through the gateway; there is no browsing UI.",
  },
  {
    path: "/analytics",
    title: "Analytics",
    phase: "Phase 4",
    description:
      "Charts for tasks over time, success vs escalation, and spend per agent. The underlying data is already recorded in traces and llm_usage.",
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
    phase: "Phase 2.5",
    description:
      "Organisation profile, team invitations and integrations. Users, roles and memberships exist in the database and are seeded; there is no UI to manage them.",
  },
];

function Shell() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
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
            <Route path="/audit" element={<AuditPage />} />
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
  );
}

/**
 * Signed out shows the login screen and nothing else.
 *
 * Deliberately not a redirect to `/login`: there is no route in this app worth
 * showing without a session, so the whole shell — sidebar, topbar, drawer — is
 * simply not mounted. Nothing can fire a request that 401s while the user
 * looks at a half-rendered dashboard.
 *
 * `loading` covers the gap where a stored token is being verified. Rendering
 * the login form during it would flash a sign-in screen at somebody who is
 * already signed in.
 */
function Gate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">
        Loading…
      </div>
    );
  }

  return user ? <Shell /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  );
}
