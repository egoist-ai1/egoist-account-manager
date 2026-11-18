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
  const provider = transaction.platform === "antigravity" ? "Antigravity" : "Codex";
  if (transaction.phase === "quiescing") {
    return notice({
      key: `switch:${transaction.id}:quiescing`,
      title: isEnglish ? "Preparing the switch" : "Подготовка переключения",
      body: isEnglish ? `Checking the profile and closing ${provider} before writing credentials.` : `Проверяем профиль и закрываем ${provider} перед записью.`,
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
      title: isEnglish ? "Verifying switch" : "Проверка переключения",
      body: isEnglish ? `Checking the running ${provider} session.` : `Проверяем аккаунт в запущенном ${provider}.`,
      tone: "progress",
      silent: true,
      timeoutType: "default",
      locale: isEnglish ? "en" : "ru",
      progress: { value: 2 / 3, label: isEnglish ? "Account switch" : "Смена аккаунта", status: isEnglish ? `Verifying ${provider}` : `Проверка ${provider}` }
    });
  }
  if (transaction.phase === "committed") {
    const verified = transaction.verification?.runtime === "verified";
    return notice({
      key: "switch:" + transaction.id + ":committed",
      title: verified ? (isEnglish ? "Running account confirmed" : "Аккаунт в приложении подтверждён")
        : (isEnglish ? "Profile applied" : "Профиль применён"),
      body: verified ? target : (isEnglish ? `${target}. The running ${provider} account is unconfirmed.`
        : `${target}. Аккаунт в открытом ${provider} пока не подтверждён.`),
      tone: verified ? "success" : "warning", silent: false,
      timeoutType: verified ? "default" : "never", locale: isEnglish ? "en" : "ru",
      progress: { value: 1, label: isEnglish ? "Profile application" : "Применение профиля", status: verified ? (isEnglish ? "Runtime email confirmed" : "Email IDE подтверждён")
        : (isEnglish ? "Runtime confirmation needed" : "Нужно подтверждение IDE") }
    });
  }
  if (transaction.phase === "rolled_back") {
    return notice({
      key: `switch:${transaction.id}:rolled_back`,
      title: isEnglish ? "Previous account restored" : "Предыдущий аккаунт восстановлен",
      body: isEnglish
        ? "The switch failed and the previous sign-in data was restored."
        : "Переключение прервалось. Прежние данные входа восстановлены.",
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
        ? "The current provider state requires inspection. Open the journal for recovery details."
        : "Текущее состояние провайдера требует проверки. Откройте журнал для восстановления.",
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
    title: isEnglish ? `Квессер ${version} is available` : `Доступен Квессер ${version}`,
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
