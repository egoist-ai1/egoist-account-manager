import { pathToFileURL } from "node:url";
import type { AuthEvent, SwitchTransaction } from "../../shared/types.js";
import type { QuotaAlert } from "./quotaAlertService.js";

export type DesktopNotificationTone = "progress" | "success" | "warning" | "error";

export interface DesktopNotificationPayload {
  key: string;
  title: string;
  body: string;
  tone: DesktopNotificationTone;
  silent: boolean;
  timeoutType: "default" | "never";
  locale?: "ru" | "en";
  progress?: {
    value: number;
    label: string;
    status: string;
  };
}

function planLabel(value: string | null | undefined): string {
  if (!value) return "ChatGPT";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function switchTarget(targetLabel: string | null, isEnglish: boolean): string {
  return targetLabel ?? (isEnglish ? "the selected profile" : "выбранный профиль");
}

export function buildAuthNotification(event: AuthEvent, isEnglish: boolean): DesktopNotificationPayload {
  if (event.success) {
    const account = event.account;
    return {
      key: `auth:${event.loginId}:success`,
      title: isEnglish ? "Sign-in saved" : "Вход сохранён",
      body: account
        ? (isEnglish
          ? `${account.label} · ${planLabel(account.planType)}. The encrypted profile is ready for switching.`
          : `${account.label} · ${planLabel(account.planType)}. Зашифрованный профиль готов к переключению.`)
        : (isEnglish ? "The encrypted Codex profile is ready." : "Зашифрованный профиль Codex готов к работе."),
      tone: "success",
      silent: false,
      timeoutType: "default"
      ,locale: isEnglish ? "en" : "ru"
    };
  }

  return {
    key: `auth:${event.loginId}:failed`,
    title: isEnglish ? "Sign-in was not completed" : "Вход не завершён",
    body: isEnglish
      ? "The saved profiles were not changed. Open the manager to retry authorization."
      : "Сохранённые профили не изменены. Откройте менеджер и повторите авторизацию.",
    tone: "error",
    silent: false,
    timeoutType: "never"
    ,locale: isEnglish ? "en" : "ru"
  };
}

export function buildSwitchNotification(
  transaction: SwitchTransaction,
  targetLabel: string | null,
  isEnglish: boolean
): DesktopNotificationPayload | null {
  const target = switchTarget(targetLabel, isEnglish);
  if (transaction.phase === "quiescing") {
    return {
      key: `switch:${transaction.id}:quiescing`,
      title: isEnglish ? "Switching account · 1 of 3" : "Смена аккаунта · 1 из 3",
      body: isEnglish
        ? "The current session is saved. Codex is closing safely."
        : "Текущая сессия сохранена. Codex безопасно закрывается.",
      tone: "progress",
      silent: true,
      timeoutType: "default",
      locale: isEnglish ? "en" : "ru",
      progress: { value: 1 / 3, label: isEnglish ? "Account switch" : "Смена аккаунта", status: isEnglish ? "Saving session" : "Сохранение сессии" }
    };
  }
  if (transaction.phase === "verifying") {
    return {
      key: `switch:${transaction.id}:verifying`,
      title: isEnglish ? "Codex restarted · 2 of 3" : "Codex перезапущен · 2 из 3",
      body: isEnglish ? `Codex is running with ${target}; verifying the active identity.` : `Codex запущен с профилем ${target}; проверяю активную личность.`,
      tone: "progress",
      silent: true,
      timeoutType: "default",
      locale: isEnglish ? "en" : "ru",
      progress: { value: 2 / 3, label: isEnglish ? "Account switch" : "Смена аккаунта", status: isEnglish ? "Verifying Codex" : "Проверка Codex" }
    };
  }
  if (transaction.phase === "committed") {
    return {
      key: `switch:${transaction.id}:committed`,
      title: isEnglish ? "Account activated · 3 of 3" : "Аккаунт активирован · 3 из 3",
      body: isEnglish ? `${target} is verified and ready.` : `${target} подтверждён и готов к работе.`,
      tone: "success",
      silent: false,
      timeoutType: "default",
      locale: isEnglish ? "en" : "ru",
      progress: { value: 1, label: isEnglish ? "Account switch" : "Смена аккаунта", status: isEnglish ? "Completed" : "Готово" }
    };
  }
  if (transaction.phase === "rolled_back") {
    return {
      key: `switch:${transaction.id}:rolled_back`,
      title: isEnglish ? "Previous account restored" : "Предыдущий аккаунт восстановлен",
      body: isEnglish
        ? "The new identity did not pass verification. The previous encrypted profile is active again."
        : "Новая личность не прошла проверку. Предыдущий зашифрованный профиль снова активен.",
      tone: "warning",
      silent: false,
      timeoutType: "never"
      ,locale: isEnglish ? "en" : "ru"
    };
  }
  if (transaction.phase === "failed" || transaction.phase === "recovery_required") {
    return {
      key: `switch:${transaction.id}:${transaction.phase}`,
      title: isEnglish ? "Account switch needs attention" : "Переключение требует внимания",
      body: isEnglish
        ? "Codex was not left on an unverified identity. Open the activity journal for recovery details."
        : "Codex не оставлен с неподтверждённой личностью. Откройте журнал для восстановления.",
      tone: "error",
      silent: false,
      timeoutType: "never"
      ,locale: isEnglish ? "en" : "ru"
    };
  }
  return null;
}

export function buildQuotaNotification(alert: QuotaAlert, isEnglish: boolean): DesktopNotificationPayload {
  const windowLabel = alert.windowType === "5h"
    ? (isEnglish ? "5-hour limit" : "лимит 5 часов")
    : alert.windowType === "weekly"
      ? (isEnglish ? "weekly limit" : "недельный лимит")
      : (isEnglish ? "account limit" : "лимит аккаунта");
  const recommendation = alert.recommendedAccountLabel
    ? (isEnglish ? ` Next profile: ${alert.recommendedAccountLabel}.` : ` Следующий профиль: ${alert.recommendedAccountLabel}.`)
    : (isEnglish ? " No verified backup profile is ready." : " Готового проверенного резерва пока нет.");
  return {
    key: `quota:${alert.accountId}:${alert.windowId}:${alert.resetAt}`,
    title: isEnglish ? `${windowLabel}: ${alert.remainingPercent}% remaining` : `${windowLabel.charAt(0).toUpperCase() + windowLabel.slice(1)}: осталось ${alert.remainingPercent}%`,
    body: isEnglish
      ? `${alert.accountLabel}: ${windowLabel}.${recommendation}`
      : `${alert.accountLabel}: ${windowLabel}.${recommendation}`,
    tone: "warning",
    silent: false,
    timeoutType: "default",
    locale: isEnglish ? "en" : "ru"
  };
}

export function buildUpdateNotification(version: string, isEnglish: boolean): DesktopNotificationPayload {
  return {
    key: `release:${version}`,
    title: isEnglish ? `Codex Manager ${version} is available` : `Доступен Codex Manager ${version}`,
    body: isEnglish
      ? "Open Codex Account Manager to view and download the verified GitHub Release."
      : "Открой Codex Account Manager, чтобы посмотреть и скачать проверенный GitHub Release.",
    tone: "progress",
    silent: false,
    timeoutType: "default",
    locale: isEnglish ? "en" : "ru"
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function createWindowsToastXml(payload: DesktopNotificationPayload, iconPath: string): string {
  const iconUri = pathToFileURL(iconPath).href;
  const progress = payload.progress
    ? `<progress title="${escapeXml(payload.progress.label)}" value="${Math.max(0, Math.min(1, payload.progress.value)).toFixed(2)}" valueStringOverride="${escapeXml(payload.title.match(/\d+ из 3|\d+ of 3/)?.[0] ?? "")}" status="${escapeXml(payload.progress.status)}"/>`
    : "";
  const audio = payload.silent ? '<audio silent="true"/>' : '<audio src="ms-winsoundevent:Notification.Default"/>';
  const attribution = payload.locale === "en" ? "Codex Account Manager · protected locally" : "Codex Account Manager · защищено локально";
  const action = payload.locale === "en" ? "Open manager" : "Открыть менеджер";
  return `<toast duration="${payload.timeoutType === "never" ? "long" : "short"}"><visual><binding template="ToastGeneric"><text>${escapeXml(payload.title)}</text><text>${escapeXml(payload.body)}</text><text placement="attribution">${escapeXml(attribution)}</text><image placement="appLogoOverride" hint-crop="circle" src="${escapeXml(iconUri)}"/>${progress}</binding></visual><actions><action content="${escapeXml(action)}" arguments="open-manager" activationType="foreground"/></actions>${audio}</toast>`;
}

export class DesktopNotificationService {
  private readonly emitted = new Set<string>();

  take(payload: DesktopNotificationPayload | null): DesktopNotificationPayload | null {
    if (!payload || this.emitted.has(payload.key)) return null;
    this.emitted.add(payload.key);
    if (this.emitted.size > 160) {
      const oldest = this.emitted.values().next().value as string | undefined;
      if (oldest) this.emitted.delete(oldest);
    }
    return payload;
  }
}
