import { eq } from "drizzle-orm";

import { AuditService } from "../src/audit/audit.service";
import { runWithActor } from "../src/common/request-context";
import { DEMO_TENANT_ID, SECOND_TENANT_ID } from "../src/common/tenant";
import { DbService } from "../src/db/db.service";
import { agents, auditLog, escalations, tasks, users } from "../src/db/schema";
import { EscalationsService } from "../src/escalations/escalations.service";
import { TasksService } from "../src/tasks/tasks.service";

/**
 * The human queue, against a real database.
 *
 * The assertion that matters most is the first one: completing a task as
 * `escalated` writes a queue row *in the same transaction*. Escalation already
 * fired from three places before this table existed and every one of them ended
 * the same way — a task marked `escalated` that nobody was told about. Whether
 * that is still possible is a property of the write path, not of a unit under a
 * stub, so it is checked here.
 *
 *   pnpm up:infra && pnpm db:migrate && pnpm db:rls && pnpm db:seed
 *   pnpm test:integration
 */

jest.setTimeout(30_000);

let db: DbService;
let service: EscalationsService;
let taskService: TasksService;

/**
 * Two real seeded accounts, resolved at startup rather than invented.
 *
 * `acknowledged_by` is a foreign key to `users`, so a made-up uuid fails the
 * constraint — which is the schema doing its job: the queue records *who*
 * claimed something, and "who" has to be somebody.
 */
let COORDINATOR: Actor;
let OTHER_COORDINATOR: Actor;

interface Actor {
  userId: string;
  email: string;
  tenantId: string;
  role: "coordinator" | "admin";
}

async function seededActor(email: string, role: Actor["role"]): Promise<Actor> {
  const [user] = await db.db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    throw new Error(`${email} is missing — run \`pnpm db:seed\` before this suite.`);
  }

  return { userId: user.id, email: user.email, tenantId: DEMO_TENANT_ID, role };
}

/**
 * A task to escalate, written directly rather than through `create()`.
 *
 * `create()` enqueues onto Redis, which this suite has no business needing —
 * the behaviour under test starts at `complete()`.
 */
async function seedTask(tenantId: string, input: string): Promise<string> {
  return db.withTenant(tenantId, async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.tenantId, tenantId)).limit(1);

    const [task] = await tx
      .insert(tasks)
      .values({ tenantId, agentId: agent!.id, input, status: "running" })
      .returning();

    return task!.id;
  });
}

/** Escalate a task the way the AI service does, and return its queue row. */
async function escalate(
  tenantId: string,
  input: string,
  options: { reason?: "router" | "max_iterations" | "answer_check"; outcome?: string | null } = {},
) {
  const taskId = await seedTask(tenantId, input);

  await taskService.complete(tenantId, taskId, {
    status: "escalated",
    outcome: options.outcome === undefined ? "A human should look at this." : options.outcome,
    ...(options.reason ? { escalationReason: options.reason } : {}),
  });

  const [row] = await db.withTenant(tenantId, (tx) =>
    tx.select().from(escalations).where(eq(escalations.taskId, taskId)),
  );

  return { taskId, row };
}

beforeAll(async () => {
  db = new DbService();
  const audit = new AuditService(db);
  service = new EscalationsService(db, audit);

  // Realtime and queue are irrelevant to `complete()`'s escalation path and
  // both would need a Redis connection, so they are inert stand-ins.
  const realtime = { publish: () => undefined } as never;
  const queue = { enqueue: async () => false } as never;
  taskService = new TasksService(db, realtime, queue, audit, service);

  COORDINATOR = await seededActor("coordinator@demo.clinicpilot.io", "coordinator");
  OTHER_COORDINATOR = await seededActor("admin@demo.clinicpilot.io", "admin");
});

afterAll(async () => {
  for (const tenantId of [DEMO_TENANT_ID, SECOND_TENANT_ID]) {
    // Escalations cascade from the task, so deleting the tasks is enough.
    await db.withTenant(tenantId, (tx) =>
      tx.execute(`delete from tasks where input like '[queue-test]%'`),
    );
  }
  await db.onModuleDestroy();
});

describe("a task completing as escalated", () => {
  it("queues a human in the same transaction", async () => {
    const { row } = await escalate(DEMO_TENANT_ID, "[queue-test] my chest hurts", {
      reason: "router",
    });

    expect(row).toBeDefined();
    expect(row!.status).toBe("open");
    expect(row!.reason).toBe("router");
    expect(row!.summary).toBe("A human should look at this.");
  });

  it("queues even when the caller does not say why", async () => {
    // The reason labels the row; the status is what creates it. A caller that
    // forgets to categorise must not become a patient nobody is told about.
    const { row } = await escalate(DEMO_TENANT_ID, "[queue-test] unlabelled");

    expect(row).toBeDefined();
    expect(row!.reason).toBe("unspecified");
  });

  it("still queues when the agent gave no summary at all", async () => {
    // `summary` is NOT NULL because it is the first line a human reads.
    const { row } = await escalate(DEMO_TENANT_ID, "[queue-test] silent", { outcome: null });

    expect(row!.summary).toContain("without a summary");
  });

  it("does not queue anything for a resolved task", async () => {
    const taskId = await seedTask(DEMO_TENANT_ID, "[queue-test] resolved fine");
    await taskService.complete(DEMO_TENANT_ID, taskId, {
      status: "resolved",
      outcome: "Moved to Tuesday.",
    });

    const rows = await db.withTenant(DEMO_TENANT_ID, (tx) =>
      tx.select().from(escalations).where(eq(escalations.taskId, taskId)),
    );

    expect(rows).toHaveLength(0);
  });

  it("does not queue anything for a failed task", async () => {
    // A failure is ours to fix, not a clinician's to action. Putting it in the
    // human queue would bury the real escalations under our own bugs.
    const taskId = await seedTask(DEMO_TENANT_ID, "[queue-test] crashed");
    await taskService.complete(DEMO_TENANT_ID, taskId, {
      status: "failed",
      outcome: "RuntimeError: model unreachable",
    });

    const rows = await db.withTenant(DEMO_TENANT_ID, (tx) =>
      tx.select().from(escalations).where(eq(escalations.taskId, taskId)),
    );

    expect(rows).toHaveLength(0);
  });
});

