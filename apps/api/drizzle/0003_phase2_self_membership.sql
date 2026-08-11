-- Let a user see their own memberships, in any tenant.
--
-- Login has a chicken-and-egg problem with RLS: the tenant comes from the
-- user's memberships, but `memberships` is tenant-scoped, so reading it
-- without a tenant already set returns nothing. The first live sign-in after
-- Phase 2 landed failed with "signed in with no memberships" for exactly this
-- reason — the code comment claimed a `user_id` filter was sufficient, and the
-- policy disagreed.
--
-- The wrong fixes, and why:
--   * Drop RLS on `memberships` — hands the whole table to any query that
--     forgets a WHERE clause, which is the failure RLS exists to stop.
--   * A SECURITY DEFINER function — works, but it is a hole punched through
--     the policy that then has to be audited separately forever.
--
-- The right one is to say what is actually true: you may see a membership if
-- it belongs to the tenant you are working in, **or** if it is yours. That is
-- a policy, not an exception to one.

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

DROP POLICY tenant_isolation ON "memberships";
--> statement-breakpoint

-- USING is widened; WITH CHECK is not. Reading your own membership row is
-- fine; *creating* one outside the tenant you are in is how you would grant
-- yourself access to another clinic.
CREATE POLICY membership_visibility ON "memberships"
  USING (tenant_id = app_current_tenant() OR user_id = app_current_user())
  WITH CHECK (tenant_id = app_current_tenant());
