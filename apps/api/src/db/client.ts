import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export const DEFAULT_DATABASE_URL =
  "postgresql://clinicpilot:clinicpilot@localhost:5432/clinicpilot";

/**
 * The owning connection: migrations, seeds, Drizzle Studio.
 *
 * In compose this is the `POSTGRES_USER` the image created, which is a
 * superuser. That is fine for DDL and fatal for serving requests — see below.
 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/**
 * The connection the running gateway uses.
 *
 * A distinct, unprivileged role, because **superusers bypass row-level
 * security silently**. Not with a warning, not with an error — the policies
 * are simply never applied. Running the gateway as the owner would leave every
 * tenant-isolation policy in place and enforcing nothing, which is a worse
 * failure than having no policies at all, because the code and the tests both
 * look right.
 *
 * Falls back to the owner so a clone-and-run still starts. `isRlsEnforced()`
 * is how you find out which one you got, and /api/health reports it.
 */
export function appDatabaseUrl(): string {
  return process.env.APP_DATABASE_URL ?? databaseUrl();
}

/**
 * Whether this connection is actually subject to RLS.
 *
 * Asks Postgres rather than inferring from configuration: `rolsuper` and
 * `rolbypassrls` are the two ways a role escapes policies, and either one
 * makes the whole of Phase 2 decorative.
 */
export async function isRlsEnforced(db: Db): Promise<boolean> {
  const result = await db.execute<{ enforced: boolean }>(
    sql`select not (rolsuper or rolbypassrls) as enforced
        from pg_roles where rolname = current_user`,
  );

  return result.rows[0]?.enforced ?? false;
}

/**
 * One pool per process. Scripts must close it or Node keeps the event loop
 * alive and the command appears to hang after its work is done.
 */
export function createPool(connectionString = databaseUrl()): Pool {
  return new Pool({ connectionString });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
