import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  Clock3,
  KeyRound,
  Rocket,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
  XCircle
} from "lucide-react";
import type { ManagedAccount, SwitchHistoryItem, SwitchTransaction, SwitchTransactionPhase } from "../../../shared/types";

type ActivityFilter = "all" | "success" | "rollback" | "error";

function pluralRu(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const phaseLabels: Record<SwitchTransactionPhase, [string, string]> = {
  preparing: ["Prepare", "Подготовка"],
  validating_previous: ["Validate current", "Проверка текущего"],
  validating_target: ["Validate target", "Проверка целевого"],
  ready: ["Ready", "Готово"],
  quiescing: ["Close Codex", "Закрытие Codex"],
  activating: ["Apply authorization", "Применение входа"],
  launching: ["Launch Codex", "Запуск Codex"],
  verifying: ["Verify identity", "Проверка аккаунта"],
  committed: ["Committed", "Подтверждено"],
  rolling_back: ["Rolling back", "Выполняется откат"],
  rolled_back: ["Restored", "Восстановлено"],
  aborted: ["Canceled", "Отменено"],
  failed: ["Failed", "Ошибка"],
  recovery_required: ["Recovery required", "Нужно восстановление"]
};

const compactStages = [
  {
    id: "validate",
    labels: ["Check profiles", "Проверить профили"],
    descriptions: ["Current and target identity", "Текущий и целевой аккаунт"],
    phases: ["preparing", "validating_previous", "validating_target", "ready"] as SwitchTransactionPhase[],
    icon: ShieldCheck
  },
  {
    id: "apply",
    labels: ["Apply sign-in", "Применить вход"],
    descriptions: ["Backup and atomic auth swap", "Резервная копия и замена auth"],
    phases: ["quiescing", "activating"] as SwitchTransactionPhase[],
    icon: KeyRound
  },
  {
    id: "launch",
    labels: ["Launch Codex", "Запустить Codex"],
    descriptions: ["Clean Desktop restart", "Чистый перезапуск Desktop"],
    phases: ["launching"] as SwitchTransactionPhase[],
    icon: Rocket
  },
  {
    id: "verify",
    labels: ["Confirm account", "Подтвердить аккаунт"],
    descriptions: ["Identity check or rollback", "Проверка identity или откат"],
    phases: ["verifying", "committed"] as SwitchTransactionPhase[],
    icon: BadgeCheck
  }
];

function formatTime(value: number | null, isEnglish: boolean): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(isEnglish ? "en-US" : "ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value * 1000));
}

function formatDuration(transaction: SwitchTransaction, isEnglish: boolean): string {
  const seconds = Math.max(0, (transaction.completedAt ?? transaction.updatedAt) - transaction.createdAt);
  if (seconds < 60) return `${seconds} ${isEnglish ? "sec" : "с"}`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes} ${isEnglish ? "min" : "мин"}${remainder ? ` ${remainder} ${isEnglish ? "sec" : "с"}` : ""}`;
}

function statusIcon(transaction: SwitchTransaction) {
  if (transaction.status === "committed") return <CheckCircle2 />;
  if (transaction.status === "rolled_back") return <RotateCcw />;
  if (transaction.status === "failed" || transaction.status === "recovery_required") return <ShieldAlert />;
  if (transaction.status === "aborted") return <XCircle />;
  return <Clock3 />;
}

function transactionTone(transaction: SwitchTransaction): string {
  if (transaction.status === "committed") return "success";
  if (transaction.status === "rolled_back" || transaction.status === "aborted") return "neutral";
  if (transaction.status === "failed" || transaction.status === "recovery_required") return "danger";
  return "running";
}

function statusLabel(transaction: SwitchTransaction, isEnglish: boolean): string {
  const labels: Record<SwitchTransaction["status"], [string, string]> = {
    pending: ["Ready", "Готово"],
    running: ["In progress", "В процессе"],
    rolling_back: ["Rolling back", "Откат"],
    committed: ["Verified", "Подтверждено"],
    rolled_back: ["Restored", "Восстановлено"],
    aborted: ["Canceled", "Отменено"],
    failed: ["Failed", "Ошибка"],
    recovery_required: ["Recovery required", "Нужно восстановление"]
  };
  return labels[transaction.status][isEnglish ? 0 : 1];
}

export function verificationSummary(transaction: SwitchTransaction, isEnglish: boolean): string {
  if (transaction.status === "committed") return isEnglish ? "All checks completed" : "Все проверки завершены";
  if (transaction.status === "rolled_back") return isEnglish ? "Previous session restored" : "Предыдущая сессия восстановлена";
  if (transaction.status === "recovery_required") return isEnglish ? "Manual recovery required" : "Требуется восстановление";
  return phaseLabels[transaction.phase][isEnglish ? 0 : 1];
}

function matchesFilter(transaction: SwitchTransaction, filter: ActivityFilter): boolean {
  if (filter === "all") return true;
  if (filter === "success") return transaction.status === "committed";
  if (filter === "rollback") return transaction.status === "rolled_back" || transaction.status === "aborted";
  return transaction.status === "failed" || transaction.status === "recovery_required";
}

export function ActivityPage({
  transactions,
  history,
  accounts,
  isEnglish,
  onOpenSettings
}: {
  transactions: SwitchTransaction[];
  history: SwitchHistoryItem[];
  accounts: ManagedAccount[];
  isEnglish: boolean;
  onOpenSettings: () => void;
}) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const latest = transactions[0] ?? null;
  const needsRecovery = latest?.status === "recovery_required";
  const completed = transactions.filter((item) => ["committed", "rolled_back", "aborted", "failed", "recovery_required"].includes(item.status));
  const successful = completed.filter((item) => item.status === "committed").length;
  const recovered = completed.filter((item) => item.status === "rolled_back").length;
  const problems = completed.filter((item) => item.status === "failed" || item.status === "recovery_required").length;
  const successRate = completed.length ? Math.round((successful / completed.length) * 100) : null;
  const averageDuration = completed.length
    ? Math.round(completed.reduce((sum, item) => sum + Math.max(0, (item.completedAt ?? item.updatedAt) - item.createdAt), 0) / completed.length)
    : null;
  const visibleTransactions = useMemo(() => transactions.filter((item) => matchesFilter(item, filter)), [filter, transactions]);
  const accountLabel = (id: string | null) => {
    if (!id) return isEnglish ? "External session" : "Внешняя сессия";
    return accounts.find((account) => account.id === id)?.label ?? id.slice(0, 8);
  };
  const latestPreviousLabel = latest ? accountLabel(latest.previousAccountId) : null;
  const latestTargetLabel = latest ? accountLabel(latest.targetAccountId) : null;
  const activeStageIndex = latest
    ? compactStages.findIndex((stage) => stage.phases.includes(latest.phase))
    : -1;
  const latestTerminal = latest ? ["committed", "rolled_back", "aborted", "failed", "recovery_required"].includes(latest.status) : false;

  const filters: Array<{ id: ActivityFilter; labels: [string, string]; count: number }> = [
    { id: "all", labels: ["All", "Все"], count: transactions.length },
    { id: "success", labels: ["Verified", "Успех"], count: successful },
    { id: "rollback", labels: ["Rollback", "Откат"], count: recovered },
    { id: "error", labels: ["Attention", "Сбой"], count: problems }
  ];

  return (
    <div className="v3-page activity-page activity-v304 activity-v306">
      <section className={`activity-command ${needsRecovery ? "needs-recovery" : ""}`} aria-live="polite">
        <div className="activity-command-main">
          <div className="activity-command-title">
            <span className={`activity-signal ${latest ? transactionTone(latest) : "neutral"}`}>{latest ? statusIcon(latest) : <Activity />}</span>
            <div>
              <span className="v3-kicker">{isEnglish ? "LATEST SWITCH" : "ПОСЛЕДНЕЕ ПЕРЕКЛЮЧЕНИЕ"}</span>
              <h2>{latest ? statusLabel(latest, isEnglish) : (isEnglish ? "Journal is ready" : "Журнал готов")}</h2>
              {latest ? (
                <p className="activity-account-route">
                  <bdi title={latestPreviousLabel ?? undefined}>{latestPreviousLabel}</bdi>
                  <ArrowRight aria-hidden="true" />
                  <bdi title={latestTargetLabel ?? undefined}>{latestTargetLabel}</bdi>
                </p>
              ) : <p>{isEnglish ? "Verified switches and recovery events will appear here." : "Здесь появятся проверенные переключения и события восстановления."}</p>}
            </div>
          </div>
          {latest ? (
            <div className="activity-latest-meta">
              <span><Clock3 />{formatTime(latest.createdAt, isEnglish)}</span>
              <span><TimerReset />{formatDuration(latest, isEnglish)}</span>
              <code>#{latest.id.slice(0, 8)}</code>
            </div>
          ) : null}
        </div>

        <div className="activity-kpis">
          <div><strong>{successRate === null ? "—" : `${successRate}%`}</strong><span>{isEnglish ? "successful operations" : "успешных операций"}</span></div>
          <div><strong>{averageDuration === null ? "—" : `${averageDuration}${isEnglish ? "s" : " с"}`}</strong><span>{isEnglish ? "average duration" : "среднее время"}</span></div>
          <div className={recovered ? "is-warning" : ""}><strong>{recovered}</strong><span>{isEnglish ? "safe rollbacks" : pluralRu(recovered, "безопасный откат", "безопасных отката", "безопасных откатов")}</span></div>
          <div className={problems ? "is-danger" : ""}><strong>{problems}</strong><span>{isEnglish ? "need attention" : problems === 1 ? "требует внимания" : "требуют внимания"}</span></div>
        </div>
      </section>

      {latest ? (
        <section className="activity-route" aria-label={isEnglish ? "Switch progress" : "Ход переключения"}>
          <div className="activity-route-head">
            <div>
              <span className="v3-kicker">{isEnglish ? "SAFE SWITCH ROUTE" : "ЗАЩИТА ПЕРЕКЛЮЧЕНИЯ"}</span>
              <strong>{verificationSummary(latest, isEnglish)}</strong>
              <p>{isEnglish ? "Four checks prevent Codex from starting with the wrong account." : "Четыре этапа не дают Codex запуститься с чужим или повреждённым входом."}</p>
            </div>
            <span className={`transaction-state ${transactionTone(latest)}`}>{statusIcon(latest)}{statusLabel(latest, isEnglish)}</span>
          </div>
          <div className="compact-stepper switch-safety-route">
            {compactStages.map((stage, index) => {
              const complete = latest.status === "committed" || index < activeStageIndex;
              const current = !latestTerminal && index === activeStageIndex;
              const restored = latest.status === "rolled_back" && index === 1;
              const failed = (latest.status === "failed" || latest.status === "recovery_required")
                && index === (activeStageIndex >= 0 ? activeStageIndex : 3);
              const StageIcon = stage.icon;
              return (
                <div key={stage.id} className={`switch-stage ${complete ? "is-complete" : ""} ${current ? "is-current" : ""} ${restored ? "is-restored" : ""} ${failed ? "is-failed" : ""}`} aria-current={current ? "step" : undefined}>
                  <span className="switch-stage-marker">{complete ? <CheckCircle2 /> : restored ? <RotateCcw /> : <StageIcon />}</span>
                  <div className="switch-stage-copy">
                    <strong>{stage.labels[isEnglish ? 0 : 1]}</strong>
                    <small>{stage.descriptions[isEnglish ? 0 : 1]}</small>
                  </div>
                </div>
              );
            })}
          </div>
          {latest.errorMessage ? <div className="activity-error"><ShieldAlert /><span><strong>{latest.errorCode ?? statusLabel(latest, isEnglish)}</strong>{latest.errorMessage}</span>{needsRecovery ? <button className="button recovery-action" onClick={onOpenSettings}>{isEnglish ? "Diagnostics" : "Диагностика"}<ArrowRight /></button> : null}</div> : null}
        </section>
      ) : null}

      <section className="activity-journal">
        <header className="activity-journal-head">
          <div><span className="v3-kicker">{isEnglish ? "HISTORY AND AUDIT" : "ИСТОРИЯ И АУДИТ"}</span><h3>{isEnglish ? "Switch history" : "История переключений"}</h3><p>{isEnglish ? `${transactions.length} operations · ${history.length} audit records` : `${transactions.length} ${pluralRu(transactions.length, "операция", "операции", "операций")} · ${history.length} ${pluralRu(history.length, "запись аудита", "записи аудита", "записей аудита")}`}</p></div>
          <div className="activity-filters" aria-label={isEnglish ? "Journal filter" : "Фильтр журнала"}>
            {filters.map((item) => <button key={item.id} aria-pressed={filter === item.id} className={filter === item.id ? "is-selected" : ""} onClick={() => setFilter(item.id)}>{item.labels[isEnglish ? 0 : 1]}<span>{item.count}</span></button>)}
          </div>
        </header>
        <div className="activity-timeline">
          {visibleTransactions.length === 0 ? (
            <div className="activity-empty"><ShieldCheck /><strong>{filter === "all" ? (isEnglish ? "No operations yet" : "Операций пока нет") : (isEnglish ? "Nothing in this category" : "В этой категории событий нет")}</strong><span>{isEnglish ? "The journal keeps only verified local facts." : "Журнал показывает только проверенные локальные факты."}</span></div>
          ) : visibleTransactions.map((transaction) => (
            <details className={`timeline-event ${transactionTone(transaction)}`} key={transaction.id}>
              <summary>
                <span className={`activity-row-icon ${transactionTone(transaction)}`}>{statusIcon(transaction)}</span>
                <div className="timeline-route">
                  <strong className="timeline-account-route">
                    <bdi title={accountLabel(transaction.previousAccountId)}>{accountLabel(transaction.previousAccountId)}</bdi>
                    <ArrowRight aria-hidden="true" />
                    <bdi title={accountLabel(transaction.targetAccountId)}>{accountLabel(transaction.targetAccountId)}</bdi>
                  </strong>
                  <span>{phaseLabels[transaction.phase][isEnglish ? 0 : 1]} · {formatTime(transaction.updatedAt, isEnglish)}</span>
                </div>
                <span className={`timeline-status ${transactionTone(transaction)}`}>{statusLabel(transaction, isEnglish)}</span>
                <span className="timeline-duration">{formatDuration(transaction, isEnglish)}</span>
                <ChevronDown className="timeline-chevron" />
              </summary>
              <div className="timeline-details">
                <span><b>{isEnglish ? "Transaction" : "Транзакция"}</b><code>{transaction.id}</code></span>
                <span><b>{isEnglish ? "Technical phase" : "Техническая фаза"}</b><code>{transaction.phase}</code></span>
                <span><b>{isEnglish ? "Result" : "Результат"}</b>{transaction.errorMessage ?? (isEnglish ? "Identity verified; active marker committed." : "Личность проверена; активный профиль зафиксирован.")}</span>
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
