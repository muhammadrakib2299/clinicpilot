import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useSearchParams } from "react-router-dom";

import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { TraceDrawer } from "@/components/TraceDrawer";
import { AuditPage } from "@/pages/AuditPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotBuiltPage } from "@/pages/NotBuiltPage";
import { QueuePage } from "@/pages/QueuePage";
import { TasksPage } from "@/pages/TasksPage";
import { countEscalations } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { useTheme } from "@/lib/theme";

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
  const { theme, toggle: toggleTheme } = useTheme();
  const [navOpen, setNavOpen] = useState(false);

  /**
   * Which trace is open lives in the URL, not in component state.
   *
   * It was `useState`, which made the single most demo-able thing in the
   * product unlinkable: you could not send a colleague the run where the agent
   * escalated, bookmark the one you were mid-way through reading, or reload
   * the page without losing it. A trace is a record of something that
   * happened — records get addresses.
   *
   * A search param rather than a `/tasks/:id` route because the drawer overlays
   * whichever screen you were on, and that context is worth keeping in the
   * link. Opening pushes a history entry and closing replaces it, so Back
   * lands on the page as it was before the drawer rather than reopening it.
   */
  const [params, setParams] = useSearchParams();
  const openTaskId = params.get("trace");

  const setOpenTaskId = useCallback(
    (taskId: string | null) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (taskId) next.set("trace", taskId);
          else next.delete("trace");
          return next;
        },
        { replace: !taskId },
      );
    },
    [setParams],
  );

  // The badge is loaded here rather than in the Sidebar so acting on the queue
  // can refresh it — a count that stays at 4 after you clear it is worse than
  // no count at all.
  // Polled, because this is the closest thing the app has to a notification:
  // an escalation raised by a run nobody is watching should reach the sidebar
  // without the user reloading the page to find out.
  const { data: queued, reload: reloadQueue } = useApi(countEscalations, [], {
    pollMs: 30_000,
  });

  // Escape closes the drawer. Without it the only way out on a phone is to hit
  // the exact 36px button it is sitting under.
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text">
      {/* Ten nav links sit between the page load and the content. */}
      <a
        href="#main"
        className="skip-link rounded-md border border-border-strong bg-surface-1 px-3 py-2 text-sm font-medium"
      >
        Skip to main content
      </a>

      {/* Only ever visible under the drawer — `lg:hidden` because from `lg` up
          the sidebar is in normal flow and there is nothing to dim. */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          aria-hidden
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      <Sidebar
        openEscalations={queued?.open ?? 0}
        open={navOpen}
        onNavigate={() => setNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          theme={theme}
          onToggleTheme={toggleTheme}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((value) => !value)}
        />
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<DashboardPage onOpenTask={setOpenTaskId} />} />
            <Route path="/tasks" element={<TasksPage onOpenTask={setOpenTaskId} />} />
            <Route
              path="/queue"
              element={
                <QueuePage
                  onOpenTask={(taskId) => {
                    setOpenTaskId(taskId);
                    reloadQueue();
                  }}
                />
              }
            />
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
