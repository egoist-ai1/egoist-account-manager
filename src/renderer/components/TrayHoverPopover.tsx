import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { formatRemainingCountdown, formatResetTimeShort } from "../../shared/accountListPresentation";
import { buildPlatformTraySnapshot } from "../../shared/liveTray";
import type { PlatformTraySnapshot } from "../../shared/liveTray";
import type { AppApi, AppSettings, ManagedAccount } from "../../shared/types";
import "../tray-hover.css";

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

export function TrayHoverPopover({ api }: { api: AppApi }) {
  const [platform, setPlatform] = useState<"codex" | "antigravity">("codex");
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
    api.getTrayPlatform?.().then((p) => {
      if (p) setPlatform(p);
    });
    const offAccounts = api.onAccountsUpdated(() => void reload());
    const offPlatform = api.onTrayPlatform?.((p) => setPlatform(p));
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      offAccounts();
      offPlatform?.();
      window.clearInterval(timer);
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
    fresh: isEnglish ? "Live" : "В сети",
    critical: isEnglish ? "Critical" : "Критично",
    stale: isEnglish ? "Stale" : "Устарело",
    error: isEnglish ? "Error" : "Сбой",
    unknown: isEnglish ? "No quota" : "Нет данных"
  }[snapshot.state];

  const displayValue = snapshot.remainingPercent === null
    ? (snapshot.state === "error" ? "!" : snapshot.state === "stale" ? "~" : "-")
    : String(snapshot.remainingPercent);

  const countdown = formatRemainingCountdown(snapshot.activeWindowResetAt, now, isEnglish);
  const shortReset = formatResetTimeShort(snapshot.activeWindowResetAt, language, now);
  const resetText = snapshot.activeWindowResetAt
    ? (isEnglish ? `Reset ${shortReset}` : `Сброс ${shortReset}`)
    : (isEnglish ? "Reset pending" : "Сброс уточняется");

  return (
    <main
      className={`tray-hover tray-hover-${snapshot.state} tray-theme-${platform}`}
      aria-label={`Account Manager EGO · ${isAntigravity ? "Antigravity" : "Codex"}`}
    >
      <header className="tray-hover-header">
        <div className="tray-hover-brand">
          <span className="tray-status-dot" />
          <span className="tray-brand-title">{isAntigravity ? "Antigravity" : "Codex"}</span>
        </div>
        <span className="tray-hover-state">
          {stateLabel}
        </span>
      </header>

      <section className="tray-hover-hero">
        <div className="tray-hover-identity">
          <span className="tray-account-name" title={active?.email || active?.label}>
            {snapshot.accountLabel}
          </span>
          <span className="tray-plan-badge">
            {active ? planLabel(active.planType, platform) : (isEnglish ? "Select profile" : "Выберите аккаунт")}
          </span>
        </div>
        <div className="tray-hover-value">
          <strong>{displayValue}{snapshot.remainingPercent !== null ? <sup>%</sup> : null}</strong>
          <small>{isEnglish ? "available" : "доступно"}</small>
        </div>
      </section>

      <section className="tray-hover-limit" aria-label={isEnglish ? "Current quota" : "Текущий лимит"}>
        <div className="tray-limit-row">
          <time className="tray-limit-reset">{resetText}</time>
          {countdown ? (
            <span className="tray-countdown-chip">
              <Clock size={10} aria-hidden="true" />
              <span>{countdown}</span>
            </span>
          ) : null}
        </div>
        <div className="tray-progress-track">
          <div
            className="tray-progress-fill"
            style={{ width: `${Math.min(100, Math.max(0, snapshot.remainingPercent ?? 0))}%` }}
          />
        </div>
      </section>
    </main>
  );
}

