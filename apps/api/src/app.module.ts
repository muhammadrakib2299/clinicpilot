import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { DbModule } from "./db/db.module";
import { HealthController } from "./health/health.controller";
import { RealtimeModule } from "./realtime/realtime.module";
import { TasksModule } from "./tasks/tasks.module";

/**
 * Root module. Remaining feature modules (auth, tenancy, rbac, orchestrator,
 * workflows, analytics, audit, realtime, billing) are wired in during
 * Phases 1–2.5 per 08-PLAN.md.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env"] }),
    DbModule,
    RealtimeModule,
    TasksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
