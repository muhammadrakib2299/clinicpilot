import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  MessageSummary,
  RecordDeliveryInput,
  RecordMessageInput,
} from "@clinicpilot/shared-types";
import { and, asc, desc, eq } from "drizzle-orm";

import { AuditService } from "../audit/audit.service";
import { currentTenantId } from "../common/tenant";
import { DbService } from "../db/db.service";
import { messages } from "../db/schema";

@Injectable()
export class MessagesService {
  constructor(
    private readonly dbService: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Record one drafted follow-up.
   *
   * Audited as a distinct action rather than folded into the task's trace:
   * contacting a patient is the kind of event a compliance reviewer looks for
   * by name, and `task.resolved` does not say that one happened.
   */
  async record(tenantId: string, input: RecordMessageInput): Promise<MessageSummary> {
    const row = await this.dbService.withTenant(tenantId, async (tx) => {
      const [created] = await tx
        .insert(messages)
        .values({
          tenantId,
          taskId: input.taskId ?? null,
          patientRef: input.patientRef,
          appointmentRef: input.appointmentRef ?? null,
          templateId: input.templateId,
          body: input.body,
        })
        .returning();

      return created!;
    });

    await this.audit.recordSystem({
      tenantId,
      action: "message.drafted",
      resourceType: "message",
      resourceId: row.id,
      metadata: { patientRef: row.patientRef, templateId: row.templateId },
    });

    return toSummary(row);
  }

  async list(limit = 50): Promise<MessageSummary[]> {
    const tenantId = currentTenantId();

    const rows = await this.dbService.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(messages)
        .where(eq(messages.tenantId, tenantId))
        .orderBy(desc(messages.createdAt))
        .limit(limit),
    );

    return rows.map(toSummary);
  }

  /**
   * What the delivery sweep should attempt, oldest first.
   *
   * Only `drafted`. A `failed` message is not retried automatically: the
   * failures a channel produces are mostly ones that will happen again — a
   * number that does not exist, a patient who has opted out — and a sweep that
   * retries every five minutes turns one bad row into a permanent alarm. It
   * stays visible with its error for a person to act on.
   */
  async pending(tenantId: string, limit: number): Promise<MessageSummary[]> {
    const rows = await this.dbService.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.tenantId, tenantId), eq(messages.status, "drafted")))
        .orderBy(asc(messages.createdAt))
        .limit(limit),
    );

    return rows.map(toSummary);
  }

  /**
   * Record what the delivery workflow did with one message.
   *
   * The status change is guarded on still being `drafted`, so two overlapping
   * sweeps cannot both deliver the same message — the second one gets a 409
   * rather than sending a patient the same text twice. n8n's schedule trigger
   * will happily start a second run while the first is still going if a pass
   * takes longer than its interval, which makes this the likely case rather
   * than the paranoid one.
   */
  async recordDelivery(
    tenantId: string,
    id: string,
    input: RecordDeliveryInput,
  ): Promise<MessageSummary> {
    const row = await this.dbService.withTenant(tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.id, id), eq(messages.tenantId, tenantId)))
        .limit(1);

      if (!existing) throw new NotFoundException(`Message ${id} not found`);

      const [updated] = await tx
        .update(messages)
        .set({
          status: input.status,
          deliveryChannel: input.channel,
          deliveredAt: new Date(),
          deliveryError: input.status === "failed" ? input.error : null,
        })
        .where(and(eq(messages.id, id), eq(messages.status, "drafted")))
        .returning();

      if (!updated) {
        throw new ConflictException(
          `Message ${id} is already ${existing.status} — another delivery run has it.`,
        );
      }

      return updated;
    });

    await this.audit.recordSystem({
      tenantId,
      // Distinct actions, because "did we contact this patient" and "did we
      // try and fail" are different questions a reviewer asks.
      action: input.status === "sent" ? "message.sent" : "message.delivery_failed",
      resourceType: "message",
      resourceId: row.id,
      metadata: {
        patientRef: row.patientRef,
        channel: input.channel,
        ...(input.status === "failed" ? { error: input.error } : {}),
      },
    });

    return toSummary(row);
  }
}

function toSummary(row: typeof messages.$inferSelect): MessageSummary {
  return {
    id: row.id,
    patientRef: row.patientRef,
    templateId: row.templateId,
    body: row.body,
    status: row.status,
    deliveryChannel: row.deliveryChannel,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    deliveryError: row.deliveryError,
    createdAt: row.createdAt.toISOString(),
  };
}
