import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import type IORedis from "ioredis";

import {
  createRedis,
  RUN_TASK_JOB,
  RUN_TASK_JOB_OPTIONS,
  TASK_QUEUE,
  type RunTaskJob,
} from "./task-queue";

@Injectable()
export class TaskQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(TaskQueueService.name);
  private readonly connection: IORedis;
  private readonly queue: Queue<RunTaskJob>;

  constructor() {
    this.connection = createRedis();
    // ioredis retries forever by default and logs every attempt. One warning
    // is useful; a wall of them buries whatever else the gateway is saying.
    this.connection.on("error", (error) => this.logger.warn(`redis: ${error.message}`));

    this.queue = new Queue<RunTaskJob>(TASK_QUEUE, { connection: this.connection });
  }

  /**
   * Hand a task to the worker.
   *
   * Returns whether it made it onto the queue rather than throwing. The task
   * row is already committed at this point, and losing a patient's message
   * because Redis blinked is worse than a run that starts late — a queued task
   * can still be driven by hand, a discarded one is gone. The caller decides
   * what to tell the client; this decides not to destroy anything.
   *
   * The real fix is an outbox: write the job to Postgres in the same
   * transaction as the task and relay it from there. Logged as debt rather
   * than pretended away — this window is genuinely lossy.
   */
  async enqueue(job: RunTaskJob): Promise<boolean> {
    try {
      await this.queue.add(RUN_TASK_JOB, job, {
        ...RUN_TASK_JOB_OPTIONS,
        jobId: job.taskId,
      });
      return true;
    } catch (error) {
      this.logger.error(
        `could not enqueue task ${job.taskId}: ${(error as Error).message}. ` +
          "It stays queued and can be run by hand.",
      );
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
