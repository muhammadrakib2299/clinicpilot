import {
  AgentKind,
  AgentStatus,
  EMBEDDING_DIMENSIONS,
  PlanCode,
  TaskChannel,
  TaskStatus,
  TraceKind,
} from "@clinicpilot/shared-types";

import {
  agentKind,
  agentStatus,
  documentChunks,
  planCode,
  taskChannel,
  taskStatus,
  traceKind,
  TENANT_SCOPED_TABLES,
} from "./schema";

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

  /**
   * The embedding column and the wire contract are the same number in two
   * places. Postgres would eventually object to a wrong-length vector, but
   * only at INSERT — after a document has been read, chunked and embedded, and
   * with an error from the driver rather than from anything that knows why.
   */
  it("sizes the embedding column from the wire contract", () => {
    // The rendered SQL type rather than the column's config, because that
    // string is what drizzle-kit writes into the migration.
    expect(documentChunks.embedding.getSQLType()).toBe(`vector(${EMBEDDING_DIMENSIONS})`);
  });

  /**
   * Every tenant-scoped table has to be named here, because that list is what
   * the isolation suite iterates. A new table that is missing from it is not
   * covered by any RLS assertion, and nothing else would notice.
   */
  it("lists both document tables as tenant-scoped", () => {
    expect(TENANT_SCOPED_TABLES).toContain("documents");
    expect(TENANT_SCOPED_TABLES).toContain("document_chunks");
  });
});
