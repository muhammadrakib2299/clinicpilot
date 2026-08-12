import { Controller, Get, Global, Injectable, Module } from "@nestjs/common";
import type { TenantRef } from "@clinicpilot/shared-types";
import { asc } from "drizzle-orm";

import { ServiceOnly } from "../auth/auth.decorators";
import { DbService } from "../db/db.service";
import { tenants } from "../db/schema";

/**
 * Which clinics exist.
 *
 * **This is the one query in the system that is deliberately not scoped to a
 * tenant**, and it exists for one reason: a scheduled job has no session, and
 * therefore no tenant. Something has to tell the n8n delivery sweep which
 * clinics to make a pass over, and the alternatives are worse — a cross-tenant
 * query that bypasses RLS, or a workflow with tenant ids pasted into it that
 * silently stops covering a clinic the moment one is added.
 *
 * So the sweep enumerates here and then scopes every subsequent call to one
 * tenant at a time, which keeps RLS doing its job on every row it touches.
 *
 * `tenants` has no row-level security policy, and that is not an oversight: a
 * tenant row is not itself tenant-scoped, and login has to resolve one before
 * any tenant context exists. What protects this is `@ServiceOnly` — and the
 * response is ids and names, nothing else, so the whole exposure is the list
 * of clinic names rather than anything inside one.
 */
@Injectable()
export class TenantsService {
  constructor(private readonly dbService: DbService) {}

  async list(): Promise<TenantRef[]> {
    const rows = await this.dbService.db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .orderBy(asc(tenants.name));

    return rows;
  }
}

@ServiceOnly()
@Controller("internal/tenants")
export class InternalTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }
}

@Global()
@Module({
  controllers: [InternalTenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
