/**
 * Roles and the privilege hierarchy — deliberately free of any dependency.
 *
 * Split out of `index.ts` because the SPA needs `roleAtLeast` to decide what
 * to render, and importing it from the package root dragged zod into the
 * browser bundle: +17 KB gzipped, a 25% increase, for one comparison. zod
 * belongs on the server, where the schemas are actually parsed.
 *
 * `index.ts` builds its `UserRole` enum from `USER_ROLES` below, so there is
 * still one list.
 */

/**
 * Ordered most-privileged first. The order **is** the hierarchy — `roleAtLeast`
 * compares positions — so inserting a role in the middle changes who can do
 * what. Must stay in step with the `user_role` enum in the gateway's schema.
 */
export const USER_ROLES = ["admin", "clinician", "coordinator", "viewer"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Whether `role` is at least as privileged as `minimum`.
 *
 * A hierarchy rather than a permission matrix. Four roles that genuinely nest
 * do not need a matrix, and the matrix version of this is the kind of thing
 * that grows a bug where an admin cannot do something a viewer can.
 */
export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return USER_ROLES.indexOf(role) <= USER_ROLES.indexOf(minimum);
}
