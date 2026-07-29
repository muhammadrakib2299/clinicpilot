import { Controller, Get } from "@nestjs/common";

import { DbService } from "../db/db.service";

@Controller("health")
export class HealthController {
  constructor(private readonly db: DbService) {}

  /**
   * Always 200, even when a dependency is down.
   *
   * A degraded gateway is still a running process, and the compose healthcheck
   * gating startup on this must not flap because Postgres restarted. The body
   * says which dependency is unhappy; alerting reads `status`, not the code.
   */
  @Get()
  async check() {
    const database = (await this.db.ping()) ? "up" : "down";

    return {
      status: database === "up" ? "ok" : "degraded",
      service: "clinicpilot-api",
      dependencies: { database },
      ts: new Date().toISOString(),
    };
  }
}
