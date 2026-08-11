import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";

import { currentActor } from "../common/request-context";
import { appDatabaseUrl, createDb, createPool, isRlsEnforced, type Db } from "./client";

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private readonly pool: Pool;
  readonly db: Db;

  /** Cached after the first check; the role cannot change under a live pool. */
  private rlsEnforced: boolean | null = null;

  constructor() {
    // The unprivileged role, not the migration owner — see appDatabaseUrl().
    this.pool = createPool(appDatabaseUrl());
    this.db = createDb(this.pool);
  }

  /**
   * Run a unit of work with the tenant visible to row-level security.
   *
   * `SET LOCAL` is transaction-scoped, which is exactly the lifetime wanted: it
   * reverts on commit or rollback, so a pooled connection can never carry one
   * request's tenant into the next. A session-level `SET` would do precisely
   * that, and the bug would only appear under concurrency.
   *
   * Everything tenant-scoped goes through here. A query that skips it sees
   * nothing rather than seeing everything, because the policy compares against
   * NULL — the safe direction for this to fail.
   */
  async withTenant<T>(tenantId: string, work: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      // set_config's third argument is is_local. Parameterised, because this
      // value arrives from a JWT.
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return work(tx as unknown as Db);
    });
  }

  /** Same, for the tenant on the current request. */
  async withCurrentTenant<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    const actor = currentActor();
    if (!actor) {
      throw new Error("withCurrentTenant called outside an authenticated request");
    }
    return this.withTenant(actor.tenantId, work);
  }

  /**
   * Whether this connection is actually subject to RLS.
   *
   * Surfaced on /api/health because the failure it detects is invisible: a
   * superuser connection applies no policies and reports no error, so the
   * isolation tests pass, the code reads correctly, and nothing is enforced.
   */
  async rlsIsEnforced(): Promise<boolean> {
    if (this.rlsEnforced === null) {
      try {
        this.rlsEnforced = await isRlsEnforced(this.db);
      } catch {
        return false;
      }

      if (!this.rlsEnforced) {
        this.logger.error(
          "Connected as a role that BYPASSES row-level security. Tenant isolation " +
            "is NOT being enforced. Run `pnpm db:rls` and set APP_DATABASE_URL.",
        );
      }
    }

    return this.rlsEnforced;
  }

  /**
   * Cheap liveness probe for the health endpoint.
   *
   * Returns a boolean rather than throwing: an unreachable database is a
   * degraded service, not a crashed one, and the health check should be able
   * to say which of its dependencies is down.
   */
  async ping(): Promise<boolean> {
    try {
      await this.db.execute(sql`select 1`);
      return true;
    } catch (error) {
      this.logger.warn(`database ping failed: ${(error as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Without this the pool keeps the event loop alive and the process hangs
    // on shutdown instead of exiting.
    await this.pool.end();
  }
}
