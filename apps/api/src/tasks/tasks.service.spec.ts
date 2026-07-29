import { isUniqueViolation, toTraceStepPayload } from "./tasks.service";

describe("isUniqueViolation", () => {
  it("matches a bare driver error", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("matches through Drizzle's wrapper, where the driver error is the cause", () => {
    // Drizzle 0.45 throws DrizzleQueryError wrapping the pg error, so a
    // top-level `code` check silently misses every constraint violation and
    // they all surface as 500s.
    const wrapped = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "traces_task_step_key",
      }),
    });

    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("matches through more than one layer of wrapping", () => {
    const outer = { cause: { cause: { code: "23505" } } };

    expect(isUniqueViolation(outer)).toBe(true);
  });

  it("does not match a different constraint failure", () => {
    // 23503 is foreign_key_violation — a different bug with a different fix.
    expect(isUniqueViolation({ cause: { code: "23503" } })).toBe(false);
  });

  it("does not match an ordinary error", () => {
    expect(isUniqueViolation(new Error("connection lost"))).toBe(false);
  });

  it("handles null, undefined and primitives without throwing", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  it("gives up rather than looping forever on a self-referential cause", () => {
    const cyclic: { code?: string; cause?: unknown } = { code: "other" };
    cyclic.cause = cyclic;

    expect(isUniqueViolation(cyclic)).toBe(false);
  });
});

describe("toTraceStepPayload", () => {
  const row = {
    id: "row-1",
    taskId: "task-1",
    tenantId: "tenant-1",
    stepNo: 1,
    kind: "reason" as const,
    label: "Reason",
    detail: "Checking the booking.",
    content: { model: "claude-sonnet-5" },
    tokensIn: 1487,
    tokensOut: 269,
    costUsd: "0.005660",
    latencyMs: 4150,
    createdAt: new Date("2026-07-29T10:49:46.445Z"),
  };

  it("converts numeric cost from the driver's string to a number", () => {
    // pg returns numeric as a string to avoid float loss. Sending that to the
    // SPA would make the Trace Viewer concatenate costs instead of summing.
    const payload = toTraceStepPayload(row);

    expect(payload.costUsd).toBe(0.00566);
    expect(typeof payload.costUsd).toBe("number");
  });

  it("keeps a null cost null rather than coercing it to zero", () => {
    // A tool_call step has no cost. Zero would imply a free model call.
    const payload = toTraceStepPayload({ ...row, costUsd: null });

    expect(payload.costUsd).toBeNull();
  });

  it("does not leak tenantId to the client", () => {
    expect(toTraceStepPayload(row)).not.toHaveProperty("tenantId");
  });

  it("passes the step ordering through unchanged", () => {
    expect(toTraceStepPayload({ ...row, stepNo: 7 }).stepNo).toBe(7);
  });
});
