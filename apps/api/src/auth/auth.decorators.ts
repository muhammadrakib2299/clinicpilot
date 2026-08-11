import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "@clinicpilot/shared-types";

export const PUBLIC_KEY = "clinicpilot:public";
export const SERVICE_KEY = "clinicpilot:service";
export const ROLES_KEY = "clinicpilot:min-role";

/**
 * Reachable without a session.
 *
 * Opt-out rather than opt-in: the auth guard is registered globally, so a new
 * controller is protected by default and forgetting a decorator locks a route
 * down instead of opening it up. That is the direction this mistake should
 * fail in.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Reachable only by another service, with the shared token — never by a user.
 *
 * These routes carry no user at all, which is why they are the ones that most
 * need saying out loud in the code.
 */
export const ServiceOnly = () => SetMetadata(SERVICE_KEY, true);

/**
 * Minimum role. Hierarchical, not exact: `@MinRole("coordinator")` admits
 * admins and clinicians too, because they are strictly more privileged.
 */
export const MinRole = (role: UserRole) => SetMetadata(ROLES_KEY, role);
