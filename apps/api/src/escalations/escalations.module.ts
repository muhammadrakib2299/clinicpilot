import { Body, Controller, Get, Global, Module, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { EscalationQuery, ResolveEscalationInput } from "@clinicpilot/shared-types";

import { MinRole } from "../auth/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { EscalationsService } from "./escalations.service";

/**
 * The human queue.
 *
 * Reading is open to any member: a viewer who cannot act on an escalation can
 * still see that one is outstanding, and hiding the backlog from the people
 * standing at the desk is the wrong default for a queue.
 *
 * Acting on one is `coordinator` and above — the same bar as creating a task,
 * because closing an escalation is a decision about a patient's message rather
 * than a piece of housekeeping.
 */
@Controller("escalations")
export class EscalationsController {
  constructor(private readonly escalations: EscalationsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(EscalationQuery)) query: EscalationQuery) {
    return this.escalations.list(query);
  }

  /** For the sidebar badge — a count, without shipping the queue to draw it. */
  @Get("count")
  count() {
    return this.escalations.openCount();
  }

  @MinRole("coordinator")
  @Post(":id/acknowledge")
  acknowledge(@Param("id", ParseUUIDPipe) id: string) {
    return this.escalations.acknowledge(id);
  }

  @MinRole("coordinator")
  @Post(":id/resolve")
  resolve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ResolveEscalationInput)) body: ResolveEscalationInput,
  ) {
    return this.escalations.resolve(id, body);
  }
}

/**
 * Global because `TasksModule` injects the service to queue an escalation
 * inside the transaction that completes a task — the one place a row is
 * created, and deliberately not an endpoint anyone can call.
 */
@Global()
@Module({
  controllers: [EscalationsController],
  providers: [EscalationsService],
  exports: [EscalationsService],
})
export class EscalationsModule {}
