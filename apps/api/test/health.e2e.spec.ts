import { type INestApplication } from "@nestjs/common";
import { WsAdapter } from "@nestjs/platform-ws";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";

/**
 * Boots the real Nest application (global `api` prefix included) so the health
 * check is verified at the URL the compose stack and CI actually probe.
 *
 * Deliberately tolerant of the database being down: CI's Node job has no
 * Postgres, and the point of this endpoint is that it answers either way.
 */
describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // AuthModule refuses to construct without one, deliberately — a generated
    // fallback would work until the second replica started. CI has no .env, so
    // the suite supplies its own.
    process.env["JWT_SECRET"] ??= "test-secret-not-used-anywhere-real";

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Must mirror main.ts. Without it Nest looks for the default socket.io
    // driver, cannot find it, and calls process.exit(1) during init — which
    // reads as a mysterious test-suite crash rather than a missing adapter.
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterAll(async () => {
    // Closes the pg pool too; without it Jest hangs on an open handle.
    await app.close();
  });

  it("GET /api/health returns 200 whether or not the database is reachable", async () => {
    const res = await request(app.getHttpServer()).get("/api/health").expect(200);

    expect(res.body.service).toBe("clinicpilot-api");
    expect(["ok", "degraded"]).toContain(res.body.status);
    expect(["up", "down"]).toContain(res.body.dependencies.database);
    expect(typeof res.body.ts).toBe("string");
  });

  it("agrees with itself about its dependencies", async () => {
    const res = await request(app.getHttpServer()).get("/api/health").expect(200);

    // `ok` must never be reported alongside a degraded dependency — that is
    // the failure mode a health check exists to prevent. Both dependencies
    // count: a reachable database that is not enforcing tenant isolation is
    // not a healthy gateway.
    const healthy =
      res.body.dependencies.database === "up" &&
      res.body.dependencies.tenantIsolation === "enforced";

    expect(res.body.status).toBe(healthy ? "ok" : "degraded");
  });

  it("reports whether tenant isolation is actually being enforced", async () => {
    const res = await request(app.getHttpServer()).get("/api/health").expect(200);

    expect(["enforced", "BYPASSED"]).toContain(res.body.dependencies.tenantIsolation);
  });

  it("is reachable without a session, unlike everything else", async () => {
    // The global auth guard closes every route by default; health has to opt
    // out or the compose healthcheck can never pass.
    await request(app.getHttpServer()).get("/api/health").expect(200);
  });

  it("refuses an unauthenticated request to a protected route", async () => {
    // The other half of that: proves the guard is actually mounted, so the
    // test above is testing an opt-out rather than an absence.
    await request(app.getHttpServer()).get("/api/tasks").expect(401);
  });

  it("refuses an internal route with no service token", async () => {
    await request(app.getHttpServer())
      .post("/api/internal/tasks/00000000-0000-4000-8000-000000000009/running")
      .expect(401);
  });

  it("serves nothing at the unprefixed path", async () => {
    await request(app.getHttpServer()).get("/health").expect(404);
  });
});
