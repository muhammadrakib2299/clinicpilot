import { useMemo, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { ChartFacet, ColumnChart, type ColumnPoint } from "@/components/Chart";
import {
  Card,
  EmptyState,
  KpiTile,
  OutcomeBar,
  RefreshControl,
  Skeleton,
} from "@/components/primitives";
import { getAnalytics, type AnalyticsSummary } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/cn";

/**
 * Windows the UI offers.
 *
 * The gateway clamps to 90, but 30 is the widest this screen asks for. Each
 * column is also a hover target, and at 30 days across a full-width panel one
 * is around 37px — measured in the browser. A 90-day window would put that
 * near 12px, under the ~24px a pointer can reasonably hit, and a chart whose
 * values can only be read by a keyboard is not one worth offering.
 */
const WINDOWS = [7, 30] as const;

const usd = (value: number | null, digits = 4) =>
  value === null ? "—" : `$${value.toFixed(digits)}`;
const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

/** Milliseconds as something a person reads without counting zeros. */
function duration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** `2026-08-18` → `18 Aug` (or `Aug 18` — the order follows the reader's locale). */
function axisLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * The three outcomes, each its own facet.
 *
 * Not one stacked column. `scripts/validate_palette.js` fails the design
 * system's status tokens as adjacent series — resolved↔failed at ΔE 5.6 under
 * deuteranopia in dark, danger↔warning at 11.5 under *normal* vision in light,
 * where the floor is 15. Those tokens were contrast-checked as status text in
 * the 2026-08-17 pass and they are correct for that; carrying a comparison in a
 * stack is a different job and they fail it. Three single-series panels put the
 * comparison in the titles instead.
 */
const OUTCOMES = [
  { key: "resolved", title: "Resolved", color: "var(--success)" },
  { key: "escalated", title: "Escalated", color: "var(--warning)" },
  { key: "failed", title: "Failed", color: "var(--danger)" },
] as const;

export function AnalyticsPage() {
  // The window lives in the URL — "the last week, for this clinic" is a thing
  // you send someone, and it survives the reload that a filter in state does
  // not.
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("days"));
  const days = WINDOWS.includes(requested as (typeof WINDOWS)[number]) ? requested : 30;

  const { data, error, loading, updatedAt, reload } = useApi(() => getAnalytics(days), [days], {
    pollMs: 60_000,
  });

  const [showTable, setShowTable] = useState(false);

  const setDays = (value: number) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("days", String(value));
        return next;
      },
      { replace: true },
    );

  // One scale across the three facets. Independent scales would draw a single
  // failed task at the same height as twenty resolved ones, which is precisely
  // the comparison the row exists to support.
  const outcomeMax = useMemo(
    () =>
      Math.max(
        1,
        ...(data?.daily ?? []).flatMap((day) => [day.resolved, day.escalated, day.failed]),
      ),
    [data],
  );

  const spendPoints: ColumnPoint[] = useMemo(
    () =>
      (data?.daily ?? []).map((day) => ({
        key: day.date,
        label: axisLabel(day.date),
        value: day.costUsd,
      })),
    [data],
  );

  const spendMax = useMemo(
    () => Math.max(...spendPoints.map((point) => point.value), 0.0001),
    [spendPoints],
  );

  const empty = data !== null && data.totals.tasks === 0 && data.totals.costUsd === 0;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted">
            What the fleet did, what it cost, and how long it took.
          </p>
        </div>
        <RefreshControl updatedAt={updatedAt} busy={loading} onRefresh={reload} />
      </div>

      {error && (
        <Card className="border-danger/40 p-4 text-sm text-danger">
          Could not reach the API: {error}
        </Card>
      )}

      {/*
        One filter row, above everything it scopes. Not a control per card —
        two panels on different windows sitting side by side is a chart that
        lies without any of its numbers being wrong.
      */}
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm text-muted">Window</span>
        <div className="flex flex-wrap gap-2">
          {WINDOWS.map((window) => (
            <button
              key={window}
              onClick={() => setDays(window)}
              aria-pressed={days === window}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                days === window
                  ? "border-border-strong bg-surface-2 font-medium text-text"
                  : "border-border text-muted hover:text-text",
              )}
            >
              Last {window} days
            </button>
          ))}
        </div>
        {data && (
          <span className="ml-auto font-mono text-xs text-muted tnum">
            from {data.from} · UTC days
          </span>
        )}
      </Card>

      {loading && !data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Tasks"
              value={data.totals.tasks.toLocaleString()}
              hint={`${data.totals.resolved} resolved · ${data.totals.escalated} escalated · ${data.totals.failed} failed`}
            />
            <KpiTile
              label="Success rate"
              value={pct(
                data.totals.resolved + data.totals.escalated + data.totals.failed === 0
                  ? null
                  : data.totals.resolved /
                      (data.totals.resolved + data.totals.escalated + data.totals.failed),
              )}
              hint="Resolved as a share of everything that finished"
            />
            <KpiTile
              label="Cost per resolved task"
              value={usd(data.totals.costPerResolved)}
              hint={`${usd(data.totals.costUsd)} across ${data.totals.modelCalls} model calls`}
            />
            <KpiTile
              label="Task latency p95"
              value={duration(data.latency.p95Ms)}
              hint={
                data.latency.samples === 0
                  ? "No finished tasks in this window"
                  : `p50 ${duration(data.latency.p50Ms)} · ${data.latency.samples} finished · queue wait and model time included`
              }
            />
          </div>

          {empty ? (
            <EmptyState icon={BarChart3} title="Nothing ran in this window">
              Analytics is computed from real tasks — there are none in the last {days} days, so
              every panel would be a flat line. Send a message from the Dashboard and it appears
              here.
            </EmptyState>
          ) : (
            <>
              <Card className="p-4 sm:p-5">
                <div className="mb-4">
                  <h2 className="text-sm font-semibold">Tasks per day</h2>
                  <p className="text-xs text-muted">
                    One panel per outcome, sharing a scale so the heights compare. Every day in
                    the window is drawn, including the quiet ones.
                  </p>
                </div>

                {/*
                  Stacked, not three across. Side by side at a 30-day window
                  each column was 11px wide — under the ~24px a pointer can
                  reasonably hit, measured in the browser rather than guessed.
                  Full width puts them near 40px, and the panels sharing an
                  x position is the better read regardless: whether escalations
                  spiked on the day volume did is a question you answer by
                  looking straight down.
                */}
                <div className="space-y-5">
                  {OUTCOMES.map((outcome) => (
                    <ChartFacet
                      key={outcome.key}
                      title={outcome.title}
                      color={outcome.color}
                      value={String(data.totals[outcome.key])}
                    >
                      <ColumnChart
                        color={outcome.color}
                        yMax={outcomeMax}
                        height={104}
                        points={data.daily.map((day) => ({
                          key: day.date,
                          label: axisLabel(day.date),
                          value: day[outcome.key],
                        }))}
                      />
                    </ChartFacet>
                  ))}
                </div>
              </Card>

              <Card className="p-4 sm:p-5">
                <div className="mb-4">
                  <h2 className="text-sm font-semibold">Spend per day</h2>
                  {/* One series, so no legend box — the heading already says
                      what is plotted, and a single swatch would restate it. */}
                  <p className="text-xs text-muted">
                    Model spend in USD, from `llm_usage`. Cache reads bill at a tenth, so a busy
                    day is not always the expensive one.
                  </p>
                </div>
                <ColumnChart
                  points={spendPoints}
                  color="var(--accent)"
                  yMax={spendMax}
                  height={160}
                  format={(value) => `$${value.toFixed(3)}`}
                />
              </Card>

              {/*
                The table-view twin. Every value in the charts above is here as
                text, so nothing is reachable only by hovering — and it is the
                copy that works in a screen reader, in print, and in forced
                colours.
              */}
              <Card className="overflow-hidden">
                <button
                  onClick={() => setShowTable((open) => !open)}
                  aria-expanded={showTable}
                  className="flex w-full items-center gap-2 p-4 text-left text-sm font-medium hover:bg-surface-2"
                >
                  <Table2 className="size-4 text-muted" aria-hidden />
                  The same numbers as a table
                  <span className="ml-auto font-mono text-xs text-muted">
                    {showTable ? "Hide" : "Show"}
                  </span>
                </button>

                {showTable && (
                  <div className="overflow-x-auto border-t border-border">
                    <table className="w-full min-w-[560px] text-sm">
                      <caption className="sr-only">
                        Tasks and model spend for each UTC day in the selected window.
                      </caption>
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                          <th scope="col" className="px-4 py-3 font-medium">
                            Day
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Resolved
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Escalated
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Failed
                          </th>
                          <th scope="col" className="px-4 py-3 font-medium">
                            Spend
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.daily.map((day) => (
                          <tr key={day.date} className="border-b border-border last:border-0">
                            <td className="px-4 py-2 font-mono text-xs text-muted tnum">
                              {day.date}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs tnum">{day.resolved}</td>
                            <td className="px-4 py-2 font-mono text-xs tnum">{day.escalated}</td>
                            <td className="px-4 py-2 font-mono text-xs tnum">{day.failed}</td>
                            <td className="px-4 py-2 font-mono text-xs tnum">
                              {usd(day.costUsd, 4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <AgentBreakdown agents={data.agents} />
              <ModelBreakdown models={data.models} />
            </>
          )}

          <FollowUps followUps={data.followUps} />
        </>
      )}
    </div>
  );
}

/** Per-agent totals. A table, because five measures across three entities is not a chart. */
function AgentBreakdown({ agents }: { agents: AnalyticsSummary["agents"] }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-semibold">Per agent</h2>
        <p className="text-xs text-muted">
          An agent that took no work in this window still gets a row — a missing agent and an idle
          one look identical otherwise.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">
            Tasks, outcomes and model spend for each agent over the selected window.
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-3 font-medium">
                Agent
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Tasks
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Outcome
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Success
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Spend
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Per resolved
              </th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.agentId} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{agent.name}</div>
                  <div className="font-mono text-xs text-muted">{agent.kind}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs tnum">{agent.tasks}</td>
                <td className="w-40 px-4 py-3">
                  <OutcomeBar
                    successRate={agent.successRate}
                    escalationRate={agent.escalationRate}
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs tnum">{pct(agent.successRate)}</td>
                <td className="px-4 py-3 font-mono text-xs tnum">{usd(agent.costUsd)}</td>
                <td className="px-4 py-3 font-mono text-xs tnum">
                  {usd(agent.costPerResolved)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Spend by model.
 *
 * The panel where ADR-003 becomes visible: the fallback is Sonnet then Haiku,
 * so a second model appearing here is the failover having fired rather than a
 * configuration someone chose.
 */
function ModelBreakdown({ models }: { models: AnalyticsSummary["models"] }) {
  if (models.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-semibold">By model</h2>
        <p className="text-xs text-muted">
          A second model here means the fallback fired — Sonnet then Haiku, per ADR-003 — not a
          setting somebody changed.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">
            Calls, tokens and spend for each model used over the selected window.
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-3 font-medium">
                Model
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Calls
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Tokens in
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Tokens out
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Cached reads
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Spend
              </th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.model} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{model.model}</td>
                <td className="px-4 py-3 font-mono text-xs tnum">{model.calls}</td>
                <td className="px-4 py-3 font-mono text-xs tnum">
                  {model.tokensIn.toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-xs tnum">
                  {model.tokensOut.toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-xs tnum">
                  {model.cacheReadTokens.toLocaleString()}
                </td>
                <td className="px-4 py-3 font-mono text-xs tnum">{usd(model.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * The one business KPI this system can actually compute.
 *
 * `08-PLAN` asks Phase 4 for three: no-show delta, calls deflected, follow-ups
 * completed. Only the third is measurable — nothing here records appointment
 * attendance or inbound call volume, and the KPI tiles already had those
 * invented figures once and had them removed. The absence is stated rather than
 * quietly dropped, because a reader who knows the plan will look for them.
 */
function FollowUps({ followUps }: { followUps: AnalyticsSummary["followUps"] }) {
  const total = followUps.drafted + followUps.sent + followUps.failed;

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Follow-ups</h2>
      <p className="mt-1 text-xs text-muted">
        Delivered to a stand-in carrier, which each row on Patient Messages names — so this counts
        what the system did, not what a patient received.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile
          label="Delivered"
          value={String(followUps.sent)}
          hint={total === 0 ? "Nothing drafted in this window" : `of ${total} drafted`}
        />
        <KpiTile label="Waiting" value={String(followUps.drafted)} hint="Queued for the n8n sweep" />
        <KpiTile
          label="Failed"
          value={String(followUps.failed)}
          hint={followUps.failed ? "Not retried automatically" : "None"}
        />
      </div>

      <p className="mt-4 text-xs text-muted">
        <strong className="font-medium text-text">No-show delta and calls deflected are not
        here.</strong>{" "}
        `08-PLAN` asks for both, and nothing in this system records appointment attendance or
        inbound calls. They were invented figures on the original mock and were removed for it;
        they return when there is a measurement behind them.
      </p>
    </Card>
  );
}
