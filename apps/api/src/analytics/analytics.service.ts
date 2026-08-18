import { Injectable } from "@nestjs/common";
import type {
  AnalyticsAgent,
  AnalyticsDay,
  AnalyticsModel,
  AnalyticsSummary,
} from "@clinicpilot/shared-types";
import { and, eq, gte, sql } from "drizzle-orm";

import { currentTenantId } from "../common/tenant";
import { DbService } from "../db/db.service";
import { agents, llmUsage, messages, tasks } from "../db/schema";

/** Window bounds. A month by default; a quarter is the most anyone asked for. */
export const MIN_DAYS = 1;
export const MAX_DAYS = 90;
export const DEFAULT_DAYS = 30;

/**
 * The UTC day a timestamp falls in, as `YYYY-MM-DD`.
 *
 * UTC on both sides of the wire — the SQL buckets with `at time zone 'utc'` and
 * this builds the spine the same way — because a series whose buckets depend on
 * the server's local timezone silently shifts when the gateway is deployed
 * somewhere else, and the shift shows up as one duplicated day and one missing
 * one rather than as an error.
 */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Every UTC day in the window, oldest first, inclusive of today.
 *
 * Exported because it is the part worth testing on its own: an off-by-one here
 * is invisible on a chart and wrong in a report.
 */
export function daySpine(days: number, now: Date): string[] {
  const spine: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    spine.push(utcDay(new Date(now.getTime() - offset * 86_400_000)));
  }
  return spine;
}

