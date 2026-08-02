import type { ProviderQuotaState } from "./providerAdapter.js";
import type { AccountPlatform, ManagedAccount } from "./types.js";
import { buildQuotaRefreshErrorMessage } from "./quotaRefreshError.js";

export interface QuotaRefreshMessageInput {
  platform: AccountPlatform;
  scope: "single" | "all";
  refreshedCount: number;
  source: ProviderQuotaState["source"];
  confidence: ProviderQuotaState["confidence"];
}

export interface QuotaRefreshAccountMessageInput {
  platform: AccountPlatform;
  status: ManagedAccount["status"];
  statusReason: string | null;
  lastRefreshError?: string | null;
  source: ProviderQuotaState["source"];
  confidence: ProviderQuotaState["confidence"];
}

export function buildQuotaRefreshMessage(input: QuotaRefreshMessageInput): string {
  if (input.platform === "antigravity") {
    if (input.source !== "unknown" && input.confidence !== "unknown") {
      if (input.scope === "all") {
        return `Лимиты Antigravity обновлены через Code Assist · аккаунтов: ${input.refreshedCount}`;
      }
      return "Лимиты Antigravity обновлены через Code Assist · данные помечены как локально выведенные";
    }
    return "Лимиты Antigravity не обновлены: нужен Google вход или доступный Code Assist статус";
  }

  if (input.source === "official_api" && input.confidence === "confirmed") {
    if (input.scope === "all") {
      return `Лимиты Codex обновлены через официальный API · аккаунтов: ${input.refreshedCount}`;
    }
    return "Лимиты Codex обновлены через официальный API · подтверждено";
  }

  return "Снимок лимитов обновлён локально · точность не подтверждена провайдером";
}

export function buildQuotaRefreshAccountMessage(input: QuotaRefreshAccountMessageInput): string {
  const error = input.lastRefreshError ?? (input.status === "error" ? input.statusReason : null);
  if (error) {
    return `${buildQuotaRefreshErrorMessage("Не удалось обновить лимиты", error)} Последний корректный снимок сохранён.`;
  }

  return buildQuotaRefreshMessage({
    platform: input.platform,
    scope: "single",
    refreshedCount: 1,
    source: input.source,
    confidence: input.confidence
  });
}
