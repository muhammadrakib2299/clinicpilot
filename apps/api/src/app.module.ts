import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AgentsModule } from "./agents/agents.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { DbModule } from "./db/db.module";
import { FhirModule } from "./fhir/fhir.module";
import { HealthController } from "./health/health.controller";
import { OverviewModule } from "./overview/overview.module";
import { QueueModule } from "./queue/queue.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { TasksModule } from "./tasks/tasks.module";

/**
 * Root module.
 *
 * `AuthModule` registers a global guard, so every route is protected unless it
 * opts out with `@Public()` or `@ServiceOnly()`. A new controller is therefore
 * closed by default, and forgetting a decorator locks a route down rather than
 * opening it up.
 *
 * Remaining modules (orchestrator, workflows, analytics, billing) arrive in
 * Phases 2.5–4 per 08-PLAN.md.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env"] }),
    DbModule,
    AuditModule,
    AuthModule,
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
