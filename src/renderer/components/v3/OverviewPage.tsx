import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  ExternalLink,
  KeyRound,
  Layers3,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Zap
} from "lucide-react";
import type {
  AccountPlatform,
  AppDiagnostics,
  CodexCredentialStoreDiagnostics,
  ManagedAccount,
  SwitchTransaction
} from "../../../shared/types";
import {
  buildProviderQuotaState,
  type ProviderLimitWindowType
} from "../../../shared/providerAdapter";
import { buildQuotaFreshness, hasCurrentQuotaRefreshFailure } from "../../../shared/quotaFreshness";
import { rankSwitchCandidates } from "../../../shared/smartSelection";
import {
  formatRemainingCountdown,
  formatResetTimeShort,
  selectAccountListQuota
} from "../../../shared/accountListPresentation";
import antigravityLogoUrl from "../../assets/antigravity-app-official.png";
import codexLogoUrl from "../../assets/codex-official.png";

export function formatLiveCountdown(secondsRemaining: number | null, isEnglish: boolean): string | null {
  if (secondsRemaining === null || secondsRemaining <= 0) return null;
  const s = Math.floor(secondsRemaining);
  if (s < 60) {
    return isEnglish ? "< 1m" : "< 1м";
  }
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return isEnglish ? `${m}m` : `${m}м`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (s < 86400) {
    return isEnglish ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : (m > 0 ? `${h}ч ${m}м` : `${h}ч`);
  }
  const d = Math.floor(s / 86400);
  const remH = Math.floor((s % 86400) / 3600);
  return isEnglish ? (remH > 0 ? `${d}d ${remH}h` : `${d}d`) : (remH > 0 ? `${d}д ${remH}ч` : `${d}д`);
}

function remaining(usedPercent: number | null): number | null {
  return usedPercent === null ? null : Math.max(0, Math.min(100, 100 - usedPercent));
}

function quotaTone(value: number | null): string {
  if (value === null) return "unknown";
  if (value <= 10) return "danger";
  if (value <= 25) return "warning";
  return "ready";
}

function formatRemaining(value: number | null): string {
  return value === null ? "-" : `${Math.round(value)}%`;
}

function pluralRu(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function formatQuotaReset(resetAt: number | null, now: number, isEnglish: boolean): string {
  if (!resetAt) return isEnglish ? "Refresh to load reset time" : "Обновите, чтобы узнать сброс";
  const seconds = Math.max(0, resetAt - now);
  if (seconds === 0) return isEnglish ? "Reset is expected" : "Ожидается сброс";
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    if (minutes < 60) {
      return isEnglish
        ? `Resets in ${minutes} min`
        : `Сброс через ${minutes} ${pluralRu(minutes, "минуту", "минуты", "минут")}`;
    }
  }
  if (seconds < 86_400) {
    const hours = Math.ceil(seconds / 3600);
    return isEnglish
      ? `Resets in ${hours} h`
      : `Сброс через ${hours} ${pluralRu(hours, "час", "часа", "часов")}`;
  }
  const days = Math.ceil(seconds / 86_400);
  return isEnglish
    ? `Resets in ${days} d`
    : `Сброс через ${days} ${pluralRu(days, "день", "дня", "дней")}`;
}

