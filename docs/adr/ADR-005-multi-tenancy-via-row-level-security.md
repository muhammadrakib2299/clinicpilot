# ADR-005 — Multi-tenancy via Postgres row-level security

- **Status:** Accepted
- **Date:** 2026-08-11
- **Relates to:** [ADR-004](./ADR-004-postgres-ownership-and-drizzle.md) (the
  gateway owns Postgres), [ADR-007](./ADR-007-queue-and-worker-topology.md)
  (runs happen with no user in the request)

## Context

Every tenant-scoped table has carried `tenant_id` since Phase 1, and every
query filtered on it. That is *a* multi-tenancy model — the one where isolation
holds exactly as long as no developer ever forgets a `WHERE` clause. For a
healthcare product, "we always remember" is not a control.

The options are the usual three: filter in the application, isolate with
row-level security, or give each tenant its own schema or database.

## Decision

**Shared tables with Postgres row-level security, on a connection that RLS
actually applies to, with the tenant set per transaction.**

Concretely:

1. `ENABLE` **and** `FORCE ROW LEVEL SECURITY` on every tenant-scoped table.
2. Policies carry `USING` **and** `WITH CHECK`, both comparing to
   `app_current_tenant()`, which returns NULL when unset.
3. The gateway connects as a `NOSUPERUSER NOBYPASSRLS` role, created by
   `pnpm db:rls`. Migrations keep the owning role.
4. Every tenant-scoped query runs inside `withTenant()`, a transaction that
   issues `SET LOCAL app.tenant_id`.
5. Application-level `tenant_id` filters stay.

## Rationale

### RLS over application filtering

It enforces isolation at the database, so an application bug cannot leak across
tenants. That is the whole argument, and it is worth the cost for data of this
kind.

### RLS over schema-per-tenant

Schema-per-tenant isolates harder and is a genuine option later. It is not the
default because migrations then run N times and become a deployment risk that
grows with the customer list, and because pooling connections across hundreds
of schemas is its own problem. Shared-with-RLS is the model that scales down to
a demo and up to a few thousand tenants; `11-SAAS-PRODUCTIZATION.md` keeps
schema isolation as an enterprise upsell path rather than day-one complexity.

### The role is not a detail — it is the decision

**Postgres superusers bypass RLS silently.** Not with a warning, not with an
error: the policies remain, and every one is skipped. The compose default user
is a superuser, so the obvious wiring — reuse `DATABASE_URL` — would have left
every policy in place and nothing enforced. Worse than having no policies,
because the code, the schema and the tests all still look right.

Hence a separate unprivileged role, and hence `/api/health` reporting
`tenantIsolation`, so the misconfiguration is visible rather than silent.

`FORCE` matters for the same reason at one remove: plain `ENABLE` exempts the
table owner, which is the role that runs migrations.

### `SET LOCAL`, not `SET`

Transaction-scoped. A session-level `SET` on a pooled connection would carry
one request's tenant into the next request that borrowed it — a cross-tenant
read that only appears under concurrency, which is the worst possible time to
find one.

### Belt and braces

The explicit `WHERE tenant_id = ...` filters stay. RLS is the backstop for a
query that forgets, not permission to stop filtering, and they are what still
holds if the gateway is ever pointed at a superuser connection.

### `users` is deliberately not covered

A login has to find an account before any tenant exists to scope the lookup to.
Identity is global; `memberships` is what makes it tenant-scoped.

That created the one bug worth recording here. `memberships` *is* RLS-covered,
so reading it before a tenant is chosen returned nothing and every login failed
— while the comment above the query asserted a `user_id` filter was enough. The
fix was to widen the policy rather than to step around it: a membership is
visible if it belongs to the current tenant **or** to the current user
(`app.user_id`). `WITH CHECK` stays tenant-only, because creating a membership
elsewhere is how you would grant yourself another clinic.

## Consequences

**Accepted costs**

- **A second database role to provision.** `pnpm db:rls` is a step a fresh
  clone must run, and forgetting it means RLS silently does nothing — which is
  why health reports it.
- **Every tenant-scoped query is a transaction.** Cheap, but not free, and it
  means a query written outside `withTenant()` sees nothing rather than
  erroring. Failing closed is the right direction; it is still a confusing
  first debugging experience.
- **Two places express the same rule.** The policy and the `WHERE` clause can
  drift. Accepted deliberately — see "belt and braces".
- **The internal surface takes its tenant from a header.** Runs have no user
  (ADR-007), so the tenant is a claim. It grants nothing — every query is
  scoped to whatever was claimed, so a wrong value finds no rows — but it is
  weaker than a session and depends on the service token in front of it.
- **Cross-tenant reporting is now hard by construction.** Any future
  "usage across all tenants" query needs a deliberate, separately-audited path.

**Verified, not assumed** — as the unprivileged role, against real Postgres:
no tenant set returns zero rows; a tenant sees only its own; asking for another
tenant's id by hand returns nothing; `INSERT` into another tenant is refused by
`WITH CHECK`; the context does not survive the transaction; and the owning role
does see everything, which is why the app role exists.

## Revisit if

- A tenant needs physical isolation for a contractual reason — that is the
  schema-per-tenant upgrade, and it can be per-tenant rather than global.
- Connection-pool overhead from per-transaction `SET LOCAL` shows up in a
  profile, which it has not.
- A second service needs direct database access, at which point the policy set
  has to be understood by more than one codebase and `SECURITY DEFINER`
  functions may be the better boundary.
