import { describe, expect, it } from "vitest";

import { buildQuotaRefreshErrorMessage, classifyQuotaRefreshError } from "../../src/shared/quotaRefreshError";

describe("quota refresh error classification", () => {
  it("classifies unauthorized refresh failures without exposing token details", () => {
    const error = new Error("401 unauthorized refreshToken=refresh-secret-token-value");

    expect(classifyQuotaRefreshError(error)).toBe("unauthorized");
    expect(buildQuotaRefreshErrorMessage("Не удалось обновить лимиты", error)).toBe(
      "Не удалось обновить лимиты: нужна повторная авторизация. Подробности доступны в журнале диагностики."
    );
    expect(buildQuotaRefreshErrorMessage("Не удалось обновить лимиты", error)).not.toContain("refresh-secret-token-value");
  });

  it("classifies provider limit and provider unavailable failures", () => {
    expect(classifyQuotaRefreshError(new Error("rate limit reached"))).toBe("provider_limit");
    expect(classifyQuotaRefreshError(new Error("503 service unavailable"))).toBe("provider_unavailable");
  });

  it("treats a signed-out Codex profile as an authorization issue", () => {
    expect(classifyQuotaRefreshError(new Error("Codex profile is not logged into a ChatGPT account"))).toBe("unauthorized");
    expect(classifyQuotaRefreshError(new Error("Codex profile is not authenticated"))).toBe("unauthorized");
    expect(classifyQuotaRefreshError(new Error("Codex profile belongs to a different ChatGPT account"))).toBe("unauthorized");
  });

  it("classifies network failures separately from unknown failures", () => {
    expect(classifyQuotaRefreshError(new Error("network timeout ECONNRESET"))).toBe("network");
    expect(classifyQuotaRefreshError(new Error("unexpected parser failure"))).toBe("unknown");
  });

  it("classifies refresh cooldown failures with clear retry copy", () => {
    const error = new Error("Обновление лимитов временно отложено после недавней ошибки. Повторите через 30 с.");

    expect(classifyQuotaRefreshError(error)).toBe("cooldown");
    expect(buildQuotaRefreshErrorMessage("Не удалось обновить лимиты", error)).toBe(
      "Не удалось обновить лимиты: обновление временно отложено после недавней ошибки, чтобы не спамить провайдера. Подробности доступны в журнале диагностики."
    );
  });
});
