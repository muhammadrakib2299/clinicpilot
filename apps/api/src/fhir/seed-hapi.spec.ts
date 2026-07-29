import { nextWeekdayUtc, plusMinutes } from "./seed-hapi";

const SUNDAY = 0;
const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;

/** 2026-07-29 is a Wednesday. */
const WED_29_JUL = new Date("2026-07-29T11:22:33.444Z");

describe("nextWeekdayUtc", () => {
  it("finds the next occurrence later in the same week", () => {
    const result = nextWeekdayUtc(WED_29_JUL, THURSDAY, 14);

    expect(result.toISOString()).toBe("2026-07-30T14:00:00.000Z");
  });

  it("wraps into the following week when the weekday has passed", () => {
    const result = nextWeekdayUtc(WED_29_JUL, TUESDAY, 10, 30);

    expect(result.toISOString()).toBe("2026-08-04T10:30:00.000Z");
  });

  it("skips a whole week rather than returning the same day", () => {
    // Load-bearing: the free slots are anchored on the appointment's own
    // Thursday, and "next Thursday" must mean the week after, not itself.
    const thursday = new Date("2026-07-30T14:00:00.000Z");

    expect(nextWeekdayUtc(thursday, THURSDAY, 15).toISOString()).toBe(
      "2026-08-06T15:00:00.000Z",
    );
  });

  it("discards the source time of day and uses the one given", () => {
    const result = nextWeekdayUtc(WED_29_JUL, THURSDAY, 9, 15);

    expect(result.getUTCHours()).toBe(9);
    expect(result.getUTCMinutes()).toBe(15);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it("defaults the minute to zero", () => {
    expect(nextWeekdayUtc(WED_29_JUL, THURSDAY, 14).getUTCMinutes()).toBe(0);
  });

  it("handles Sunday, where the weekday index wraps to zero", () => {
    const result = nextWeekdayUtc(WED_29_JUL, SUNDAY, 8);

    expect(result.getUTCDay()).toBe(SUNDAY);
    expect(result.toISOString()).toBe("2026-08-02T08:00:00.000Z");
  });

  it("crosses a month boundary without drifting", () => {
    const result = nextWeekdayUtc(new Date("2026-07-31T00:00:00.000Z"), WEDNESDAY, 9);

    expect(result.toISOString()).toBe("2026-08-05T09:00:00.000Z");
  });

  it("always returns a date strictly in the future of its input", () => {
    for (let weekday = 0; weekday < 7; weekday++) {
      const result = nextWeekdayUtc(WED_29_JUL, weekday, 0);
      expect(result.getTime()).toBeGreaterThan(WED_29_JUL.getTime());
      expect(result.getUTCDay()).toBe(weekday);
    }
  });
});

describe("plusMinutes", () => {
  it("adds the interval", () => {
    expect(plusMinutes(new Date("2026-07-30T14:00:00.000Z"), 30).toISOString()).toBe(
      "2026-07-30T14:30:00.000Z",
    );
  });

  it("rolls over the hour and the day", () => {
    expect(plusMinutes(new Date("2026-07-30T23:45:00.000Z"), 30).toISOString()).toBe(
      "2026-07-31T00:15:00.000Z",
    );
  });

  it("does not mutate its argument", () => {
    const original = new Date("2026-07-30T14:00:00.000Z");
    plusMinutes(original, 60);

    expect(original.toISOString()).toBe("2026-07-30T14:00:00.000Z");
  });
});
