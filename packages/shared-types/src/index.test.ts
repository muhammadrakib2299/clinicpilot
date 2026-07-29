import { describe, expect, it } from "vitest";

import { Agent, AgentKind, AgentStatus, PlanCode, TraceKind, TraceStep } from "./index";

describe("Agent", () => {
  it("defaults configJson so callers never handle undefined config", () => {
    const parsed = Agent.parse({
      id: "ag_sched",
      orgId: "org_northside",
      name: "Scheduling Agent",
      kind: "scheduling",
      status: "active",
    });

    expect(parsed.configJson).toEqual({});
  });

  it("rejects an agent kind outside the shipped fleet", () => {
    const result = Agent.safeParse({
      id: "ag_x",
      orgId: "org_northside",
      name: "Billing Agent",
      kind: "billing",
      status: "active",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const result = Agent.safeParse({
      id: "ag_sched",
      orgId: "org_northside",
      name: "Scheduling Agent",
      kind: "scheduling",
      status: "on_fire",
    });

    expect(result.success).toBe(false);
  });
});

describe("TraceStep", () => {
  it("accepts a step with no token or cost metadata (tool calls have none)", () => {
    const parsed = TraceStep.parse({
      kind: "tool_call",
      label: "Tool · find_availability",
      detail: "GET Slot?schedule=prov-7",
    });

    expect(parsed.tokensIn).toBeUndefined();
    expect(parsed.costUsd).toBeUndefined();
  });

  it("carries token accounting when the step hit the model", () => {
    const parsed = TraceStep.parse({
      kind: "reason",
      label: "Reason",
      detail: "Intent = reschedule.",
      tokensIn: 820,
      tokensOut: 96,
      costUsd: 0.004,
      latencyMs: 640,
    });

    expect(parsed.tokensIn).toBe(820);
    expect(parsed.costUsd).toBeCloseTo(0.004);
  });
});

describe("enums stay in sync with the product surface", () => {
  it("covers every agent in the fleet", () => {
    expect(AgentKind.options).toEqual(["scheduling", "followup", "docqa"]);
  });

  it("covers every trace step the Trace Viewer renders", () => {
    expect(TraceKind.options).toEqual([
      "reason",
      "tool_call",
      "observation",
      "action",
      "escalation",
    ]);
  });

  it("covers every billable plan", () => {
    expect(PlanCode.options).toEqual(["free", "pro", "clinic", "enterprise"]);
  });

  it("covers every agent status", () => {
    expect(AgentStatus.options).toEqual(["active", "degraded", "paused"]);
  });
});
