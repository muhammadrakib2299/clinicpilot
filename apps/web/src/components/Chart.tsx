import { useId } from "react";

import { niceMax } from "@/lib/chart";
import { cn } from "@/lib/cn";

/**
 * Charts, drawn by hand in HTML.
 *
 * Recharts is what `04-UI-UX` and `05-TECH-STACK` name, and it was measured
 * before being turned down: importing it took the production bundle from
 * **80.4 KB to 193.2 KB gzipped — +112.8 KB for two column charts**. This repo
 * has already declined socket.io at ~40 KB and TanStack Query at ~13 KB on that
 * same argument, and a chart library is a worse trade than either, because the
 * specific things these charts need — a 2px surface gap rather than a stroke
 * between marks, a 4px rounded cap that stays square at the baseline, hairline
 * solid gridlines one step off the surface — are the parts a chart library
 * makes you fight.
 *
 * Columns are flex children, not SVG. A percentage height inside a flex row is
 * responsive for free, focusable for free, and gets real hover and focus states
 * from CSS rather than from a pointer-event layer.
 */

export interface ColumnPoint {
  /** Bucket key — the UTC date for every series on this screen. */
  key: string;
  /** What the axis and the tooltip call this bucket. */
  label: string;
  value: number;
}

/**
 * A single-series column chart.
 *
 * Single series on purpose, and it is the accessibility decision rather than a
 * simplification. The three task outcomes are drawn as three of these rather
 * than as one stacked column, because the design system's status tokens fail
 * colour-separation as adjacent series: `scripts/validate_palette.js` puts
 * resolved↔failed at ΔE 5.6 under deuteranopia in dark, and — worse —
 * danger↔warning at **11.5 under normal vision** in light, beneath the floor of
 * 15 where full-colour readers can still tell a pair apart. Faceting removes
 * the comparison from colour entirely: each panel carries one hue and a written
 * title, so identity is never colour-alone and there is no adjacent pair to
 * confuse.
 *
 * `yMax` is passed in rather than derived per panel, so a facet row shares one
 * scale. Independent scales would draw a single failed task the same height as
 * twenty resolved ones.
 */
export function ColumnChart({
  points,
  color,
  yMax,
  format = (value) => value.toLocaleString(),
  height = 132,
  className,
}: {
  points: ColumnPoint[];
  /** A CSS colour — always a token, never a literal. */
  color: string;
  yMax: number;
  format?: (value: number) => string;
  height?: number;
  className?: string;
}) {
  const max = niceMax(yMax);
  const ticks = [max, max / 2, 0];

  // Three ticks: first, middle, last. Enough to orient without crowding, and
  // the tooltip and the table view carry every exact value.
  //
  // Deduplicated because a two-point series would otherwise repeat its
  // endpoints, and clamped to the points that exist so an empty series renders
  // no axis rather than `undefined`.
  const axisIndices = [
    ...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]),
  ].filter((index) => index >= 0 && index < points.length);

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex gap-2">
        {/* Tick labels sit outside the plot so nothing overlaps a column. */}
        <div
          className="flex w-10 shrink-0 flex-col justify-between text-right font-mono text-[11px] leading-none text-muted tnum"
          style={{ height }}
          aria-hidden
        >
          {ticks.map((tick) => (
            <span key={tick}>{format(tick)}</span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1" style={{ height }}>
          {/* Hairline, solid, one step off the surface. Never dashed: a dashed
              rule reads as a threshold or a projection when it is just a grid. */}
          {ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden
              className="absolute inset-x-0 border-t border-border"
              style={{ top: `${(1 - tick / max) * 100}%` }}
            />
          ))}

          <div className="absolute inset-0 flex items-end gap-[2px]">
            {points.map((point) => (
              <Column
                key={point.key}
                point={point}
                color={color}
                max={max}
                format={format}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex gap-2">
        <div className="w-10 shrink-0" aria-hidden />
        {/*
          Three labels laid out across the plot, not one per column with the
          rest hidden. Sharing the columns' grid meant each label inherited a
          column's width — about 26px at a 30-day window — and `truncate` cut
          "Jul 20" down to "J…". A tick that has to be decoded is worse than no
          tick, and the browser was the only thing that could show it: in jsdom
          the text is present and correct, and only the rendered width is wrong.
        */}
        <div
          aria-hidden
          className="flex min-w-0 flex-1 justify-between font-mono text-[11px] leading-none text-muted"
        >
          {axisIndices.map((index) => (
            <span key={points[index]!.key}>{points[index]!.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One column, and the hit target that is taller than it.
 *
 * The target is the full height of the plot rather than the drawn bar, because
 * a day with one task is a 6px sliver and pointing at it should not be a test
 * of aim. Hover and focus show the same tooltip — the value is never reachable
 * by pointer alone — and it is a `<button>` so a keyboard gets there at all.
 */
function Column({
  point,
  color,
  max,
  format,
}: {
  point: ColumnPoint;
  color: string;
  max: number;
  format: (value: number) => string;
}) {
  const tooltipId = useId();
  const pct = Math.max(0, Math.min(100, (point.value / max) * 100));

  return (
    <div className="group relative flex h-full min-w-0 flex-1 items-end">
      <div
        className="w-full rounded-t-[4px] transition-opacity group-hover:opacity-80"
        style={{
          // A zero day still draws a 2px stub. Nothing at all is
          // indistinguishable from a gap in the data, and these two mean
          // very different things on a control plane.
          height: point.value === 0 ? "2px" : `max(${pct}%, 3px)`,
          backgroundColor: point.value === 0 ? "var(--border-strong)" : color,
        }}
      />

      <button
        type="button"
        aria-describedby={tooltipId}
        className="absolute inset-0 cursor-default rounded-sm"
      >
        <span className="sr-only">
          {point.label}: {format(point.value)}
        </span>
      </button>

      <div
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border-strong bg-surface-1 px-2 py-1 text-xs shadow-sm group-hover:block group-focus-within:block"
      >
        <span className="font-mono text-muted tnum">{point.label}</span>{" "}
        <span className="font-mono font-medium tnum">{format(point.value)}</span>
      </div>
    </div>
  );
}

/**
 * A facet: one titled panel in a small-multiple row.
 *
 * The title is what carries identity here — the colour is decoration on a
 * single-series panel, not the key to reading it.
 */
export function ChartFacet({
  title,
  value,
  color,
  children,
}: {
  title: string;
  value: string;
  color: string;
  children: React.ReactNode;
}) {
  const captionId = useId();

  return (
    // Named by its own caption explicitly rather than relying on a figure
    // inheriting the name from `<figcaption>`. That path is in the accname
    // spec and unevenly implemented — jsdom does not compute it at all — which
    // leaves the panel carrying the *whole* of this chart's identity announced
    // as an unnamed group.
    <figure className="min-w-0" aria-labelledby={captionId}>
      <figcaption id={captionId} className="mb-3 flex items-baseline gap-2">
        {/* A swatch beside the text, never the text in the series colour: a
            light categorical hue is illegible as body type on the surface. */}
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-[2px]"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm font-medium">{title}</span>
        <span className="ml-auto font-mono text-sm text-muted tnum">{value}</span>
      </figcaption>
      {children}
    </figure>
  );
}
