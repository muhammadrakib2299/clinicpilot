/**
 * Mock data for the Fleet Overview shell.
 * Replaced by live API + WebSocket streams in Phase 1.
 * All data is synthetic — no real PHI.
 */

export type AgentStatus = "active" | "degraded" | "paused";
export type AgentKind = "scheduling" | "followup" | "docqa";
export type TraceKind = "reason" | "tool_call" | "observation" | "action" | "escalation";

export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  status: AgentStatus;
  tasksToday: number;
  successRate: number; // 0..1
  escalationRate: number; // 0..1
  costPerTask: number; // usd
  spark: number[];
}

export interface Kpi {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
  spark?: number[];
}

export interface ActivityItem {
  id: string;
  time: string;
  kind: TraceKind;
  agent: string;
  text: string;
}

export interface TraceStep {
  kind: TraceKind;
  label: string;
  detail: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs?: number;
}

export const ORG = { name: "Northside Family Clinic", plan: "Clinic" };

export const KPIS: Kpi[] = [
  { label: "Appointments booked", value: "128", delta: "+12%", trend: "up", spark: [8, 10, 9, 12, 14, 13, 18, 22] },
  { label: "Follow-ups sent", value: "342", delta: "+8%", trend: "up", spark: [30, 34, 31, 40, 44, 41, 48, 52] },
  { label: "No-show rate", value: "11%", delta: "-4pp", trend: "down", spark: [19, 18, 17, 15, 14, 13, 12, 11] },
  { label: "Calls deflected", value: "76%", delta: "+6pp", trend: "up", spark: [60, 63, 66, 68, 70, 72, 74, 76] },
];

export const AGENTS: Agent[] = [
  {
    id: "ag_sched",
    name: "Scheduling Agent",
    kind: "scheduling",
    status: "active",
    tasksToday: 54,
    successRate: 0.92,
    escalationRate: 0.08,
    costPerTask: 0.031,
    spark: [12, 18, 14, 22, 19, 26, 24, 31],
  },
  {
    id: "ag_follow",
    name: "Follow-up Agent",
    kind: "followup",
    status: "active",
    tasksToday: 118,
    successRate: 0.96,
    escalationRate: 0.04,
    costPerTask: 0.012,
    spark: [40, 44, 41, 48, 52, 49, 58, 61],
  },
  {
    id: "ag_docqa",
    name: "Document Q&A Agent",
    kind: "docqa",
    status: "degraded",
    tasksToday: 37,
    successRate: 0.89,
    escalationRate: 0.11,
    costPerTask: 0.021,
    spark: [10, 14, 12, 18, 15, 20, 17, 22],
  },
];

export const ACTIVITY: ActivityItem[] = [
  { id: "a1", time: "09:41", kind: "action", agent: "Scheduling", text: "Booked appointment for patient #40021 (Thu → next Tue 10:30)" },
  { id: "a2", time: "09:39", kind: "action", agent: "Follow-up", text: "Sent post-visit check-in SMS ×12" },
  { id: "a3", time: "09:37", kind: "escalation", agent: "Follow-up", text: "Clinical question detected → routed to human queue" },
  { id: "a4", time: "09:35", kind: "observation", agent: "Document Q&A", text: "Answered discharge-policy query (2 citations)" },
  { id: "a5", time: "09:32", kind: "tool_call", agent: "Scheduling", text: "FHIR read: Slot availability for provider #7" },
  { id: "a6", time: "09:30", kind: "reason", agent: "Scheduling", text: "Planned reschedule: verify slot → confirm → notify" },
];

export const SAMPLE_TRACE: { task: string; steps: TraceStep[] } = {
  task: '"Hi, I need to move my Thursday appointment to next week."',
  steps: [
    { kind: "reason", label: "Reason", detail: "Intent = reschedule. Need current appointment + open slots before proposing a time.", tokensIn: 820, tokensOut: 96, costUsd: 0.004, latencyMs: 640 },
    { kind: "tool_call", label: "Tool · find_appointment", detail: "GET Appointment?patient=40021&status=booked", latencyMs: 210 },
    { kind: "observation", label: "Observation", detail: "Found Appointment/9f2 — Thu 14:00 with Dr. Chen.", tokensIn: 240, tokensOut: 40, costUsd: 0.001, latencyMs: 120 },
    { kind: "tool_call", label: "Tool · find_availability", detail: "GET Slot?schedule=prov-7&start=ge2026-07-06", latencyMs: 260 },
    { kind: "observation", label: "Observation", detail: "3 open slots next week; earliest Tue 10:30.", tokensIn: 300, tokensOut: 52, costUsd: 0.001, latencyMs: 130 },
    { kind: "action", label: "Action · reschedule_appointment", detail: "PUT Appointment/9f2 → Tue 10:30; drafted confirmation SMS.", tokensIn: 410, tokensOut: 120, costUsd: 0.006, latencyMs: 480 },
  ],
};
