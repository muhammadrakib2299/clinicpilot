import { DEFAULT_DAYS, MAX_DAYS, MIN_DAYS, clampDays, daySpine, utcDay } from "./analytics.service";

describe("utcDay", () => {
  it("buckets by UTC, not by the machine's timezone", () => {
    // 23:30 on the 17th in UTC is already the 18th in Dhaka, where this repo
    // is written. The bucket has to be the same either way or a series moves
    // when the gateway is deployed somewhere else.
    expect(utcDay(new Date("2026-08-17T23:30:00.000Z"))).toBe("2026-08-17");
    expect(utcDay(new Date("2026-08-18T00:30:00.000Z"))).toBe("2026-08-18");
  });
});

describe("daySpine", () => {
  const now = new Date("2026-08-18T09:15:00.000Z");

  it("ends on today and runs oldest first", () => {
    const spine = daySpine(7, now);

    expect(spine).toHaveLength(7);
    expect(spine[0]).toBe("2026-08-12");
    expect(spine.at(-1)).toBe("2026-08-18");
  });

  it("includes today when the window is one day", () => {
    // The off-by-one that would make `?days=1` return yesterday, or nothing.
    expect(daySpine(1, now)).toEqual(["2026-08-18"]);
  });

  it("emits every day exactly once across a month boundary", () => {
    const spine = daySpine(35, now);

    expect(new Set(spine).size).toBe(35);
    expect(spine).toContain("2026-07-31");
    expect(spine).toContain("2026-08-01");
  });

  it("crosses a leap day without skipping or repeating one", () => {
    const spine = daySpine(4, new Date("2028-03-01T12:00:00.000Z"));

    expect(spine).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
  });
});

describe("clampDays", () => {
  it("defaults when the caller sends nothing or nonsense", () => {
    expect(clampDays(undefined)).toBe(DEFAULT_DAYS);
    expect(clampDays("")).toBe(DEFAULT_DAYS);
    expect(clampDays("last month")).toBe(DEFAULT_DAYS);
  });

  it("clamps rather than refusing, because the window is a view preference", () => {
    expect(clampDays("99999")).toBe(MAX_DAYS);
    expect(clampDays("0")).toBe(MIN_DAYS);
    expect(clampDays("-7")).toBe(MIN_DAYS);
  });

  it("keeps a sensible window intact", () => {
    expect(clampDays("7")).toBe(7);
    expect(clampDays("30")).toBe(30);
    // Truncated, not rounded — a fractional day is not a bucket.
    expect(clampDays("7.9")).toBe(7);
  });
});
