import { useState } from "react";
import { Download, ShieldAlert } from "lucide-react";
import type { AuditQueryInput } from "@clinicpilot/shared-types";

import { Card } from "@/components/primitives";
import { downloadAuditCsv, listAudit, type AuditEntry } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";

/**
 * Actions that change something, highlighted.
 *
 * An audit log is mostly reads, and a reviewer scanning one is looking for the
 * writes. Same reasoning as the Trace Viewer colouring `action` differently
 * from `tool_call`.
 */
const MUTATING = /\.(create|update|delete|write|reschedule|export|switch_tenant)$/;

function ActionCell({ action }: { action: string }) {
  return (
    <span
      className={cn(
        "font-mono text-xs",
        MUTATING.test(action) ? "font-medium text-warning" : "text-text",
      )}
    >
      {action}
    </span>
  );
}

export function AuditPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useState<AuditQueryInput>({});
  const [applied, setApplied] = useState<AuditQueryInput>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data, error, loading, reload } = useApi<AuditEntry[]>(
    () => listAudit(applied),
    [JSON.stringify(applied)],
  );

  // The API refuses this for anyone below admin anyway; saying so here beats
  // rendering an empty table and a 403 the user has to interpret.
  if (!can("admin")) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card className="flex items-start gap-3 p-6">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <h1 className="text-sm font-semibold">Admins only</h1>
            <p className="mt-1 text-sm text-muted">
              The audit log shows every user&rsquo;s activity across the organisation, so it is
              restricted to administrators. Sign in as an admin to view it.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const entries = data ?? [];

  const onExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadAuditCsv(applied);
      // Exporting is itself an audited action, so the table it came from is
      // now one row out of date.
      reload();
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted">
            Append-only. The database refuses updates and deletes, so this is a record rather than
            a log.
          </p>
        </div>
        <button
          onClick={onExport}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-text disabled:opacity-50"
        >
          <Download className="size-3.5" />
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      <Card className="p-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(filters);
          }}
        >
          {(
            [
              ["actor", "Actor email"],
              ["action", "Action"],
              ["resourceType", "Resource type"],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="space-y-1.5">
              <span className="block text-xs text-muted">{label}</span>
              <input
                value={filters[field] ?? ""}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, [field]: event.target.value }))
                }
                className="w-48 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus:border-border-strong"
              />
            </label>
          ))}

          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90"
          >
            Filter
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters({});
              setApplied({});
            }}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-text"
          >
            Clear
          </button>
        </form>
      </Card>

      {(error || exportError) && (
        <Card className="border-danger/40 p-4 text-sm text-danger">{error ?? exportError}</Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Resource</th>
                <th className="px-4 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted tnum">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    {/* `system` is a real value, not a missing one — the AI
                        service acts with no user, and attributing its FHIR
                        reads to whoever submitted the task would be a lie. */}
                    <span className={cn("text-xs", !entry.actorName && "italic text-muted")}>
                      {entry.actorName ?? entry.actorEmail ?? "system"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <ActionCell action={entry.action} />
                  </td>
                  <td className="max-w-[24rem] truncate px-4 py-2.5 text-xs text-muted">
                    {entry.resourceType}
                    {entry.resourceId ? ` · ${entry.resourceId}` : ""}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{entry.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && <p className="p-4 text-xs text-muted">Loading…</p>}
        {!loading && entries.length === 0 && !error && (
          <p className="p-4 text-xs text-muted">
            Nothing matches. Sign in, create a task, or run an agent — every one of those writes a
            row here.
          </p>
        )}
      </Card>
    </div>
  );
}
