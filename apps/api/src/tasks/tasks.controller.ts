import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  AppendTraceInput,
  CompleteTaskInput,
  CreateTaskInput,
} from "@clinicpilot/shared-types";

import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { TasksService } from "./tasks.service";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateTaskInput)) body: CreateTaskInput) {
    return this.tasks.create(body);
  }

  @Get()
  list(@Query("limit") limit?: string) {
    const parsed = Number(limit);
    return this.tasks.list(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.tasks.findWithTrace(id);
  }
}

/**
 * Service-to-service surface. The AI service posts trace steps here rather
 * than holding a database connection (ADR-004), and calls FHIR through the
 * gateway rather than directly (ADR-008).
 *
 * Mounted under `internal/` so it is obvious in routing — and obvious in
 * review — that this must not be reachable from the public internet. Phase 2
 * puts a service token in front of it alongside the RBAC work.
 */
@Controller("internal/tasks")
export class InternalTasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post(":id/running")
  markRunning(@Param("id", ParseUUIDPipe) id: string) {
    return this.tasks.markRunning(id);
  }

  @Post(":id/traces")
  appendTrace(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AppendTraceInput)) body: AppendTraceInput,
  ) {
    return this.tasks.appendTrace(id, body);
  }

  @Post(":id/complete")
  complete(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CompleteTaskInput)) body: CompleteTaskInput,
  ) {
    return this.tasks.complete(id, body);
  }
}
