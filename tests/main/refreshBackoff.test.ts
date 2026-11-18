import { describe, expect, it } from "vitest";

import { MAX_PROVIDER_RETRY_AFTER_MS, RefreshBackoff } from "../../src/main/services/refreshBackoff";

describe("RefreshBackoff", () => {
  it("blocks repeated account refreshes after a failure and clears after success", () => {
    const backoff = new RefreshBackoff({
      baseDelayMs: 30_000,
      maxDelayMs: 120_000,
      nowMs: () => 1_000
    });

    expect(backoff.getBlockedReason("acc_1")).toBeNull();

    backoff.recordFailure("acc_1", "network timeout");
    const blocked = backoff.getBlockedReason("acc_1");
    expect(blocked).toEqual({
      remainingMs: 30_000,
      message: "Обновление лимитов временно отложено после недавней ошибки. Повторите через 30 с."
    });
    expect(blocked?.message).not.toContain("acc_1");

    backoff.recordSuccess("acc_1");
    expect(backoff.getBlockedReason("acc_1")).toBeNull();
  });

  it("uses exponential delay per account and caps the wait time", () => {
    let now = 10_000;
    const backoff = new RefreshBackoff({
      baseDelayMs: 30_000,
      maxDelayMs: 60_000,
      nowMs: () => now
    });

    backoff.recordFailure("acc_1", "first");
    now = 40_000;
    expect(backoff.getBlockedReason("acc_1")).toBeNull();

    backoff.recordFailure("acc_1", "second");
    expect(backoff.getBlockedReason("acc_1")?.remainingMs).toBe(60_000);

    expect(backoff.getBlockedReason("acc_2")).toBeNull();
  });

  it("honors a 429 Retry-After minimum beyond the ordinary backoff cap", () => {
    let now = 1000;
    const backoff = new RefreshBackoff({ baseDelayMs: 30_000, maxDelayMs: 120_000, nowMs: () => now });
    backoff.recordFailure("a", "429", { retryAfterSeconds: 600 });
    expect(backoff.getBlockedReason("a")?.remainingMs).toBe(600_000);
    now += 10_000;
    backoff.recordFailure("a", "network");
    expect(backoff.getBlockedReason("a")?.remainingMs).toBe(590_000);
    now += 590_000;
    expect(backoff.getBlockedReason("a")).toBeNull();
  });

  it("ignores non-finite and negative hints and bounds oversized provider delays", () => {
    const backoff = new RefreshBackoff({ baseDelayMs: 10, maxDelayMs: 20, nowMs: () => 1000 });
    for (const [index, retryAfterSeconds] of [NaN, Infinity, -4].entries()) {
      backoff.recordFailure(`invalid-${index}`, "invalid", { retryAfterSeconds });
      expect(backoff.getBlockedReason(`invalid-${index}`)?.remainingMs).toBe(10);
    }
    backoff.recordFailure("oversized", "429", { retryAfterSeconds: Number.MAX_VALUE });
    expect(backoff.getBlockedReason("oversized")?.remainingMs).toBe(MAX_PROVIDER_RETRY_AFTER_MS);
    backoff.recordFailure("fraction", "429", { retryAfterSeconds: 0.125 });
    expect(backoff.getBlockedReason("fraction")?.remainingMs).toBe(125);
  });
});
