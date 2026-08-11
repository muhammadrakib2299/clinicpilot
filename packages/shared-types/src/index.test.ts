import { describe, expect, it } from "vitest";

import {
  Agent,
  AgentKind,
  AgentStatus,
  FhirId,
  FindAppointmentsQuery,
  FindFreeSlotsQuery,
  PlanCode,
  RescheduleAppointmentInput,
  TaskChannel,
  TaskStatus,
  TraceKind,
  TraceStep,
} from "./index";

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
      "reflection",
      "tool_call",
      "observation",
      "action",
      "escalation",
    ]);
  });

  it("orders trace kinds the way a run actually unfolds", () => {
    // Postgres sorts an enum by declaration order, so this is what an
    // `ORDER BY kind` reads as — and `reflection` sits before the `action` it
    // gates, which is the order it happens in.
    const { options } = TraceKind;
    expect(options.indexOf("reflection")).toBeLessThan(options.indexOf("action"));
    expect(options.indexOf("reason")).toBeLessThan(options.indexOf("reflection"));
  });

  it("covers every billable plan", () => {
    expect(PlanCode.options).toEqual(["free", "pro", "clinic", "enterprise"]);
  });

  it("covers every agent status", () => {
    expect(AgentStatus.options).toEqual(["active", "degraded", "paused"]);
  });

  it("covers every task intake channel", () => {
    expect(TaskChannel.options).toEqual(["web", "sms", "voice", "email"]);
  });

  it("covers every task status", () => {
    expect(TaskStatus.options).toEqual([
      "queued",
      "running",
      "resolved",
      "escalated",
      "failed",
    ]);
  });

  it("orders task statuses so a plain ORDER BY reads as lifecycle progress", () => {
    // Postgres sorts an enum by declaration order, so this ordering is load-
    // bearing for the Task Inbox — not cosmetic.
    const { options } = TaskStatus;
    expect(options.indexOf("queued")).toBeLessThan(options.indexOf("running"));
    expect(options.indexOf("running")).toBeLessThan(options.indexOf("resolved"));
  });
});

describe("FhirId", () => {
  it("accepts a bare id unchanged", () => {
    expect(FhirId.parse("137240399")).toBe("137240399");
  });

  it("strips the resource-type prefix a model tends to supply", () => {
    // The exact input that produced /Appointment/Appointment/137240399 and a
    // 400 on the first live agent run.
    expect(FhirId.parse("Appointment/137240399")).toBe("137240399");
    expect(FhirId.parse("Slot/137240396")).toBe("137240396");
  });

  it("tolerates surrounding whitespace and a leading slash", () => {
    expect(FhirId.parse("  /Patient/137240393 ")).toBe("137240393");
  });

  it("accepts the full R4 id charset", () => {
    expect(FhirId.parse("appt-current.v2")).toBe("appt-current.v2");
  });

  it("rejects a versioned reference rather than silently reading the version", () => {
    // Taking the last segment of Patient/1/_history/2 would address "2".
    expect(FhirId.safeParse("Patient/137240393/_history/2").success).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(FhirId.safeParse("").success).toBe(false);
    expect(FhirId.safeParse("   ").success).toBe(false);
  });

  it("rejects a prefix with the id missing rather than looking up 'Appointment'", () => {
    // Forgiving the trailing slash here would read the resource type as the id
    // and 404 on a resource nobody asked about.
    expect(FhirId.safeParse("Appointment/").success).toBe(false);
    expect(FhirId.safeParse("Patient/137240393/").success).toBe(false);
  });

  it("rejects an id over the spec's 64 characters", () => {
    expect(FhirId.safeParse("a".repeat(65)).success).toBe(false);
  });

  it("names both accepted forms in its error, so the model can self-correct", () => {
    const result = FhirId.safeParse("not a valid id!");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("137240399");
      expect(result.error.issues[0]?.message).toContain("Appointment/137240399");
    }
  });
});

describe("FindAppointmentsQuery", () => {
  it("normalises the patient id and defaults the result count", () => {
    const parsed = FindAppointmentsQuery.parse({ patientId: "Patient/137240393" });

    expect(parsed.patientId).toBe("137240393");
    expect(parsed.count).toBe(20);
  });

  it("coerces count from the string a query parameter actually arrives as", () => {
    expect(FindAppointmentsQuery.parse({ patientId: "1", count: "5" }).count).toBe(5);
  });

  it("caps count, so a model cannot pull the context window full of bundles", () => {
    expect(FindAppointmentsQuery.safeParse({ patientId: "1", count: "5000" }).success).toBe(false);
  });

  it("rejects a status outside the scheduling agent's subset", () => {
    // 'entered-in-error' is real R4 but is not the agent's business.
    const result = FindAppointmentsQuery.safeParse({
      patientId: "1",
      status: "entered-in-error",
    });

    expect(result.success).toBe(false);
  });
});

describe("FindFreeSlotsQuery", () => {
  it("accepts a UTC instant and an offset instant", () => {
    expect(
      FindFreeSlotsQuery.parse({ scheduleId: "Schedule/1", from: "2026-08-13T09:00:00Z" }).from,
    ).toBe("2026-08-13T09:00:00Z");

    expect(
      FindFreeSlotsQuery.safeParse({ scheduleId: "1", from: "2026-08-13T09:00:00+01:00" }).success,
    ).toBe(true);
  });

  it("rejects a malformed instant instead of returning every slot", () => {
    // A bad `start=ge…` bound is ignored server-side, and the unfiltered result
    // looks exactly like a working query.
    expect(FindFreeSlotsQuery.safeParse({ scheduleId: "1", from: "next Tuesday" }).success).toBe(
      false,
    );
    expect(FindFreeSlotsQuery.safeParse({ scheduleId: "1", from: "2026-08-13" }).success).toBe(
      false,
    );
  });
});

describe("RescheduleAppointmentInput", () => {
  const valid = {
    appointmentId: "Appointment/137240399",
    slotId: "Slot/137240396",
    start: "2026-08-18T10:30:00Z",
    end: "2026-08-18T11:00:00Z",
  };

  it("normalises both ids", () => {
    const parsed = RescheduleAppointmentInput.parse(valid);

    expect(parsed.appointmentId).toBe("137240399");
    expect(parsed.slotId).toBe("137240396");
  });

  it("rejects an interval that ends before it starts", () => {
    const result = RescheduleAppointmentInput.safeParse({
      ...valid,
      start: "2026-08-18T11:00:00Z",
      end: "2026-08-18T10:30:00Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["end"]);
  });

  it("rejects a zero-length appointment", () => {
    expect(
      RescheduleAppointmentInput.safeParse({ ...valid, end: valid.start }).success,
    ).toBe(false);
  });
});
