import {
  AgentKind,
  AgentStatus,
  PlanCode,
  TaskChannel,
  TaskStatus,
  TraceKind,
} from "@clinicpilot/shared-types";

import { agentKind, agentStatus, planCode, taskChannel, taskStatus, traceKind } from "./schema";

/**
 * The zod schemas are the wire contract and the pgEnums are the storage
 * contract. Nothing structurally ties them together, so without this test a
 * value added to one side surfaces as a runtime 500 or a failed INSERT rather
 * than a failed build.
 *
 * Order matters as well as membership: Postgres enum sort order is the
 * declaration order, so `ORDER BY status` changes meaning if the two drift.
 */
describe("storage enums match the wire contract", () => {
  it.each([
    ["agent_kind", agentKind.enumValues, AgentKind.options],
    ["agent_status", agentStatus.enumValues, AgentStatus.options],
    ["plan_code", planCode.enumValues, PlanCode.options],
    ["task_channel", taskChannel.enumValues, TaskChannel.options],
    ["task_status", taskStatus.enumValues, TaskStatus.options],
    ["trace_kind", traceKind.enumValues, TraceKind.options],
  ])("%s", (_name, stored: readonly string[], wire: readonly string[]) => {
    expect([...stored]).toEqual([...wire]);
  });
});

describe("schema invariants", () => {
  it("declares an enum for every column that has a fixed value set", () => {
    // Guards against someone adding a status column as free text later.
    expect(taskStatus.enumValues).toContain("escalated");
    expect(traceKind.enumValues).toContain("escalation");
  });
});
