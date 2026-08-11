import { AsyncLocalStorage } from "node:async_hooks";

import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { UserRole } from "@clinicpilot/shared-types";

/**
 * Who is making the current request, carried out-of-band.
 *
 * `AsyncLocalStorage` rather than threading a context argument through every
 * service method. The alternative was considered and rejected: the tenant is
 * needed by every query in the application, and a parameter that appears in
 * every signature is one that will eventually be omitted from one of them —
 * and the failure mode of omitting it is a cross-tenant read.
 */
export interface RequestActor {
  userId: string;
  email: string;
  tenantId: string;
  role: UserRole;
  ip?: string;
}

/**
 * The store is a mutable box, and the box is opened before the actor exists.
 *
 * This is the part that is easy to get wrong, and I did: the first version
 * opened the scope inside the auth guard with
 * `storage.run(actor, () => true)`. That scope closes the instant the callback
 * returns — the guard's `true` — so the controller ran outside it and every
 * tenant-scoped query threw. Guards cannot wrap the handler; only middleware
 * and interceptors can.
 *
 * So middleware opens an empty scope around the entire downstream pipeline,
 * and the guard fills it in once it has verified the token. Async
 * continuations inherit the scope, so every query in the request sees it.
 */
interface Store {
  actor?: RequestActor;
}

const storage = new AsyncLocalStorage<Store>();

/**
 * Open an empty request scope around `fn`.
 *
 * Exported because tests need the same scope the middleware provides — a guard
 * exercised in isolation still calls `setActor`, and without a scope that is a
 * (correct) hard error rather than a silent no-op.
 */
export function runInRequestScope<T>(fn: () => T): T {
  return storage.run({}, fn);
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: () => void): void {
    runInRequestScope(next);
  }
}

/** Called by the auth guard once the token is verified. */
export function setActor(actor: RequestActor): void {
  const store = storage.getStore();
  if (!store) {
    throw new Error(
      "No request scope. RequestContextMiddleware must be applied before the auth guard runs.",
    );
  }
  store.actor = actor;
}

/** For tests and scripts that need a scope without an HTTP request. */
export function runWithActor<T>(actor: RequestActor, fn: () => T): T {
  return storage.run({ actor }, fn);
}

/** The current actor, or undefined outside a request (scripts, the worker). */
export function currentActor(): RequestActor | undefined {
  return storage.getStore()?.actor;
}

/**
 * The tenant this request may touch.
 *
 * Throws rather than returning a default. Phase 1 had a hardcoded demo tenant
 * here and every query silently used it; now an unauthenticated code path that
 * reaches a query is a bug, and it should present as one rather than as a
 * successful read of somebody's clinic.
 *
 * That choice earned itself immediately — the scoping bug above surfaced as a
 * loud 500 on the first live request instead of as every user quietly reading
 * the demo tenant's data.
 */
export function currentTenantId(): string {
  const actor = currentActor();

  if (!actor) {
    throw new Error(
      "No tenant in scope. A query ran outside an authenticated request — " +
        "check RequestContextMiddleware is applied, or use the service-token path.",
    );
  }

  return actor.tenantId;
}
