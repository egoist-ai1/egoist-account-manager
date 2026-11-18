import { Activity, ArrowRight, Circle, Clock3, KeyRound, Layers3, RefreshCcw, ShieldCheck } from "lucide-react";
import type { AppDiagnostics, ManagedAccount, SwitchTransaction } from "../../../shared/types";
import { getAccountReadiness, rankSwitchCandidates } from "../../../shared/smartSelection";
import { formatRemainingCountdown } from "../../../shared/accountListPresentation";
import { profilePresentation } from "../../profilePresentation";
import { useVisibleClock } from "../../hooks/useVisibleClock";
import { runtimeLabel } from "../RuntimeEvidence";
import { PlatformMark } from "../PlatformMark";
import { verificationSummary } from "./ActivityPage";

export function formatLiveCountdown(secondsRemaining: number | null, isEnglish: boolean): string | null {
  if (secondsRemaining === null || secondsRemaining <= 0) return null;
  return formatRemainingCountdown(secondsRemaining + 1, 1, isEnglish);
}

export function formatQuotaReset(resetAt: number | null, now: number, isEnglish: boolean): string {
  if (!resetAt) return isEnglish ? "Reset time unknown" : "Время сброса неизвестно";
  if (resetAt <= now) return isEnglish ? "Reset needs confirmation" : "Сброс требует проверки";
  return `${isEnglish ? "Reset in" : "Сброс через"} ${formatRemainingCountdown(resetAt, now, isEnglish)}`;
}

export interface OverviewPageProps {
  accounts: ManagedAccount[];
  diagnostics: AppDiagnostics | null;
  latestTransaction: SwitchTransaction | null;
  busy: string | null;
  autoRefreshIntervalMs: number;
  smartSwitchThresholdPercent: number;
  isEnglish: boolean;
  displayEmail: (value: string) => string;
  displayLabel: (value: string) => string;
  onAdd: () => void;
  onAddAntigravity?: () => void;
  onAddCodex?: () => void;
  onRefresh: () => void;
  onSwitch: (accountId: string) => void;
  onOpenAccounts: () => void;
  onOpenActivity?: () => void;
}

