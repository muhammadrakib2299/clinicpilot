import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { currentActor, runInRequestScope } from "../common/request-context";
import { PUBLIC_KEY, ROLES_KEY, SERVICE_KEY } from "./auth.decorators";
import { AuthGuard, timingSafeEqualString } from "./auth.guard";
import type { AuthService, TokenClaims } from "./auth.service";

const CLAIMS: TokenClaims = {
  sub: "user-1",
  email: "admin@demo.clinicpilot.io",
  tenantId: "00000000-0000-4000-8000-000000000001",
  role: "admin",
};

function contextWith(headers: Record<string, string> = {}): ExecutionContext {
  const request = {
    ip: "203.0.113.7",
    header: (name: string) => headers[name.toLowerCase()],
  };

  return {
    getType: () => "http",
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** A Reflector that reports one metadata key as set. */
function reflectorFor(key?: string, value: unknown = true): Reflector {
  return {
    getAllAndOverride: (wanted: string) => (wanted === key ? value : undefined),
  } as unknown as Reflector;
}

/**
 * Every call goes through a request scope, because that is what the middleware
 * provides in production — the guard fills a scope in, it does not open one.
 */
const activate = (guard: AuthGuard, context: ExecutionContext) =>
  runInRequestScope(() => guard.canActivate(context));

const authStub = (claims: TokenClaims = CLAIMS) =>
  ({ verify: () => claims }) as unknown as AuthService;

const failingAuth = () =>
  ({
    verify: () => {
      throw new UnauthorizedException("Session expired or invalid");
    },
  }) as unknown as AuthService;

describe("AuthGuard", () => {
  const originalToken = process.env["SERVICE_TOKEN"];
  afterEach(() => {
    if (originalToken === undefined) delete process.env["SERVICE_TOKEN"];
    else process.env["SERVICE_TOKEN"] = originalToken;
  });

  it("lets a @Public route through with no token", async () => {
    const guard = new AuthGuard(reflectorFor(PUBLIC_KEY), failingAuth());

    await expect(activate(guard, contextWith())).resolves.toBe(true);
  });

  it("refuses a protected route with no Authorization header", async () => {
    const guard = new AuthGuard(reflectorFor(), authStub());

    await expect(activate(guard, contextWith())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuses an Authorization header that is not a bearer token", async () => {
    const guard = new AuthGuard(reflectorFor(), authStub());

    await expect(
      activate(guard, contextWith({ authorization: "Basic dXNlcjpwYXNz" })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("admits a valid token and attaches the actor to the request", async () => {
    const guard = new AuthGuard(reflectorFor(), authStub());
    const context = contextWith({ authorization: "Bearer valid" });

    await expect(activate(guard, context)).resolves.toBe(true);

    const actor = (
      context.switchToHttp().getRequest() as { actor?: ReturnType<typeof currentActor> }
    ).actor;

    expect(actor).toEqual({
      userId: "user-1",
      email: "admin@demo.clinicpilot.io",
      tenantId: CLAIMS.tenantId,
      role: "admin",
      ip: "203.0.113.7",
    });
  });

  it("takes the tenant from the token, never from the request", async () => {
    // A header-supplied tenant would be an authorisation bypass in one line.
    const guard = new AuthGuard(reflectorFor(), authStub());
    const context = contextWith({
      authorization: "Bearer valid",
      "x-tenant-id": "00000000-0000-4000-8000-000000000002",
    });

    await activate(guard, context);

    const actor = (
      context.switchToHttp().getRequest() as { actor?: ReturnType<typeof currentActor> }
    ).actor;

    expect(actor?.tenantId).toBe(CLAIMS.tenantId);
  });

  describe("roles", () => {
    const withRole = (role: TokenClaims["role"], minimum: string) =>
      new AuthGuard(reflectorFor(ROLES_KEY, minimum), authStub({ ...CLAIMS, role }));

    it("admits a role above the minimum", async () => {
      await expect(
        activate(withRole("admin", "coordinator"), contextWith({ authorization: "Bearer t" })),
      ).resolves.toBe(true);
    });

    it("admits a role exactly at the minimum", async () => {
      await expect(
        activate(withRole("viewer", "viewer"), contextWith({ authorization: "Bearer t" })),
      ).resolves.toBe(true);
    });

    it("refuses a role below the minimum, and says which is needed", async () => {
      const attempt = activate(
        withRole("viewer", "coordinator"),
        contextWith({ authorization: "Bearer t" }),
      );

      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toThrow(/coordinator/);
    });
  });

  describe("service token", () => {
    it("refuses when SERVICE_TOKEN is unset, rather than allowing", async () => {
      // The convenient default is the one that ships an open door to patient
      // data, so an unconfigured internal surface is a closed one.
      delete process.env["SERVICE_TOKEN"];
      const guard = new AuthGuard(reflectorFor(SERVICE_KEY), authStub());

      await expect(
        activate(guard, contextWith({ "x-service-token": "anything" })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("refuses a wrong token", async () => {
      process.env["SERVICE_TOKEN"] = "the-real-token";
      const guard = new AuthGuard(reflectorFor(SERVICE_KEY), authStub());

      await expect(
        activate(guard, contextWith({ "x-service-token": "not-it" })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("refuses a missing token", async () => {
      process.env["SERVICE_TOKEN"] = "the-real-token";
      const guard = new AuthGuard(reflectorFor(SERVICE_KEY), authStub());

      await expect(activate(guard, contextWith())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("admits the right token, with no user and no bearer", async () => {
      process.env["SERVICE_TOKEN"] = "the-real-token";
      const guard = new AuthGuard(reflectorFor(SERVICE_KEY), failingAuth());

      await expect(
        activate(guard, contextWith({ "x-service-token": "the-real-token" })),
      ).resolves.toBe(true);
    });
  });
});

describe("timingSafeEqualString", () => {
  it("matches identical strings", () => {
    expect(timingSafeEqualString("token", "token")).toBe(true);
  });

  it("rejects different strings", () => {
    expect(timingSafeEqualString("token", "toker")).toBe(false);
  });

  it("handles different lengths without throwing", () => {
    // node's timingSafeEqual throws on a length mismatch, and that throw is
    // itself a leak — it reveals the expected token's length.
    expect(timingSafeEqualString("short", "a-much-longer-token")).toBe(false);
    expect(timingSafeEqualString("", "x")).toBe(false);
  });

  it("handles multi-byte characters", () => {
    expect(timingSafeEqualString("tökén", "tökén")).toBe(true);
    expect(timingSafeEqualString("tökén", "token")).toBe(false);
  });
});
