import { existsSync } from "node:fs";

import { createDb, createPool, databaseUrl } from "./client";
import { agents, tenants } from "./schema";

const ROOT_ENV = "../../.env";
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

/**
 * Fixed rather than generated so the seed is idempotent and so fixtures,
 * demo links and manual psql pokes all refer to the same tenant across
 * re-runs and across machines.
 */
export const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";

const DEMO_TENANT = {
  id: DEMO_TENANT_ID,
  name: "Northside Family Clinic",
  plan: "clinic" as const,
};

/**
 * All three agents from the product surface are seeded, but only the
 * Scheduling Agent is `active`. Follow-up and Document Q&A land in Phase 3;
 * seeding them as `paused` keeps the Fleet Overview honest — they exist as
 * configured agents, they are not pretending to run.
 */
const DEMO_AGENTS = [
  {
    tenantId: DEMO_TENANT_ID,
    kind: "scheduling" as const,
    name: "Scheduling Agent",
    status: "active" as const,
    config: { model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5" },
  },
  {
    tenantId: DEMO_TENANT_ID,
    kind: "followup" as const,
    name: "Follow-up Agent",
    status: "paused" as const,
    config: {},
  },
  {
    tenantId: DEMO_TENANT_ID,
    kind: "docqa" as const,
    name: "Document Q&A Agent",
    status: "paused" as const,
    config: {},
  },
];

export async function seed(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);

  try {
    await db
      .insert(tenants)
      .values(DEMO_TENANT)
      .onConflictDoUpdate({
        target: tenants.id,
        set: { name: DEMO_TENANT.name, plan: DEMO_TENANT.plan },
      });
    console.log(`tenant  ${DEMO_TENANT.name} (${DEMO_TENANT_ID})`);

    for (const agent of DEMO_AGENTS) {
      await db
        .insert(agents)
        .values(agent)
        // agents is unique on (tenant_id, kind), so a re-run updates in place
        // rather than failing or duplicating the tenant's fleet.
        .onConflictDoUpdate({
          target: [agents.tenantId, agents.kind],
          set: { name: agent.name, status: agent.status, config: agent.config },
        });
      console.log(`agent   ${agent.name.padEnd(20)} ${agent.status}`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  console.log(`seeding ${databaseUrl().replace(/:[^:@]*@/, ":***@")}`);
  seed()
    .then(() => console.log("\ndone — re-running is safe"))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
