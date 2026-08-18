import type {
  AnalyticsSummary,
  AuditQueryInput,
  DocumentSummary,
  EscalationStatus,
  EscalationSummary,
  MessageSummary,
  SessionUser,
  UserRole,
} from "@clinicpilot/shared-types";

import type { AgentKind, MessageStatus, TraceKind } from "@/lib/types";
import { clearToken, getToken } from "@/lib/session";

const API_URL = import.meta.env["VITE_API_URL"] ?? "http://localhost:8080";

/** Fired on any 401 so the app can drop to the login screen from anywhere. */
export const SESSION_EXPIRED = "clinicpilot:session-expired";

export interface Task {
  id: string;
  agentId: string;
  channel: string;
  input: string;
  status: "queued" | "running" | "resolved" | "escalated" | "failed";
  outcome: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** A persisted trace step, as the gateway serves and broadcasts it. */
export interface LiveTraceStep {
  id: string;
  taskId: string;
  stepNo: number;
  kind: TraceKind;
  label: string;
  detail: string;
  content: Record<string, unknown> | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  createdAt: string;
}

/**
 * One place that attaches the session and one place that notices it has gone.
 *
 * Every call routes through here. A 401 clears the token and announces it, so
 * an expired session drops to the login screen from whichever screen happened
 * to notice — rather than each caller rendering its own "could not reach the
 * API" and leaving the user stuck on a page that will never load.
 */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED));
  }

  return res;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { message?: string; issues?: Array<{ message: string }> }
      | null;

    // Field-level detail when the gateway sent it; the bare status is the
    // least useful thing we could show.
    const detail = body?.issues?.map((issue) => issue.message).join("; ");
    throw new Error(detail || body?.message || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── Session ─────────────────────────────────────────────────────────────────

export interface LoginResult {
  token: string;
  user: SessionUser;
}

export async function login(email: string, password: string) {
  return json<LoginResult>(
    await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
}

export async function fetchMe() {
  return json<SessionUser>(await request("/api/auth/me"));
}

export async function switchTenant(tenantId: string) {
  return json<LoginResult>(
    await request("/api/auth/switch-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    }),
  );
}

export async function logout() {
  // Best-effort: the token is stateless, so the client discarding it is what
  // actually ends the session. This is for the audit entry.
  await request("/api/auth/logout", { method: "POST" }).catch(() => undefined);
}

// ── Audit ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

function auditParams(filters: AuditQueryInput): string {
  const params = new URLSearchParams();
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.action) params.set("action", filters.action);
  if (filters.resourceType) params.set("resourceType", filters.resourceType);
  return params.toString();
}

export async function listAudit(filters: AuditQueryInput = {}) {
  return json<AuditEntry[]>(await request(`/api/audit?${auditParams(filters)}`));
}

/**
 * Downloads rather than returning the CSV, because the export is streamed
 * straight to a file — and because doing it through `request` keeps the
 * Authorization header on it, which a plain `<a href>` could not.
 */
export async function downloadAuditCsv(filters: AuditQueryInput = {}): Promise<void> {
  const res = await request(`/api/audit/export.csv?${auditParams(filters)}`);
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);

  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "clinicpilot-audit.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export type {
  AnalyticsSummary,
  DocumentSummary,
  EscalationStatus,
  EscalationSummary,
  MessageSummary,
  SessionUser,
  UserRole,
};

export async function createTask(input: string, agentKind: AgentKind = "scheduling") {
  return json<Task>(
    await request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentKind, input }),
    }),
  );
}

export async function getTask(id: string) {
  return json<{ task: Task; steps: LiveTraceStep[] }>(await request(`/api/tasks/${id}`));
}

export async function listTasks() {
  return json<Task[]>(await request("/api/tasks"));
}

/** ws:// or wss:// depending on how the API itself is served. */
export function traceSocketUrl(): string {
  return `${API_URL.replace(/^http/, "ws")}/ws/traces`;
}

export interface AgentSummary {
  id: string;
  kind: AgentKind;
  name: string;
  status: "active" | "degraded" | "paused";
  tasksToday: number;
  totalTasks: number;
  /** null when nothing has finished — not 0, which would read as "0% success". */
  successRate: number | null;
  escalationRate: number | null;
  costPerTask: number | null;
  totalCostUsd: number;
}

export interface OverviewKpis {
  tasksTotal: number;
  tasksToday: number;
  tasksOpen: number;
  resolved: number;
  escalated: number;
  failed: number;
  successRate: number | null;
  totalCostUsd: number;
  costPerResolvedTask: number | null;
  modelCalls: number;
  tokensIn: number;
  tokensOut: number;
}

export interface ActivityItem {
  id: string;
  taskId: string;
  kind: TraceKind;
  label: string;
  detail: string;
  createdAt: string;
  agentName: string;
}

export async function listAgents() {
  return json<AgentSummary[]>(await request("/api/agents"));
}

// ── The human queue ─────────────────────────────────────────────────────────

export async function listEscalations(status?: EscalationStatus) {
  const query = status ? `?status=${status}` : "";
  return json<EscalationSummary[]>(await request(`/api/escalations${query}`));
}

export async function countEscalations() {
  return json<{ open: number; acknowledged: number }>(await request("/api/escalations/count"));
}

export async function acknowledgeEscalation(id: string) {
  return json<EscalationSummary>(
    await request(`/api/escalations/${id}/acknowledge`, { method: "POST" }),
  );
}

export async function resolveEscalation(id: string, resolution: string) {
  return json<EscalationSummary>(
    await request(`/api/escalations/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution }),
    }),
  );
}

export async function getOverview() {
  return json<{ kpis: OverviewKpis; activity: ActivityItem[] }>(
    await request("/api/overview"),
  );
}

// ── The corpus ──────────────────────────────────────────────────────────────

/**
 * What the Document Q&A agent can answer from.
 *
 * Not role-gated, matching the gateway: these are the practice's own policies,
 * and RLS is what keeps one clinic's corpus out of another's.
 */
export async function listDocuments() {
  return json<DocumentSummary[]>(await request("/api/documents"));
}

// ── Outbound patient contact ────────────────────────────────────────────────

/**
 * Everything the Follow-up Agent drafted, newest first.
 *
 * The gateway defaults to 50 and caps nothing else, so the limit is the only
 * paging this has until `09-TODO`'s pagination item is paid.
 */
export async function listMessages(limit?: number) {
  const query = limit ? `?limit=${limit}` : "";
  return json<MessageSummary[]>(await request(`/api/messages${query}`));
}

/** Narrower than `MessageSummary["status"]`, which the gateway types as `string`. */
export function messageStatusOf(message: MessageSummary): MessageStatus {
  return message.status === "sent" || message.status === "failed" ? message.status : "drafted";
}

// ── Analytics ───────────────────────────────────────────────────────────────

/**
 * Every panel on the Analytics screen, over one window.
 *
 * One call rather than one per panel, because they are all scoped by the same
 * `days`: separate requests would let the tiles and the charts drift onto
 * different windows the moment one of them refetched on its own.
 */
export async function getAnalytics(days: number) {
  return json<AnalyticsSummary>(await request(`/api/analytics?days=${days}`));
}
