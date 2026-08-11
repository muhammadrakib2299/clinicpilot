-- Phase 2 — row-level security and an append-only audit log.
--
-- Hand-written: drizzle-kit generates table DDL from the schema, and none of
-- what follows is expressible there. It is committed alongside the generated
-- migrations and applied by the same `pnpm db:migrate`.
--
-- Two things have to be true for any of this to mean anything, and both are
-- easy to get silently wrong:
--
--   1. The application must NOT connect as a superuser. Superusers bypass RLS
--      entirely and no error is raised — the policies below simply never
--      apply. The compose default user IS a superuser, so `pnpm db:rls`
--      creates a separate NOSUPERUSER NOBYPASSRLS role for the gateway, and
--      /api/health reports which one is actually in use.
--   2. Every request must set `app.tenant_id`. It is read with the
--      missing_ok flag, so an unset value is NULL rather than an error, and
--      NULL matches no row. No context means no data, which is the safe way
--      round for this to fail.

-- ── Tenant isolation ────────────────────────────────────────────────────────

-- FORCE as well as ENABLE. ENABLE alone exempts the table owner, and the owner
-- here is the same role that runs migrations — one `GRANT` mistake away from
-- being the application's role too.
ALTER TABLE "agents"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agents"      FORCE  ROW LEVEL SECURITY;
ALTER TABLE "tasks"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks"       FORCE  ROW LEVEL SECURITY;
ALTER TABLE "traces"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "traces"      FORCE  ROW LEVEL SECURITY;
ALTER TABLE "llm_usage"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "llm_usage"   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "audit_log"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log"   FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

-- Returns NULL when unset or blank, so `tenant_id = current_tenant()` is NULL
-- and therefore not true. STABLE, not IMMUTABLE: it varies within a
-- transaction boundary but not within a statement, which is what lets the
-- planner call it once per query instead of once per row.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

-- USING filters what is visible; WITH CHECK filters what may be written. Both
-- are needed: USING alone would let a caller INSERT a row belonging to another
-- tenant that it could then never see — a write it cannot audit or undo.
CREATE POLICY tenant_isolation ON "agents"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "tasks"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "traces"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "llm_usage"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "memberships"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON "audit_log"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint

-- `users` is deliberately not covered. A login has to find an account before
-- any tenant exists to scope the lookup to, so isolation for identity comes
-- from never exposing the table except through the session — and from
-- `memberships` above, which is what decides whether that identity may see
-- anything at all.

-- ── Append-only audit log ───────────────────────────────────────────────────

-- Enforced in the database, not in the service. An audit trail the
-- application can rewrite is a log with extra steps, and the whole reason
-- HIPAA's audit-control safeguard exists is that the interesting attacker is
-- often the application itself.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
--> statement-breakpoint

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
