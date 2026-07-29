import { Test, type TestingModule } from "@nestjs/testing";

import { HealthController } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get(HealthController);
  });

  it("reports ok and identifies the service", () => {
    const result = controller.check();

    expect(result.status).toBe("ok");
    expect(result.service).toBe("clinicpilot-api");
  });

  it("stamps an ISO-8601 UTC timestamp", () => {
    const { ts } = controller.check();

    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
  });
});
