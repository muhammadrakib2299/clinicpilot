import type { AgentKind, TraceKind } from "@/data/mock";

const API_URL = import.meta.env["VITE_API_URL"] ?? "http://localhost:8080";

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

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function createTask(input: string, agentKind: AgentKind = "scheduling") {
  return json<Task>(
    await fetch(`${API_URL}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentKind, input }),
    }),
  );
}

export async function getTask(id: string) {
  return json<{ task: Task; steps: LiveTraceStep[] }>(await fetch(`${API_URL}/api/tasks/${id}`));
}

export async function listTasks() {
  return json<Task[]>(await fetch(`${API_URL}/api/tasks`));
}

/** ws:// or wss:// depending on how the API itself is served. */
export function traceSocketUrl(): string {
  return `${API_URL.replace(/^http/, "ws")}/ws/traces`;
}
