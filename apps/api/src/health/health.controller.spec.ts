import { Test, type TestingModule } from "@nestjs/testing";

import { DbService } from "../db/db.service";
import { HealthController } from "./health.controller";

async function controllerWith(databaseUp: boolean): Promise<HealthController> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DbService, useValue: { ping: async () => databaseUp } }],
  }).compile();

  return module.get(HealthController);
}

describe("HealthController", () => {
  it("reports ok and identifies the service when everything is up", async () => {
    const result = await (await controllerWith(true)).check();

    expect(result.status).toBe("ok");
    expect(result.service).toBe("clinicpilot-api");
    expect(result.dependencies).toEqual({ database: "up" });
  });

  it("reports degraded — not ok — when the database is unreachable", async () => {
    const result = await (await controllerWith(false)).check();

    expect(result.status).toBe("degraded");
    expect(result.dependencies).toEqual({ database: "down" });
  });

  it("stamps an ISO-8601 UTC timestamp", async () => {
    const { ts } = await (await controllerWith(true)).check();

    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
  });
});
