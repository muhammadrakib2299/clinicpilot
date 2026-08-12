import { relations, sql } from "drizzle-orm";
import {
  boolean,
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
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "@clinicpilot/shared-types";

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

/**
 * Ordered most-privileged first, and the order is load-bearing: `atLeast()` in
 * the RBAC guard compares positions, so inserting a role in the middle changes
 * who can do what. Append, or update the guard deliberately.
 */
export const userRole = pgEnum("user_role", ["admin", "clinician", "coordinator", "viewer"]);
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
/**
 * Where a follow-up message got to.
 *
 * All three are reachable now. An n8n workflow sweeps `drafted` messages on a
 * schedule, hands each to a channel, and reports back.
 *
 * `sent` means **the delivery workflow handed it to its configured channel** —
 * not that it reached a phone. Which channel is recorded alongside, because
 * the configured channel in this repo is `simulated`: there is no Twilio
 * account and an untested carrier integration is worth less than an honest
 * seam (the argument in ADR-003 and ADR-009, for the third time). A row
 * therefore says what actually happened rather than implying a delivery that
 * did not occur, and swapping the stand-in for a real node changes the value
 * in `delivery_channel` and nothing else.
 */
export const messageStatus = pgEnum("message_status", ["drafted", "sent", "failed"]);

/**
 * Why an agent handed a task to a human.
 *
 * One value per place the system actually escalates from, plus `unspecified`
 * for a caller that did not say. That last one is not laziness — it is what
 * keeps the escalation row mandatory: the gateway writes one whenever a task
 * completes as `escalated`, and a missing reason must not be a missing queue
 * entry. Add a value when a new escalation path exists, not in anticipation.
 */
export const escalationReason = pgEnum("escalation_reason", [
  "router",
  "max_iterations",
  "answer_check",
  "unspecified",
]);

/**
 * Where a queued escalation has got to.
 *
 * `acknowledged` exists so two people do not work the same one. It is a claim,
 * not an assignment — nothing routes escalations to individuals, and inventing
 * that before anyone has asked for it would be a workflow nobody wanted.
 */
export const escalationStatus = pgEnum("escalation_status", [
  "open",
  "acknowledged",
  "resolved",
]);

export const traceKind = pgEnum("trace_kind", [
  "reason",
  "reflection",
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

/**
 * Identity is global; membership is what makes it tenant-scoped.
 *
 * `06-ARCHITECTURE` sketched `users.tenant_id` plus a `roles` lookup and a
 * `user_roles` join. Two changes, both deliberate:
 *
 * 1. A user has no tenant of their own. The sketch had `tenant_id` on both
 *    `users` and `user_roles`, which contradicts itself the moment someone
 *    belongs to two clinics — and the tenant switcher in this phase requires
 *    exactly that.
 * 2. `roles` is an enum, not a table. It is four values that the RBAC guard
 *    also has to know at compile time, so a lookup table buys a join and a
 *    second place for them to disagree.
 *
 * Deliberately NOT tenant-scoped for RLS: a login has to find the user before
 * any tenant is known. Isolation for this table comes from never exposing it
 * except through the session.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** scrypt, salt included — see common/password.ts for the format. */
    passwordHash: text("password_hash").notNull(),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    // Case-insensitive: nobody expects Admin@demo and admin@demo to be two
    // accounts, and allowing both is an account-takeover shaped problem.
    uniqueIndex("users_email_key").on(sql`lower(${table.email})`),
  ],
);

/**
 * Which tenants a user belongs to, and as what.
 *
 * One row per (user, tenant). The tenant switcher lists these; the JWT names
 * the one currently active; RLS enforces that the choice was legitimate.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: userRole("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_user_tenant_key").on(table.userId, table.tenantId),
    index("memberships_tenant_idx").on(table.tenantId),
  ],
);

/**
 * Append-only record of who did what to which resource.
 *
 * HIPAA's audit-control safeguard is the reason this exists, and "append-only"
 * is enforced by a trigger in the migration rather than by convention — an
 * audit log an application can edit is a log, not an audit trail.
 *
 * `actorId` is nullable on purpose: the AI service acts with no user in the
 * request, and recording that as "system" is more truthful than attributing a
 * machine's FHIR read to whoever happened to submit the task.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** Denormalised so a deleted user does not erase who did the thing. */
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
    index("audit_log_actor_idx").on(table.actorId),
    index("audit_log_resource_idx").on(table.resourceType, table.resourceId),
  ],
);

/**
 * Outbound patient contact.
 *
 * A record rather than a log line, for the same reason `audit_log` is: "did we
 * contact this patient, when, and with what words" is a question a clinic has
 * to be able to answer, and a trace step is an engineering artefact rather
 * than a clinical one.
 *
 * `body` is stored rendered. The template id says which approved wording was
 * used, but templates change, and what was actually sent is the thing that
 * matters six months later.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The run that produced it, so a message traces back to its reasoning. */
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** FHIR Patient id. Not a foreign key — the patient lives in the EHR. */
    patientRef: text("patient_ref").notNull(),
    appointmentRef: text("appointment_ref"),
    templateId: text("template_id").notNull(),
    body: text("body").notNull(),
    status: messageStatus("status").notNull().default("drafted"),
    /**
     * Which channel the delivery workflow handed it to — `simulated` in this
     * repo. Recorded rather than assumed, so `sent` is a statement about what
     * happened rather than about what a real carrier would have done.
     */
    deliveryChannel: text("delivery_channel"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Why it failed, when it did. Kept so a person can act on it. */
    deliveryError: text("delivery_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
    index("messages_patient_idx").on(table.tenantId, table.patientRef),
    // The delivery sweep's query: everything still waiting in one tenant,
    // oldest first. Partial, because it is only ever run for one status and a
    // full index would be mostly rows the sweep will never look at again.
    index("messages_pending_idx")
      .on(table.tenantId, table.createdAt)
      .where(sql`status = 'drafted'`),
  ],
);

