import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";

import { createDb, createPool, type Db } from "./client";

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private readonly pool: Pool;
  readonly db: Db;

  constructor() {
    this.pool = createPool();
    this.db = createDb(this.pool);
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
