import { useEffect, useMemo, useState } from "react";
import { buildLiveTraySnapshot } from "../../shared/liveTray";
import type { AppApi, AppSettings, ManagedAccount } from "../../shared/types";
import "../tray-hover.css";

function planLabel(value: string): string {
  return value === "unknown" ? "ChatGPT" : value.charAt(0).toUpperCase() + value.slice(1);
}

function resetLabel(resetAt: number | null, language: AppSettings["language"]): string {
  const isEnglish = language === "en";
  if (!resetAt) return isEnglish ? "Reset time pending" : "Время сброса уточняется";
  const formatted = new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(resetAt * 1000);
  return isEnglish ? `Resets ${formatted}` : `Сброс ${formatted}`;
}

function relativeUpdatedAt(updatedAt: number | null, now: number, language: AppSettings["language"]): string {
  const isEnglish = language === "en";
  if (!updatedAt) return isEnglish ? "not updated" : "не обновлялось";
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60));
  if (minutes < 1) return isEnglish ? "just now" : "только что";
  return new Intl.RelativeTimeFormat(language, { numeric: "always" }).format(-minutes, "minute");
}

export function TrayHoverPopover({ api }: { api: AppApi }) {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const reload = async () => {
      const [nextAccounts, nextSettings] = await Promise.all([api.listAccounts(), api.getSettings()]);
      setAccounts(nextAccounts);
      setSettings(nextSettings);
      setNow(Math.floor(Date.now() / 1000));
    };
    void reload();
    const off = api.onAccountsUpdated(() => void reload());
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [api]);

  const language = settings?.language ?? "ru";
  const isEnglish = language === "en";
  const snapshot = useMemo(() => buildLiveTraySnapshot(accounts, {
    now,
    privacyMode: settings?.privacyMode,
    language
  }), [accounts, language, now, settings?.privacyMode]);
  const active = accounts.find((account) => account.id === snapshot.accountId) ?? null;
  const stateLabel = {
    empty: isEnglish ? "No profile" : "Нет профиля",
    fresh: isEnglish ? "Live" : "Актуально",
    critical: isEnglish ? "Critical" : "Критично",
    stale: isEnglish ? "Stale" : "Устарело",
    error: isEnglish ? "Refresh error" : "Сбой обновления",
    unknown: isEnglish ? "No quota" : "Нет данных"
  }[snapshot.state];
  const displayValue = snapshot.remainingPercent === null
    ? (snapshot.state === "error" ? "!" : snapshot.state === "stale" ? "~" : "—")
    : String(snapshot.remainingPercent);

  return (
    <main
      className={`tray-hover tray-hover-${snapshot.state}`}
      aria-label={isEnglish ? "Active Codex quota" : "Лимиты активного аккаунта Codex"}
    >
      <header className="tray-hover-header">
        <span className="tray-hover-brand"><i aria-hidden="true" /><b>CODEX</b><em>/ LIVE</em></span>
        <span className="tray-hover-state"><i aria-hidden="true" />{stateLabel} · {relativeUpdatedAt(snapshot.updatedAt, now, language)}</span>
      </header>

      <section className="tray-hover-hero">
        <span className="tray-hover-identity">
          <small>{isEnglish ? "ACTIVE PROFILE" : "АКТИВНЫЙ ПРОФИЛЬ"}</small>
          <strong title={active?.label}>{snapshot.accountLabel}</strong>
          <em>{active ? planLabel(active.planType) : (isEnglish ? "Open Manager to choose" : "Выберите аккаунт в Manager")}</em>
        </span>
        <span className="tray-hover-value">
          <strong>{displayValue}{snapshot.remainingPercent !== null ? <sup>%</sup> : null}</strong>
          <small>{isEnglish ? "available" : "доступно"}</small>
        </span>
      </section>

      <section className="tray-hover-limit" aria-label={isEnglish ? "Current quota" : "Текущий лимит"}>
        <span>
          <small>{isEnglish ? "CURRENT QUOTA" : "ТЕКУЩИЙ ЛИМИТ"}</small>
          <time>{resetLabel(snapshot.activeWindowResetAt, language)}</time>
        </span>
        <i aria-hidden="true"><em style={{ width: `${snapshot.remainingPercent ?? 0}%` }} /></i>
      </section>
    </main>
  );
}
