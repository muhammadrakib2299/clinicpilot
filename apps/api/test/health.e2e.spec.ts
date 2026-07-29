import { type INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";

/**
 * Boots the real Nest application (global `api` prefix included) so the health
 * check is verified at the URL the compose stack and CI actually probe.
 */
describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health returns 200 with the service descriptor", async () => {
    const res = await request(app.getHttpServer()).get("/api/health").expect(200);

    expect(res.body).toMatchObject({ status: "ok", service: "clinicpilot-api" });
    expect(typeof res.body.ts).toBe("string");
  });

  it("serves nothing at the unprefixed path", async () => {
    await request(app.getHttpServer()).get("/health").expect(404);
  });
});
