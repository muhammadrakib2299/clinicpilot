import { Body, Controller, Get, Global, Module, Post, Req } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { LoginInput, SwitchTenantInput } from "@clinicpilot/shared-types";
import type { Request } from "express";

import { AuditService } from "../audit/audit.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestActor } from "../common/request-context";
import { Public } from "./auth.decorators";
import { AuthGuard } from "./auth.guard";
import { AuthService, TOKEN_TTL } from "./auth.service";

const actorOf = (request: Request): RequestActor =>
  (request as Request & { actor: RequestActor }).actor;

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post("login")
  async login(
    @Body(new ZodValidationPipe(LoginInput)) body: LoginInput,
    @Req() request: Request,
  ) {
    const result = await this.auth.login(body);

    // Written outside the request's actor scope, because the actor only exists
    // from the next request onwards — a sign-in is the one action whose audit
    // entry has to name a user the guard never saw.
    await this.audit.record({
      tenantId: result.user.tenantId,
      actorId: result.user.id,
      actorEmail: result.user.email,
      action: "auth.login",
      resourceType: "session",
      resourceId: result.user.id,
      ip: request.ip,
    });

    return result;
  }

  @Get("me")
  me(@Req() request: Request) {
    const actor = actorOf(request);
    return this.auth.sessionFor(actor.userId, actor.tenantId);
  }

  @Post("switch-tenant")
  async switchTenant(
    @Body(new ZodValidationPipe(SwitchTenantInput)) body: SwitchTenantInput,
    @Req() request: Request,
  ) {
    const actor = actorOf(request);
    const result = await this.auth.switchTenant(actor.userId, body.tenantId);

    await this.audit.record({
      tenantId: result.user.tenantId,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "auth.switch_tenant",
      resourceType: "tenant",
      resourceId: body.tenantId,
      metadata: { from: actor.tenantId },
      ip: request.ip,
    });

    return result;
  }

  /**
   * There is no server-side session to destroy — the token is stateless, so
   * this records the intent and the client discards it. A real revocation list
   * is Phase 2.5 work, and pretending this does more than it does would be the
   * kind of security theatre SECURITY.md exists to avoid.
   */
  @Post("logout")
  async logout(@Req() request: Request) {
    const actor = actorOf(request);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "auth.logout",
      resourceType: "session",
      resourceId: actor.userId,
      ip: request.ip,
    });

    return { ok: true };
  }
}

/**
 * Global because `AuthGuard` is registered application-wide and Nest has to be
 * able to construct it wherever it runs.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env["JWT_SECRET"];

        // Refuses to boot rather than generating one. A generated secret would
        // work perfectly until the second replica started, at which point
        // tokens issued by one instance are rejected by the other.
        if (!secret || secret.length < 16) {
          throw new Error(
            "JWT_SECRET must be set to at least 16 characters. See .env.example.",
          );
        }

        return { secret, signOptions: { expiresIn: TOKEN_TTL } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
