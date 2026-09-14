import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Clock, RefreshCcw, X } from "lucide-react";
import { formatRemainingCountdown, formatResetTimeShort } from "../../shared/accountListPresentation";
import { buildPlatformTraySnapshot } from "../../shared/liveTray";
import type { PlatformTraySnapshot } from "../../shared/liveTray";
import type { AppApi, AppSettings, ManagedAccount } from "../../shared/types";
import "../tray-popover.css";

function planLabel(value: string, platform?: "codex" | "antigravity"): string {
  const normalized = String(value || "unknown").toLowerCase().replace(/[\s_-]+/g, "");
  if (platform === "antigravity") {
    if (normalized === "googleaipro") return "Google AI Pro";
    if (normalized === "googleaiultra") return "Google AI Ultra";
    if (normalized === "free") return "Free";
    if (normalized === "standard" || normalized === "antigravity" || normalized === "unknown" || normalized === "standardtier") return "Antigravity";
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  if (normalized === "unknown") return "Codex";
  if (normalized === "googleaipro") return "Google AI Pro";
  if (normalized === "googleaiultra") return "Google AI Ultra";
  return value.charAt(0).toUpperCase() + value.slice(1);
}


export function TrayPopover({ api }: { api: AppApi }) {
  const [platform, setPlatform] = useState<"codex" | "antigravity">("codex");
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
    api.getTrayPlatform?.().then((p) => {
      if (p) setPlatform(p);
    });
    const offAccounts = api.onAccountsUpdated(() => void reload());
    const offPlatform = api.onTrayPlatform?.((p) => setPlatform(p));
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void api.hideTrayPopover();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      offAccounts();
      offPlatform?.();
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [api]);

  const language = settings?.language ?? "ru";
  const isEnglish = language === "en";
  const isAntigravity = platform === "antigravity";

  const active = useMemo(() => {
    return accounts.find((a) => a.isActive && (a.platform ?? "codex") === platform)
      ?? accounts.find((a) => (a.platform ?? "codex") === platform)
      ?? null;
  }, [accounts, platform]);

  const snapshot: PlatformTraySnapshot = useMemo(() => {
    const s = buildPlatformTraySnapshot(accounts, platform, {
      now,
      privacyMode: settings?.privacyMode,
      language
    });
    if (s) return s;
    return {
      platform,
      planType: isAntigravity ? "google-ai-pro" : "unknown",
      state: "empty",
      accountId: null,
      accountLabel: isEnglish ? "No active profile" : "Нет активного профиля",
      remainingPercent: null,
      fiveHourRemaining: null,
      weeklyRemaining: null,
      activeWindowType: null,
      activeWindowResetAt: null,
      iconText: "-",
      tooltip: "",
      updatedAt: null
    };
  }, [accounts, platform, now, settings?.privacyMode, language, isAntigravity, isEnglish]);

  const stateLabel = {
    empty: isEnglish ? "No profile" : "Нет профиля",
    fresh: isEnglish ? "Live" : "Актуально",
    critical: isEnglish ? "Critical" : "Критично",
    stale: isEnglish ? "Stale" : "Устарело",
    error: isEnglish ? "Error" : "Ошибка",
    unknown: isEnglish ? "No quota" : "Нет данных"
  }[snapshot.state];

  const displayValue = snapshot.remainingPercent === null
    ? (snapshot.state === "error" ? "!" : snapshot.state === "stale" ? "~" : "-")
    : String(snapshot.remainingPercent);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (active?.id) {
        await api.refreshAccount(active.id);
      } else {
        await api.refreshAllAccounts();
      }
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <main
      className={`tray-live tray-theme-${platform} tray-state-${snapshot.state}`}
      role="dialog"
      aria-label={`Account Manager EGO · ${isAntigravity ? "Antigravity" : "Codex"}`}
    >
      <header className="tray-live-header">
        <span className="tray-live-brand">
          <i aria-hidden="true" />
          <b>{isAntigravity ? "Antigravity" : "Codex"}</b>
        </span>
        <span className="tray-live-state">
          {stateLabel}
        </span>
      </header>

      <div className="tray-live-hero">
        <div className="tray-live-identity">
          <strong title={active?.email || active?.label}>{snapshot.accountLabel}</strong>
          <span className="tray-plan-badge">
            {active ? planLabel(active.planType, platform) : (isEnglish ? "Select profile" : "Выберите аккаунт")}
          </span>
        </div>
        <div className="tray-live-value">
          <strong>{displayValue}{snapshot.remainingPercent !== null ? <sup>%</sup> : null}</strong>
          <small>{isEnglish ? "available" : "доступно"}</small>
        </div>
      </div>

      {(() => {
        const countdown = formatRemainingCountdown(snapshot.activeWindowResetAt, now, isEnglish);
        const shortReset = formatResetTimeShort(snapshot.activeWindowResetAt, language, now);
        const resetText = snapshot.activeWindowResetAt
          ? (isEnglish ? `Reset ${shortReset}` : `Сброс ${shortReset}`)
          : (isEnglish ? "Reset pending" : "Сброс уточняется");

        return (
          <div className="tray-live-limit">
            <div className="tray-live-limit-timing">
              <time
                title={
                  snapshot.activeWindowResetAt
                    ? isEnglish
                      ? `Exact reset: ${new Date(snapshot.activeWindowResetAt * 1000).toLocaleString("en-US")}`
                      : `Точный сброс: ${new Date(snapshot.activeWindowResetAt * 1000).toLocaleString("ru-RU")}`
                    : undefined
                }
              >
                {resetText}
              </time>
              {countdown ? (
                <span
                  className="tray-countdown-chip"
                  title={isEnglish ? `Time until reset: ${countdown}` : `До сброса: ${countdown}`}
                >
                  <Clock size={10} aria-hidden="true" />
                  <span>{countdown}</span>
                </span>
              ) : null}
            </div>
            <i aria-hidden="true">
              <em style={{ width: `${Math.min(100, Math.max(0, snapshot.remainingPercent ?? 0))}%` }} />
            </i>
          </div>
        );
      })()}

      <footer className="tray-live-footer">
        <div className="tray-live-footer-left">
          <button
            type="button"
            className="tray-btn-refresh"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
            aria-label={isEnglish ? "Refresh quota" : "Обновить лимит"}
            title={isEnglish ? "Refresh quota" : "Обновить лимит"}
          >
            <RefreshCcw size={13} className={refreshing ? "spin" : ""} />
          </button>
        </div>
        <div className="tray-live-footer-right">
          <button
            type="button"
            className="tray-btn-open"
            onClick={() => {
              void api.hideTrayPopover();
              void api.showMainWindow();
            }}
          >
            {isEnglish ? "Manager" : "Менеджер"}
            <ArrowUpRight size={13} />
          </button>
          <button
            type="button"
            className="tray-btn-close"
            onClick={() => void api.hideTrayPopover()}
            aria-label={isEnglish ? "Close" : "Закрыть"}
            title={isEnglish ? "Close" : "Закрыть"}
          >
            <X size={13} />
          </button>
        </div>
      </footer>
    </main>
  );
}
