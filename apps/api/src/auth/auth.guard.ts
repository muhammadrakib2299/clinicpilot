import { createHash, timingSafeEqual } from "node:crypto";

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { roleAtLeast, type UserRole } from "@clinicpilot/shared-types";
import type { Request } from "express";

import { setActor, type RequestActor } from "../common/request-context";
import { AuthService } from "./auth.service";
import { PUBLIC_KEY, ROLES_KEY, SERVICE_KEY } from "./auth.decorators";

/**
 * One global guard for authentication, tenant context and RBAC.
 *
 * Global so that protection is the default and a new route has to opt out
 * explicitly. The alternative — decorating each controller — fails open, and
 * the thing it fails open on here is patient data.
 *
 * It does not open the AsyncLocalStorage scope — `RequestContextMiddleware`
 * does, before this runs. A guard cannot: its scope would close the moment it
 * returned `true`, leaving the controller outside it. This fills in the store
 * the middleware already opened.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket upgrades are authenticated in the gateway, not here; this
    // guard only understands HTTP.
    if (context.getType() !== "http") return true;

    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request>();

    if (this.reflector.getAllAndOverride<boolean>(SERVICE_KEY, targets)) {
      this.assertServiceToken(request);
      return true;
    }

    const claims = this.auth.verify(bearer(request));
    const minRole = this.reflector.getAllAndOverride<UserRole>(ROLES_KEY, targets);

    if (minRole && !roleAtLeast(claims.role, minRole)) {
      throw new ForbiddenException(
        `This action needs the ${minRole} role or higher; you are ${claims.role}.`,
      );
    }

    const actor: RequestActor = {
      userId: claims.sub,
      email: claims.email,
      tenantId: claims.tenantId,
      role: claims.role,
      ip: request.ip,
    };

    (request as Request & { actor?: RequestActor }).actor = actor;

    // Into the scope the middleware opened. Everything downstream —
    // controller, services, queries — reads the actor from there, which is
    // what makes `currentTenantId()` work without a parameter on every call.
    setActor(actor);

    return true;
  }

  /**
   * The `internal/` surface reads and writes patient data with no user in the
   * request, so the token is the only thing standing in front of it.
   *
   * An unset `SERVICE_TOKEN` refuses every request rather than allowing them.
   * The convenient default is the one that ships an open door.
   */
  private assertServiceToken(request: Request): void {
    const expected = process.env["SERVICE_TOKEN"];

    if (!expected) {
      throw new UnauthorizedException(
        "SERVICE_TOKEN is not configured, so internal routes are closed.",
      );
    }

    const presented = request.header("x-service-token");
    if (!presented || !timingSafeEqualString(presented, expected)) {
      throw new UnauthorizedException("Invalid service token");
    }
  }
}

function bearer(request: Request): string {
  const header = request.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new UnauthorizedException("Sign in to continue");
  }

  return token;
}

/**
 * Constant-time string comparison.
 *
 * `===` short-circuits on the first differing byte, which leaks the token one
 * character at a time to anyone who can measure the response.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  // timingSafeEqual throws on a length mismatch, and that throw is itself the
  // leak — it reveals the token's length. Hashing both to a fixed 32 bytes
  // first makes every comparison the same size and the same duration.
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

  return timingSafeEqual(digest(a), digest(b));
}
