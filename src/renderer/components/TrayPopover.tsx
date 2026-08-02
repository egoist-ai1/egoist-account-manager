import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowUpRight, Clock3, RefreshCcw, X } from "lucide-react";
import { buildLiveTraySnapshot } from "../../shared/liveTray";
import type { AppApi, AppSettings, ManagedAccount } from "../../shared/types";
import "../tray-popover.css";

function quotaLabel(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function planLabel(value: string): string {
  return value === "unknown" ? "ChatGPT" : value.charAt(0).toUpperCase() + value.slice(1);
}

function relativeUpdatedAt(updatedAt: number | null, now: number, language: AppSettings["language"]): string {
  const isEnglish = language === "en";
  if (!updatedAt) return isEnglish ? "not updated" : "не обновлялось";
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60));
  if (minutes < 1) return isEnglish ? "just now" : "только что";
  return new Intl.RelativeTimeFormat(language, { numeric: "always" }).format(-minutes, "minute");
}

export function TrayPopover({ api }: { api: AppApi }) {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const reload = async () => {
    const [nextAccounts, nextSettings] = await Promise.all([api.listAccounts(), api.getSettings()]);
    setAccounts(nextAccounts);
    setSettings(nextSettings);
    setNow(Math.floor(Date.now() / 1000));
  };

  useEffect(() => {
    void reload();
    const off = api.onAccountsUpdated(() => void reload());
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void api.hideTrayPopover();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      off();
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKeyDown);
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
    empty: isEnglish ? "No active profile" : "Нет активного профиля",
    fresh: isEnglish ? "Live data" : "Данные актуальны",
    critical: isEnglish ? "Quota is critical" : "Лимит критический",
    stale: isEnglish ? "Snapshot is stale" : "Снимок устарел",
    error: isEnglish ? "Refresh needs attention" : "Обновление требует внимания",
    unknown: isEnglish ? "Quota is unavailable" : "Лимиты недоступны"
  }[snapshot.state];
  const refreshActive = async () => {
    if (!snapshot.accountId || refreshing) return;
    setRefreshing(true);
    try {
      await api.refreshAccount(snapshot.accountId);
      await reload();
    } finally {
      setRefreshing(false);
    }
  };
  const percent = snapshot.remainingPercent ?? 0;

  return (
    <main className={`tray-live tray-live-${snapshot.state}`}>
      <header className="tray-live-header">
        <span className="tray-live-brand"><i aria-hidden="true" />Codex Live</span>
        <button onClick={() => void api.hideTrayPopover()} aria-label={isEnglish ? "Close" : "Закрыть"}><X /></button>
      </header>

      <section className="tray-live-overview">
        <div className="tray-live-identity">
          <span>{isEnglish ? "ACTIVE ACCOUNT" : "АКТИВНЫЙ АККАУНТ"}</span>
          <strong title={active?.label}>{snapshot.accountLabel}</strong>
          <small>{active ? planLabel(active.planType) : (isEnglish ? "Select an account in Manager" : "Выберите аккаунт в Manager")}</small>
        </div>
        <div className="tray-live-gauge" style={{ "--tray-percent": `${percent * 3.6}deg` } as CSSProperties} aria-label={snapshot.remainingPercent === null ? stateLabel : `${snapshot.remainingPercent}%`}>
          <span>{snapshot.iconText}</span>
          {snapshot.remainingPercent !== null ? <small>%</small> : null}
        </div>
      </section>

      <section className="tray-live-quotas" aria-label={isEnglish ? "Quota windows" : "Окна лимитов"}>
        <div>
          <span><b>{isEnglish ? "5 hours" : "5 часов"}</b><strong>{quotaLabel(snapshot.fiveHourRemaining)}</strong></span>
          <i><em style={{ width: `${snapshot.fiveHourRemaining ?? 0}%` }} /></i>
        </div>
        <div>
          <span><b>{isEnglish ? "Week" : "Неделя"}</b><strong>{quotaLabel(snapshot.weeklyRemaining)}</strong></span>
          <i><em style={{ width: `${snapshot.weeklyRemaining ?? 0}%` }} /></i>
        </div>
      </section>

      <footer className="tray-live-footer">
        <span className="tray-live-status"><Clock3 /><span><b>{stateLabel}</b><small>{relativeUpdatedAt(snapshot.updatedAt, now, language)}</small></span></span>
        <span className="tray-live-actions">
          <button className="tray-action-refresh" disabled={!snapshot.accountId || refreshing} onClick={() => void refreshActive()} aria-label={isEnglish ? "Refresh active quota" : "Обновить лимиты активного аккаунта"}><RefreshCcw className={refreshing ? "spin" : ""} /></button>
          <button className="tray-action-open" onClick={() => void api.showMainWindow()}>{isEnglish ? "Open" : "Открыть"}<ArrowUpRight /></button>
        </span>
      </footer>
    </main>
  );
}
