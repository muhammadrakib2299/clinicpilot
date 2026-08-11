import { existsSync } from "node:fs";

import { Logger } from "@nestjs/common";
import { UnrecoverableError, Worker, type Job } from "bullmq";

import { createRedis, isRetryable, TASK_QUEUE, type RunTaskJob } from "./queue/task-queue";

const ROOT_ENV = "../../.env";
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

// Nest's logger without a Nest application: this process needs none of the DI
// container, but `pnpm logs` interleaves it with the gateway and two log
// formats in one stream is a needless thing to read past.
const logger = new Logger("Worker");

/**
 * Consumes queued tasks and asks the AI service to run them.
 *
 * Its own process, not a provider inside the gateway. An agent run holds a
 * connection open for tens of seconds, and workers are the thing you scale
 * when a backlog builds — neither is true of the HTTP API, so tying their
 * lifecycles together would mean scaling one to fix the other.
 *
 * Plain Node rather than a Nest application. The whole job is: take a job off
 * a queue, make one HTTP call, interpret the status. There is nothing here to
 * inject.
 */

const AI_SERVICE_URL = (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/$/, "");

/** How long one agent run may take before the worker gives up on it. */
const RUN_TIMEOUT_MS = Number(process.env.WORKER_RUN_TIMEOUT_MS ?? 300_000);

/**
 * One run at a time by default.
 *
 * Every concurrent run is a live Claude conversation being billed, so the
 * ceiling on this is a spend decision before it is a throughput one.
 */
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 1);

async function runTask(job: Job<RunTaskJob>): Promise<void> {
  const { taskId, tenantId, input, agentKind } = job.data;

  const response = await fetch(`${AI_SERVICE_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, tenantId, input, agentKind }),
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
  });

  if (response.ok) {
    const result = (await response.json()) as { outcome?: string; costUsd?: number };
    logger.log(
      `task ${taskId} ${result.outcome ?? "done"} ($${(result.costUsd ?? 0).toFixed(6)})`,
    );
    return;
  }

  const detail = await readDetail(response);

  if (!isRetryable(response.status)) {
    throw new UnrecoverableError(`AI service ${response.status}: ${detail}`);
  }

  throw new Error(`AI service ${response.status}: ${detail}`);
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : JSON.stringify(body);
  } catch {
    return response.statusText;
  }
}

const connection = createRedis();
connection.on("error", (error) => logger.warn(`redis: ${error.message}`));

const worker = new Worker<RunTaskJob>(TASK_QUEUE, runTask, {
  connection,
  concurrency: CONCURRENCY,
});

worker.on("failed", (job, error) => {
  const attempts = job ? `${job.attemptsMade}/${job.opts.attempts ?? 1}` : "?";
  logger.error(`task ${job?.data.taskId} failed (attempt ${attempts}): ${error.message}`);
});

worker.on("ready", () => {
  logger.log(
    `consuming '${TASK_QUEUE}' -> ${AI_SERVICE_URL}/run (concurrency ${CONCURRENCY})`,
  );
});

/**
 * `worker.close()` waits for in-flight jobs, so a deploy does not abandon an
 * agent mid-conversation — the job would be retried and the tokens spent
 * twice. SIGINT and SIGTERM both, because one is Ctrl-C and the other is
 * Docker.
 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.log(`${signal} — finishing in-flight runs`);
    void worker
      .close()
      .then(() => connection.disconnect())
      .then(() => process.exit(0));
  });
}
