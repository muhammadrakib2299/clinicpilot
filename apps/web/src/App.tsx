import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { FleetOverview } from "@/components/FleetOverview";
import { TraceDrawer } from "@/components/TraceDrawer";

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [traceOpen, setTraceOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
        <main className="flex-1 overflow-y-auto">
          <FleetOverview onOpenTrace={() => setTraceOpen(true)} />
        </main>
      </div>
      <TraceDrawer open={traceOpen} onClose={() => setTraceOpen(false)} />
    </div>
  );
}
