import { describe, expect, it } from "vitest";

import { RefreshBackoff } from "../../src/main/services/refreshBackoff";

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
});
