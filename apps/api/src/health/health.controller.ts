import { Controller, Get } from "@nestjs/common";

import { Public } from "../auth/auth.decorators";
import { DbService } from "../db/db.service";

@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly db: DbService) {}

  /**
   * Always 200, even when a dependency is down.
   *
   * A degraded gateway is still a running process, and the compose healthcheck
   * gating startup on this must not flap because Postgres restarted. The body
   * says which dependency is unhappy; alerting reads `status`, not the code.
   *
   * `tenantIsolation` is here because the failure it reports is otherwise
   * invisible. A superuser connection applies no row-level security policies
   * and raises no error — the code reads correctly, the tests pass, and
   * nothing is enforced. Anything other than "enforced" means tenants are not
   * actually isolated, so it degrades the whole service rather than being a
   * detail buried in a log.
   */
  @Get()
  async check() {
    const [databaseUp, rlsEnforced] = await Promise.all([
      this.db.ping(),
      this.db.rlsIsEnforced(),
    ]);

    const database = databaseUp ? "up" : "down";
    const tenantIsolation = rlsEnforced ? "enforced" : "BYPASSED";

    return {
      status: databaseUp && rlsEnforced ? "ok" : "degraded",
      service: "clinicpilot-api",
      dependencies: { database, tenantIsolation },
      ts: new Date().toISOString(),
    };
  }
}
