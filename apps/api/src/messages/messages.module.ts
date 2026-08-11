import { Body, Controller, Get, Global, Headers, Module, Post, Query } from "@nestjs/common";
import { RecordMessageInput } from "@clinicpilot/shared-types";

import { ServiceOnly } from "../auth/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { requireTenant } from "../tasks/tasks.controller";
import { MessagesService } from "./messages.service";

/**
 * Reading a tenant's outbound patient contact.
 *
 * No `@MinRole`: any signed-in member of a clinic may see what that clinic
 * sent its own patients. It is not privileged *within* a tenant — RLS is what
 * keeps it inside one — and restricting it would make the record less useful
 * to exactly the people who need to act on a reply.
 */
@Controller("messages")
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(@Query("limit") limit?: string) {
    const parsed = Number(limit);
    return this.messages.list(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
  }
}

/** Where the Follow-up Agent records what it drafted. */
@ServiceOnly()
@Controller("internal/messages")
export class InternalMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  record(
    @Headers("x-tenant-id") tenantId: string,
    @Body(new ZodValidationPipe(RecordMessageInput)) body: RecordMessageInput,
  ) {
    return this.messages.record(requireTenant(tenantId), body);
  }
}

@Global()
@Module({
  controllers: [MessagesController, InternalMessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
