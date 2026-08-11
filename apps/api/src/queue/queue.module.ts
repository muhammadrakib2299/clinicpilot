import { Global, Module } from "@nestjs/common";

import { TaskQueueService } from "./task-queue.service";

/**
 * Global for the same reason as DbModule: one Redis connection per process,
 * injected wherever a feature needs to enqueue, rather than a connection per
 * importing module.
 */
@Global()
@Module({
  providers: [TaskQueueService],
  exports: [TaskQueueService],
})
export class QueueModule {}
