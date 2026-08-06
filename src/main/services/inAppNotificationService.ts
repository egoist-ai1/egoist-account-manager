import type { AppNotificationPayload, AuthEvent, SwitchTransaction } from "../../shared/types.js";
import type { QuotaAlert } from "./quotaAlertService.js";

function planLabel(value: string | null | undefined): string {
  if (!value) return "ChatGPT";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function switchTarget(targetLabel: string | null, isEnglish: boolean): string {
  return targetLabel ?? (isEnglish ? "the selected profile" : "выбранный профиль");
}

function notice(input: Omit<AppNotificationPayload, "createdAt">): AppNotificationPayload {
  return { ...input, createdAt: Math.floor(Date.now() / 1000) };
}

export function buildAuthNotification(event: AuthEvent, isEnglish: boolean): AppNotificationPayload {
  if (event.success) {
    const account = event.account;
    return notice({
      key: `auth:${event.loginId}:success`,
      title: isEnglish ? "Sign-in saved" : "Вход сохранён",
      body: account
        ? (isEnglish
          ? `${account.label} · ${planLabel(account.planType)}. The encrypted profile is ready for switching.`
          : `${account.label} · ${planLabel(account.planType)}. Зашифрованный профиль готов к переключению.`)
        : (isEnglish ? "The encrypted Codex profile is ready." : "Зашифрованный профиль Codex готов к работе."),
      tone: "success",
      silent: false,
      timeoutType: "default",
      locale: isEnglish ? "en" : "ru",
      progress: { value: 1, label: isEnglish ? "Authorization" : "Авторизация", status: isEnglish ? "Encrypted and ready" : "Зашифровано и готово" }
    });
  }

  return notice({
    key: `auth:${event.loginId}:failed`,
    title: isEnglish ? "Sign-in was not completed" : "Вход не завершён",
    body: isEnglish
      ? "The saved profiles were not changed. Open the manager to retry authorization."
      : "Сохранённые профили не изменены. Откройте менеджер и повторите авторизацию.",
    tone: "error",
    silent: false,
    timeoutType: "never",
    locale: isEnglish ? "en" : "ru"
  });
}

export function buildSwitchNotification(
  transaction: SwitchTransaction,
  targetLabel: string | null,
  isEnglish: boolean
): AppNotificationPayload | null {
  const target = switchTarget(targetLabel, isEnglish);
  if (transaction.phase === "quiescing") {
    return notice({
      key: `switch:${transaction.id}:quiescing`,
      title: isEnglish ? "Session protected · 1 of 3" : "Сессия защищена · 1 из 3",
      body: isEnglish ? "The current session is saved. Codex is closing safely." : "Текущая сессия сохранена. Codex безопасно закрывается.",
      tone: "progress",
      silent: true,
      timeoutType: "default",
      locale: isEnglish ? "en" : "ru",
      progress: { value: 1 / 3, label: isEnglish ? "Account switch" : "Смена аккаунта", status: isEnglish ? "Saving session" : "Сохранение сессии" }
    });
  }
  if (transaction.phase === "verifying") {
    return notice({
      key: `switch:${transaction.id}:verifying`,
      title: isEnglish ? "Codex restarted · 2 of 3" : "Codex перезапущен · 2 из 3",
      body: isEnglish ? `Codex is running with ${target}; verifying the active identity.` : `Codex запущен с профилем ${target}; проверяю активную личность.`,
      tone: "progress",
      silent: true,
      timeoutType: "default",
      locale: isEnglish ? "en" : "ru",
      progress: { value: 2 / 3, label: isEnglish ? "Account switch" : "Смена аккаунта", status: isEnglish ? "Verifying Codex" : "Проверка Codex" }
    });
  }
  if (transaction.phase === "committed") {
    return notice({
      key: `switch:${transaction.id}:committed`,
      title: isEnglish ? "Account activated · 3 of 3" : "Аккаунт активирован · 3 из 3",
      body: isEnglish ? `${target} is verified and ready.` : `${target} подтверждён и готов к работе.`,
      tone: "success",
      silent: false,
      timeoutType: "default",
      locale: isEnglish ? "en" : "ru",
      progress: { value: 1, label: isEnglish ? "Account switch" : "Смена аккаунта", status: isEnglish ? "Completed" : "Готово" }
    });
  }
  if (transaction.phase === "rolled_back") {
    return notice({
      key: `switch:${transaction.id}:rolled_back`,
      title: isEnglish ? "Previous account restored" : "Предыдущий аккаунт восстановлен",
      body: isEnglish
        ? "The new identity did not pass verification. The previous encrypted profile is active again."
        : "Новая личность не прошла проверку. Предыдущий зашифрованный профиль снова активен.",
      tone: "warning",
      silent: false,
      timeoutType: "never",
      locale: isEnglish ? "en" : "ru"
    });
  }
  if (transaction.phase === "failed" || transaction.phase === "recovery_required") {
    return notice({
      key: `switch:${transaction.id}:${transaction.phase}`,
      title: isEnglish ? "Account switch needs attention" : "Переключение требует внимания",
      body: isEnglish
        ? "Codex was not left on an unverified identity. Open the activity journal for recovery details."
        : "Codex не оставлен с неподтверждённой личностью. Откройте журнал для восстановления.",
      tone: "error",
      silent: false,
      timeoutType: "never",
      locale: isEnglish ? "en" : "ru"
    });
  }
  return null;
}

export function buildQuotaNotification(alert: QuotaAlert, isEnglish: boolean): AppNotificationPayload {
  const windowLabel = alert.windowType === "5h"
    ? (isEnglish ? "5-hour limit" : "Лимит 5 часов")
    : alert.windowType === "weekly"
      ? (isEnglish ? "Weekly limit" : "Недельный лимит")
      : (isEnglish ? "Account limit" : "Лимит аккаунта");
  const recommendation = alert.recommendedAccountLabel
    ? (isEnglish ? ` Next verified profile: ${alert.recommendedAccountLabel}.` : ` Следующий проверенный профиль: ${alert.recommendedAccountLabel}.`)
    : (isEnglish ? " No verified backup profile is ready." : " Готового проверенного резерва пока нет.");
  return notice({
    key: `quota:${alert.accountId}:${alert.windowId}:${alert.resetAt}`,
    title: isEnglish ? `${windowLabel}: ${alert.remainingPercent}% remaining` : `${windowLabel}: осталось ${alert.remainingPercent}%`,
    body: `${alert.accountLabel}.${recommendation}`,
    tone: "warning",
    silent: false,
    timeoutType: "never",
    locale: isEnglish ? "en" : "ru"
  });
}

export function buildUpdateNotification(version: string, isEnglish: boolean): AppNotificationPayload {
  return notice({
    key: `release:${version}`,
    title: isEnglish ? `Egoist Account Manager ${version} is available` : `Доступен Egoist Account Manager ${version}`,
    body: isEnglish
      ? "A stable release is listed in the official GitHub repository. Open the update banner to review it."
      : "В официальном GitHub-репозитории опубликован стабильный релиз. Откройте плашку, чтобы проверить его.",
    tone: "progress",
    silent: false,
    timeoutType: "default",
    locale: isEnglish ? "en" : "ru"
  });
}

export class InAppNotificationService {
  private readonly emitted = new Set<string>();

  take(payload: AppNotificationPayload | null): AppNotificationPayload | null {
    if (!payload || this.emitted.has(payload.key)) return null;
    this.emitted.add(payload.key);
    if (this.emitted.size > 160) {
      const oldest = this.emitted.values().next().value as string | undefined;
      if (oldest) this.emitted.delete(oldest);
    }
    return payload;
  }
}
