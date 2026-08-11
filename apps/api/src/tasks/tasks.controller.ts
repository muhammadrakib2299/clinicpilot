import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  AppendTraceInput,
  CompleteTaskInput,
  CreateTaskInput,
} from "@clinicpilot/shared-types";

import { MinRole, ServiceOnly } from "../auth/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { TasksService } from "./tasks.service";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** Creating work for an agent is a coordinator action; viewers may not. */
  @MinRole("coordinator")
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
 * `@ServiceOnly` puts the shared token in front of every route: there is no
 * user on these requests, so the token is the only thing between them and
 * patient data. An unset `SERVICE_TOKEN` closes the surface rather than
 * opening it.
 *
 * The tenant arrives in a header because there is no session to read it from.
 * It is a claim, not an authorisation — every query runs scoped to it, so a
 * wrong value finds nothing rather than finding somebody else's task.
 */
@ServiceOnly()
@Controller("internal/tasks")
export class InternalTasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post(":id/running")
  markRunning(@Param("id", ParseUUIDPipe) id: string, @Headers("x-tenant-id") tenantId: string) {
    return this.tasks.markRunning(requireTenant(tenantId), id);
  }

  @Post(":id/traces")
  appendTrace(
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("x-tenant-id") tenantId: string,
    @Body(new ZodValidationPipe(AppendTraceInput)) body: AppendTraceInput,
  ) {
    return this.tasks.appendTrace(requireTenant(tenantId), id, body);
  }

  @Post(":id/complete")
  complete(
    @Param("id", ParseUUIDPipe) id: string,
    @Headers("x-tenant-id") tenantId: string,
    @Body(new ZodValidationPipe(CompleteTaskInput)) body: CompleteTaskInput,
  ) {
    return this.tasks.complete(requireTenant(tenantId), id, body);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validated before it reaches a query, because it is interpolated into
 * `set_config('app.tenant_id', ...)`. Parameterised there too, but a value
 * that decides what RLS lets through earns a shape check of its own.
 */
export function requireTenant(tenantId: string | undefined): string {
  if (!tenantId || !UUID.test(tenantId)) {
    throw new BadRequestException("x-tenant-id must be a tenant UUID");
  }
  return tenantId;
}
