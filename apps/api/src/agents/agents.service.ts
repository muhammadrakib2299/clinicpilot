import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { currentTenantId } from "../common/tenant";
import { DbService } from "../db/db.service";
import { agents, llmUsage, tasks } from "../db/schema";

@Injectable()
export class AgentsService {
  constructor(private readonly dbService: DbService) {}

  /**
   * The fleet, with the stats the agent cards render.
   *
   * Every number here is derived from real rows. A freshly seeded install shows
   * zeros, which is correct and honest — the previous version of this screen
   * rendered invented figures (54 tasks, 92% success) that looked like a working
   * product and were not.
   */
  async list() {
    const tenantId = currentTenantId();

    const rows = await this.dbService.db
      .select({
        id: agents.id,
        kind: agents.kind,
        name: agents.name,
        status: agents.status,
        tasksToday: sql<number>`count(${tasks.id}) filter (
          where ${tasks.createdAt} >= date_trunc('day', now())
        )::int`,
        total: sql<number>`count(${tasks.id})::int`,
        resolved: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'resolved')::int`,
        escalated: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'escalated')::int`,
      })
      .from(agents)
      .leftJoin(tasks, eq(tasks.agentId, agents.id))
      .where(eq(agents.tenantId, tenantId))
      .groupBy(agents.id, agents.kind, agents.name, agents.status);

    const spend = await this.dbService.db
      .select({
        agentId: llmUsage.agentId,
        cost: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)`,
        calls: sql<number>`count(*)::int`,
      })
      .from(llmUsage)
      .where(eq(llmUsage.tenantId, tenantId))
      .groupBy(llmUsage.agentId);

    const byAgent = new Map(spend.map((row) => [row.agentId, row]));

    return rows.map((row) => {
      const agentSpend = byAgent.get(row.id);
      const totalCost = Number(agentSpend?.cost ?? 0);
      // Rates are null rather than 0 when nothing has run. Zero would read as
      // "0% success", which is a very different claim from "no data yet".
      const finished = row.resolved + row.escalated;

      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        status: row.status,
        tasksToday: row.tasksToday,
        totalTasks: row.total,
        successRate: finished === 0 ? null : row.resolved / finished,
        escalationRate: finished === 0 ? null : row.escalated / finished,
        costPerTask: row.total === 0 ? null : totalCost / row.total,
        totalCostUsd: totalCost,
      };
    });
  }

  async findByKind(kind: (typeof agents.$inferSelect)["kind"]) {
    const [agent] = await this.dbService.db
      .select()
      .from(agents)
      .where(and(eq(agents.tenantId, currentTenantId()), eq(agents.kind, kind)))
      .limit(1);

    return agent ?? null;
  }
}
