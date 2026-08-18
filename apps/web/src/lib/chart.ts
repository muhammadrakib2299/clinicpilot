/**
 * Scale maths for the hand-rolled charts.
 *
 * In `lib/` rather than beside the component because it is a pure function with
 * its own test — and because exporting a non-component from a component module
 * breaks fast refresh for the whole file.
 */

/**
 * The smallest round number at or above `value`, for the top gridline.
 *
 * An axis that tops out at the tallest bar puts that bar flush against the
 * frame and leaves the reader nothing to judge it against. Rounding up to 1, 2,
 * 2.5 or 5 × a power of ten also keeps the halfway tick a number a person can
 * read — 12.5 rather than 11.5.
 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}
