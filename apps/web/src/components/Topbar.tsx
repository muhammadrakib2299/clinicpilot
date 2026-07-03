import { ChevronDown, Bell, Sun, Moon, Search } from "lucide-react";
import { ORG } from "@/data/mock";

export function Topbar({ theme, onToggleTheme }: { theme: "dark" | "light"; onToggleTheme: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface-1 px-4">
      <div className="flex items-center gap-3">
        <button className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium hover:border-border-strong">
          <span className="size-2 rounded-sm bg-accent" />
          {ORG.name}
          <span className="rounded border border-border bg-surface-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
            {ORG.plan}
          </span>
          <ChevronDown className="size-3.5 text-muted" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted md:flex">
          <Search className="size-3.5" />
          <span className="pr-8">Search agents, tasks…</span>
          <kbd className="rounded border border-border bg-surface-1 px-1.5 text-[10px]">⌘K</kbd>
        </div>
        <button
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          className="flex size-9 items-center justify-center rounded-md border border-border bg-surface-2 text-muted hover:text-text"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <button
          aria-label="Notifications"
          className="relative flex size-9 items-center justify-center rounded-md border border-border bg-surface-2 text-muted hover:text-text"
        >
          <Bell className="size-4" />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-danger" />
        </button>
      </div>
    </header>
  );
}
