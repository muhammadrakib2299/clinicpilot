import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export const DEFAULT_DATABASE_URL =
  "postgresql://clinicpilot:clinicpilot@localhost:5432/clinicpilot";

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
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
