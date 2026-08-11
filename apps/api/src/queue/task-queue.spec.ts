import {
  DEFAULT_REDIS_URL,
  RUN_TASK_JOB_OPTIONS,
  TASK_QUEUE,
  isRetryable,
  redisUrl,
} from "./task-queue";

describe("isRetryable", () => {
  it("retries a task the AI service could not start", () => {
    // 503 is "no API key". The provider is checked before the task is marked
    // running, so nothing was spent and nothing was written.
    expect(isRetryable(503)).toBe(true);
  });

  it("retries an upstream timeout or overload", () => {
    expect(isRetryable(502)).toBe(true);
    expect(isRetryable(504)).toBe(true);
    expect(isRetryable(429)).toBe(true);
  });

  it("does not retry a request that will be just as wrong next time", () => {
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(422)).toBe(false);
  });

  it("does not retry a task another run already holds", () => {
    // 409 from the claim. Replaying it is exactly the double-spend the claim
    // was added to prevent, so this must never move into the retry set.
    expect(isRetryable(409)).toBe(false);
  });

  it("treats an unlisted status as unrecoverable rather than looping on it", () => {
    expect(isRetryable(418)).toBe(false);
  });
});

describe("redisUrl", () => {
  const original = process.env["REDIS_URL"];
  afterEach(() => {
    if (original === undefined) delete process.env["REDIS_URL"];
    else process.env["REDIS_URL"] = original;
  });

  it("uses REDIS_URL when it is set", () => {
    process.env["REDIS_URL"] = "redis://elsewhere:6380";

    expect(redisUrl()).toBe("redis://elsewhere:6380");
  });

  it("falls back to the compose default", () => {
    delete process.env["REDIS_URL"];

    expect(redisUrl()).toBe(DEFAULT_REDIS_URL);
  });
});

describe("RUN_TASK_JOB_OPTIONS", () => {
  it("retries a handful of times rather than once or forever", () => {
    expect(RUN_TASK_JOB_OPTIONS.attempts).toBe(3);
  });

  it("backs off exponentially, because the usual failure is a busy upstream", () => {
    expect(RUN_TASK_JOB_OPTIONS.backoff).toEqual({ type: "exponential", delay: 5_000 });
  });

  it("bounds completed history instead of growing for the life of the volume", () => {
    expect(RUN_TASK_JOB_OPTIONS.removeOnComplete).toEqual({ age: 3_600, count: 100 });
  });

  it("keeps failures far longer than successes — they are the ones to look at", () => {
    const failed = RUN_TASK_JOB_OPTIONS.removeOnFail as { age: number };
    const completed = RUN_TASK_JOB_OPTIONS.removeOnComplete as { age: number };

    expect(failed.age).toBeGreaterThan(completed.age);
  });

  it("does not set jobId here — the producer sets it per task, for dedupe", () => {
    expect(RUN_TASK_JOB_OPTIONS).not.toHaveProperty("jobId");
  });
});

describe("queue naming", () => {
  it("is stable, because a rename orphans everything already enqueued", () => {
    expect(TASK_QUEUE).toBe("task-runs");
  });
});
