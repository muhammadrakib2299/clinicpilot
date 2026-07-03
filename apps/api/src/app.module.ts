import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health/health.controller";

/**
 * Root module. Feature modules (auth, tenancy, rbac, agents, tasks,
 * orchestrator, workflows, analytics, audit, realtime, billing) are
 * wired in during Phases 1–2.5 per docs/08-PLAN.md.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController],
})
export class AppModule {}
