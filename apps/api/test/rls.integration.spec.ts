import { Client } from "pg";

import { appDatabaseUrl, databaseUrl } from "../src/db/client";
import { DEMO_TENANT_ID, SECOND_TENANT_ID } from "../src/common/tenant";

// The .env is loaded by `test/load-env.cjs` via globalSetup, not here — jest
// hands each test file a copy of process.env, so `process.loadEnvFile` in a
// spec mutates the real process and changes nothing the spec can see.

/**
 * Tenant isolation, against a real database, as the role that serves requests.
 *
 * Deliberately **not** part of `pnpm test`. It needs a migrated, seeded
 * Postgres, and a suite that silently skips when one is absent is worse than
 * no suite at all — Phase 0 shipped two lint scripts and a test script that
 * were silent no-ops for weeks, and nothing noticed. This one connects or
 * fails; CI runs it in the compose job where a database definitely exists.
 *
 *   pnpm db:migrate && pnpm db:rls && pnpm db:seed
 *   pnpm --filter @clinicpilot/api test:integration
 *
 * Everything here was verified by hand first. Automating it is the point: a
 * policy that is correct today and silently disabled by a future migration is
 * exactly the failure that has no other symptom.
 */

jest.setTimeout(30_000);

/** The role the gateway actually connects as. */
let app: Client;
/** The migration owner — a superuser, and the control case. */
let owner: Client;

const asTenant = async <T>(tenantId: string, work: () => Promise<T>): Promise<T> => {
  await app.query("begin");
  try {
    await app.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return await work();
  } finally {
    await app.query("rollback");
  }
};

const count = async (client: Client, sql: string, params: unknown[] = []): Promise<number> => {
  const result = await client.query<{ n: string }>(sql, params);
  return Number(result.rows[0]?.n ?? -1);
};

/** Names the target on failure — "auth failed" is useless without the host. */
async function connect(label: string, url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  const where = url.replace(/:[^:@]*@/, ":***@");

  try {
    await client.connect();
    return client;
  } catch (error) {
    throw new Error(
      `Could not connect as the ${label} role to ${where}: ${(error as Error).message}
` +
        "These tests need a live database. Run: pnpm up:infra && pnpm db:migrate && " +
        "pnpm db:rls && pnpm db:seed",
    );
  }
}

beforeAll(async () => {
  app = await connect("application", appDatabaseUrl());
  owner = await connect("owner", databaseUrl());
});

afterAll(async () => {
  await app?.end();
  await owner?.end();
});

describe("the connection RLS is enforced against", () => {
  it("is not a superuser and cannot bypass RLS", async () => {
    // The single most important assertion in this file. A superuser skips
    // every policy below with no error, so all the other tests would pass
    // while enforcing nothing.
    const { rows } = await app.query<{ su: boolean; bypass: boolean; who: string }>(
      `select rolsuper as su, rolbypassrls as bypass, current_user as who
         from pg_roles where rolname = current_user`,
    );

    expect(rows[0]?.su).toBe(false);
    expect(rows[0]?.bypass).toBe(false);
  });

  it("is a different role from the one that runs migrations", async () => {
    const [appUser, ownerUser] = await Promise.all([
      app.query<{ who: string }>("select current_user as who"),
      owner.query<{ who: string }>("select current_user as who"),
    ]);

    expect(appUser.rows[0]?.who).not.toBe(ownerUser.rows[0]?.who);
  });

  it("confirms the owner really would bypass — which is why the app role exists", async () => {
    const seen = await count(owner, "select count(*) as n from agents");

    // Both seeded clinics, with no tenant set. Not a bug: it is the control
    // case, and the reason the gateway must not use this connection.
    expect(seen).toBeGreaterThanOrEqual(6);
  });
});

