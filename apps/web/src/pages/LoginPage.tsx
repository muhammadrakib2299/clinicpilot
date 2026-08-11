import { useState } from "react";
import { Activity, AlertTriangle, LoaderCircle } from "lucide-react";

import { useAuth } from "@/lib/auth";

/**
 * The demo accounts, listed on the page.
 *
 * Printing credentials in the UI is normally indefensible. Here the entire
 * point of the deployment is that a stranger can click it, the data is
 * synthetic, and hiding them would only mean putting them in a README the
 * same stranger has to go and find. They are listed by role because *which*
 * account you pick is the interesting part — it changes what the app lets you
 * do.
 */
const DEMO_ACCOUNTS = [
  { email: "admin@demo.clinicpilot.io", role: "Admin", can: "everything, including the audit log" },
  { email: "clinician@demo.clinicpilot.io", role: "Clinician", can: "two clinics — try the switcher" },
  { email: "coordinator@demo.clinicpilot.io", role: "Coordinator", can: "create and run tasks" },
  { email: "viewer@demo.clinicpilot.io", role: "Viewer", can: "read only" },
];

const DEMO_PASSWORD = "clinicpilot";

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState(DEMO_ACCOUNTS[0]!.email);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await signIn(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md border border-border-strong bg-surface-2">
            <Activity className="size-4 text-accent" strokeWidth={2.5} />
          </div>
          <span className="text-base font-semibold tracking-tight">ClinicPilot</span>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-lg border border-border bg-surface-1 p-5"
        >
          <div>
            <h1 className="text-sm font-semibold">Sign in</h1>
            <p className="mt-1 text-xs text-muted">Synthetic demo data only. No real PHI.</p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs text-muted">Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-border-strong"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-muted">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-border-strong"
            />
          </label>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-danger/40 bg-surface-2 p-2.5 text-xs text-danger"
            >
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50"
          >
            {submitting && <LoaderCircle className="size-3.5 animate-spin" />}
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="rounded-lg border border-border bg-surface-1 p-4">
          <h2 className="text-xs font-semibold text-muted">Demo accounts</h2>
          <p className="mt-1 text-[11px] text-muted">
            Password <code className="rounded bg-surface-2 px-1 font-mono">{DEMO_PASSWORD}</code>{" "}
            for all of them. The role changes what you can do.
          </p>
          <ul className="mt-3 space-y-1.5">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(DEMO_PASSWORD);
                  }}
                  className="flex w-full items-baseline gap-2 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-surface-2"
                >
                  <span className="w-20 shrink-0 text-xs font-medium">{account.role}</span>
                  <span className="truncate text-[11px] text-muted">{account.can}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