export function formatQuotaResetMoment(resetAt: number | null, isEnglish: boolean): string {
  if (!resetAt) return isEnglish ? "No confirmed date" : "Нет подтверждённой даты";
  return new Intl.DateTimeFormat(isEnglish ? "en-US" : "ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(resetAt * 1000);
}

export interface NearestQuotaResetSummary {
  accountId: string;
  accountLabel: string;
  resetAt: number;
  remaining: number | null;
  windowType: ProviderLimitWindowType;
  freshness: "fresh" | "saved";
  protectedProfiles: number;
  profilesWithReset: number;
}

export function selectNearestQuotaReset(
  accounts: ManagedAccount[],
  now: number,
  platform: AccountPlatform
): NearestQuotaResetSummary | null {
  const protectedAccounts = accounts.filter((account) =>
    account.platform === platform &&
    account.credentialState === "ready" &&
    !account.archived
  );
  const candidates = protectedAccounts.flatMap((account) => {
    const freshnessState = buildQuotaFreshness(account, { now, staleAfterSeconds: 15 * 60 }).state;
    const freshness: NearestQuotaResetSummary["freshness"] = freshnessState === "fresh" &&
      !hasCurrentQuotaRefreshFailure(account)
      ? "fresh"
      : "saved";
    return buildProviderQuotaState(account).windows.flatMap((window) => {
      if (window.resetAt === null || window.resetAt <= now) return [];
      return [{
        accountId: account.id,
        accountLabel: account.label,
        resetAt: window.resetAt,
        remaining: window.remaining,
        windowType: window.windowType,
        freshness,
        checkedAt: account.lastRefreshAt ?? 0
      }];
    });
  });
  if (candidates.length === 0) return null;

  const selected = candidates.slice().sort((left, right) =>
    left.resetAt - right.resetAt ||
    Number(right.freshness === "fresh") - Number(left.freshness === "fresh") ||
    right.checkedAt - left.checkedAt ||
    left.accountLabel.localeCompare(right.accountLabel)
  )[0];
  return {
    accountId: selected.accountId,
    accountLabel: selected.accountLabel,
    resetAt: selected.resetAt,
    remaining: selected.remaining,
    windowType: selected.windowType,
    freshness: selected.freshness,
    protectedProfiles: protectedAccounts.length,
    profilesWithReset: new Set(candidates.map((candidate) => candidate.accountId)).size
  };
}

export function formatCredentialStore(
  diagnostics: CodexCredentialStoreDiagnostics | null | undefined,
  isEnglish: boolean
): string {
  if (!diagnostics) return isEnglish ? "Checking…" : "Проверяется…";
  if (diagnostics.configuredMode === "unspecified" && diagnostics.effectiveStore === "file") {
    return isEnglish ? "File · default" : "Файл · по умолчанию";
  }
  const labels: Record<CodexCredentialStoreDiagnostics["configuredMode"], [string, string]> = {
    file: ["File", "Файл"],
    keyring: ["Windows keyring", "Хранилище Windows"],
    auto: ["Automatic selection", "Автовыбор"],
    ephemeral: ["Ephemeral session", "Временная сессия"],
    unspecified: ["Not detected", "Не определено"],
    invalid: ["Configuration error", "Ошибка настройки"]
  };
  return labels[diagnostics.configuredMode][isEnglish ? 0 : 1];
}

interface PlanMeta {
  label: string;
  tone: string;
}

function getPlanMeta(plan: string | null | undefined, platform: "antigravity" | "codex"): PlanMeta {
  const raw = String(plan ?? "").trim();
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");

  if (platform === "antigravity" || key.startsWith("googleai") || key.startsWith("g1") || key.includes("antigravity")) {
    if (key === "googleaiultrax20" || key.includes("ultrax20") || (key.includes("ultra") && key.includes("20"))) {
      return { label: "Ultra x20", tone: "ag-ultrax20" };
    }
    if (key === "googleaiultra" || key.includes("ultra")) {
      return { label: "AI Ultra", tone: "ag-ultra" };
    }
    if (key === "googleaipro" || key === "g1protier" || key.includes("pro")) {
      return { label: "AI Pro", tone: "ag-pro" };
    }
    return { label: "Standard", tone: "ag-standard" };
  }

  if (key === "free") return { label: "Free", tone: "free" };
  if (key === "go") return { label: "Go", tone: "go" };
  if (key === "plus") return { label: "Plus", tone: "plus" };
  if (key === "team" || key === "business") return { label: key === "business" ? "Business" : "Team", tone: "team" };
  if (key === "enterprise" || key === "edu") return { label: "Enterprise", tone: "enterprise" };
  if (key.includes("20") || key === "prox20") return { label: "Pro X20", tone: "pro20" };
  if (key.includes("10") || key === "prox10" || key === "prolite") return { label: key === "prolite" ? "Pro Lite" : "Pro X10", tone: "pro10" };
  if (key.includes("5") || key === "prox5") return { label: "Pro X5", tone: "pro5" };
  if (key === "pro") return { label: "Pro", tone: "pro" };

  return { label: raw || "Standard", tone: "unknown" };
}

function quotaStateLabel(value: number | null, isEnglish: boolean): string {
  if (value === null) return isEnglish ? "No data" : "Нет данных";
  if (value <= 10) return isEnglish ? "Critical" : "Критично";
  if (value <= 25) return isEnglish ? "Low" : "Мало";
  return isEnglish ? "Available" : "Доступно";
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
  onAdd: () => void;
  onAddAntigravity?: () => void;
  onAddCodex?: () => void;
  onRefresh: () => void;
  onSwitch: (accountId: string) => void;
  onOpenAccounts: () => void;
  onOpenActivity?: () => void;
}

export function OverviewPage({
  accounts,
  diagnostics: _diagnostics,
  latestTransaction: _latestTransaction,
  busy,
  autoRefreshIntervalMs: _autoRefreshIntervalMs,
  smartSwitchThresholdPercent,
  isEnglish,
  displayEmail,
  onAdd,
  onAddAntigravity,
  onAddCodex,
  onRefresh,
  onSwitch,
  onOpenAccounts,
  onOpenActivity
}: OverviewPageProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Dual Active Profiles
  const activeAg = accounts.find((a) => a.platform === "antigravity" && a.isActive) ?? null;
  const activeCodex = accounts.find((a) => a.platform === "codex" && a.isActive) ?? null;

  // Antigravity Quotas
  const agPrimaryRemaining = remaining(activeAg?.primaryUsedPercent ?? null);
  const agPrimaryLabel = activeAg?.primaryWindowDurationMins === 300
    ? (isEnglish ? "5-hour limit" : "5-часовой лимит")
    : (isEnglish ? "Model limit" : "Лимит модели");
  const agPrimaryResetAt = activeAg?.primaryResetsAt ?? null;

  const agSecondaryRemaining = remaining(activeAg?.secondaryUsedPercent ?? null);
  const agSecondaryLabel = isEnglish ? "Weekly limit" : "Недельный лимит";
  const agSecondaryResetAt = activeAg?.secondaryResetsAt ?? null;
  const agSecondaryIsUnlimited = activeAg !== null && activeAg.secondaryUsedPercent === null && activeAg.secondaryResetsAt === null;

  // OpenAI Codex Quotas
  const codexHas5h = activeCodex?.fiveHourUsedPercent !== null;
  const codexHasWeekly = activeCodex?.weeklyUsedPercent !== null;

  let codex5hRemaining: number | null = null;
  let codex5hResetAt: number | null = null;
  let codexWeeklyRemaining: number | null = null;
  let codexWeeklyResetAt: number | null = null;
  let codexWeeklyIsUnlimited = false;

  if (codexHas5h) {
    codex5hRemaining = remaining(activeCodex?.fiveHourUsedPercent ?? null);
    codex5hResetAt = activeCodex?.fiveHourResetsAt ?? null;
    if (codexHasWeekly) {
      codexWeeklyRemaining = remaining(activeCodex?.weeklyUsedPercent ?? null);
      codexWeeklyResetAt = activeCodex?.weeklyResetsAt ?? null;
    } else {
      codexWeeklyIsUnlimited = true;
    }
  } else if (codexHasWeekly) {
    codexWeeklyRemaining = remaining(activeCodex?.weeklyUsedPercent ?? null);
    codexWeeklyResetAt = activeCodex?.weeklyResetsAt ?? null;
    codex5hRemaining = null;
    codexWeeklyIsUnlimited = false;
  } else if (activeCodex) {
    codex5hRemaining = remaining(activeCodex.primaryUsedPercent ?? null);
    codex5hResetAt = activeCodex.primaryResetsAt ?? null;
    codexWeeklyIsUnlimited = true;
  }

  // Switch Recommendations
  const switchCandidates = rankSwitchCandidates(accounts, { now, staleAfterSeconds: 15 * 60 });
  const threshold = Math.max(5, Math.min(50, Math.round(smartSwitchThresholdPercent)));

  const agKnown = [agPrimaryRemaining, agSecondaryRemaining].filter((v): v is number => v !== null);
  const agMin = agKnown.length ? Math.min(...agKnown) : null;
  const agNeedsSwitch = agMin !== null && agMin <= threshold;
  const agCandidate = agNeedsSwitch
    ? switchCandidates.find((c) => c.account.platform === "antigravity" && c.state === "ready" && c.account.id !== activeAg?.id) ?? null
    : null;

  const codexKnown = [codex5hRemaining, codexWeeklyRemaining].filter((v): v is number => v !== null);
  const codexMin = codexKnown.length ? Math.min(...codexKnown) : null;
  const codexNeedsSwitch = codexMin !== null && codexMin <= threshold;
  const codexCandidate = codexNeedsSwitch
    ? switchCandidates.find((c) => c.account.platform === "codex" && c.state === "ready" && c.account.id !== activeCodex?.id) ?? null
    : null;

  // Fleet Standby Statistics
  const readyStandbyCount = accounts.filter(
    (a) => !a.isActive && !a.archived && a.credentialState === "ready" && (remaining(a.fiveHourUsedPercent ?? a.primaryUsedPercent ?? null) ?? 100) >= 50
  ).length;

  const protectedProfilesCount = accounts.filter((a) => a.credentialState === "ready" && !a.archived).length;

  // Earliest Reset across Fleet
  const futureResets = accounts
    .filter((a) => !a.archived && a.credentialState === "ready")
    .flatMap((a) => {
      const q = selectAccountListQuota(a, now);
      return q.resetAt && q.resetAt > now ? [{ account: a, resetAt: q.resetAt, windowType: q.windowType }] : [];
    })
    .sort((a, b) => a.resetAt - b.resetAt);
  const earliestFleetReset = futureResets[0] ?? null;

  // Process Standby Fleets per platform (scheduleAccounts compatibility for test contracts)
  const scheduleAccounts = useMemo(() => {
    return accounts
      .filter((a) => !a.archived)
      .map((account) => {
        const quota = selectAccountListQuota(account, now);
        const countdown = formatRemainingCountdown(quota.resetAt, now, isEnglish);
        return {
          account,
          remaining: quota.remainingPercent,
          resetAt: quota.resetAt,
          windowType: quota.windowType,
          countdown
        };
      })
      .sort((a, b) => {
        if (a.account.isActive && !b.account.isActive) return -1;
        if (!a.account.isActive && b.account.isActive) return 1;
        return (b.remaining ?? 0) - (a.remaining ?? 0);
      });
  }, [accounts, now, isEnglish]);

  // Standby accounts for Antigravity
  const agStandbyAccounts = useMemo(() => {
    return scheduleAccounts.filter((item) => item.account.platform === "antigravity" && !item.account.isActive);
  }, [scheduleAccounts]);

  // Standby accounts for Codex
  const codexStandbyAccounts = useMemo(() => {
    return scheduleAccounts.filter((item) => item.account.platform === "codex" && !item.account.isActive);
  }, [scheduleAccounts]);

  return (
    <div className="v3-page overview-page overview-dual-v5">
      {/* Top Header */}
      <div className="overview-page-header">
        <div>
          <h1 className="overview-headline">
            {isEnglish ? "Command Center" : "Панель управления"}
          </h1>
          <p className="overview-subheadline">
            {isEnglish
              ? "Dual-engine status, live quota telemetry, and fast profile switching."
              : "Мониторинг сессий Antigravity и Codex, учёт лимитов и быстрое переключение."}
          </p>
        </div>
        <div className="overview-header-actions">
          <button
            className="button clean-action-button"
            disabled={busy !== null || accounts.length === 0}
            onClick={onRefresh}
            title={isEnglish ? "Refresh all rate limits" : "Обновить лимиты всех профилей"}
          >
            <RefreshCcw className={busy === "refresh:all" ? "spin" : ""} size={14} />
            <span>{isEnglish ? "Refresh limits" : "Обновить лимиты"}</span>
          </button>
          <button className="button secondary clean-action-button" onClick={onOpenAccounts}>
            <Layers3 size={14} />
            <span>{isEnglish ? "All accounts" : "Все аккаунты"}</span>
          </button>
          {onOpenActivity && (
            <button
              className="button secondary clean-action-button"
              onClick={onOpenActivity}
              title={isEnglish ? "Switch audit journal" : "Журнал аудита переключений"}
            >
              <Activity size={14} />
              <span>{isEnglish ? "Audit" : "Аудит"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Fleet Telemetry Bento Bar */}
      <section className="overview-bento-strip">
        <div className="bento-metric-card">
          <div className="bento-icon-wrapper is-pool">
            <Layers3 size={18} />
          </div>
          <div className="bento-metric-data">
            <span className="bento-metric-label">{isEnglish ? "Standby Pool" : "Резервный пул"}</span>
            <div className="bento-metric-value">
              <strong>{readyStandbyCount}</strong>
              <small>{isEnglish ? "ready to switch" : "готовы к работе"}</small>
            </div>
          </div>
        </div>

        <div className="bento-metric-card">
          <div className="bento-icon-wrapper is-time">
            <Clock3 size={18} />
          </div>
          <div className="bento-metric-data">
            <span className="bento-metric-label">{isEnglish ? "Earliest Quota Reset" : "Ближайший сброс"}</span>
            <div className="bento-metric-value">
              {earliestFleetReset ? (
                <>
                  <strong className="bento-time-highlight">
                    {formatRemainingCountdown(earliestFleetReset.resetAt, now, isEnglish)}
                  </strong>
                  <small title={earliestFleetReset.account.label}>{earliestFleetReset.account.label}</small>
                </>
              ) : (
                <>
                  <strong>{isEnglish ? "All clear" : "Лимиты в норме"}</strong>
                  <small>{isEnglish ? "No impending limits" : "Ограничений нет"}</small>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="bento-metric-card">
          <div className="bento-icon-wrapper is-security">
            <ShieldCheck size={18} />
          </div>
          <div className="bento-metric-data">
            <span className="bento-metric-label">{isEnglish ? "Vault Security" : "Защита сессий"}</span>
            <div className="bento-metric-value">
              <strong>{protectedProfilesCount} / {accounts.length}</strong>
              <small>{isEnglish ? "DPAPI vault" : "DPAPI"}</small>
            </div>
          </div>
        </div>

        <div className="bento-metric-card">
          <div className="bento-icon-wrapper is-sync">
            <CheckCircle2 size={18} />
          </div>
          <div className="bento-metric-data">
            <span className="bento-metric-label">{isEnglish ? "IDE Integration" : "Интеграция IDE"}</span>
            <div className="bento-metric-value">
              <strong className="bento-sync-highlight">{activeAg ? "state.vscdb" : "-"}</strong>
              <small>{activeAg ? (isEnglish ? "Live sync active" : "Синхронизировано") : (isEnglish ? "Not connected" : "Не подключено")}</small>
            </div>
          </div>
        </div>
      </section>

      {/* Smart Switch Recommendation Banner */}
      {(agCandidate || codexCandidate) ? (
        <section className="overview-recommendation-clean">
          <div className="recommendation-content">
            <span className="recommendation-icon-bubble"><Zap size={20} /></span>
            <div className="recommendation-text">
              <h3>
                {agCandidate
                  ? (isEnglish ? "Antigravity quota depleted" : "Лимит Antigravity на исходе")
                  : (isEnglish ? "Codex quota depleted" : "Лимит Codex на исходе")}
              </h3>
              <p>
                {agCandidate
                  ? (isEnglish
                    ? `Switch to "${agCandidate.account.label}" (${agCandidate.remainingPercent}% available) to continue uninterrupted.`
                    : `Переключитесь на "${agCandidate.account.label}" (${agCandidate.remainingPercent}% доступно) для непрерывной работы.`)
                  : (isEnglish
                    ? `Switch to "${codexCandidate!.account.label}" (${codexCandidate!.remainingPercent}% available) to continue uninterrupted.`
                    : `Переключитесь на "${codexCandidate!.account.label}" (${codexCandidate!.remainingPercent}% доступно) для непрерывной работы.`)}
              </p>
            </div>
          </div>
          <button
            className="button recommendation-switch-button"
            disabled={busy !== null}
            onClick={() => onSwitch(agCandidate ? agCandidate.account.id : codexCandidate!.account.id)}
          >
            <Zap size={14} />
            {isEnglish
              ? `Switch to ${agCandidate ? agCandidate.account.label : codexCandidate!.account.label}`
              : `Переключиться на ${agCandidate ? agCandidate.account.label : codexCandidate!.account.label}`}
          </button>
        </section>
      ) : null}

      {/* Dual Platform Command Cockpit */}
      <section className="overview-dual-hero">
        {/* ===================== Column 1: Google Antigravity ===================== */}
        <div className={`dual-command-card is-antigravity ${activeAg ? "is-connected" : "is-empty"}`}>
          {/* Card Header */}
          <div className="command-card-header">
            <div className="command-brand">
              <img src={antigravityLogoUrl} alt="Antigravity" className="brand-vector-icon" />
              <div className="brand-titles">
                <span className="brand-kicker">Google AI</span>
                <h2 className="brand-title">Antigravity</h2>
              </div>
            </div>
            <div className="command-status">
              <span className={`status-pill-clean ${activeAg ? "is-live" : "is-offline"}`}>
                <span className="status-dot" />
                {activeAg ? (isEnglish ? "Active in IDE" : "Активен в IDE") : (isEnglish ? "Not connected" : "Не подключён")}
              </span>
            </div>
          </div>

          {activeAg ? (
            <div className="command-card-body">
              {/* Profile Identity Strip */}
              <div className="profile-identity-strip">
                <span className="identity-avatar ag-avatar">
                  {activeAg.label.slice(0, 1).toUpperCase()}
                </span>
                <div className="identity-text">
                  <div className="identity-name-row">
                    <strong className="identity-name" title={activeAg.label}>{activeAg.label}</strong>
                    {(() => {
                      const meta = getPlanMeta(activeAg.planType, "antigravity");
                      return (
                        <span className={`identity-plan-badge plan-${meta.tone}`}>
                          <span className="plan-glyph" aria-hidden="true" />
                          <span>{meta.label}</span>
                        </span>
                      );
                    })()}
                  </div>
                  <span className="identity-email">{displayEmail(activeAg.email)}</span>
                </div>
              </div>

              {/* Dual Quota Gauges */}
              <div className="command-quotas-grid">
                {/* 5-Hour Limit */}
                <div className="clean-quota-card is-antigravity">
                  <div className="clean-quota-header">
                    <span className="clean-quota-label">{agPrimaryLabel}</span>
                    <span className="clean-quota-state">{quotaStateLabel(agPrimaryRemaining, isEnglish)}</span>
                  </div>
                  <div className="clean-quota-big-number">
                    <span className={`clean-big-num ${quotaTone(agPrimaryRemaining)}`}>
                      {formatRemaining(agPrimaryRemaining)}
                    </span>
                  </div>
                  <div className="clean-quota-progress">
                    <div
                      className={`clean-quota-bar ${quotaTone(agPrimaryRemaining)}`}
                      style={{ width: `${agPrimaryRemaining ?? 0}%` }}
                    />
                  </div>
                  <div className="clean-quota-footer">
                    <Clock3 className="footer-clock-icon" size={13} />
                    <span>
                      {agPrimaryResetAt && agPrimaryResetAt > now ? (
                        <>
                          {isEnglish ? "Resets in " : "Сброс через "}
                          <strong className="clean-countdown-highlight">
                            {formatRemainingCountdown(agPrimaryResetAt, now, isEnglish)}
                          </strong>
                        </>
                      ) : (
                        formatQuotaReset(agPrimaryResetAt, now, isEnglish)
                      )}
                    </span>
                  </div>
                </div>

                {/* Weekly Limit */}
                <div className="clean-quota-card is-antigravity">
                  <div className="clean-quota-header">
                    <span className="clean-quota-label">{agSecondaryLabel}</span>
                    <span className="clean-quota-state">
                      {agSecondaryIsUnlimited ? (isEnglish ? "Unlimited" : "Не ограничен") : quotaStateLabel(agSecondaryRemaining, isEnglish)}
                    </span>
                  </div>
                  <div className="clean-quota-big-number">
                    <span className={`clean-big-num ${agSecondaryIsUnlimited ? "is-unlimited" : quotaTone(agSecondaryRemaining)}`}>
                      {agSecondaryIsUnlimited ? "∞" : formatRemaining(agSecondaryRemaining)}
                    </span>
                  </div>
                  <div className="clean-quota-progress">
                    <div
                      className={`clean-quota-bar ${agSecondaryIsUnlimited ? "is-unlimited" : quotaTone(agSecondaryRemaining)}`}
                      style={{ width: agSecondaryIsUnlimited ? "100%" : `${agSecondaryRemaining ?? 0}%` }}
                    />
                  </div>
                  <div className="clean-quota-footer">
                    <Clock3 className="footer-clock-icon" size={13} />
                    <span>
                      {agSecondaryIsUnlimited ? (
                        isEnglish ? "Unlimited Pro quota" : "Полный безлимит Pro"
                      ) : agSecondaryResetAt && agSecondaryResetAt > now ? (
                        <>
                          {isEnglish ? "Resets in " : "Сброс через "}
                          <strong className="clean-countdown-highlight">
                            {formatRemainingCountdown(agSecondaryResetAt, now, isEnglish)}
                          </strong>
                        </>
                      ) : (
                        formatQuotaReset(agSecondaryResetAt, now, isEnglish)
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Antigravity Standby Pool Matrix */}
              <div className="engine-standby-section">
                <div className="engine-standby-header">
                  <div className="engine-standby-title">
                    <span className="standby-kicker">{isEnglish ? "STANDBY POOL" : "РЕЗЕРВНЫЙ ПУЛ"}</span>
                    <strong>{isEnglish ? "Available Antigravity Profiles" : "Доступные профили Antigravity"}</strong>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {onAddAntigravity ? (
                      <button
                        className="button secondary compact-button"
                        onClick={onAddAntigravity}
                        title={isEnglish ? "Sign in with Google in browser" : "Войти через Google в браузере"}
                        style={{ fontSize: "11px", padding: "3px 8px" }}
                      >
                        <ExternalLink size={12} />
                        <span>{isEnglish ? "Add Google" : "Войти через Google"}</span>
                      </button>
                    ) : null}
                    <span className="standby-count-pill">{agStandbyAccounts.length}</span>
                  </div>
                </div>

                <div className="engine-standby-list schedule-card-list">
                  {agStandbyAccounts.length > 0 ? (
                    agStandbyAccounts.map((item) => (
                      <div className="compact-standby-item" key={item.account.id}>
                        <div className="standby-account-col">
                          <span className="mini-avatar ag-avatar">
                            {item.account.label.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="standby-names">
                            <div className="standby-title-line">
                              <strong className="standby-label">{item.account.label}</strong>
                              {(() => {
                                const meta = getPlanMeta(item.account.planType, "antigravity");
                                return (
                                  <span className={`standby-plan-pill plan-${meta.tone}`}>
                                    <span className="plan-glyph" aria-hidden="true" />
                                    <span>{meta.label}</span>
                                  </span>
                                );
                              })()}
                            </div>
                            <span className="standby-email">{displayEmail(item.account.email)}</span>
                          </div>
                        </div>

                        <div className="standby-metrics-col">
                          <div className="standby-quota-badge">
                            <span className={`standby-pct ${quotaTone(item.remaining)}`}>
                              {item.remaining === null ? "-" : `${item.remaining}%`}
                            </span>
                          </div>
                          <span className="standby-reset-hint">
                            {item.resetAt && item.resetAt > now
                              ? formatResetTimeShort(item.resetAt, isEnglish ? "en" : "ru", now)
                              : (isEnglish ? "Ready" : "Готов")}
                          </span>
                        </div>

                        <div className="standby-action-col">
                          <button
                            className="button secondary compact-button standby-switch-button"
                            disabled={busy !== null}
                            onClick={() => onSwitch(item.account.id)}
                            title={isEnglish ? `Switch to ${item.account.label}` : `Переключиться на ${item.account.label}`}
                          >
                            <Zap size={12} />
                            <span>{isEnglish ? "Switch" : "Переключить"}</span>
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="standby-empty-note">
                      <span>{isEnglish ? "No additional standby profiles" : "Нет дополнительных резервных профилей"}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="command-card-empty">
              <KeyRound className="empty-icon" size={32} />
              <h3>{isEnglish ? "Connect Antigravity" : "Подключить Antigravity"}</h3>
              <p>{isEnglish ? "Sign in with Google to manage Antigravity IDE quotas and accounts." : "Войдите через Google для управления квотами Antigravity IDE."}</p>
              <button className="button clean-action-button" onClick={onAddAntigravity ?? onAdd}>
                <Zap size={14} />
                {isEnglish ? "Connect Google Account" : "Подключить Google аккаунт"}
              </button>
            </div>
          )}
        </div>

        {/* ===================== Column 2: OpenAI Codex ===================== */}
        <div className={`dual-command-card is-codex ${activeCodex ? "is-connected" : "is-empty"}`}>
          {/* Card Header */}
          <div className="command-card-header">
            <div className="command-brand">
              <img src={codexLogoUrl} alt="Codex" className="brand-vector-icon" />
              <div className="brand-titles">
                <span className="brand-kicker">OpenAI</span>
                <h2 className="brand-title">Codex CLI</h2>
              </div>
            </div>
            <div className="command-status">
              <span className={`status-pill-clean ${activeCodex ? "is-live" : "is-offline"}`}>
                <span className="status-dot" />
                {activeCodex ? (isEnglish ? "Active CLI" : "Активен в CLI") : (isEnglish ? "Not connected" : "Не подключён")}
              </span>
            </div>
          </div>

          {activeCodex ? (
            <div className="command-card-body">
              {/* Profile Identity Strip */}
              <div className="profile-identity-strip">
                <span className="identity-avatar codex-avatar">
                  {activeCodex.label.slice(0, 1).toUpperCase()}
                </span>
                <div className="identity-text">
                  <div className="identity-name-row">
                    <strong className="identity-name" title={activeCodex.label}>{activeCodex.label}</strong>
                    {(() => {
                      const meta = getPlanMeta(activeCodex.planType, "codex");
                      return (
                        <span className={`identity-plan-badge plan-${meta.tone}`}>
                          <span className="plan-glyph" aria-hidden="true" />
                          <span>{meta.label}</span>
                        </span>
                      );
                    })()}
                  </div>
                  <span className="identity-email">{displayEmail(activeCodex.email)}</span>
                </div>
              </div>

              {/* Dual Quota Gauges */}
              <div className="command-quotas-grid">
                {/* 5-Hour Limit */}
                <div className="clean-quota-card is-codex">
                  <div className="clean-quota-header">
                    <span className="clean-quota-label">{isEnglish ? "5-hour limit" : "5-часовой лимит"}</span>
                    <span className="clean-quota-state">{quotaStateLabel(codex5hRemaining, isEnglish)}</span>
                  </div>
                  <div className="clean-quota-big-number">
                    <span className={`clean-big-num ${quotaTone(codex5hRemaining)}`}>
                      {formatRemaining(codex5hRemaining)}
                    </span>
                  </div>
                  <div className="clean-quota-progress">
                    <div
                      className={`clean-quota-bar ${quotaTone(codex5hRemaining)}`}
                      style={{ width: `${codex5hRemaining ?? 0}%` }}
                    />
                  </div>
                  <div className="clean-quota-footer">
                    <Clock3 className="footer-clock-icon" size={13} />
                    <span>
                      {codex5hResetAt && codex5hResetAt > now ? (
                        <>
                          {isEnglish ? "Resets in " : "Сброс через "}
                          <strong className="clean-countdown-highlight">
                            {formatRemainingCountdown(codex5hResetAt, now, isEnglish)}
                          </strong>
                        </>
                      ) : (
                        formatQuotaReset(codex5hResetAt, now, isEnglish)
                      )}
                    </span>
                  </div>
                </div>

                {/* Weekly Limit */}
                <div className="clean-quota-card is-codex">
                  <div className="clean-quota-header">
                    <span className="clean-quota-label">{isEnglish ? "Weekly limit" : "Недельный лимит"}</span>
                    <span className="clean-quota-state">
                      {codexWeeklyIsUnlimited ? (isEnglish ? "Unlimited" : "Не ограничен") : quotaStateLabel(codexWeeklyRemaining, isEnglish)}
                    </span>
                  </div>
                  <div className="clean-quota-big-number">
                    <span className={`clean-big-num ${codexWeeklyIsUnlimited ? "is-unlimited" : quotaTone(codexWeeklyRemaining)}`}>
                      {codexWeeklyIsUnlimited ? "∞" : formatRemaining(codexWeeklyRemaining)}
                    </span>
                  </div>
                  <div className="clean-quota-progress">
                    <div
                      className={`clean-quota-bar ${codexWeeklyIsUnlimited ? "is-unlimited" : quotaTone(codexWeeklyRemaining)}`}
                      style={{ width: codexWeeklyIsUnlimited ? "100%" : `${codexWeeklyRemaining ?? 0}%` }}
                    />
                  </div>
                  <div className="clean-quota-footer">
                    <Clock3 className="footer-clock-icon" size={13} />
                    <span>
                      {codexWeeklyIsUnlimited ? (
                        isEnglish ? "Included in subscription" : "Включено в подписку"
                      ) : codexWeeklyResetAt && codexWeeklyResetAt > now ? (
                        <>
                          {isEnglish ? "Resets in " : "Сброс через "}
                          <strong className="clean-countdown-highlight">
                            {formatRemainingCountdown(codexWeeklyResetAt, now, isEnglish)}
                          </strong>
                        </>
                      ) : (
                        formatQuotaReset(codexWeeklyResetAt, now, isEnglish)
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Codex Standby Pool Matrix */}
              <div className="engine-standby-section">
                <div className="engine-standby-header">
                  <div className="engine-standby-title">
                    <span className="standby-kicker">{isEnglish ? "STANDBY POOL" : "РЕЗЕРВНЫЙ ПУЛ"}</span>
                    <strong>{isEnglish ? "Available Codex Profiles" : "Доступные профили Codex"}</strong>
                  </div>
                  <span className="standby-count-pill">{codexStandbyAccounts.length}</span>
                </div>

                <div className="engine-standby-list schedule-card-list">
                  {codexStandbyAccounts.length > 0 ? (
                    codexStandbyAccounts.map((item) => (
                      <div className="compact-standby-item" key={item.account.id}>
                        <div className="standby-account-col">
                          <span className="mini-avatar codex-avatar">
                            {item.account.label.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="standby-names">
                            <div className="standby-title-line">
                              <strong className="standby-label">{item.account.label}</strong>
                              {(() => {
                                const meta = getPlanMeta(item.account.planType, "codex");
                                return (
                                  <span className={`standby-plan-pill plan-${meta.tone}`}>
                                    <span className="plan-glyph" aria-hidden="true" />
                                    <span>{meta.label}</span>
                                  </span>
                                );
                              })()}
                            </div>
                            <span className="standby-email">{displayEmail(item.account.email)}</span>
                          </div>
                        </div>

                        <div className="standby-metrics-col">
                          <div className="standby-quota-badge">
                            <span className={`standby-pct ${quotaTone(item.remaining)}`}>
                              {item.remaining === null ? "-" : `${item.remaining}%`}
                            </span>
                          </div>
                          <span className="standby-reset-hint">
                            {item.resetAt && item.resetAt > now
                              ? formatResetTimeShort(item.resetAt, isEnglish ? "en" : "ru", now)
                              : (isEnglish ? "Ready" : "Готов")}
                          </span>
                        </div>

                        <div className="standby-action-col">
                          <button
                            className="button secondary compact-button standby-switch-button"
                            disabled={busy !== null}
                            onClick={() => onSwitch(item.account.id)}
                            title={isEnglish ? `Switch to ${item.account.label}` : `Переключиться на ${item.account.label}`}
                          >
                            <Zap size={12} />
                            <span>{isEnglish ? "Switch" : "Переключить"}</span>
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="standby-empty-note">
                      <span>{isEnglish ? "No additional standby profiles" : "Нет дополнительных резервных профилей"}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="command-card-empty">
              <Sparkles className="empty-icon" size={32} />
              <h3>{isEnglish ? "Connect OpenAI Codex" : "Войти в OpenAI Codex"}</h3>
              <p>{isEnglish ? "Add Codex session credentials to balance AI coding quotas." : "Добавьте профиль Codex для балансировки лимитов генерации кода."}</p>
              <button className="button clean-action-button" onClick={onAddCodex ?? onAdd}>
                <KeyRound size={14} />
                {isEnglish ? "Sign in with Codex" : "Войти в Codex"}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
