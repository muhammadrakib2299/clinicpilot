import { Module } from "@nestjs/common";

import { InternalTasksController, TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  controllers: [TasksController, InternalTasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
