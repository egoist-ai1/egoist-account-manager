import { redactSensitiveText } from "./redaction.js";

export type QuotaRefreshErrorCategory =
  | "cooldown"
  | "network"
  | "unauthorized"
  | "provider_limit"
  | "provider_unavailable"
  | "unknown";

function errorText(error: unknown): string {
  if (error instanceof Error) return redactSensitiveText(error.message);
  return redactSensitiveText(String(error));
}

export function classifyQuotaRefreshError(error: unknown): QuotaRefreshErrorCategory {
  const message = errorText(error).toLowerCase();

  if (/cooldown|temporarily delayed|временно отложено|повторите через/.test(message)) {
    return "cooldown";
  }
  if (/\b401\b|\b403\b|unauthorized|forbidden|needs?_?reauth|invalid_grant|invalid refresh|not authenticated|not logged into a chatgpt(?:-compatible)? account|belongs to a different chatgpt account|login required|повторная авторизация/.test(message)) {
    return "unauthorized";
  }
  if (/\b500\b|\b502\b|\b503\b|\b504\b|service unavailable|temporarily unavailable|provider unavailable/.test(message)) {
    return "provider_unavailable";
  }
  if (/network|timeout|timed out|econnreset|enotfound|eai_again|socket|offline|сеть недоступна/.test(message)) {
    return "network";
  }
  if (/rate limit|limit reached|quota exceeded|too many requests|\b429\b/.test(message)) {
    return "provider_limit";
  }

  return "unknown";
}

export function buildQuotaRefreshErrorMessage(action: string, error: unknown): string {
  const category = classifyQuotaRefreshError(error);
  const reason: Record<QuotaRefreshErrorCategory, string> = {
    cooldown: "обновление временно отложено после недавней ошибки, чтобы не спамить провайдера",
    network: "сеть недоступна или запрос истёк по времени",
    unauthorized: "нужна повторная авторизация",
    provider_limit: "провайдер вернул ограничение лимитов",
    provider_unavailable: "провайдер временно недоступен",
    unknown: "причина не определена"
  };

  return `${action}: ${reason[category]}. Подробности доступны в журнале диагностики.`;
}
