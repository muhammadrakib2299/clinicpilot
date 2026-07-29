import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { FleetOverview } from "@/components/FleetOverview";
import { TraceDrawer } from "@/components/TraceDrawer";
import { listTasks } from "@/lib/api";

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  /** Agent cards have no task of their own, so they open the most recent one. */
  async function openLatestTrace() {
    try {
      const tasks = await listTasks();
      if (tasks[0]) setOpenTaskId(tasks[0].id);
    } catch {
      /* the composer surfaces API errors; a failed peek is not worth a toast */
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
        <main className="flex-1 overflow-y-auto">
          <FleetOverview onOpenTrace={openLatestTrace} onTaskCreated={setOpenTaskId} />
        </main>
      </div>
      <TraceDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </div>
  );
}
