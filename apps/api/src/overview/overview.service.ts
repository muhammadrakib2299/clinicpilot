import { Injectable } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";

import { currentTenantId } from "../common/tenant";
import { DbService } from "../db/db.service";
import { agents, llmUsage, tasks, traces } from "../db/schema";

@Injectable()
export class OverviewService {
  constructor(private readonly dbService: DbService) {}

  /**
   * KPI tiles.
   *
   * These are *operational* metrics — tasks, outcomes, spend — because those are
   * what the system actually observes. The mock this replaced showed business
   * outcomes ("no-show rate −4pp", "76% calls deflected") that nothing in the
   * product measures. Inventing an outcome metric is worse than omitting it;
   * those return in Phase 4 when there is a baseline to compare against.
   */
  async kpis() {
    const tenantId = currentTenantId();

    const [counts] = await this.dbService.db
      .select({
        total: sql<number>`count(*)::int`,
        today: sql<number>`count(*) filter (
          where ${tasks.createdAt} >= date_trunc('day', now())
        )::int`,
        resolved: sql<number>`count(*) filter (where ${tasks.status} = 'resolved')::int`,
        escalated: sql<number>`count(*) filter (where ${tasks.status} = 'escalated')::int`,
        failed: sql<number>`count(*) filter (where ${tasks.status} = 'failed')::int`,
        open: sql<number>`count(*) filter (where ${tasks.status} in ('queued','running'))::int`,
      })
      .from(tasks)
      .where(eq(tasks.tenantId, tenantId));

    const [spend] = await this.dbService.db
      .select({
        totalCost: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)`,
        tokensIn: sql<number>`coalesce(sum(${llmUsage.tokensIn}), 0)::int`,
        tokensOut: sql<number>`coalesce(sum(${llmUsage.tokensOut}), 0)::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(llmUsage)
      .where(eq(llmUsage.tenantId, tenantId));

    const totalCost = Number(spend?.totalCost ?? 0);
    const finished = (counts?.resolved ?? 0) + (counts?.escalated ?? 0) + (counts?.failed ?? 0);

    return {
      tasksTotal: counts?.total ?? 0,
      tasksToday: counts?.today ?? 0,
      tasksOpen: counts?.open ?? 0,
      resolved: counts?.resolved ?? 0,
      escalated: counts?.escalated ?? 0,
      failed: counts?.failed ?? 0,
      successRate: finished === 0 ? null : (counts?.resolved ?? 0) / finished,
      totalCostUsd: totalCost,
      costPerResolvedTask: counts?.resolved ? totalCost / counts.resolved : null,
      modelCalls: spend?.calls ?? 0,
      tokensIn: spend?.tokensIn ?? 0,
      tokensOut: spend?.tokensOut ?? 0,
    };
  }

  /** Most recent trace steps across every task — the activity feed. */
  async activity(limit = 8) {
    const rows = await this.dbService.db
      .select({
        id: traces.id,
        taskId: traces.taskId,
        kind: traces.kind,
        label: traces.label,
        detail: traces.detail,
        createdAt: traces.createdAt,
        agentName: agents.name,
      })
      .from(traces)
      .innerJoin(tasks, eq(tasks.id, traces.taskId))
      .innerJoin(agents, eq(agents.id, tasks.agentId))
      .where(eq(traces.tenantId, currentTenantId()))
      .orderBy(desc(traces.createdAt))
      .limit(limit);

    return rows;
  }
}
