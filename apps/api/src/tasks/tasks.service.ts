import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AppendTraceInput, CompleteTaskInput, CreateTaskInput } from "@clinicpilot/shared-types";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { currentTenantId } from "../common/tenant";
import { DbService } from "../db/db.service";
import { agents, llmUsage, tasks, traces } from "../db/schema";
import { TaskQueueService } from "../queue/task-queue.service";
import { RealtimeService } from "../realtime/realtime.service";

/**
 * Statuses a task may be moved to `running` from.
 *
 * `queued` is the normal path and `failed` is a deliberate retry. The two
 * omissions are the point: a `running` task is already in flight, and letting
 * a second worker start it would double-spend the model and repeat the FHIR
 * write; a `resolved` or `escalated` task is finished, and re-running it would
 * move an appointment that has already been moved. This is what makes the
 * queue's at-least-once delivery safe.
 */
const RUNNABLE_FROM = ["queued", "failed"] as const;

export function isRunnable(status: string): boolean {
  return (RUNNABLE_FROM as readonly string[]).includes(status);
}

@Injectable()
export class TasksService {
  constructor(
    private readonly dbService: DbService,
    private readonly realtime: RealtimeService,
    private readonly queue: TaskQueueService,
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

    // After the commit, never inside it: a job that referenced a row a rolled
    // back transaction never wrote would be picked up and 404 immediately.
    const queued = await this.queue.enqueue({
      taskId: task!.id,
      input: task!.input,
      agentKind: input.agentKind,
    });

    // Surfaced rather than swallowed — `queued` means two different things
    // depending on this, and the client is the only one who can tell a user
    // their message will need a nudge.
    return { ...task!, queued };
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

  /**
   * Claim a task for a run.
   *
   * The claim is what makes duplicate delivery harmless. A worker whose
   * connection dropped mid-run will retry, and the retry has no way of knowing
   * the first attempt is still going — so the second one is refused here
   * rather than allowed to spend a second conversation's worth of tokens
   * moving an appointment that is already being moved.
   */
  async markRunning(id: string) {
    const task = await this.findOne(id);

    if (!isRunnable(task.status)) {
      throw new ConflictException(
        `Task ${id} is ${task.status}, not runnable. ` +
          "A task can only be run from 'queued' or after a failure.",
      );
    }

    // Guarded in the UPDATE as well as checked above: two workers can both
    // pass the read before either writes, and only one may win. Postgres
    // serialises the row, so the loser updates nothing and gets the 409.
    const [updated] = await this.db
      .update(tasks)
      .set({ status: "running" })
      .where(and(eq(tasks.id, id), inArray(tasks.status, [...RUNNABLE_FROM])))
      .returning();

    if (!updated) {
      throw new ConflictException(`Task ${id} was claimed by another run.`);
    }

    this.realtime.publish({
      type: "task:status",
      taskId: id,
      status: updated.status,
      outcome: updated.outcome,
    });

    return updated;
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
