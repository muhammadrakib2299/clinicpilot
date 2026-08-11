/**
 * Tenant resolution.
 *
 * Phase 1 returned one hardcoded id from here and every query used it. Phase 2
 * replaced that with the actor on the request — see `request-context.ts` — and
 * this file now exists for two things only: the seeded demo tenant's fixed id,
 * and a re-export so the seam stays where the rest of the code expects it.
 *
 * The important change is what happens with no tenant in scope. It used to be
 * "the demo tenant"; it is now an exception. A query that reaches the database
 * without an authenticated request is a bug, and it should look like one.
 */

export { currentTenantId, currentActor, runWithActor } from "./request-context";
export type { RequestActor } from "./request-context";

/** Matches the fixed id the seed writes, so fixtures and requests agree. */
export const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";

/** The second seeded clinic — exists so cross-tenant isolation is testable. */
export const SECOND_TENANT_ID = "00000000-0000-4000-8000-000000000002";
