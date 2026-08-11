import { AsyncLocalStorage } from "node:async_hooks";

import type { UserRole } from "@clinicpilot/shared-types";

/**
 * Who is making the current request, carried out-of-band.
 *
 * `AsyncLocalStorage` rather than threading a context argument through every
 * service method. The alternative was considered and rejected: the tenant is
 * needed by every query in the application, and a parameter that appears in
 * every signature is one that will eventually be omitted from one of them —
 * and the failure mode of omitting it is a cross-tenant read.
 *
 * The store is populated once, by the auth guard, and is read-only afterwards.
 */
export interface RequestActor {
  userId: string;
  email: string;
  tenantId: string;
  role: UserRole;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestActor>();

export function runWithActor<T>(actor: RequestActor, fn: () => T): T {
  return storage.run(actor, fn);
}

/** The current actor, or undefined outside a request (scripts, the worker). */
export function currentActor(): RequestActor | undefined {
  return storage.getStore();
}

/**
 * The tenant this request may touch.
 *
 * Throws rather than returning a default. Phase 1 had a hardcoded demo tenant
 * here and every query silently used it; now an unauthenticated code path that
 * reaches a query is a bug, and it should present as one rather than as a
 * successful read of somebody's clinic.
 */
export function currentTenantId(): string {
  const actor = storage.getStore();

  if (!actor) {
    throw new Error(
      "No tenant in scope. A query ran outside an authenticated request — " +
        "wrap it in runWithActor, or use the service-token path for internal routes.",
    );
  }

  return actor.tenantId;
}
