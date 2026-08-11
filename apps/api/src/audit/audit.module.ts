import { Controller, Get, Global, Header, Module, Query } from "@nestjs/common";
import { AuditQuery } from "@clinicpilot/shared-types";

import { MinRole } from "../auth/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuditService, toCsv } from "./audit.service";

const CSV_COLUMNS = [
  "createdAt",
  "actorEmail",
  "actorName",
  "action",
  "resourceType",
  "resourceId",
  "ip",
];

/**
 * Reading the audit log is an admin action.
 *
 * It is the one screen that shows every user's activity, so a coordinator
 * being able to read it would make the log a surveillance tool rather than a
 * governance one.
 */
@MinRole("admin")
@Controller("audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query(new ZodValidationPipe(AuditQuery)) query: AuditQuery) {
    return this.audit.list(query);
  }

  @Get("export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="clinicpilot-audit.csv"')
  async export(@Query(new ZodValidationPipe(AuditQuery)) query: AuditQuery) {
    const rows = await this.audit.list(query);

    // Exporting the audit log is itself auditable — arguably the single most
    // important entry in the table, since it is the one that says a copy of
    // everyone's activity left the building.
    await this.audit.record({
      action: "audit.export",
      resourceType: "audit_log",
      metadata: { rows: rows.length, filters: query },
    });

    return toCsv(rows, CSV_COLUMNS);
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
