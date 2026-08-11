import { Injectable, Logger } from "@nestjs/common";
import type { AuditQuery } from "@clinicpilot/shared-types";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import { currentActor } from "../common/request-context";
import { DbService } from "../db/db.service";
import { auditLog, users } from "../db/schema";

export interface AuditEntryInput {
  tenantId?: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * Write one audit entry.
   *
   * Never throws. An audit write failing must not roll back the action it was
   * recording — refusing to reschedule an appointment because the log was
   * briefly unavailable is the wrong trade, and a caller that has to
   * `try/catch` every audit call will eventually forget one.
   *
   * The honest consequence is that this is append-only *and* best-effort: the
   * database guarantees an entry cannot be altered, not that one exists. A
   * failed write is logged at error level so it is at least visible. Making it
   * transactional with each action is the Phase 4 hardening.
   */
  async record(entry: AuditEntryInput): Promise<void> {
    const actor = currentActor();
    const tenantId = entry.tenantId ?? actor?.tenantId;

    if (!tenantId) {
      this.logger.error(`audit entry '${entry.action}' has no tenant; dropped`);
      return;
    }

    try {
      await this.dbService.withTenant(tenantId, async (tx) => {
        await tx.insert(auditLog).values({
          tenantId,
          actorId: entry.actorId !== undefined ? entry.actorId : (actor?.userId ?? null),
          actorEmail: entry.actorEmail !== undefined ? entry.actorEmail : (actor?.email ?? null),
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          metadata: entry.metadata ?? null,
          ip: entry.ip ?? actor?.ip ?? null,
        });
      });
    } catch (error) {
      this.logger.error(
        `failed to write audit entry '${entry.action}': ${(error as Error).message}`,
      );
    }
  }

  /**
   * An action taken with no user in the request — the AI service reading a
   * patient, the worker starting a run.
   *
   * Recorded as `system` rather than attributed to whoever submitted the task.
   * A machine's FHIR read is not that person's access, and an audit trail that
   * blurs the two is worse than one that says "system": it invents a fact
   * about a human.
   */
  async recordSystem(entry: Omit<AuditEntryInput, "actorId" | "actorEmail">): Promise<void> {
    await this.record({ ...entry, actorId: null, actorEmail: "system" });
  }

  /** The Audit Log screen. Tenant-scoped by RLS, filtered by the query. */
  async list(query: AuditQuery) {
    const actor = currentActor();
    if (!actor) throw new Error("audit list requires an authenticated request");

    return this.dbService.withTenant(actor.tenantId, async (tx) => {
      const filters: SQL[] = [];

      if (query.action) {
        filters.push(sql`${auditLog.action} ilike ${`%${query.action}%`}`);
      }
      if (query.resourceType) {
        filters.push(eq(auditLog.resourceType, query.resourceType));
      }
      if (query.actor) {
        filters.push(sql`${auditLog.actorEmail} ilike ${`%${query.actor}%`}`);
      }

      return tx
        .select({
          id: auditLog.id,
          actorEmail: auditLog.actorEmail,
          actorName: users.name,
          action: auditLog.action,
          resourceType: auditLog.resourceType,
          resourceId: auditLog.resourceId,
          metadata: auditLog.metadata,
          ip: auditLog.ip,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorId))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(auditLog.createdAt))
        .limit(query.limit);
    });
  }
}

/** RFC 4180 CSV. Quotes everything — simpler than deciding what needs it. */
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return '""';
    const text = value instanceof Date ? value.toISOString() : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = [columns.map(escape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escape(row[column])).join(","));
  }

  // CRLF, because the spec says so and Excel is the actual consumer.
  return lines.join("\r\n");
}
