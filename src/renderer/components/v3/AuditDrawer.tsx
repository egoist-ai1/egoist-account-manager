import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  KeyRound,
  Rocket,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle
} from "lucide-react";
import type { ManagedAccount, SwitchHistoryItem, SwitchTransaction, SwitchTransactionPhase } from "../../../shared/types";
import { verificationSummary } from "./ActivityPage";

type ActivityFilter = "all" | "success" | "rollback" | "error";

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
  if (!value) return "-";
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
  if (transaction.status === "committed") return <CheckCircle2 size={16} />;
  if (transaction.status === "rolled_back") return <RotateCcw size={16} />;
  if (transaction.status === "failed" || transaction.status === "recovery_required") return <ShieldAlert size={16} />;
  if (transaction.status === "aborted") return <XCircle size={16} />;
  return <Clock3 size={16} />;
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

function matchesFilter(transaction: SwitchTransaction, filter: ActivityFilter): boolean {
  if (filter === "all") return true;
  if (filter === "success") return transaction.status === "committed";
  if (filter === "rollback") return transaction.status === "rolled_back" || transaction.status === "aborted";
  return transaction.status === "failed" || transaction.status === "recovery_required";
}

export interface AuditDrawerProps {
  open: boolean;
  onClose: () => void;
  transactions: SwitchTransaction[];
  history?: SwitchHistoryItem[];
  accounts: ManagedAccount[];
  isEnglish: boolean;
  displayEmail?: (email: string) => string;
}

export function AuditDrawer({
  open,
  onClose,
  transactions,
  accounts,
  isEnglish,
  displayEmail = (e) => e
}: AuditDrawerProps) {
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const successful = transactions.filter((item) => item.status === "committed").length;
  const recovered = transactions.filter((item) => item.status === "rolled_back").length;
  const problems = transactions.filter((item) => item.status === "failed" || item.status === "recovery_required").length;

  const visibleTransactions = useMemo(() => transactions.filter((item) => matchesFilter(item, filter)), [filter, transactions]);

  const accountLabel = (id: string | null) => {
    if (!id) return isEnglish ? "External session" : "Внешняя сессия";
    return accounts.find((account) => account.id === id)?.label ?? id.slice(0, 8);
  };

  const accountEmail = (id: string | null) => {
    if (!id) return "";
    const acct = accounts.find((account) => account.id === id);
    return acct ? displayEmail(acct.email) : "";
  };

  if (!open) return null;

  return (
    <div className="audit-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={isEnglish ? "Switch Audit Journal" : "Журнал аудита переключений"}>
      <aside className="audit-drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="audit-drawer-header">
          <div className="audit-drawer-title-group">
            <span className="audit-drawer-icon-wrap">
              <Activity size={18} />
            </span>
            <div>
              <h3>{isEnglish ? "Switch Audit Journal" : "Журнал аудита"}</h3>
              <p>{isEnglish ? "Verified transactions and session rollback safety" : "Подтверждённые транзакции и безопасность отката"}</p>
            </div>
          </div>
          <button className="icon-btn audit-close-btn" onClick={onClose} aria-label={isEnglish ? "Close journal" : "Закрыть журнал"}>
            <X size={18} />
          </button>
        </div>

        {/* Safety 4-stage banner */}
        <div className="audit-safety-summary">
          <div className="audit-safety-header">
            <ShieldCheck size={16} />
            <strong>{isEnglish ? "Four-stage safety prevents Codex from launching unverified" : "Четыре этапа не дают Codex запуститься"}</strong>
          </div>
          <div className="switch-stage-copy">
            <span>{isEnglish ? "Current and target identity verification, atomic backup and safe rollback." : "Резервная копия и замена auth с гарантированным откатом при сбое."}</span>
          </div>
          <div className="audit-stages-mini-grid">
            {compactStages.map((stage) => {
              const Icon = stage.icon;
              const label = stage.labels[isEnglish ? 0 : 1];
              const desc = stage.descriptions[isEnglish ? 0 : 1];
              return (
                <div key={stage.id} className="audit-mini-stage" title={`${label}: ${desc}`}>
                  <Icon size={12} />
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Filter Pills */}
        <div className="audit-filter-bar">
          <button className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
            <span>{isEnglish ? "All" : "Все"}</span>
            <small>{transactions.length}</small>
          </button>
          <button className={filter === "success" ? "is-active" : ""} onClick={() => setFilter("success")}>
            <span>{isEnglish ? "Verified" : "Успех"}</span>
            <small>{successful}</small>
          </button>
          <button className={filter === "rollback" ? "is-active" : ""} onClick={() => setFilter("rollback")}>
            <span>{isEnglish ? "Rollback" : "Откат"}</span>
            <small>{recovered}</small>
          </button>
          <button className={filter === "error" ? "is-active" : ""} onClick={() => setFilter("error")}>
            <span>{isEnglish ? "Attention" : "Сбой"}</span>
            <small>{problems}</small>
          </button>
        </div>

        {/* Transactions List */}
        <div className="audit-drawer-list">
          {visibleTransactions.length > 0 ? (
            visibleTransactions.map((tx) => (
              <div key={tx.id} className={`audit-tx-card is-${tx.status}`}>
                <div className="audit-tx-top">
                  <div className="audit-tx-status">
                    <span className={`audit-status-badge is-${tx.status}`}>
                      {statusIcon(tx)}
                      <span>{statusLabel(tx, isEnglish)}</span>
                    </span>
                    <span className="audit-tx-platform">{tx.platform === "antigravity" ? "Antigravity" : "Codex"}</span>
                  </div>
                  <div className="audit-tx-timing">
                    <span>{formatTime(tx.completedAt ?? tx.createdAt, isEnglish)}</span>
                    <small>{formatDuration(tx, isEnglish)}</small>
                  </div>
                </div>

                <div className="audit-tx-route">
                  <div className="audit-route-account">
                    <span className="audit-route-tag">{isEnglish ? "from" : "из"}</span>
                    <strong>{accountLabel(tx.previousAccountId)}</strong>
                  </div>
                  <ArrowRight size={14} className="audit-route-arrow" />
                  <div className="audit-route-account is-target">
                    <span className="audit-route-tag">{isEnglish ? "to" : "в"}</span>
                    <strong>{accountLabel(tx.targetAccountId)}</strong>
                    {accountEmail(tx.targetAccountId) && (
                      <small>{accountEmail(tx.targetAccountId)}</small>
                    )}
                  </div>
                </div>

                <div className="audit-tx-summary">
                  <span>{verificationSummary(tx, isEnglish)}</span>
                  {tx.errorMessage && (
                    <p className="audit-tx-error">{tx.errorMessage}</p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="audit-empty-state">
              <Activity size={32} />
              <strong>{isEnglish ? "No audit records found" : "Записей аудита пока нет"}</strong>
              <p>{isEnglish ? "Transactions will appear here when profiles are switched." : "Здесь будут отображаться отчёты о переключениях и проверке сессий."}</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
