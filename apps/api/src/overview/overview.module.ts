import { Controller, Get, Module, Query } from "@nestjs/common";

import { OverviewService } from "./overview.service";

@Controller("overview")
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  /** One round trip for the dashboard — KPI tiles and the activity feed. */
  @Get()
  async summary(@Query("activity") activity?: string) {
    const parsed = Number(activity);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : undefined;

    const [kpis, recent] = await Promise.all([
      this.overview.kpis(),
      this.overview.activity(limit),
    ]);

    return { kpis, activity: recent };
  }
}

@Module({
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
