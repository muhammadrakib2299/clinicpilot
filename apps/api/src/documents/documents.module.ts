import { Body, Controller, Get, Global, Headers, Module, Post } from "@nestjs/common";
import { IngestDocumentInput, SearchDocumentsInput } from "@clinicpilot/shared-types";

import { ServiceOnly } from "../auth/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { requireTenant } from "../tasks/tasks.controller";
import { DocumentsService } from "./documents.service";

/**
 * What a clinic can see of its own corpus.
 *
 * Reading is not role-gated — these are the practice's own policies, and RLS
 * is what keeps them inside one tenant. The list exists so "what can the
 * Document Q&A agent actually answer from" has an answer that is not "read the
 * seed script".
 */
@Controller("documents")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list() {
    return this.documents.list();
  }
}

/**
 * Ingest and retrieval, for the AI service.
 *
 * Behind the service token like every other `internal/` route. Search is a
 * POST despite reading nothing, because the query is a 384-element vector:
 * as a query string it would be several kilobytes of URL, and it would end up
 * in every access log the request passes through.
 */
@ServiceOnly()
@Controller("internal/documents")
export class InternalDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  ingest(
    @Headers("x-tenant-id") tenantId: string,
    @Body(new ZodValidationPipe(IngestDocumentInput)) body: IngestDocumentInput,
  ) {
    return this.documents.ingest(requireTenant(tenantId), body);
  }

  @Post("search")
  search(
    @Headers("x-tenant-id") tenantId: string,
    @Body(new ZodValidationPipe(SearchDocumentsInput)) body: SearchDocumentsInput,
  ) {
    return this.documents.search(requireTenant(tenantId), body);
  }
}

@Global()
@Module({
  controllers: [DocumentsController, InternalDocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
