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

  it("agrees with itself about the database", async () => {
    const res = await request(app.getHttpServer()).get("/api/health").expect(200);

    // `ok` must never be reported alongside a down dependency — that is the
    // failure mode a health check exists to prevent.
    const expected = res.body.dependencies.database === "up" ? "ok" : "degraded";
    expect(res.body.status).toBe(expected);
  });

  it("serves nothing at the unprefixed path", async () => {
    await request(app.getHttpServer()).get("/health").expect(404);
  });
});
