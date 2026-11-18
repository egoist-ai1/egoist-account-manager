import { getAccountQuotaSelection, getAccountQuotaWindows, getAccountReadiness } from "../shared/smartSelection";
import { formatQuotaRemaining, quotaWindowLabel } from "../shared/providerAdapter";
import { hasCurrentQuotaRefreshFailure } from "../shared/quotaFreshness";
import type { AppSettings, ManagedAccount } from "../shared/types";

export { quotaWindowLabel } from "../shared/providerAdapter";

export function profilePresentation(account: ManagedAccount, now: number, language: AppSettings["language"]) {
  const en = language === "en";
  const readiness = getAccountReadiness(account, { now, staleAfterSeconds: 15 * 60 });
  const windows = getAccountQuotaWindows(account).map((window) => ({ ...window, remaining: Math.max(0, Math.min(100, 100 - window.usedPercent)), title: quotaWindowLabel(window.windowDurationMins, language) }));
  const selection = getAccountQuotaSelection(account);
  const summaryIds = new Set(selection.windows.map((window) => window.id));
  const summaryWindows = windows.filter((window) => summaryIds.has(window.id));
  const capturedAt = account.quotaSnapshot?.capturedAt ?? account.lastRefreshAt;
  const age = capturedAt ? Math.max(0, Math.floor((now - capturedAt) / 60)) : null;
  const ageLabel = age === null ? (en ? "No snapshot" : "Нет снимка") : age < 1 ? (en ? "Just now" : "Только что") : age < 60 ? (en ? `${age} min ago` : `${age} мин назад`) : (en ? `${Math.floor(age / 60)} h ago` : `${Math.floor(age / 60)} ч назад`);
  const refreshFailed = hasCurrentQuotaRefreshFailure(account);
  const freshnessState = refreshFailed ? "error" : age === null || windows.length === 0 ? "unknown" : now - capturedAt! > 900 || readiness.reason === "reset_passed" ? "stale" : "fresh";
  const freshness = freshnessState === "error" ? (en ? "Refresh failed" : "Сбой обновления") : freshnessState === "unknown" ? (en ? "No data" : "Нет данных") : freshnessState === "stale" ? (en ? "Stale" : "Устарел") : (en ? "Fresh" : "Свежий");
  const credentialsLabel = account.credentialState === "ready" ? (en ? "Sign-in saved" : "Вход сохранён") : account.credentialState === "needs_reauth" ? (en ? "Sign-in required" : "Нужен вход") : (en ? "Check sign-in" : "Проверить вход");
  return { readiness, windows, summaryWindows, remainingPercent: selection.remainingPercent, ageLabel, freshness, freshnessState, refreshFailed, credentialsLabel, formatRemaining: (value: number | null) => formatQuotaRemaining(value, language) };
}
