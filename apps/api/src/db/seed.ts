import { existsSync } from "node:fs";

import { eq, sql } from "drizzle-orm";

import { hashPassword } from "../common/password";
import { DEMO_TENANT_ID, SECOND_TENANT_ID } from "../common/tenant";
import { createDb, createPool, databaseUrl } from "./client";
import { agents, memberships, tenants, users } from "./schema";
import type { NewAgent } from "./schema";

const ROOT_ENV = "../../.env";
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

// Shared with the runtime tenant seam so fixtures and requests agree.
export { DEMO_TENANT_ID, SECOND_TENANT_ID } from "../common/tenant";

/**
 * Two clinics, not one.
 *
 * The second exists so tenant isolation is something that can be *observed*
 * rather than asserted: the RLS test signs in as Riverside and checks it
 * cannot see Northside's rows, which is meaningless with a single tenant in
 * the database. It also gives the tenant switcher something to switch to.
 */
const DEMO_TENANTS = [
  { id: DEMO_TENANT_ID, name: "Northside Family Clinic", plan: "clinic" as const },
  { id: SECOND_TENANT_ID, name: "Riverside Medical Group", plan: "pro" as const },
];

/**
 * All three agents from the product surface are seeded, but only the
 * Scheduling Agent is `active`. Follow-up and Document Q&A land in Phase 3;
 * seeding them as `paused` keeps the Fleet Overview honest — they exist as
 * configured agents, they are not pretending to run.
 */
function fleetFor(tenantId: string): NewAgent[] {
  return [
    {
      tenantId,
      kind: "scheduling",
      name: "Scheduling Agent",
      status: "active",
      config: { model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5" },
    },
    { tenantId, kind: "followup", name: "Follow-up Agent", status: "paused", config: {} },
    { tenantId, kind: "docqa", name: "Document Q&A Agent", status: "paused", config: {} },
  ];
}

/**
 * One account per role, so every guard can actually be exercised by hand.
 *
 * `dr.chen` deliberately belongs to both clinics — the tenant switcher is only
 * meaningfully testable with a user who has somewhere to switch to, and a
 * clinician working across two sites is the realistic version of that.
 *
 * The password is weak, identical across accounts, and printed on sign-in.
 * That is correct for a seeded demo whose data is synthetic and whose whole
 * purpose is being clicked by a stranger; it is also why `pnpm db:seed` is not
 * something to run against anything real.
 */
export const DEMO_PASSWORD = "clinicpilot";

const DEMO_USERS = [
  {
    email: "admin@demo.clinicpilot.io",
    name: "Priya Nair",
    memberships: [{ tenantId: DEMO_TENANT_ID, role: "admin" as const }],
  },
  {
    email: "clinician@demo.clinicpilot.io",
    name: "Dr Wei Chen",
    memberships: [
      { tenantId: DEMO_TENANT_ID, role: "clinician" as const },
      { tenantId: SECOND_TENANT_ID, role: "admin" as const },
    ],
  },
  {
    email: "coordinator@demo.clinicpilot.io",
    name: "Sam Okafor",
    memberships: [{ tenantId: DEMO_TENANT_ID, role: "coordinator" as const }],
  },
  {
    email: "viewer@demo.clinicpilot.io",
    name: "Jo Bailey",
    memberships: [{ tenantId: DEMO_TENANT_ID, role: "viewer" as const }],
  },
];

export async function seed(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);

  try {
    for (const tenant of DEMO_TENANTS) {
      await db
        .insert(tenants)
        .values(tenant)
        .onConflictDoUpdate({
          target: tenants.id,
          set: { name: tenant.name, plan: tenant.plan },
        });
      console.log(`tenant  ${tenant.name.padEnd(24)} ${tenant.id}`);
    }

    for (const tenant of DEMO_TENANTS) {
      for (const agent of fleetFor(tenant.id)) {
        await db
          .insert(agents)
          .values(agent)
          // agents is unique on (tenant_id, kind), so a re-run updates in place
          // rather than failing or duplicating the tenant's fleet.
          .onConflictDoUpdate({
            target: [agents.tenantId, agents.kind],
            set: { name: agent.name, status: agent.status, config: agent.config },
          });
      }
    }
    console.log(`agents  3 per tenant (scheduling active, others paused)`);

    for (const user of DEMO_USERS) {
      // Read-then-write rather than ON CONFLICT: the unique index is on
      // `lower(email)`, and Drizzle's conflict target takes columns, not
      // expressions. Re-seeding also must not rotate the password of an
      // account someone is already signed in as.
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(sql`lower(${users.email})`, user.email.toLowerCase()))
        .limit(1);

      const row =
        existing ??
        (
          await db
            .insert(users)
            .values({
              email: user.email,
              name: user.name,
              passwordHash: await hashPassword(DEMO_PASSWORD),
            })
            .returning({ id: users.id })
        )[0];

      for (const membership of user.memberships) {
        await db
          .insert(memberships)
          .values({ userId: row!.id, tenantId: membership.tenantId, role: membership.role })
          .onConflictDoUpdate({
            target: [memberships.userId, memberships.tenantId],
            set: { role: membership.role },
          });
      }

      const where = user.memberships.map((m) => m.role).join(" + ");
      console.log(`user    ${user.email.padEnd(34)} ${where}`);
    }

    console.log(`\npassword for every demo account: ${DEMO_PASSWORD}`);
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