export function OverviewPage({ accounts, latestTransaction, busy, autoRefreshIntervalMs, smartSwitchThresholdPercent, isEnglish: en, displayEmail, displayLabel, onAdd, onAddAntigravity, onAddCodex, onRefresh, onSwitch, onOpenAccounts, onOpenActivity }: OverviewPageProps) {
  const now = useVisibleClock();
  const language = en ? "en" : "ru";
  const candidates = rankSwitchCandidates(accounts, { now, staleAfterSeconds: 900 });
  const selected = accounts.filter((account) => account.isActive && !account.archived);
  const platforms = ["codex", "antigravity"] as const;
  const readyCount = accounts.filter((account) => !account.isActive && getAccountReadiness(account, { now, staleAfterSeconds: 900 }).state === "ready").length;
  const needAttention = accounts.filter((account) => getAccountReadiness(account, { now, staleAfterSeconds: 900 }).state !== "ready" || (account.isActive && account.runtimeVerification?.runtime !== "verified")).length;
  return (
    <div className="overview-page">
      <header className="page-head">
        <div>
          <h2>{en ? "Session overview" : "Обзор сессий"}</h2>
          <p>{autoRefreshIntervalMs
            ? (en ? `Limits refresh every ${autoRefreshIntervalMs / 60_000} min` : `Лимиты обновляются каждые ${autoRefreshIntervalMs / 60_000} мин`)
            : (en ? "Background refresh is off" : "Фоновое обновление лимитов выключено")}</p>
        </div>
        <button className="button secondary" disabled={busy !== null || accounts.length === 0} aria-busy={busy === "refresh:all"} onClick={onRefresh}>
          <RefreshCcw className={busy === "refresh:all" ? "spin" : ""} />{en ? "Refresh limits" : "Обновить лимиты"}
        </button>
      </header>
      <div className="overview-platforms">
        {platforms.map((platform) => {
          const account = selected.find((item) => item.platform === platform);
          const label = platform === "antigravity" ? "Antigravity" : "Codex";
          if (!account) return (
            <section key={platform} className="overview-connect" aria-label={label}>
              <header className="overview-platform-header"><PlatformMark platform={platform} /><strong>{label}</strong></header>
              <div className="overview-connect-body">
                <span className="empty-icon"><KeyRound aria-hidden="true" /></span>
                <p>{en ? "No selected profile" : "Профиль не выбран"}</p>
                <button className="button secondary" disabled={busy !== null} onClick={platform === "antigravity" ? onAddAntigravity ?? onAdd : onAddCodex ?? onAdd}>
                  {en ? "Add profile" : "Добавить профиль"}
                </button>
              </div>
            </section>
          );
          const view = profilePresentation(account, now, language);
          const remaining = view.readiness.remainingPercent;
          const verified = account.runtimeVerification?.runtime === "verified";
          const mismatch = account.runtimeVerification?.runtime === "mismatch";
          const suggestion = remaining !== null && remaining <= smartSwitchThresholdPercent
            ? candidates.find((item) => item.account.platform === platform && item.account.id !== account.id && item.state === "ready")
            : null;
          return (
            <section className="overview-selected-profile" key={platform} aria-label={label}>
              <header className="overview-platform-header">
                <PlatformMark platform={platform} />
                <strong>{label}</strong>
                <span className="overview-freshness">{view.freshness} · {view.ageLabel}</span>
              </header>
              <div className="overview-profile-identity">
                <h3>{displayLabel(account.label)}</h3>
                <p>{displayEmail(account.email)}</p>
                <span className={`runtime-inline ${verified ? "is-verified" : ""} ${mismatch ? "is-error" : ""}`}>
                  {verified ? <ShieldCheck aria-hidden="true" /> : <Circle aria-hidden="true" />}
                  {runtimeLabel(account.runtimeVerification, language)}
                </span>
              </div>
              <div className="overview-quotas">
                {view.summaryWindows.length ? view.summaryWindows.slice(0, 2).map((window) => (
                  <div key={window.id} className={`overview-quota ${window.remaining <= 10 ? "is-critical" : ""}`}>
                    <span>{window.title}</span>
                    <strong>{view.formatRemaining(window.remaining)}</strong>
                    <div className="bar"><span style={{ width: `${window.remaining}%` }} /></div>
                    <small>{formatQuotaReset(window.resetsAt, now, en)}</small>
                  </div>
                )) : <div className="overview-quota"><span>{en ? "No quota data" : "Нет данных лимита"}</span><strong>—</strong></div>}
              </div>
              {suggestion ? (
                <footer>
                  <span>{en ? "Fresh alternative" : "Профиль с доступным лимитом"}<strong>{displayLabel(suggestion.account.label)}</strong></span>
                  <button className="button" disabled={busy !== null} onClick={() => onSwitch(suggestion.account.id)}>{en ? "Switch" : "Переключить"}<ArrowRight /></button>
                </footer>
              ) : null}
            </section>
          );
        })}
      </div>
      <section className="overview-summary" aria-label={en ? "Profile summary" : "Сводка профилей"}>
        <div><Layers3 aria-hidden="true" /><strong>{accounts.filter((account) => !account.archived).length}</strong><span>{en ? "Saved profiles" : "Сохранённых профилей"}</span></div>
        <div><Clock3 aria-hidden="true" /><strong>{readyCount}</strong><span>{en ? "Fresh alternatives" : "Свежих альтернатив"}</span></div>
        <div><KeyRound aria-hidden="true" /><strong>{needAttention}</strong><span>{en ? "Need a check" : "Требуют проверки"}</span></div>
        <button className="button secondary overview-profiles-link" onClick={onOpenAccounts}>{en ? "All profiles" : "Все профили"}<ArrowRight /></button>
      </section>
      {latestTransaction && onOpenActivity ? (
        <section className="overview-journal-link">
          <Activity aria-hidden="true" />
          <div><strong>{en ? "Latest switch" : "Последнее переключение"}</strong><span>{verificationSummary(latestTransaction, en)}</span></div>
          <button className="button secondary" onClick={onOpenActivity}>{en ? "Open journal" : "Открыть журнал"}</button>
        </section>
      ) : null}
    </div>
  );
}
