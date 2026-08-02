import { describe, expect, it } from "vitest";

import { buildQuotaRefreshAccountMessage, buildQuotaRefreshMessage } from "../../src/shared/quotaRefreshMessage";

describe("quota refresh messages", () => {
  it("states when a Codex manual refresh used the official provider API", () => {
    expect(
      buildQuotaRefreshMessage({
        platform: "codex",
        scope: "single",
        refreshedCount: 1,
        source: "official_api",
        confidence: "confirmed"
      })
    ).toBe("Лимиты Codex обновлены через официальный API · подтверждено");
  });

  it("states when Antigravity Code Assist quota was refreshed", () => {
    expect(
      buildQuotaRefreshMessage({
        platform: "antigravity",
        scope: "single",
        refreshedCount: 1,
        source: "local_status",
        confidence: "inferred"
      })
    ).toBe("Лимиты Antigravity обновлены через Code Assist · данные помечены как локально выведенные");
  });

  it("states when Antigravity quota still has no usable source", () => {
    expect(
      buildQuotaRefreshMessage({
        platform: "antigravity",
        scope: "single",
        refreshedCount: 0,
        source: "unknown",
        confidence: "unknown"
      })
    ).toBe("Лимиты Antigravity не обновлены: нужен Google вход или доступный Code Assist статус");
  });

  it("summarizes bulk Codex refreshes with the refreshed account count", () => {
    expect(
      buildQuotaRefreshMessage({
        platform: "codex",
        scope: "all",
        refreshedCount: 3,
        source: "official_api",
        confidence: "confirmed"
      })
    ).toBe("Лимиты Codex обновлены через официальный API · аккаунтов: 3");
  });

  it("does not report success when a failed refresh returns an account with stale official quota data", () => {
    expect(
      buildQuotaRefreshAccountMessage({
        platform: "codex",
        status: "error",
        statusReason: "network timeout while reading rate limits",
        source: "official_api",
        confidence: "confirmed"
      })
    ).toBe("Не удалось обновить лимиты: сеть недоступна или запрос истёк по времени. Подробности доступны в журнале диагностики. Последний корректный снимок сохранён.");
  });

  it("reports a separate transient refresh error even when the account remains authorized", () => {
    expect(
      buildQuotaRefreshAccountMessage({
        platform: "codex",
        status: "active",
        statusReason: null,
        lastRefreshError: "network timeout",
        source: "official_api",
        confidence: "confirmed"
      })
    ).toContain("Последний корректный снимок сохранён");
  });
});