/** Clamps a caller-supplied `?days=` to something the query can serve. */
export function clampDays(raw: unknown): number {
  // Blank is absent, checked before `Number` gets a look at it: `Number("")`
  // is 0 rather than NaN, so a bare `?days=` in the URL would fall through the
  // finite check, clamp to the minimum, and quietly serve a one-day window
  // that looks like a system with nothing in it.
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return DEFAULT_DAYS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.trunc(parsed)));
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Everything the Analytics screen draws, in one round trip.
   *
   * One endpoint rather than five, because every panel is scoped by the same
   * window: five endpoints would let the tiles and the chart disagree about
   * which days they cover the moment one of them was refetched alone.
   *
   * Like `AgentsService`, the explicit `tenantId` predicates stay even though
   * RLS enforces the same thing. Belt and braces: RLS is the backstop for a
   * query that forgets, not a licence to stop filtering.
   */
  async summary(days: number, now = new Date()): Promise<AnalyticsSummary> {
    const tenantId = currentTenantId();
    const spine = daySpine(days, now);
    // Midnight UTC on the first day of the window. Built from the spine rather
    // than separately, so the SQL predicate and the rendered axis cannot
    // disagree about where the window starts.
    const since = new Date(`${spine[0]!}T00:00:00.000Z`);

    return this.dbService.withTenant(tenantId, async (tx) => {
      const dayExpr = sql<string>`to_char(date_trunc('day', ${tasks.createdAt} at time zone 'utc'), 'YYYY-MM-DD')`;
      const spendDayExpr = sql<string>`to_char(date_trunc('day', ${llmUsage.createdAt} at time zone 'utc'), 'YYYY-MM-DD')`;

      const [taskDays, spendDays, agentRows, agentSpend, modelRows, latencyRow, followUpRow] =
        await Promise.all([
          tx
            .select({
              date: dayExpr,
              tasks: sql<number>`count(*)::int`,
              resolved: sql<number>`count(*) filter (where ${tasks.status} = 'resolved')::int`,
              escalated: sql<number>`count(*) filter (where ${tasks.status} = 'escalated')::int`,
              failed: sql<number>`count(*) filter (where ${tasks.status} = 'failed')::int`,
            })
            .from(tasks)
            .where(and(eq(tasks.tenantId, tenantId), gte(tasks.createdAt, since)))
            .groupBy(dayExpr),

          tx
            .select({
              date: spendDayExpr,
              costUsd: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)`,
            })
            .from(llmUsage)
            .where(and(eq(llmUsage.tenantId, tenantId), gte(llmUsage.createdAt, since)))
            .groupBy(spendDayExpr),

          tx
            .select({
              agentId: agents.id,
              name: agents.name,
              kind: agents.kind,
              tasks: sql<number>`count(${tasks.id})::int`,
              resolved: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'resolved')::int`,
              escalated: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'escalated')::int`,
              failed: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'failed')::int`,
            })
            .from(agents)
            // The window lives in the join predicate, not in `where`: as a
            // filter it would drop any agent that did nothing this month, and
            // an agent sitting at zero is exactly what the reader needs to see.
            .leftJoin(tasks, and(eq(tasks.agentId, agents.id), gte(tasks.createdAt, since)))
            .where(eq(agents.tenantId, tenantId))
            .groupBy(agents.id, agents.name, agents.kind),

          tx
            .select({
              agentId: llmUsage.agentId,
              costUsd: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)`,
            })
            .from(llmUsage)
            .where(and(eq(llmUsage.tenantId, tenantId), gte(llmUsage.createdAt, since)))
            .groupBy(llmUsage.agentId),

          tx
            .select({
              model: llmUsage.model,
              calls: sql<number>`count(*)::int`,
              tokensIn: sql<number>`coalesce(sum(${llmUsage.tokensIn}), 0)::int`,
              tokensOut: sql<number>`coalesce(sum(${llmUsage.tokensOut}), 0)::int`,
              cacheReadTokens: sql<number>`coalesce(sum(${llmUsage.cacheReadTokens}), 0)::int`,
              costUsd: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)`,
            })
            .from(llmUsage)
            .where(and(eq(llmUsage.tenantId, tenantId), gte(llmUsage.createdAt, since)))
            .groupBy(llmUsage.model),

          tx
            .select({
              // `percentile_cont` over the wall clock between enqueue and the
              // final status. Only finished tasks: a run still in flight has no
              // duration yet, and counting it as zero would drag both
              // percentiles toward instant.
              p50: sql<string | null>`percentile_cont(0.5) within group (
                order by extract(epoch from (${tasks.resolvedAt} - ${tasks.createdAt})) * 1000
              )`,
              p95: sql<string | null>`percentile_cont(0.95) within group (
                order by extract(epoch from (${tasks.resolvedAt} - ${tasks.createdAt})) * 1000
              )`,
              samples: sql<number>`count(*)::int`,
            })
            .from(tasks)
            .where(
              and(
                eq(tasks.tenantId, tenantId),
                gte(tasks.createdAt, since),
                sql`${tasks.resolvedAt} is not null`,
              ),
            ),

          tx
            .select({
              drafted: sql<number>`count(*) filter (where ${messages.status} = 'drafted')::int`,
              sent: sql<number>`count(*) filter (where ${messages.status} = 'sent')::int`,
              failed: sql<number>`count(*) filter (where ${messages.status} = 'failed')::int`,
            })
            .from(messages)
            .where(and(eq(messages.tenantId, tenantId), gte(messages.createdAt, since))),
        ]);

      const tasksByDate = new Map(taskDays.map((row) => [row.date, row]));
      const spendByDate = new Map(spendDays.map((row) => [row.date, Number(row.costUsd)]));

      const daily: AnalyticsDay[] = spine.map((date) => {
        const row = tasksByDate.get(date);
        return {
          date,
          tasks: row?.tasks ?? 0,
          resolved: row?.resolved ?? 0,
          escalated: row?.escalated ?? 0,
          failed: row?.failed ?? 0,
          costUsd: spendByDate.get(date) ?? 0,
        };
      });

      const spendByAgent = new Map(agentSpend.map((row) => [row.agentId, Number(row.costUsd)]));

      const agentSummaries: AnalyticsAgent[] = agentRows
        .map((row): AnalyticsAgent => {
          const costUsd = spendByAgent.get(row.agentId) ?? 0;
          const finished = row.resolved + row.escalated + row.failed;

          return {
            agentId: row.agentId,
            name: row.name,
            kind: row.kind,
            tasks: row.tasks,
            resolved: row.resolved,
            escalated: row.escalated,
            failed: row.failed,
            successRate: finished === 0 ? null : row.resolved / finished,
            escalationRate: finished === 0 ? null : row.escalated / finished,
            costUsd,
            costPerResolved: row.resolved === 0 ? null : costUsd / row.resolved,
          };
        })
        .sort((a, b) => b.tasks - a.tasks || a.name.localeCompare(b.name));

      const models: AnalyticsModel[] = modelRows
        .map((row) => ({
          model: row.model,
          calls: row.calls,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          cacheReadTokens: row.cacheReadTokens,
          costUsd: Number(row.costUsd),
        }))
        .sort((a, b) => b.costUsd - a.costUsd || a.model.localeCompare(b.model));

      const totals = daily.reduce(
        (acc, day) => ({
          tasks: acc.tasks + day.tasks,
          resolved: acc.resolved + day.resolved,
          escalated: acc.escalated + day.escalated,
          failed: acc.failed + day.failed,
          costUsd: acc.costUsd + day.costUsd,
        }),
        { tasks: 0, resolved: 0, escalated: 0, failed: 0, costUsd: 0 },
      );

      const modelCalls = models.reduce((sum, row) => sum + row.calls, 0);

      return {
        days,
        from: spine[0]!,
        daily,
        agents: agentSummaries,
        models,
        latency: {
          // `percentile_cont` returns null over an empty set, and the driver
          // hands numerics back as strings. Both roads lead to null here rather
          // than to 0, which would draw a flat, fast-looking line for a system
          // that has never finished anything.
          p50Ms: latencyRow[0]?.p50 == null ? null : Math.round(Number(latencyRow[0].p50)),
          p95Ms: latencyRow[0]?.p95 == null ? null : Math.round(Number(latencyRow[0].p95)),
          samples: latencyRow[0]?.samples ?? 0,
        },
        followUps: {
          drafted: followUpRow[0]?.drafted ?? 0,
          sent: followUpRow[0]?.sent ?? 0,
          failed: followUpRow[0]?.failed ?? 0,
        },
        totals: {
          ...totals,
          costPerResolved: totals.resolved === 0 ? null : totals.costUsd / totals.resolved,
          modelCalls,
          tokensIn: models.reduce((sum, row) => sum + row.tokensIn, 0),
          tokensOut: models.reduce((sum, row) => sum + row.tokensOut, 0),
        },
      };
    });
  }
}
