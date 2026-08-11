import { Injectable } from "@nestjs/common";
import type { MessageSummary, RecordMessageInput } from "@clinicpilot/shared-types";
import { desc, eq } from "drizzle-orm";

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
}

function toSummary(row: typeof messages.$inferSelect): MessageSummary {
  return {
    id: row.id,
    patientRef: row.patientRef,
    templateId: row.templateId,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
