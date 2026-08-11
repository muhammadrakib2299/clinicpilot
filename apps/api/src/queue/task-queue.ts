import IORedis from "ioredis";
import type { JobsOptions } from "bullmq";

/**
 * Shared between the producer (inside the gateway) and the worker (its own
 * process). Both halves have to agree on the queue name, the payload and the
 * retry policy, so none of it is written twice.
 */

export const TASK_QUEUE = "task-runs";
export const RUN_TASK_JOB = "run-task";

export interface RunTaskJob {
  taskId: string;
  input: string;
  agentKind: string;
}

export const DEFAULT_REDIS_URL = "redis://localhost:6379";

export function redisUrl(): string {
  return process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
}

/**
 * BullMQ requires `maxRetriesPerRequest: null` on a Worker's connection — its
 * blocking commands sit open for far longer than ioredis' default retry budget
 * allows, and with the default the worker dies on the first idle stretch.
 * Producers do not need it, but sharing one factory means the two connections
 * cannot drift apart.
 */
export function createRedis(): IORedis {
  return new IORedis(redisUrl(), { maxRetriesPerRequest: null });
}

/**
 * At-least-once, with the retries aimed at the failures that are worth
 * retrying.
 *
 * `jobId` is the task id, so BullMQ refuses a duplicate outright: a double
 * submit, or a producer retry, cannot put the same task on the queue twice.
 * The id is freed when the job is removed on completion, which is what makes a
 * deliberate re-run of the same task later still possible.
 */
export const RUN_TASK_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  // Keep a window of history for the queue view Phase 4 adds, rather than an
  // unbounded list that grows for the life of the Redis volume.
  removeOnComplete: { age: 3_600, count: 100 },
  removeOnFail: { age: 24 * 3_600 },
};

/**
 * Which AI-service failures are worth replaying.
 *
 * Lives here rather than in the worker so it can be tested without importing
 * a module that opens a Redis connection on load.
 *
 * The 4xx cases are the interesting ones. A malformed request or an agent kind
 * that is not deployed will be exactly as wrong on the third attempt, so they
 * fail straight to the dead-letter list instead of burning the backoff. 409 is
 * the deliberate one: it means another run already holds the task, or the task
 * is finished — retrying it is precisely the double-spend the claim exists to
 * prevent.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryable(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}