describe("the queue", () => {
  it("carries enough of the task to triage without opening it", async () => {
    const { taskId } = await escalate(DEMO_TENANT_ID, "[queue-test] triage me", {
      reason: "answer_check",
    });

    const [entry] = await runWithActor(COORDINATOR, () =>
      service.list({ limit: 200 }).then((rows) => rows.filter((row) => row.taskId === taskId)),
    );

    expect(entry!.taskInput).toBe("[queue-test] triage me");
    expect(entry!.taskChannel).toBe("web");
    expect(entry!.agentName).toBeTruthy();
    expect(entry!.reason).toBe("answer_check");
  });

  it("filters by status", async () => {
    const { row } = await escalate(DEMO_TENANT_ID, "[queue-test] to acknowledge");
    await runWithActor(COORDINATOR, () => service.acknowledge(row!.id));

    const open = await runWithActor(COORDINATOR, () =>
      service.list({ status: "open", limit: 200 }),
    );

    expect(open.map((entry) => entry.id)).not.toContain(row!.id);
  });

  it("counts what is outstanding, by status", async () => {
    const before = await runWithActor(COORDINATOR, () => service.openCount());
    await escalate(DEMO_TENANT_ID, "[queue-test] counted");
    const after = await runWithActor(COORDINATOR, () => service.openCount());

    expect(after.open).toBe(before.open + 1);
  });
});

describe("claiming and closing", () => {
  it("records who claimed it", async () => {
    const { row } = await escalate(DEMO_TENANT_ID, "[queue-test] claim me");

    const claimed = await runWithActor(COORDINATOR, () => service.acknowledge(row!.id));

    expect(claimed.status).toBe("acknowledged");
    expect(claimed.acknowledgedBy).toBe(COORDINATOR.email);
    expect(claimed.acknowledgedAt).not.toBeNull();
  });

  it("refuses a second claim, so two people do not work the same one", async () => {
    const { row } = await escalate(DEMO_TENANT_ID, "[queue-test] contested");
    await runWithActor(COORDINATOR, () => service.acknowledge(row!.id));

    await expect(
      runWithActor(OTHER_COORDINATOR, () => service.acknowledge(row!.id)),
    ).rejects.toThrow(/already working/i);
  });

  it("closes with a note, and records who wrote it", async () => {
    const { row } = await escalate(DEMO_TENANT_ID, "[queue-test] close me");

    const resolved = await runWithActor(COORDINATOR, () =>
      service.resolve(row!.id, { resolution: "Called the patient; booked them in for Thursday." }),
    );

    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedBy).toBe(COORDINATOR.email);
    expect(resolved.resolution).toContain("Called the patient");
  });

  it("can be closed without being claimed first", async () => {
    // Requiring a claim before a close is a workflow step that buys nothing
    // when the person closing it is the person who dealt with it.
    const { row } = await escalate(DEMO_TENANT_ID, "[queue-test] straight to done");

    const resolved = await runWithActor(COORDINATOR, () =>
      service.resolve(row!.id, { resolution: "Already handled at the desk." }),
    );

    expect(resolved.status).toBe("resolved");
    expect(resolved.acknowledgedBy).toBeNull();
  });

  it("refuses to close the same escalation twice", async () => {
    const { row } = await escalate(DEMO_TENANT_ID, "[queue-test] double close");
    await runWithActor(COORDINATOR, () => service.resolve(row!.id, { resolution: "Done." }));

    await expect(
      runWithActor(COORDINATOR, () => service.resolve(row!.id, { resolution: "Done again." })),
    ).rejects.toThrow(/already resolved/i);
  });

  it("writes the resolution into the audit log, which cannot be edited", async () => {
    // `escalations.resolution` is an ordinary updatable column. The audit entry
    // is the copy nobody can rewrite, which is the one that answers "what
    // happened to this patient's message" six months later.
    const { row } = await escalate(DEMO_TENANT_ID, "[queue-test] audited");
    await runWithActor(COORDINATOR, () =>
      service.resolve(row!.id, { resolution: "Rebooked by phone." }),
    );

    const entries = await db.withTenant(DEMO_TENANT_ID, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.resourceId, row!.id)),
    );

    const resolveEntry = entries.find((entry) => entry.action === "escalation.resolve");
    expect(resolveEntry?.metadata).toMatchObject({ resolution: "Rebooked by phone." });
    expect(resolveEntry?.actorEmail).toBe(COORDINATOR.email);
  });
});

describe("tenant isolation", () => {
  it("does not show another clinic's queue", async () => {
    const { row } = await escalate(SECOND_TENANT_ID, "[queue-test] riverside only");

    const seen = await runWithActor(COORDINATOR, () => service.list({ limit: 200 }));

    expect(seen.map((entry) => entry.id)).not.toContain(row!.id);
  });

  it("cannot claim an escalation belonging to another clinic", async () => {
    // RLS, not a check in the service: the row is simply not visible to a
    // transaction scoped to the wrong tenant, so the lookup 404s.
    const { row } = await escalate(SECOND_TENANT_ID, "[queue-test] not yours");

    await expect(runWithActor(COORDINATOR, () => service.acknowledge(row!.id))).rejects.toThrow(
      /not found/i,
    );
  });
});