describe("tenant isolation", () => {
  it("shows nothing at all with no tenant in scope", async () => {
    // Fails closed. A query that forgets `withTenant` sees zero rows rather
    // than every tenant's.
    expect(await count(app, "select count(*) as n from agents")).toBe(0);
    expect(await count(app, "select count(*) as n from tasks")).toBe(0);
    expect(await count(app, "select count(*) as n from traces")).toBe(0);
    expect(await count(app, "select count(*) as n from audit_log")).toBe(0);
  });

  it("shows one tenant's rows when scoped to it", async () => {
    await asTenant(DEMO_TENANT_ID, async () => {
      const agents = await count(app, "select count(*) as n from agents");
      const tenants = await count(app, "select count(distinct tenant_id) as n from agents");

      expect(agents).toBe(3);
      expect(tenants).toBe(1);
    });
  });

  it("hides the other tenant even when asked for by id", async () => {
    // The filter is not doing this — the policy is. An application bug that
    // dropped the WHERE clause would still see nothing.
    await asTenant(DEMO_TENANT_ID, async () => {
      const seen = await count(app, "select count(*) as n from agents where tenant_id = $1", [
        SECOND_TENANT_ID,
      ]);

      expect(seen).toBe(0);
    });
  });

  it("refuses a write into another tenant", async () => {
    // WITH CHECK, not USING. Without it a caller could insert a row it would
    // then never be able to see, audit or undo.
    await expect(
      asTenant(DEMO_TENANT_ID, () =>
        app.query(
          `insert into tasks (tenant_id, agent_id, input)
           values ($1, (select id from agents limit 1), 'cross-tenant write')`,
          [SECOND_TENANT_ID],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("does not leak the tenant across transactions on a pooled connection", async () => {
    // `SET LOCAL`, not `SET`. A session-level setting would carry one
    // request's tenant into the next request that borrowed the connection —
    // a cross-tenant read that only appears under concurrency.
    await asTenant(DEMO_TENANT_ID, async () => {
      expect(await count(app, "select count(*) as n from agents")).toBe(3);
    });

    expect(await count(app, "select count(*) as n from agents")).toBe(0);
  });
});

describe("memberships", () => {
  it("are visible to their owner with no tenant set", async () => {
    // Login's chicken-and-egg: the tenant comes from the memberships, so they
    // have to be readable before one is chosen. The policy allows it by user,
    // rather than the query stepping around RLS.
    const [{ id }] = (
      await owner.query<{ id: string }>(
        "select user_id as id from memberships limit 1",
      )
    ).rows as [{ id: string }];

    await app.query("begin");
    try {
      await app.query("select set_config('app.user_id', $1, true)", [id]);
      const mine = await count(app, "select count(*) as n from memberships");

      expect(mine).toBeGreaterThan(0);
    } finally {
      await app.query("rollback");
    }
  });

  it("belonging to someone else stay hidden", async () => {
    await app.query("begin");
    try {
      await app.query("select set_config('app.user_id', $1, true)", [
        "00000000-0000-4000-8000-0000000000ff",
      ]);

      expect(await count(app, "select count(*) as n from memberships")).toBe(0);
    } finally {
      await app.query("rollback");
    }
  });
});

describe("audit_log is append-only", () => {
  const insertProbe = () =>
    app.query(
      `insert into audit_log (tenant_id, action, resource_type)
       values ($1, 'test.probe', 'probe')`,
      [DEMO_TENANT_ID],
    );

  it("refuses UPDATE, with rows present", async () => {
    // A per-row trigger cannot fire on zero rows, so the probe matters: an
    // earlier hand-run of this check passed for the wrong reason.
    await expect(
      asTenant(DEMO_TENANT_ID, async () => {
        await insertProbe();
        await app.query("update audit_log set action = 'tampered'");
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses DELETE, with rows present", async () => {
    await expect(
      asTenant(DEMO_TENANT_ID, async () => {
        await insertProbe();
        await app.query("delete from audit_log");
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses TRUNCATE, which would skip the trigger entirely", async () => {
    await expect(
      asTenant(DEMO_TENANT_ID, () => app.query("truncate audit_log")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("still accepts an INSERT — it is append-only, not read-only", async () => {
    await asTenant(DEMO_TENANT_ID, async () => {
      await expect(insertProbe()).resolves.toBeDefined();
    });
  });
});
