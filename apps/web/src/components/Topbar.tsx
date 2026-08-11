import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, LogOut, Moon, Sun } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";

/**
 * Organisation switcher.
 *
 * Was a fixture reading a hardcoded org name from `mock.ts`. It now lists the
 * tenants the signed-in user actually belongs to, and switching mints a new
 * token — the tenant is a claim inside it, so the server will not accept the
 * old one for a different organisation.
 */
function TenantSwitcher() {
  const { user, switchTenant } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const active = user.memberships.find((m) => m.tenantId === user.tenantId);
  const only = user.memberships.length === 1;

  return (
    <div ref={container} className="relative">
      <button
        onClick={() => !only && setOpen((value) => !value)}
        disabled={only || busy}
        aria-haspopup={only ? undefined : "menu"}
        aria-expanded={only ? undefined : open}
        title={only ? "You belong to one organisation" : "Switch organisation"}
        className={cn(
          "flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium",
          !only && "hover:border-border-strong",
        )}
      >
        <span className="size-2 rounded-sm bg-accent" />
        {active?.tenantName ?? "—"}
        <span className="rounded border border-border bg-surface-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
          {user.role}
        </span>
        {!only && <ChevronDown className="size-3.5 text-muted" />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 w-64 rounded-md border border-border bg-surface-1 p-1 shadow-lg"
        >
          {user.memberships.map((membership) => (
            <button
              key={membership.tenantId}
              role="menuitem"
              disabled={busy}
              onClick={async () => {
                setOpen(false);
                if (membership.tenantId === user.tenantId) return;
                setBusy(true);
                try {
                  await switchTenant(membership.tenantId);
                } finally {
                  setBusy(false);
                }
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2 disabled:opacity-50"
            >
              <Building2 className="size-3.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{membership.tenantName}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted">
                {membership.role}
              </span>
              {membership.tenantId === user.tenantId && (
                <Check className="size-3.5 shrink-0 text-accent" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Topbar({
  theme,
  onToggleTheme,
}: {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const { user, signOut } = useAuth();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface-1 px-4">
      <TenantSwitcher />

      <div className="flex items-center gap-2">
        {/* The search box and notification bell that used to sit here were
            chrome with nothing behind them. Removed rather than left looking
            clickable — the placeholder pages exist for features that are
            coming, not for controls that do nothing. */}
        <span className="hidden text-xs text-muted md:inline">{user?.email}</span>

        <button
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          className="flex size-9 items-center justify-center rounded-md border border-border bg-surface-2 text-muted hover:text-text"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>

        <button
          onClick={() => void signOut()}
          aria-label="Sign out"
          title="Sign out"
          className="flex size-9 items-center justify-center rounded-md border border-border bg-surface-2 text-muted hover:text-text"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}
