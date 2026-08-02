import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  KeyRound,
  Layers3,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Zap
} from "lucide-react";
import type {
  AppDiagnostics,
  CodexCredentialStoreDiagnostics,
  ManagedAccount,
  SwitchTransaction
} from "../../../shared/types";
import { rankSwitchCandidates, type RankedSwitchCandidate } from "../../../shared/smartSelection";

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
  return value === null ? "—" : `${Math.round(value)}%`;
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

function formatLastRefresh(lastRefreshAt: number | null, now: number, isEnglish: boolean): string {
  if (!lastRefreshAt) return isEnglish ? "No fresh quota snapshot" : "Нет свежего снимка лимитов";
  const minutes = Math.max(0, Math.floor((now - lastRefreshAt) / 60));
  if (minutes < 1) return isEnglish ? "Updated just now" : "Обновлено только что";
  if (minutes < 60) return isEnglish ? `Updated ${minutes} min ago` : `Обновлено ${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  return isEnglish ? `Updated ${hours} h ago` : `Обновлено ${hours} ч назад`;
}

function formatPlan(plan: string | null): string {
  if (!plan) return "ChatGPT";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function quotaStateLabel(value: number | null, isEnglish: boolean): string {
  if (value === null) return isEnglish ? "No data" : "Нет данных";
  if (value <= 10) return isEnglish ? "Critical" : "Критично";
  if (value <= 25) return isEnglish ? "Low" : "Мало";
  return isEnglish ? "Available" : "Доступно";
}

function candidateStateLabel(candidate: RankedSwitchCandidate, isEnglish: boolean): string {
  if (candidate.state === "ready") return isEnglish ? "Ready to switch" : "Готов к переключению";
  if (candidate.state === "needs_reauth") return isEnglish ? "Sign-in required" : "Нужен вход";
  if (candidate.reason === "refresh_failed") return isEnglish ? "Refresh failed" : "Сбой обновления";
  if (candidate.reason === "stale") return isEnglish ? "Snapshot expired" : "Снимок устарел";
  if (candidate.reason === "missing") return isEnglish ? "Refresh limits" : "Обновите лимиты";
  return isEnglish ? "Unavailable" : "Недоступен";
}

function sessionCopy(account: ManagedAccount, isEnglish: boolean): { title: string; body: string; tone: string } {
  if (account.credentialState === "ready") {
    return {
      title: isEnglish ? "Encrypted profile is saved" : "Зашифрованный профиль сохранён",
      body: isEnglish ? "The current session is copied to protected local storage every 30 seconds." : "Актуальная сессия сохраняется в локальное защищённое хранилище каждые 30 секунд.",
      tone: "ready"
    };
  }
  if (account.credentialState === "needs_reauth") {
    return {
      title: isEnglish ? "Saved profile retained" : "Сохранённый профиль не потерян",
      body: isEnglish ? "Codex requires sign-in again; the encrypted account record remains available." : "Codex запросил повторный вход, но зашифрованная запись аккаунта осталась в менеджере.",
      tone: "warning"
    };
  }
  return {
    title: isEnglish ? "Profile needs review" : "Профиль нужно проверить",
    body: isEnglish ? "The stored authorization was not overwritten by an ambiguous external change." : "Неоднозначное внешнее изменение не перезаписало сохранённую авторизацию.",
    tone: "warning"
  };
}

function transactionLabel(transaction: SwitchTransaction | null, isEnglish: boolean): string {
  if (!transaction) return isEnglish ? "No switch activity yet" : "Переключений пока не было";
  const labels: Record<SwitchTransaction["phase"], [string, string]> = {
    preparing: ["Preparing", "Подготовка"],
    validating_previous: ["Checking current profile", "Проверка текущего профиля"],
    validating_target: ["Checking target profile", "Проверка целевого профиля"],
    ready: ["Ready", "Готово"],
    quiescing: ["Closing Codex", "Закрытие Codex"],
    activating: ["Applying authorization", "Применение авторизации"],
    launching: ["Launching Codex", "Запуск Codex"],
    verifying: ["Verifying identity", "Проверка аккаунта"],
    committed: ["Switch verified", "Переключение подтверждено"],
    rolling_back: ["Restoring previous profile", "Возврат предыдущего профиля"],
    rolled_back: ["Previous profile restored", "Предыдущий профиль восстановлен"],
    aborted: ["Canceled safely", "Безопасно отменено"],
    failed: ["Switch failed", "Ошибка переключения"],
    recovery_required: ["Recovery required", "Требуется восстановление"]
  };
  return labels[transaction.phase][isEnglish ? 0 : 1];
}

function quotaCard(
  id: string,
  label: string,
  value: number | null,
  resetAt: number | null,
  now: number,
  isEnglish: boolean
) {
  const valueLabel = formatRemaining(value);
  const ariaLabel = value === null
    ? `${label}: ${isEnglish ? "data unavailable" : "данные недоступны"}`
    : `${label}: ${valueLabel} ${isEnglish ? "remaining" : "доступно"}`;
  return (
    <article className={`quota-card ${quotaTone(value)}`} key={id}>
      <header className="quota-card-head">
        <strong>{label}</strong>
        <span>{quotaStateLabel(value, isEnglish)}</span>
      </header>
      <div className="quota-card-visual">
        <div
          className="quota-ring"
          style={{ "--quota-value": `${value ?? 0}%` } as React.CSSProperties}
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value ?? undefined}
        >
          <strong>{valueLabel}</strong>
          <span>{isEnglish ? "left" : "остаток"}</span>
        </div>
        <div className="quota-copy">
          <span>{isEnglish ? "Next reset" : "Следующий сброс"}</span>
          <strong>{formatQuotaReset(resetAt, now, isEnglish)}</strong>
        </div>
      </div>
      <div className="quota-meter" aria-hidden="true"><i style={{ width: `${value ?? 0}%` }} /></div>
    </article>
  );
}

export function OverviewPage({
  accounts,
  diagnostics,
  latestTransaction,
  busy,
  autoRefreshIntervalMs,
  smartSwitchThresholdPercent,
  isEnglish,
  displayEmail,
  onAdd,
  onRefresh,
  onSwitch,
  onOpenAccounts,
  onOpenActivity
}: {
  accounts: ManagedAccount[];
  diagnostics: AppDiagnostics | null;
  latestTransaction: SwitchTransaction | null;
  busy: string | null;
  autoRefreshIntervalMs: number;
  smartSwitchThresholdPercent: number;
  isEnglish: boolean;
  displayEmail: (value: string) => string;
  onAdd: () => void;
  onRefresh: () => void;
  onSwitch: (accountId: string) => void;
  onOpenAccounts: () => void;
  onOpenActivity: () => void;
}) {
  const now = Math.floor(Date.now() / 1000);
  const active = accounts.find((account) => account.isActive) ?? null;
  const fiveHourRemaining = remaining(active?.fiveHourUsedPercent ?? null);
  const weeklyRemaining = remaining(active?.weeklyUsedPercent ?? null);
  const desktop = diagnostics?.desktopLifecycle;
  const protocolReady = diagnostics?.codexCapabilities?.protocol.compatible === true;
  const identityReady = Boolean(diagnostics?.codexCapabilities?.identity.authMode);
  const credentialStoreReady = diagnostics?.credentialStore?.managerCompatible === true;
  const environmentReady = desktop?.status === "ready" || desktop?.status === "running";
  const switchReady = environmentReady && protocolReady && credentialStoreReady && (accounts.length === 0 || identityReady);
  const transactionNeedsAttention = latestTransaction?.status === "recovery_required" || latestTransaction?.status === "failed";
  const activeSession = active ? sessionCopy(active, isEnglish) : null;
  const activeQuotaError = active?.lastRefreshError ?? null;
  const savedProfiles = accounts.filter((account) => account.credentialState === "ready").length;
  const freshProfiles = accounts.filter((account) =>
    !account.lastRefreshError
    && account.lastRefreshAt !== null
    && now - account.lastRefreshAt < 15 * 60
  ).length;
  const attentionProfiles = accounts.filter((account) =>
    account.credentialState !== "ready" || Boolean(account.lastRefreshError)
  ).length;
  const switchCandidates = rankSwitchCandidates(accounts, { now, staleAfterSeconds: 15 * 60 });
  const nextCandidate = switchCandidates.find((candidate) => candidate.state === "ready") ?? null;
  const visibleCandidates = switchCandidates.slice(0, 3);
  const activeKnownRemaining = [fiveHourRemaining, weeklyRemaining].filter((value): value is number => value !== null);
  const activeMinimumRemaining = activeKnownRemaining.length ? Math.min(...activeKnownRemaining) : null;
  const threshold = Math.max(5, Math.min(50, Math.round(smartSwitchThresholdPercent)));
  const activeNearThreshold = activeMinimumRemaining !== null && activeMinimumRemaining <= threshold;
  const autoRefreshLabel = autoRefreshIntervalMs === 0
    ? (isEnglish ? "off" : "выключено")
    : `${Math.round(autoRefreshIntervalMs / 60_000)} ${isEnglish ? "min" : "мин"}`;
  const transactionDuration = latestTransaction
    ? Math.max(0, (latestTransaction.completedAt ?? latestTransaction.updatedAt) - latestTransaction.createdAt)
    : null;
  const nextResetAt = [active?.fiveHourResetsAt ?? null, active?.weeklyResetsAt ?? null]
    .filter((value): value is number => value !== null && value > now)
    .sort((a, b) => a - b)[0] ?? null;

  return (
    <div className="v3-page overview-page overview-v304 overview-v306">
      <section className="overview-command-grid">
        <div className="overview-session-panel">
          <div className="overview-live-line">
            <span className="v3-kicker">{isEnglish ? "ACTIVE SESSION" : "АКТИВНАЯ СЕССИЯ"}</span>
            <span className={`overview-live-pill ${active ? "is-live" : ""}`}><span />{active ? (isEnglish ? "live" : "в работе") : (isEnglish ? "offline" : "нет входа")}</span>
          </div>
          {active ? (
            <>
              <div className="overview-account-title">
                <span className="account-orb" aria-hidden="true">{active.label.slice(0, 1).toUpperCase()}</span>
                <div>
                  <h2 title={active.label}>{active.label}</h2>
                  <p>
                    <span>{displayEmail(active.email)}</span>
                    <span className="plan-chip">{formatPlan(active.planType)}</span>
                  </p>
                </div>
              </div>
              <div className={`session-verification ${activeSession?.tone ?? "ready"}`}>
                <ShieldCheck />
                <span>
                  <strong>{activeSession?.title}</strong>
                  {activeSession?.body}
                </span>
              </div>
            </>
          ) : (
            <div className="overview-empty-account">
              <KeyRound />
              <div>
                <h2>{isEnglish ? "Connect your first Codex account" : "Подключите первый Codex-аккаунт"}</h2>
                <p>{isEnglish ? "Browser, device code, API key and enterprise token are supported." : "Доступны браузер, device code, API key и enterprise token."}</p>
              </div>
            </div>
          )}
          <div className="overview-actions">
            {active ? (
              <button className="button" onClick={onOpenAccounts}>
                {isEnglish ? "Accounts" : "Аккаунты"}<ArrowRight />
              </button>
            ) : (
              <button className="button" disabled={busy !== null} onClick={onAdd}><KeyRound />{isEnglish ? "Add account" : "Добавить аккаунт"}</button>
            )}
            <button className="button secondary" disabled={busy !== null || accounts.length === 0} onClick={onRefresh}>
              {busy === "refresh:all" ? <RefreshCcw className="spin" /> : <RefreshCcw />}
              {isEnglish ? "Refresh" : "Обновить"}
            </button>
            <button className="button ghost-button" onClick={onOpenActivity}>{isEnglish ? "History" : "История"}</button>
          </div>
        </div>

        <div className="overview-quota-panel" aria-label={isEnglish ? "Active account limits" : "Лимиты активного аккаунта"}>
          <div className="overview-data-orbit" aria-hidden="true"><span /><span /><span /></div>
          <div className="quota-stage-heading">
            <div>
              <span className="v3-kicker">{isEnglish ? "ACCOUNT LIMITS" : "ЛИМИТЫ АККАУНТА"}</span>
              <strong>{isEnglish ? "Current available quota" : "Текущий доступный запас"}</strong>
            </div>
            <span className={activeQuotaError ? "has-refresh-error" : ""}>{activeQuotaError ? (isEnglish ? "Refresh failed · showing saved snapshot" : "Сбой обновления · показан сохранённый снимок") : formatLastRefresh(active?.lastRefreshAt ?? null, now, isEnglish)}</span>
          </div>
          <div className="quota-grid">
            {quotaCard("five-hour", isEnglish ? "5 hours" : "5 часов", fiveHourRemaining, active?.fiveHourResetsAt ?? null, now, isEnglish)}
            {quotaCard("weekly", isEnglish ? "Week" : "Неделя", weeklyRemaining, active?.weeklyResetsAt ?? null, now, isEnglish)}
          </div>
          <div className="quota-refresh-line">
            <RefreshCcw />
            <span>{isEnglish ? "Background refresh" : "Фоновое обновление"}</span>
            <strong>{autoRefreshLabel}</strong>
            <i>{activeQuotaError ? (isEnglish ? "last good snapshot kept" : "последний снимок сохранён") : (isEnglish ? "official app-server" : "официальный app-server")}</i>
          </div>
        </div>
      </section>

      <section className="overview-signal-strip" aria-label={isEnglish ? "Control plane status" : "Состояние системы"}>
        <div><Layers3 /><span>{isEnglish ? "Profiles" : "Профили"}</span><strong>{accounts.length}</strong></div>
        <div><ShieldCheck /><span>{isEnglish ? "Protected sign-ins" : "Вход сохранён"}</span><strong>{savedProfiles} {isEnglish ? `of ${accounts.length}` : `из ${accounts.length}`}</strong></div>
        <div className={attentionProfiles ? "is-warning" : "is-ready"}><RefreshCcw /><span>{isEnglish ? "Fresh quotas" : "Свежие лимиты"}</span><strong>{freshProfiles} {isEnglish ? `of ${accounts.length}` : `из ${accounts.length}`}</strong></div>
        <div className={switchReady ? "is-ready" : "is-warning"}>{switchReady ? <CheckCircle2 /> : <TriangleAlert />}<span>{isEnglish ? "Switch chain" : "Переключение"}</span><strong>{switchReady ? (isEnglish ? "Ready" : "Готово") : (isEnglish ? "Review" : "Проверить")}</strong></div>
        <div><Clock3 /><span>{isEnglish ? "Quota refresh" : "Обновление лимитов"}</span><strong>{autoRefreshLabel}</strong></div>
      </section>

      <section className="overview-secondary-grid">
        <article className={`overview-recommendation overview-continuation ${activeNearThreshold ? "is-urgent" : ""}`}>
          <header className="continuation-head">
            <span className="recommendation-icon"><Sparkles /></span>
            <div>
              <span className="v3-kicker">{isEnglish ? "CONTINUATION PLAN" : "ПЛАН ПРОДОЛЖЕНИЯ"}</span>
              <h3>
                {nextCandidate
                  ? (activeNearThreshold
                    ? (isEnglish ? "A backup profile is ready now" : "Резерв готов к переключению")
                    : (isEnglish ? "The next profile is ready in advance" : "Следующий профиль готов заранее"))
                  : (switchCandidates.length
                    ? (isEnglish ? "Backup profiles need attention" : "Резервные профили требуют внимания")
                    : (isEnglish ? "Add a backup profile" : "Добавьте резервный профиль"))}
              </h3>
            </div>
            <span className={`continuation-state ${nextCandidate ? "is-ready" : "is-warning"}`}>
              {nextCandidate ? <CheckCircle2 /> : <TriangleAlert />}
              {nextCandidate ? (isEnglish ? "ready" : "готов") : (isEnglish ? "review" : "проверить")}
            </span>
          </header>

          <div className="handoff-lane" aria-label={isEnglish ? "Account continuation route" : "Маршрут продолжения"}>
            <div>
              <span>{isEnglish ? "Now" : "Сейчас"}</span>
              <strong title={active?.label}>{active?.label ?? (isEnglish ? "No active profile" : "Нет активного профиля")}</strong>
              <small>{activeMinimumRemaining === null ? (isEnglish ? "quota unknown" : "лимиты неизвестны") : `${activeMinimumRemaining}% ${isEnglish ? "minimum left" : "минимальный остаток"}`}</small>
            </div>
            <span className="handoff-arrow"><ArrowRight /></span>
            <div className={nextCandidate ? "is-ready" : "is-warning"}>
              <span>{isEnglish ? "Next" : "Следующий"}</span>
              <strong title={nextCandidate?.account.label}>{nextCandidate?.account.label ?? (isEnglish ? "Not selected" : "Не выбран")}</strong>
              <small>{nextCandidate?.remainingPercent !== null && nextCandidate?.remainingPercent !== undefined
                ? `${nextCandidate.remainingPercent}% ${isEnglish ? "minimum reserve" : "минимальный запас"}`
                : (isEnglish ? "fresh quota data required" : "нужны свежие лимиты")}</small>
            </div>
            <span className="handoff-rule">≤ {threshold}%<small>{isEnglish ? "suggestion threshold" : "порог рекомендации"}</small></span>
          </div>

          {visibleCandidates.length > 0 ? (
            <div className="continuation-queue" aria-label={isEnglish ? "Backup profile readiness" : "Готовность резервных профилей"}>
              {visibleCandidates.map((candidate, index) => (
                <div className={`continuation-row is-${candidate.state}`} key={candidate.account.id}>
                  <span className="queue-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="queue-account"><b title={candidate.account.label}>{candidate.account.label}</b><small>{formatPlan(candidate.account.planType)}</small></span>
                  <span className="queue-state">{candidateStateLabel(candidate, isEnglish)}</span>
                  <strong>{candidate.remainingPercent === null ? "—" : `${candidate.remainingPercent}%`}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="continuation-empty">{isEnglish ? "A second protected Codex sign-in will appear here." : "Здесь появится второй защищённый вход Codex."}</p>
          )}

          <div className="continuation-guardrails" aria-label={isEnglish ? "Switch safety policy" : "Правила безопасного переключения"}>
            <div><Zap /><span>{isEnglish ? "Mode" : "Режим"}</span><strong>{isEnglish ? "Suggestion only" : "Только рекомендация"}</strong></div>
            <div><Clock3 /><span>{isEnglish ? "Safe point" : "Безопасная точка"}</span><strong>{isEnglish ? "After the current step" : "После текущего шага"}</strong></div>
            <div><ShieldCheck /><span>{isEnglish ? "Protection" : "Защита"}</span><strong>{isEnglish ? "Verify + rollback" : "Проверка + откат"}</strong></div>
          </div>

          <footer className="continuation-foot">
            <span>{isEnglish ? "The manager only suggests a switch; it never changes the account without confirmation." : "Менеджер только предлагает смену и не переключает аккаунт без подтверждения."}</span>
            {nextCandidate ? (
              <button className="button recommendation-action" disabled={busy !== null} onClick={() => onSwitch(nextCandidate.account.id)}>
                <Zap />{isEnglish ? "Switch now" : "Переключить"}
              </button>
            ) : switchCandidates.length ? (
              <button className="button secondary recommendation-action" disabled={busy !== null} onClick={onRefresh}>
                <RefreshCcw />{isEnglish ? "Refresh" : "Обновить"}
              </button>
            ) : (
              <button className="button secondary recommendation-action" onClick={onOpenAccounts}>
                {isEnglish ? "Accounts" : "Аккаунты"}<ArrowRight />
              </button>
            )}
          </footer>
        </article>

        <article className={`overview-operation ${transactionNeedsAttention ? "needs-attention" : ""}`}>
          <div className="overview-operation-head">
            <span className={transactionNeedsAttention ? "is-warning" : "is-ready"}>{transactionNeedsAttention ? <TriangleAlert /> : <Activity />}</span>
            <div><span className="v3-kicker">{isEnglish ? "LAST OPERATION" : "ПОСЛЕДНЯЯ ОПЕРАЦИЯ"}</span><h3>{transactionLabel(latestTransaction, isEnglish)}</h3></div>
          </div>
          <div className="operation-meta">
            <span><Clock3 />{transactionDuration === null ? "—" : `${transactionDuration} ${isEnglish ? "sec" : "с"}`}</span>
            <span><ShieldCheck />{isEnglish ? `${savedProfiles} protected` : `${savedProfiles} защищено`}</span>
          </div>
          <p>{latestTransaction?.errorMessage ?? (isEnglish ? "Every switch is verified and can be rolled back." : "Каждое переключение проверяется и допускает безопасный откат.")}</p>
          <div className="overview-operation-route" aria-label={isEnglish ? "Verified switch route" : "Проверенный маршрут переключения"}>
            <span><i>1</i><b>{isEnglish ? "Snapshot" : "Снимок"}</b><small>{isEnglish ? "DPAPI vault" : "DPAPI vault"}</small></span>
            <span><i>2</i><b>{isEnglish ? "Restart" : "Перезапуск"}</b><small>{isEnglish ? "Exact Codex tree" : "Точное дерево Codex"}</small></span>
            <span><i>3</i><b>{isEnglish ? "Identity" : "Личность"}</b><small>{isEnglish ? "Account verified" : "Аккаунт подтверждён"}</small></span>
          </div>
          <div className="overview-operation-signals" aria-label={isEnglish ? "Operational readiness" : "Готовность системы"}>
            <div className={savedProfiles === accounts.length ? "is-ready" : "is-warning"}><ShieldCheck /><span>{isEnglish ? "Saved sign-ins" : "Сохранённые входы"}</span><strong>{savedProfiles}/{accounts.length}</strong></div>
            <div className={freshProfiles === accounts.length ? "is-ready" : "is-warning"}><RefreshCcw /><span>{isEnglish ? "Fresh profiles" : "Свежие профили"}</span><strong>{freshProfiles}/{accounts.length}</strong></div>
            <div className={protocolReady ? "is-ready" : "is-warning"}><CheckCircle2 /><span>App-server</span><strong>{protocolReady ? (isEnglish ? "Ready" : "Готов") : (isEnglish ? "Review" : "Проверить")}</strong></div>
            <div><Clock3 /><span>{isEnglish ? "Next reset" : "Ближайший сброс"}</span><strong>{formatQuotaReset(nextResetAt, now, isEnglish)}</strong></div>
          </div>
          <div className="operation-foot">
            <div className="persistence-tags"><span>DPAPI</span><span>Rollback</span><span>{isEnglish ? "Local" : "Локально"}</span></div>
            <button className="text-action" onClick={onOpenActivity}>{isEnglish ? "Open journal" : "Открыть журнал"}<ArrowRight /></button>
          </div>
        </article>
      </section>

      {!switchReady && diagnostics ? (
        <section className="overview-attention-bar">
          <TriangleAlert />
          <span>{!credentialStoreReady ? (isEnglish ? "Codex must use file credentials before switching." : "Для переключения Codex должен использовать файловое хранение входа.") : (isEnglish ? "One of the switch-chain checks needs attention." : "Одна из проверок цепочки переключения требует внимания.")}</span>
          <strong>{formatCredentialStore(diagnostics.credentialStore, isEnglish)} · {desktop?.selected?.version ? `Codex ${desktop.selected.version}` : "Codex —"}</strong>
        </section>
      ) : null}
    </div>
  );
}
