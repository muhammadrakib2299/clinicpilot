/**
 * Tenant resolution — one seam, deliberately.
 *
 * Phase 1 runs a single hardcoded tenant with no auth. Phase 2 adds real
 * resolution from the session plus RLS policies (ADR-005). Keeping every
 * tenant lookup behind this function means that change lands in one file
 * rather than in every query, and makes it obvious in review when something
 * has skipped the seam.
 */

/** Matches the fixed id the seed writes, so fixtures and runtime agree. */
export const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";

export function currentTenantId(): string {
  return DEMO_TENANT_ID;
}
