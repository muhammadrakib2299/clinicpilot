import { existsSync } from "node:fs";

import { Client } from "pg";

import { appDatabaseUrl, databaseUrl } from "./client";

const ROOT_ENV = "../../.env";
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

/**
 * Creates the unprivileged role the gateway connects as.
 *
 * Separate from the migrations on purpose. Migrations are committed SQL that
 * anyone can read, and this step needs a password — so the DDL lives in
 * `0002_phase2_rls.sql` and the credential stays in the environment.
 *
 * The role matters more than it looks. Postgres superusers bypass row-level
 * security completely and silently: the policies apply, no error is raised,
 * and every one of them is simply skipped. The compose default user is a
 * superuser, so running the gateway as it would leave the whole of Phase 2
 * looking correct and enforcing nothing.
 *
 *   pnpm db:rls
 *
 * Idempotent — safe to re-run, and re-running is how you rotate the password.
 */
export async function setupRls(
  ownerUrl = databaseUrl(),
  appUrl = appDatabaseUrl(),
): Promise<{ role: string; database: string }> {
  const app = new URL(appUrl);
  const role = decodeURIComponent(app.username);
  const password = decodeURIComponent(app.password);
  const database = app.pathname.replace(/^\//, "");

  if (!role || !password) {
    throw new Error(
      "APP_DATABASE_URL must include a username and password — that role is what RLS is enforced against.",
    );
  }

  const owner = new URL(ownerUrl);
  if (decodeURIComponent(owner.username) === role) {
    throw new Error(
      `APP_DATABASE_URL uses '${role}', the same role as DATABASE_URL. ` +
        "The owner is a superuser and bypasses RLS, so they must differ.",
    );
  }

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();

  try {
    // Quoted identifier, parameterised password. Roles cannot be parameterised
    // in DDL, hence the identifier check above rather than trusting the URL.
    if (!/^[a-z_][a-z0-9_]*$/i.test(role)) {
      throw new Error(`'${role}' is not a plain role name`);
    }

    const exists = await client.query("select 1 from pg_roles where rolname = $1", [role]);
    const verb = exists.rowCount ? "ALTER" : "CREATE";

    // NOSUPERUSER and NOBYPASSRLS are the entire point. Stated explicitly on
    // ALTER as well as CREATE, so re-running repairs a role that was granted
    // either of them by hand.
    await client.query(
      `${verb} ROLE "${role}" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE ` +
        `PASSWORD ${literal(password)}`,
    );

    await client.query(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);
    await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);

    // Tables created by later migrations would otherwise be invisible to the
    // app role until someone remembered to re-run this.
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public ` +
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
    );

    // Deliberately withheld: DELETE on audit_log is granted above and then
    // refused by the trigger, so an attempt fails loudly rather than being
    // quietly impossible. TRUNCATE is not granted at all — it skips triggers.
    await client.query(`REVOKE TRUNCATE ON "audit_log" FROM "${role}"`);

    return { role, database };
  } finally {
    await client.end();
  }
}

/** Postgres string literal, for the one value that cannot be parameterised. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

if (require.main === module) {
  setupRls()
    .then(({ role, database }) => {
      console.log(
        `role '${role}' ready on '${database}' — LOGIN, NOSUPERUSER, NOBYPASSRLS.\n` +
          "Point the gateway at APP_DATABASE_URL; /api/health reports whether RLS is enforced.",
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
