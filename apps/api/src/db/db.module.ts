import { Global, Module } from "@nestjs/common";

import { DbService } from "./db.service";

/**
 * Global so feature modules can inject `DbService` without re-importing this
 * everywhere. One pool per process (ADR-004 makes the gateway the sole writer,
 * so there is exactly one place that needs it).
 */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
