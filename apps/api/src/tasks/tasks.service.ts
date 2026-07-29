import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AppendTraceInput, CompleteTaskInput, CreateTaskInput } from "@clinicpilot/shared-types";
import { and, asc, desc, eq } from "drizzle-orm";

import { currentTenantId } from "../common/tenant";
import { DbService } from "../db/db.service";
import { agents, llmUsage, tasks, traces } from "../db/schema";
import { RealtimeService } from "../realtime/realtime.service";

@Injectable()
export class TasksService {
  constructor(
    private readonly dbService: DbService,
    private readonly realtime: RealtimeService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async create(input: CreateTaskInput) {
    const tenantId = currentTenantId();

    const [agent] = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.kind, input.agentKind)))
      .limit(1);

    if (!agent) {
      throw new NotFoundException(
        `No ${input.agentKind} agent is deployed for this tenant. Run \`pnpm db:seed\`.`,
      );
    }

    const [task] = await this.db
      .insert(tasks)
      .values({
        tenantId,
        agentId: agent.id,
        channel: input.channel,
        input: input.input,
        status: "queued",
      })
      .returning();

    return task!;
  }

  async list(limit = 50) {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.tenantId, currentTenantId()))
      .orderBy(desc(tasks.createdAt))
      .limit(limit);
  }

  async findOne(id: string) {
    const [task] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, currentTenantId())))
      .limit(1);

    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }

  /** Task plus its trace steps in run order — what the Trace Viewer replays. */
  async findWithTrace(id: string) {
    const task = await this.findOne(id);

    const steps = await this.db
      .select()
      .from(traces)
      .where(eq(traces.taskId, id))
      .orderBy(asc(traces.stepNo));

    return { task, steps: steps.map(toTraceStepPayload) };
  }

  async markRunning(id: string) {
    await this.findOne(id);
    const [updated] = await this.db
      .update(tasks)
      .set({ status: "running" })
      .where(eq(tasks.id, id))
      .returning();
    return updated!;
  }

  async complete(id: string, input: CompleteTaskInput) {
    await this.findOne(id);

    const [updated] = await this.db
      .update(tasks)
      .set({
        status: input.status,
        outcome: input.outcome ?? null,
        resolvedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();

    this.realtime.publish({
      type: "task:status",
      taskId: id,
      status: updated!.status,
      outcome: updated!.outcome,
    });

    return updated!;
  }

  /**
   * Append one trace step, and record spend separately when the step made a
   * model call.
   *
   * Both writes go in a transaction: a trace step showing a cost with no
   * matching `llm_usage` row would make the spend dashboard disagree with the
   * Trace Viewer, which is precisely the reconciliation ADR-004 exists to keep
   * possible.
   */
  async appendTrace(taskId: string, step: AppendTraceInput) {
    const task = await this.findOne(taskId);

    try {
      const saved = await this.insertTrace(task, taskId, step);
      // Broadcast only after the write commits. Emitting first would show the
      // Trace Viewer a step that a failed transaction then never persisted.
      this.realtime.publish({ type: "trace:step", taskId, step: saved });
      return saved;
    } catch (error) {
      // The unique (task_id, step_no) index caught a replay. That is the
      // caller sending the same step twice — a retry after a timeout, most
      // likely — not a server fault, so it must not read as 500 or the AI
      // service will keep retrying something that will never succeed.
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Step ${step.stepNo} already recorded for task ${taskId}`,
        );
      }
      throw error;
    }
  }

  private async insertTrace(
    task: typeof tasks.$inferSelect,
    taskId: string,
    step: AppendTraceInput,
  ) {
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(traces)
        .values({
          taskId,
          tenantId: task.tenantId,
          stepNo: step.stepNo,
          kind: step.kind,
          label: step.label,
          detail: step.detail,
          content: step.content ?? null,
          tokensIn: step.tokensIn ?? null,
          tokensOut: step.tokensOut ?? null,
          // numeric(12,6) round-trips as a string; formatting here keeps the
          // stored scale explicit instead of relying on driver coercion.
          costUsd: step.costUsd == null ? null : step.costUsd.toFixed(6),
          latencyMs: step.latencyMs ?? null,
        })
        .returning();

      if (step.model) {
        await tx.insert(llmUsage).values({
          tenantId: task.tenantId,
          agentId: task.agentId,
          taskId,
          model: step.model,
          tokensIn: step.tokensIn ?? 0,
          tokensOut: step.tokensOut ?? 0,
          cacheReadTokens: step.cacheReadTokens ?? 0,
          cacheWriteTokens: step.cacheWriteTokens ?? 0,
          costUsd: (step.costUsd ?? 0).toFixed(6),
        });
      }

      return toTraceStepPayload(inserted!);
    });
  }
}

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * Drizzle wraps driver errors in its own `DrizzleQueryError`, so the pg error
 * carrying `code` sits on `.cause` rather than on the thrown error. Walking the
 * chain keeps this working whether or not a future version stops wrapping.
 */
export function isUniqueViolation(error: unknown, depth = 5): boolean {
  let current: unknown = error;

  for (let i = 0; i <= depth; i++) {
    if (typeof current !== "object" || current === null) return false;
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

type TraceRow = typeof traces.$inferSelect;

/** Wire shape for the SPA — camelCase, and cost as a number rather than text. */
export function toTraceStepPayload(row: TraceRow) {
  return {
    id: row.id,
    taskId: row.taskId,
    stepNo: row.stepNo,
    kind: row.kind,
    label: row.label,
    detail: row.detail,
    content: row.content,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costUsd: row.costUsd === null ? null : Number(row.costUsd),
    latencyMs: row.latencyMs,
    createdAt: row.createdAt,
  };
}
