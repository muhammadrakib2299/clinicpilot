import { describe, expect, it } from "vitest";

import { niceMax } from "./chart";

describe("niceMax", () => {
  it("leaves headroom above the tallest bar", () => {
    // The point of the function: 7 tasks must not top out at exactly 7, or the
    // tallest column sits flush against the frame with nothing to read it by.
    expect(niceMax(7)).toBe(10);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(12)).toBe(20);
  });

  it("keeps the halfway tick a number a person can read", () => {
    // 25 → 25 gives a midpoint of 12.5; the alternative of 26 gives 13, which
    // looks arbitrary on an axis.
    expect(niceMax(25)).toBe(25);
    expect(niceMax(21)).toBe(25);
  });

  it("does not round a value that is already round", () => {
    expect(niceMax(10)).toBe(10);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(5)).toBe(5);
  });

  it("works on the fractions a spend axis is made of", () => {
    expect(niceMax(0.0153)).toBeCloseTo(0.02, 6);
    expect(niceMax(0.004)).toBeCloseTo(0.005, 6);
  });

  it("never returns zero, because a zero axis divides by it", () => {
    // Every panel renders on an empty window, and `value / max` is the height.
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-4)).toBe(1);
    expect(niceMax(Number.NaN)).toBe(1);
  });
});