/**
 * Work an agent handed back to a person.
 *
 * A separate table rather than a status on `tasks`, because they answer
 * different questions. `tasks.status = 'escalated'` says how a run ended; this
 * says whether a human has dealt with it, who, and what they did — and a task
 * row has no room for that without becoming two records in one.
 *
 * **Written by the gateway, not by the agent.** `TasksService.complete()`
 * inserts one in the same transaction that marks a task escalated, so no code
 * path can escalate without queueing. The AI service supplies the reason when
 * it knows one; it cannot supply the row's existence.
 *
 * No unique constraint on `taskId`, deliberately: an escalation is an *event*,
 * not a property of a task. A task cannot normally escalate twice — `isRunnable`
 * refuses to re-run one that already has — so a second row means it genuinely
 * happened twice, after a failure and a retry, and a human should see both.
 */
export const escalations = pgTable(
  "escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    reason: escalationReason("reason").notNull().default("unspecified"),
    /** What the agent said as it gave up — the first thing a human reads. */
    summary: text("summary").notNull(),
    status: escalationStatus("status").notNull().default("open"),
    /** Who is working it. */
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** What the person actually did. The point of the queue, six months later. */
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The queue query: filtered by status, newest first, within a tenant.
    index("escalations_tenant_status_idx").on(
      table.tenantId,
      table.status,
      table.createdAt.desc(),
    ),
    index("escalations_task_idx").on(table.taskId),
  ],
);

/**
 * A clinic document the Document Q&A agent may answer from.
 *
 * Deliberately not patient data. These are policies, opening hours and
 * preparation instructions — the things a receptionist answers forty times a
 * day — which is why this agent can be given a retrieval tool at all. A
 * corpus containing records would need a different access story than "every
 * member of the tenant can read it".
 *
 * `slug` is the half of a citation a human reads, so it is stable and
 * tenant-unique: re-ingesting a document replaces its chunks in place rather
 * than accumulating a second copy the retriever would then rank against the
 * first.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Where the text came from — a repo path today, a URL or upload later. */
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("documents_tenant_slug_key").on(table.tenantId, table.slug)],
);

/**
 * One retrievable passage, and the vector it is found by.
 *
 * `embeddingModel` is stored per chunk because cosine distance between vectors
 * from two different models is not an error — it is a plausible-looking float.
 * Retrieval would keep working and keep being wrong, which is the failure mode
 * this codebase has already been bitten by once (a `+` in a FHIR search param
 * that returned every slot instead of none). Search filters on it, so a chunk
 * embedded by an older model is invisible rather than silently comparable.
 *
 * Changing embedding model therefore means a migration *and* a re-ingest.
 * That is inherent to vector search, not a limitation of this schema.
 */
export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** Position in the document. `slug#ordinal` is the citation the agent quotes. */
    ordinal: integer("ordinal").notNull(),
    /** Nearest heading above the passage, so a citation can name a section. */
    heading: text("heading"),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("document_chunks_document_ordinal_key").on(table.documentId, table.ordinal),
    index("document_chunks_tenant_idx").on(table.tenantId),
    // No vector index, on purpose. A seeded clinic has a few hundred chunks,
    // where an exact scan is both faster than an approximate index and exactly
    // correct; ivfflat additionally needs to be built against representative
    // data to be anything but harmful. Add HNSW when a tenant's chunk count
    // reaches five figures, and measure before believing it helped.
  ],
);

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
  memberships: many(memberships),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [memberships.tenantId], references: [tenants.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  tenant: one(tenants, { fields: [auditLog.tenantId], references: [tenants.id] }),
  actor: one(users, { fields: [auditLog.actorId], references: [users.id] }),
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

export const escalationsRelations = relations(escalations, ({ one }) => ({
  tenant: one(tenants, { fields: [escalations.tenantId], references: [tenants.id] }),
  task: one(tasks, { fields: [escalations.taskId], references: [tasks.id] }),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  tenant: one(tenants, { fields: [documents.tenantId], references: [tenants.id] }),
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, { fields: [documentChunks.documentId], references: [documents.id] }),
  tenant: one(tenants, { fields: [documentChunks.tenantId], references: [tenants.id] }),
}));

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Escalation = typeof escalations.$inferSelect;
export type NewEscalation = typeof escalations.$inferInsert;

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Trace = typeof traces.$inferSelect;
export type LlmUsage = typeof llmUsage.$inferSelect;

export type NewTenant = typeof tenants.$inferInsert;
export type NewUser = typeof users.$inferInsert;
export type NewMembership = typeof memberships.$inferInsert;
export type NewAuditEntry = typeof auditLog.$inferInsert;
export type NewAgent = typeof agents.$inferInsert;
export type NewTask = typeof tasks.$inferInsert;
export type NewTrace = typeof traces.$inferInsert;
export type NewLlmUsage = typeof llmUsage.$inferInsert;

/**
 * Tables RLS protects, and therefore the ones every query must carry a tenant
 * for. `users` is absent by design — login resolves an identity before any
 * tenant exists to scope it to.
 */
export const TENANT_SCOPED_TABLES = [
  "agents",
  "tasks",
  "traces",
  "llm_usage",
  "memberships",
  "audit_log",
  "messages",
  "documents",
  "document_chunks",
  "escalations",
] as const;
