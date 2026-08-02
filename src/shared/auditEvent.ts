import { maskAccountIdentifier, redactSensitiveText } from "./redaction.js";
import type { AccountPlatform, SwitchHistoryItem } from "./types.js";

export type AuditEventKind = "auth" | "export" | "import" | "refresh" | "restart" | "switch";
export type AuditEventTone = "completed" | "failed" | "running" | "warning";

export interface AuditEventView {
  kind: AuditEventKind;
  title: string;
  subject: string;
  statusLabel: string;
  tone: AuditEventTone;
  timestamp: number;
  detail: string | null;
}

export interface AuditEventInput {
  kind: AuditEventKind;
  provider?: AccountPlatform | null;
  accountId?: string | null;
  accountLabel?: string | null;
  accountEmail?: string | null;
  status: string;
  timestamp: number;
  detail?: string | null;
}

const eventTitles: Record<AuditEventKind, string> = {
  auth: "Проверка входа",
  export: "Экспорт",
  import: "Импорт",
  refresh: "Обновление лимитов",
  restart: "Перезапуск интеграции",
  switch: "Переключение аккаунта"
};

const providerLabels: Record<AccountPlatform, string> = {
  antigravity: "Antigravity",
  codex: "Codex"
};

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: "активен",
    authorized: "авторизован",
    completed: "готово",
    expired: "истёк срок",
    failed: "ошибка",
    imported: "импортировано",
    limited: "лимит",
    needs_reauth: "нужен вход",
    revoked: "отозван",
    rolled_back: "откат",
    running: "в процессе",
    skipped: "пропущено",
    success: "готово",
    validation_failed: "проверка не удалась"
  };
  return labels[status] ?? status;
}

function toneForStatus(status: string): AuditEventTone {
  if (["failed", "error", "validation_failed", "revoked", "expired"].includes(status)) return "failed";
  if (["needs_reauth", "limited", "near_limit", "skipped"].includes(status)) return "warning";
  if (["running", "pending"].includes(status)) return "running";
  return "completed";
}

function maskAuditEmail(value: string): string {
  return redactSensitiveText(value);
}

function subjectFor(input: AuditEventInput): string {
  const parts: string[] = [];
  if (input.provider) parts.push(providerLabels[input.provider]);
  if (input.accountLabel) parts.push(input.accountLabel);
  else if (input.accountEmail) parts.push(maskAuditEmail(input.accountEmail));
  else if (input.accountId) parts.push(maskAccountIdentifier(input.accountId));
  else parts.push("аккаунт не выбран");
  return parts.join(" · ");
}

export function buildAuditEventView(input: AuditEventInput): AuditEventView {
  return {
    kind: input.kind,
    title: eventTitles[input.kind],
    subject: subjectFor(input),
    statusLabel: statusLabel(input.status),
    tone: toneForStatus(input.status),
    timestamp: input.timestamp,
    detail: input.detail ? redactSensitiveText(input.detail) : null
  };
}

export function buildSwitchAuditEventView(event: SwitchHistoryItem): AuditEventView {
  return buildAuditEventView({
    kind: "switch",
    accountId: event.accountId,
    accountLabel: event.accountLabel,
    accountEmail: event.accountEmail,
    status: event.status,
    timestamp: event.startedAt,
    detail: event.error
  });
}
