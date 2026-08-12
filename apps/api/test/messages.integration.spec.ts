import { eq } from "drizzle-orm";

import { AuditService } from "../src/audit/audit.service";
import { DEMO_TENANT_ID, SECOND_TENANT_ID } from "../src/common/tenant";
import { DbService } from "../src/db/db.service";
import { auditLog, messages } from "../src/db/schema";
import { MessagesService } from "../src/messages/messages.service";
import { TenantsService } from "../src/tenants/tenants.module";

/**
 * Outbound patient contact, and the delivery sweep that moves it.
 *
 * Against a real database because the behaviour under test is a guarded UPDATE:
 * "deliver only if still drafted" is what stops two overlapping n8n passes
 * sending a patient the same message twice, and it is enforced by the WHERE
 * clause rather than by anything a stub would exercise.
 *
 *   pnpm up:infra && pnpm db:migrate && pnpm db:rls && pnpm db:seed
 *   pnpm test:integration
 */

jest.setTimeout(30_000);

let db: DbService;
let service: MessagesService;
let tenants: TenantsService;

const MARKER = "[delivery-test]";

async function draft(tenantId: string, body: string) {
  return service.record(tenantId, {
    patientRef: "137240393",
    templateId: "post_visit_check_in",
    body: `${MARKER} ${body}`,
  });
}

/** Only this suite's rows — the sweep is tenant-wide, so the filter matters. */
async function pendingHere(tenantId: string) {
  const rows = await service.pending(tenantId, 100);
  return rows.filter((row) => row.body.startsWith(MARKER));
}

beforeAll(() => {
  db = new DbService();
  service = new MessagesService(db, new AuditService(db));
  tenants = new TenantsService(db);
});

afterAll(async () => {
  for (const tenantId of [DEMO_TENANT_ID, SECOND_TENANT_ID]) {
    await db.withTenant(tenantId, (tx) =>
      tx.execute(`delete from messages where body like '${MARKER}%'`),
    );
  }
  await db.onModuleDestroy();
});

describe("what the sweep picks up", () => {
  it("returns drafted messages, oldest first", async () => {
    const first = await draft(DEMO_TENANT_ID, "one");
    const second = await draft(DEMO_TENANT_ID, "two");

    const pending = await pendingHere(DEMO_TENANT_ID);

    expect(pending.map((row) => row.id).slice(0, 2)).toEqual([first.id, second.id]);
  });

  it("leaves a delivered message alone", async () => {
    const message = await draft(DEMO_TENANT_ID, "already gone");
    await service.recordDelivery(DEMO_TENANT_ID, message.id, {
      status: "sent",
      channel: "simulated",
    });

    const pending = await pendingHere(DEMO_TENANT_ID);

    expect(pending.map((row) => row.id)).not.toContain(message.id);
  });

  it("does not retry a failed message on the next pass", async () => {
    // Most channel failures repeat — a number that does not exist, a patient
    // who opted out — so a five-minute retry turns one bad row into a
    // permanent alarm. It stays visible with its error instead.
    const message = await draft(DEMO_TENANT_ID, "will fail");
    await service.recordDelivery(DEMO_TENANT_ID, message.id, {
      status: "failed",
      channel: "simulated",
      error: "no mobile number on record",
    });

    const pending = await pendingHere(DEMO_TENANT_ID);

    expect(pending.map((row) => row.id)).not.toContain(message.id);
  });

  it("does not show one clinic another clinic's outbox", async () => {
    const riverside = await draft(SECOND_TENANT_ID, "riverside only");

    const pending = await pendingHere(DEMO_TENANT_ID);

    expect(pending.map((row) => row.id)).not.toContain(riverside.id);
  });
});

describe("recording what the channel did", () => {
  it("records the channel, not just the status", async () => {
    // `sent` alone would read as a text message somebody received. The channel
    // is what makes it a statement about what actually happened.
    const message = await draft(DEMO_TENANT_ID, "with a channel");

    const delivered = await service.recordDelivery(DEMO_TENANT_ID, message.id, {
      status: "sent",
      channel: "simulated",
    });

    expect(delivered.status).toBe("sent");
    expect(delivered.deliveryChannel).toBe("simulated");
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.deliveryError).toBeNull();
  });

  it("keeps the error when delivery fails", async () => {
    const message = await draft(DEMO_TENANT_ID, "failed with a reason");

    const failed = await service.recordDelivery(DEMO_TENANT_ID, message.id, {
      status: "failed",
      channel: "simulated",
      error: "carrier rejected the number",
    });

    expect(failed.status).toBe("failed");
    expect(failed.deliveryError).toBe("carrier rejected the number");
  });

  it("refuses a second delivery of the same message", async () => {
    // The guard that matters. n8n starts a second pass while the first is
    // still going if a pass runs long, and the patient is the one who would
    // notice a missing guard.
    const message = await draft(DEMO_TENANT_ID, "contested");
    await service.recordDelivery(DEMO_TENANT_ID, message.id, {
      status: "sent",
      channel: "simulated",
    });

    await expect(
      service.recordDelivery(DEMO_TENANT_ID, message.id, {
        status: "sent",
        channel: "simulated",
      }),
    ).rejects.toThrow(/already sent/i);
  });

  it("cannot deliver another clinic's message", async () => {
    // RLS, not a check in the service: scoped to the wrong tenant the row is
    // not visible at all, so the lookup 404s.
    const riverside = await draft(SECOND_TENANT_ID, "not yours");

    await expect(
      service.recordDelivery(DEMO_TENANT_ID, riverside.id, {
        status: "sent",
        channel: "simulated",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("audits a send and a failure as different actions", async () => {
    // "Did we contact this patient" and "did we try and fail" are different
    // questions a reviewer asks, and one action name cannot answer both.
    const sent = await draft(DEMO_TENANT_ID, "audited send");
    const failed = await draft(DEMO_TENANT_ID, "audited failure");

    await service.recordDelivery(DEMO_TENANT_ID, sent.id, {
      status: "sent",
      channel: "simulated",
    });
    await service.recordDelivery(DEMO_TENANT_ID, failed.id, {
      status: "failed",
      channel: "simulated",
      error: "unreachable",
    });

    const entries = await db.withTenant(DEMO_TENANT_ID, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.resourceType, "message")),
    );

    const forSent = entries.find(
      (entry) => entry.resourceId === sent.id && entry.action === "message.sent",
    );
    const forFailed = entries.find(
      (entry) => entry.resourceId === failed.id && entry.action === "message.delivery_failed",
    );

    expect(forSent?.metadata).toMatchObject({ channel: "simulated" });
    expect(forFailed?.metadata).toMatchObject({ error: "unreachable" });
  });

  it("stores the rendered body, so what the patient would read survives", async () => {
    const message = await draft(DEMO_TENANT_ID, "the actual words");

    const [row] = await db.withTenant(DEMO_TENANT_ID, (tx) =>
      tx.select().from(messages).where(eq(messages.id, message.id)),
    );

    expect(row!.body).toContain("the actual words");
  });
});

describe("the clinic list a scheduled job sweeps", () => {
  it("returns every tenant, because a cron has no tenant of its own", async () => {
    const all = await tenants.list();

    expect(all.map((tenant) => tenant.id)).toEqual(
      expect.arrayContaining([DEMO_TENANT_ID, SECOND_TENANT_ID]),
    );
  });

  it("carries ids and names and nothing else", async () => {
    // The one deliberately un-scoped query in the system, so it says as little
    // as it can get away with.
    const [tenant] = await tenants.list();

    expect(Object.keys(tenant!).sort()).toEqual(["id", "name"]);
  });
});
