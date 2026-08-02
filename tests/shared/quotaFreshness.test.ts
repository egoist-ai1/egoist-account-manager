import { describe, expect, it } from "vitest";

import { buildQuotaFreshness, hasCurrentQuotaRefreshFailure } from "../../src/shared/quotaFreshness";

describe("quota freshness", () => {
  it("marks recent quota snapshots as fresh", () => {
    expect(buildQuotaFreshness({ lastRefreshAt: 1_000 }, { now: 1_240, staleAfterSeconds: 900 })).toEqual({
      state: "fresh",
      label: "свежий",
      title: "Снимок лимитов свежий: 4 мин назад"
    });
  });

  it("marks old quota snapshots as stale", () => {
    expect(buildQuotaFreshness({ lastRefreshAt: 1_000 }, { now: 2_200, staleAfterSeconds: 900 })).toEqual({
      state: "stale",
      label: "устарел",
      title: "Снимок лимитов устарел: 20 мин назад"
    });
  });

  it("marks missing quota snapshots explicitly", () => {
    expect(buildQuotaFreshness({ lastRefreshAt: null }, { now: 2_200, staleAfterSeconds: 900 })).toEqual({
      state: "missing",
      label: "нет снимка",
      title: "Лимиты ещё не проверялись"
    });
  });

  it("does not keep an older refresh failure active after a newer successful snapshot", () => {
    expect(hasCurrentQuotaRefreshFailure({
      lastRefreshAt: 2_000,
      lastRefreshErrorAt: 1_900,
      lastRefreshError: "temporary failure"
    })).toBe(false);
    expect(hasCurrentQuotaRefreshFailure({
      lastRefreshAt: 2_000,
      lastRefreshErrorAt: 2_100,
      lastRefreshError: "current failure"
    })).toBe(true);
  });
});
