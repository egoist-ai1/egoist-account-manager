import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatRemainingCountdown, formatResetTimeShort } from "../../shared/accountListPresentation";
import { buildLiveTraySnapshot } from "../../shared/liveTray";
import { formatQuotaRemaining } from "../../shared/providerAdapter";
import type { AccountPlatform, AppApi, AppSettings, ManagedAccount } from "../../shared/types";
import { useVisibleClock } from "./useVisibleClock";

export function useTrayState(api: AppApi) {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [platform, setPlatform] = useState<AccountPlatform | null>(null);
  const [platformError, setPlatformError] = useState(false);
  const [accountsError, setAccountsError] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const accountRequest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++accountRequest.current;
    const [nextAccounts, nextSettings] = await Promise.allSettled([api.listAccounts(), api.getSettings()]);
    if (request !== accountRequest.current) return;
    if (nextAccounts.status === "fulfilled") setAccounts(nextAccounts.value);
    if (nextSettings.status === "fulfilled") setSettings(nextSettings.value);
    setAccountsError(nextAccounts.status === "rejected");
    setSettingsError(nextSettings.status === "rejected");
  }, [api]);

  useEffect(() => {
    let readInitialPlatform = true;
    const offAccounts = api.onAccountsUpdated(() => void reload());
    const offPlatform = api.onTrayPlatform((next) => {
      readInitialPlatform = false;
      setPlatform(next);
      setPlatformError(false);
    });
    void api.getTrayPlatform().then((next) => {
      if (readInitialPlatform) {
        setPlatform(next);
        setPlatformError(false);
      }
    }).catch(() => {
      if (readInitialPlatform) setPlatformError(true);
    });
    void reload();
    return () => {
      readInitialPlatform = false;
      accountRequest.current += 1;
      offAccounts();
      offPlatform();
    };
  }, [api, reload]);

  const language = settings?.language ?? "ru";
  const isEnglish = language === "en";
  const privacyMode = settingsError || settings?.privacyMode !== false;
  const now = useVisibleClock();
  const active = accounts.find((account) => account.isActive && (account.platform ?? "codex") === platform);
  const snapshot = useMemo(() => buildLiveTraySnapshot(platform ? accounts : [], { now, privacyMode, language }, platform ?? "codex"),
    [accounts, platform, now, privacyMode, language]);
  const error = platformError || accountsError || settingsError;
  const loading = !error && (!platform || !settings);
  const status = error ? "error" : loading ? "loading" : snapshot.state;
  const stateLabel = error ? (isEnglish ? "Refresh failed" : "Сбой обновления") : {
    loading: isEnglish ? "Loading" : "Загрузка",
    empty: isEnglish ? "No profile" : "Нет профиля",
    fresh: isEnglish ? "Up to date" : "Актуально",
    critical: isEnglish ? "Critical" : "Критично",
    stale: isEnglish ? "Stale" : "Устарело",
    error: isEnglish ? "Error" : "Ошибка",
    unknown: isEnglish ? "No quota" : "Нет данных"
  }[status];

  const resetAt = snapshot.activeWindowResetAt;
  const resetShort = formatResetTimeShort(resetAt, language, now);
  const resetText = resetAt && resetAt <= now ? (isEnglish ? "Reset needs a check" : "Сброс требует проверки")
    : resetAt ? (isEnglish ? `Reset ${resetShort}` : `Сброс ${resetShort}`)
      : (isEnglish ? "Reset pending" : "Сброс уточняется");

  return {
    active,
    platform,
    platformName: platform === "antigravity" ? "Antigravity" : platform === "codex" ? "Codex" : null,
    language,
    isEnglish,
    status,
    stateLabel,
    loading,
    accountLabel: privacyMode ? snapshot.accountLabel : active?.label.trim() || snapshot.accountLabel,
    accountTitle: privacyMode ? undefined : active?.label,
    planLabel: !active ? null : active.planType === "unknown" ? (isEnglish ? "Plan unknown" : "Тариф неизвестен") : active.planType,
    displayValue: formatQuotaRemaining(snapshot.remainingPercent, language),
    progressWidth: Math.min(100, Math.max(0, snapshot.remainingPercent ?? 0)),
    resetAt,
    resetText,
    countdown: formatRemainingCountdown(resetAt, now, isEnglish),
    reload
  };
}
