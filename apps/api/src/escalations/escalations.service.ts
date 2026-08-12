import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  EscalationQuery,
  EscalationSummary,
  ResolveEscalationInput,
} from "@clinicpilot/shared-types";
import { and, desc, eq, sql } from "drizzle-orm";

import { AuditService } from "../audit/audit.service";
import { currentActor, currentTenantId } from "../common/tenant";
import type { Db } from "../db/client";
import { DbService } from "../db/db.service";
import { agents, escalations, tasks, users } from "../db/schema";

/**
 * The human queue.
 *
 * Escalation has always *worked* — the router refuses to route, the loop gives
 * up after eight iterations, an unverifiable answer is not delivered — and
 * until now all three ended the same way: a task sitting in the inbox marked
 * `escalated`, with nobody told. This is the other half.
 */
@Injectable()
export class EscalationsService {
  constructor(
    private readonly dbService: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Queue one, in the caller's transaction.
   *
   * Takes a `tx` rather than opening its own, because the only correct caller
   * is `TasksService.complete()` and the insert has to commit or roll back with
   * the status change it accompanies. A task marked `escalated` with no queue
   * row is the exact failure this table exists to prevent, and two transactions
   * is how you get one.
   */
  async queue(
    tx: Db,
    input: {
      tenantId: string;
      taskId: string;
      reason?: EscalationSummary["reason"];
      summary: string | null;
    },
  ) {
    const [row] = await tx
      .insert(escalations)
      .values({
        tenantId: input.tenantId,
        taskId: input.taskId,
        reason: input.reason ?? "unspecified",
        // Never empty: this is the first line a human reads, and "—" at least
        // says the agent finished without explaining itself.
        summary: input.summary?.trim() || "The agent escalated without a summary.",
      })
      .returning();

    return row!;
  }

  async list(query: EscalationQuery): Promise<EscalationSummary[]> {
    return this.select(currentTenantId(), {
      status: query.status,
      limit: query.limit,
    });
  }

  /**
   * The queue query, shared by the list and by returning one row after a write.
   *
   * `acknowledgedBy` and `resolvedBy` come back as correlated subqueries rather
   * than two more joins. Both are nullable and independently so; a pair of left
   * joins to the same table needs two aliases and reads worse for a value that
   * is one email address.
   */
  private async select(
    tenantId: string,
    filter: { id?: string; status?: EscalationSummary["status"]; limit: number },
  ): Promise<EscalationSummary[]> {
    const conditions = [eq(escalations.tenantId, tenantId)];
    if (filter.id) conditions.push(eq(escalations.id, filter.id));
    if (filter.status) conditions.push(eq(escalations.status, filter.status));

    const rows = await this.dbService.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: escalations.id,
          taskId: escalations.taskId,
          reason: escalations.reason,
          summary: escalations.summary,
          status: escalations.status,
          taskInput: tasks.input,
          taskChannel: tasks.channel,
          agentName: agents.name,
          acknowledgedBy: sql<string | null>`(
            select ${users.email} from ${users} where ${users.id} = ${escalations.acknowledgedBy}
          )`.as("acknowledged_by_email"),
          acknowledgedAt: escalations.acknowledgedAt,
          resolvedBy: sql<string | null>`(
            select ${users.email} from ${users} where ${users.id} = ${escalations.resolvedBy}
          )`.as("resolved_by_email"),
          resolvedAt: escalations.resolvedAt,
          resolution: escalations.resolution,
          createdAt: escalations.createdAt,
        })
        .from(escalations)
        .innerJoin(tasks, eq(tasks.id, escalations.taskId))
        .leftJoin(agents, eq(agents.id, tasks.agentId))
        .where(and(...conditions))
        .orderBy(desc(escalations.createdAt))
        .limit(filter.limit),
    );

    return rows.map((row) => ({
      ...row,
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** How many are still outstanding — the number on the sidebar badge. */
  async openCount(): Promise<{ open: number; acknowledged: number }> {
    const tenantId = currentTenantId();

    const rows = await this.dbService.withTenant(tenantId, (tx) =>
      tx
        .select({ status: escalations.status, count: sql<number>`count(*)` })
        .from(escalations)
        .where(eq(escalations.tenantId, tenantId))
        .groupBy(escalations.status),
    );

    const by = new Map(rows.map((row) => [row.status, Number(row.count)]));
    return { open: by.get("open") ?? 0, acknowledged: by.get("acknowledged") ?? 0 };
  }

  /**
   * Claim one, so two people do not work the same escalation.
   *
   * Guarded in the UPDATE as well as read first, the same shape as
   * `markRunning`: two coordinators can both pass the read before either
   * writes, and only one may win. The loser gets a 409 naming who holds it
   * rather than a silent no-op that looks like success.
   */
  async acknowledge(id: string): Promise<EscalationSummary> {
    const actor = requireActor();

    const row = await this.dbService.withTenant(actor.tenantId, async (tx) => {
      const existing = await this.loadOne(tx, actor.tenantId, id);

      if (existing.status !== "open") {
        throw new ConflictException(
          existing.status === "resolved"
            ? `That escalation is already resolved.`
            : `Someone is already working on that escalation.`,
        );
      }

      const [updated] = await tx
        .update(escalations)
        .set({ status: "acknowledged", acknowledgedBy: actor.userId, acknowledgedAt: new Date() })
        .where(and(eq(escalations.id, id), eq(escalations.status, "open")))
        .returning();

      if (!updated) throw new ConflictException("Someone else claimed that escalation first.");
      return updated;
    });

    await this.audit.record({
      action: "escalation.acknowledge",
      resourceType: "escalation",
      resourceId: id,
      metadata: { taskId: row.taskId, reason: row.reason },
    });

    return this.one(actor.tenantId, id);
  }

  /**
   * Close one, with a note saying what was done.
   *
   * Resolvable straight from `open`: requiring someone to claim a thing before
   * closing it is a workflow step that buys nothing when the person closing it
   * is the person who dealt with it.
   */
  async resolve(id: string, input: ResolveEscalationInput): Promise<EscalationSummary> {
    const actor = requireActor();

    const row = await this.dbService.withTenant(actor.tenantId, async (tx) => {
      const existing = await this.loadOne(tx, actor.tenantId, id);

      if (existing.status === "resolved") {
        throw new ConflictException("That escalation is already resolved.");
      }

      const [updated] = await tx
        .update(escalations)
        .set({
          status: "resolved",
          resolvedBy: actor.userId,
          resolvedAt: new Date(),
          resolution: input.resolution,
        })
        .where(eq(escalations.id, id))
        .returning();

      return updated!;
    });

    await this.audit.record({
      action: "escalation.resolve",
      resourceType: "escalation",
      resourceId: id,
      // The note goes in the audit entry too. `escalations` is editable and
      // `audit_log` is not, so this is the copy that cannot be rewritten later.
      metadata: { taskId: row.taskId, reason: row.reason, resolution: input.resolution },
    });

    return this.one(actor.tenantId, id);
  }

  private async one(tenantId: string, id: string): Promise<EscalationSummary> {
    const [found] = await this.select(tenantId, { id, limit: 1 });
    if (!found) throw new NotFoundException(`Escalation ${id} not found`);
    return found;
  }

  private async loadOne(tx: Db, tenantId: string, id: string) {
    const [row] = await tx
      .select()
      .from(escalations)
      .where(and(eq(escalations.id, id), eq(escalations.tenantId, tenantId)))
      .limit(1);

    if (!row) throw new NotFoundException(`Escalation ${id} not found`);
    return row;
  }
}

function requireActor() {
  const actor = currentActor();
  if (!actor) throw new Error("escalation changes require an authenticated request");
  return actor;
}
