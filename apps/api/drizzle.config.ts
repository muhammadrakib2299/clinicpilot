import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit runs its own process from apps/api, so nothing has loaded the
// repo-root .env for us. Node's built-in loader avoids a dotenv dependency
// that only this one config file would need.
const ROOT_ENV = "../../.env";
if (existsSync(ROOT_ENV)) {
  process.loadEnvFile(ROOT_ENV);
}

// Matches the compose defaults so a clean clone works with no .env at all.
const DEFAULT_URL = "postgresql://clinicpilot:clinicpilot@localhost:5432/clinicpilot";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? DEFAULT_URL,
  },
  // Migrations are committed SQL, generated from the schema and reviewed in the
  // diff — never pushed straight to a database. `drizzle-kit push` is banned in
  // this repo for exactly the reason it is convenient: it hides the DDL.
  strict: true,
  verbose: true,
});
