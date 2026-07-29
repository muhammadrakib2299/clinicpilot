import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Phase 1 spine of the data model in 06-ARCHITECTURE-SCALABILITY.md.
 *
 * Two rules hold across every table here:
 *
 * 1. Every tenant-scoped table carries `tenantId` from day one, even though
 *    Phase 1 runs a single hardcoded tenant. Phase 2 then adds RLS policies
 *    (ADR-005) as a pure addition rather than a migration of live rows.
 * 2. Money is `numeric`, never a float. Per-step LLM costs are fractions of a
 *    cent and get summed thousands of times for the cost dashboard; binary
 *    floating point drifts, and "why doesn't the invoice match the traces"
 *    is not a bug worth having.
 *
 * Enum values mirror `packages/shared-types` exactly — the zod schemas are the
 * wire contract, these are the storage contract, and a drift between them is
 * caught by a test rather than by a 500 in production.
 */

export const planCode = pgEnum("plan_code", ["free", "pro", "clinic", "enterprise"]);
export const agentKind = pgEnum("agent_kind", ["scheduling", "followup", "docqa"]);
export const agentStatus = pgEnum("agent_status", ["active", "degraded", "paused"]);
export const taskChannel = pgEnum("task_channel", ["web", "sms", "voice", "email"]);
export const taskStatus = pgEnum("task_status", [
  "queued",
  "running",
  "resolved",
  "escalated",
  "failed",
]);
export const traceKind = pgEnum("trace_kind", [
  "reason",
  "tool_call",
  "observation",
  "action",
  "escalation",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: planCode("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: agentKind("kind").notNull(),
    name: text("name").notNull(),
    status: agentStatus("status").notNull().default("active"),
    config: jsonb("config").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agents_tenant_idx").on(table.tenantId),
    // One agent of each kind per tenant: the Fleet Overview renders one card
    // per kind, and a duplicate would silently split a tenant's metrics.
    uniqueIndex("agents_tenant_kind_key").on(table.tenantId, table.kind),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    channel: taskChannel("channel").notNull().default("web"),
    input: text("input").notNull(),
    status: taskStatus("status").notNull().default("queued"),
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    // The Task Inbox query: newest-first within a tenant.
    index("tasks_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
    index("tasks_agent_idx").on(table.agentId),
    index("tasks_status_idx").on(table.tenantId, table.status),
  ],
);

/**
 * Append-only. A trace is the audit record of what an agent did and why, so
 * steps are written once and never updated — Phase 2 enforces that with a
 * trigger alongside the audit_log work.
 */
export const traces = pgTable(
  "traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    stepNo: integer("step_no").notNull(),
    kind: traceKind("kind").notNull(),
    label: text("label").notNull(),
    detail: text("detail").notNull(),
    /** Raw tool input/output, kept out of `detail` so the UI stays readable. */
    content: jsonb("content"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Replaying a run means ordering by step; the unique constraint makes a
    // duplicate step_no a write error instead of a scrambled Trace Viewer.
    uniqueIndex("traces_task_step_key").on(table.taskId, table.stepNo),
    index("traces_tenant_idx").on(table.tenantId),
  ],
);

/**
 * One row per model call. Deliberately separate from `traces`: a single trace
 * step can involve zero or several model calls, and billing must reconcile
 * against the provider's numbers rather than against the UI's step list.
 */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    /** Split out because cached reads bill at 0.1x and writes at a premium. */
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The spend chart: sum cost over a tenant's recent window.
    index("llm_usage_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
    index("llm_usage_task_idx").on(table.taskId),
  ],
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  agents: many(agents),
  tasks: many(tasks),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  tenant: one(tenants, { fields: [agents.tenantId], references: [tenants.id] }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  tenant: one(tenants, { fields: [tasks.tenantId], references: [tenants.id] }),
  agent: one(agents, { fields: [tasks.agentId], references: [agents.id] }),
  traces: many(traces),
}));

export const tracesRelations = relations(traces, ({ one }) => ({
  task: one(tasks, { fields: [traces.taskId], references: [tasks.id] }),
  tenant: one(tenants, { fields: [traces.tenantId], references: [tenants.id] }),
}));

export const llmUsageRelations = relations(llmUsage, ({ one }) => ({
  tenant: one(tenants, { fields: [llmUsage.tenantId], references: [tenants.id] }),
  agent: one(agents, { fields: [llmUsage.agentId], references: [agents.id] }),
  task: one(tasks, { fields: [llmUsage.taskId], references: [tasks.id] }),
}));

export type Tenant = typeof tenants.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Trace = typeof traces.$inferSelect;
export type LlmUsage = typeof llmUsage.$inferSelect;

export type NewTenant = typeof tenants.$inferInsert;
export type NewAgent = typeof agents.$inferInsert;
export type NewTask = typeof tasks.$inferInsert;
export type NewTrace = typeof traces.$inferInsert;
export type NewLlmUsage = typeof llmUsage.$inferInsert;
