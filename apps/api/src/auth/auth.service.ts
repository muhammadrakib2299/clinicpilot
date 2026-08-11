import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { LoginInput, SessionUser, TenantMembership, UserRole } from "@clinicpilot/shared-types";
import { eq, sql } from "drizzle-orm";

import { hashPassword, verifyPassword } from "../common/password";
import { DbService } from "../db/db.service";
import { memberships, tenants, users } from "../db/schema";

/** Long enough for a demo session, short enough that a leaked token expires. */
export const TOKEN_TTL = "12h";

export interface TokenClaims {
  sub: string;
  email: string;
  tenantId: string;
  role: UserRole;
}

/**
 * A hash of a password that no account uses.
 *
 * Verified against when the email is unknown, so a login for a non-existent
 * account costs the same as one for a real account with the wrong password.
 * Without it, response time answers "does this email have an account here" —
 * which for a clinic is itself patient information.
 */
let decoyHash: Promise<string> | null = null;
function decoy(): Promise<string> {
  decoyHash ??= hashPassword("password-that-belongs-to-no-account");
  return decoyHash;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Exchange credentials for a token.
   *
   * Every failure — unknown email, wrong password, no membership — returns the
   * same message. Distinguishing them is a small kindness to a user and a
   * large one to an attacker enumerating accounts.
   */
  async login(input: LoginInput): Promise<{ token: string; user: SessionUser }> {
    const email = input.email.trim().toLowerCase();

    // `users` is not RLS-scoped — there is no tenant yet to scope it to.
    const [user] = await this.dbService.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, email))
      .limit(1);

    if (!user) {
      await verifyPassword(input.password, await decoy());
      throw new UnauthorizedException("Invalid email or password");
    }

    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const found = await this.membershipsFor(user.id);
    if (found.length === 0) {
      // A real account with no clinic. Same message: whether an email exists
      // is exactly what the uniform response is protecting.
      this.logger.warn(`user ${user.id} signed in with no memberships`);
      throw new UnauthorizedException("Invalid email or password");
    }

    const active = input.tenantId
      ? found.find((m) => m.tenantId === input.tenantId)
      : found[0];

    if (!active) {
      throw new UnauthorizedException("You do not have access to that organisation");
    }

    await this.dbService.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    return {
      token: await this.sign(user.id, user.email, active),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tenantId: active.tenantId,
        role: active.role,
        memberships: found,
      },
    };
  }

  /**
   * Issue a token for a different tenant the same user belongs to.
   *
   * Re-reads the membership rather than trusting the current token's claim
   * list. A token is a snapshot; access may have been revoked since it was
   * issued, and a switch is exactly when that should be noticed.
   */
  async switchTenant(userId: string, tenantId: string) {
    const found = await this.membershipsFor(userId);
    const target = found.find((m) => m.tenantId === tenantId);

    if (!target) throw new UnauthorizedException("You do not have access to that organisation");

    const [user] = await this.dbService.db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new UnauthorizedException("Account no longer exists");

    return {
      token: await this.sign(userId, user.email, target),
      user: {
        id: userId,
        email: user.email,
        name: user.name,
        tenantId: target.tenantId,
        role: target.role,
        memberships: found,
      } satisfies SessionUser,
    };
  }

  async sessionFor(userId: string, tenantId: string): Promise<SessionUser> {
    const found = await this.membershipsFor(userId);
    const active = found.find((m) => m.tenantId === tenantId);

    if (!active) throw new UnauthorizedException("Your access to this organisation has changed");

    const [user] = await this.dbService.db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new UnauthorizedException("Account no longer exists");

    return {
      id: userId,
      email: user.email,
      name: user.name,
      tenantId: active.tenantId,
      role: active.role,
      memberships: found,
    };
  }

  verify(token: string): TokenClaims {
    try {
      return this.jwt.verify<TokenClaims>(token);
    } catch {
      throw new UnauthorizedException("Session expired or invalid");
    }
  }

  /**
   * Which tenants this user belongs to.
   *
   * `memberships` is RLS-protected, and this deliberately runs outside a tenant
   * context — the whole point is to discover which tenants there are. It is
   * scoped by `user_id` instead, which is the one filter that is safe here
   * because the user id came from a verified token or a verified password.
   */
  private async membershipsFor(userId: string): Promise<TenantMembership[]> {
    return this.dbService.db
      .select({
        tenantId: memberships.tenantId,
        tenantName: tenants.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, userId))
      .orderBy(tenants.name);
  }

  private async sign(userId: string, email: string, membership: TenantMembership) {
    return this.jwt.signAsync({
      sub: userId,
      email,
      tenantId: membership.tenantId,
      role: membership.role,
    } satisfies TokenClaims);
  }
}

