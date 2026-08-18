import { Controller, Get, Module, Query } from "@nestjs/common";

import { AnalyticsService, clampDays } from "./analytics.service";

/**
 * Metrics over a window.
 *
 * No `@MinRole`, matching `/api/overview`: spend and outcomes are already on
 * the Dashboard for every signed-in role, and gating the same figures here
 * would be a distinction the product does not otherwise make. RLS is what
 * keeps one clinic's numbers out of another's.
 */
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * `?days=` is clamped rather than validated into a 400.
   *
   * The window is a view preference arriving from a query string, not a
   * command — `?days=99999` means "as much as you have", and answering it with
   * 90 days is more useful than refusing to draw the page. A caller who sends
   * nonsense gets the default and a series that says which window it covers.
   */
  @Get()
  summary(@Query("days") days?: string) {
    return this.analytics.summary(clampDays(days));
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
