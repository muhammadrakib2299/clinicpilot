import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AgentsModule } from "./agents/agents.module";
import { DbModule } from "./db/db.module";
import { FhirModule } from "./fhir/fhir.module";
import { HealthController } from "./health/health.controller";
import { OverviewModule } from "./overview/overview.module";
import { QueueModule } from "./queue/queue.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { TasksModule } from "./tasks/tasks.module";

/**
 * Root module. Remaining feature modules (auth, tenancy, rbac, orchestrator,
 * workflows, analytics, audit, billing) are wired in during Phases 1–2.5 per
 * 08-PLAN.md.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env"] }),
    DbModule,
    QueueModule,
    RealtimeModule,
    TasksModule,
    AgentsModule,
    OverviewModule,
    FhirModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
