import { redactSensitiveText } from "./redaction.js";

export type QuotaRefreshErrorCategory =
  | "cooldown"
  | "network"
  | "unauthorized"
  | "provider_forbidden"
  | "provider_limit"
  | "provider_unavailable"
  | "unknown";

export interface ProviderRequestErrorDetails {
  category: QuotaRefreshErrorCategory;
  statusCode: number | null;
  retryAfterSeconds: number | null;
  requiresReauth: boolean;
  retryable: boolean;
  message: string;
}

export class ProviderRequestError extends Error implements ProviderRequestErrorDetails {
  readonly category: QuotaRefreshErrorCategory;
  readonly statusCode: number | null;
  readonly retryAfterSeconds: number | null;
  readonly requiresReauth: boolean;
  readonly retryable: boolean;

  constructor(details: ProviderRequestErrorDetails) {
    super(redactSensitiveText(details.message).slice(0, 500));
    this.name = "ProviderRequestError";
    this.category = details.category;
    this.statusCode = details.statusCode;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.requiresReauth = details.requiresReauth;
    this.retryable = details.retryable;
  }

  toDetails(): ProviderRequestErrorDetails {
    return { category: this.category, statusCode: this.statusCode, retryAfterSeconds: this.retryAfterSeconds,
      requiresReauth: this.requiresReauth, retryable: this.retryable, message: this.message };
  }
}

export function parseRetryAfter(value: string | null, nowSeconds = Math.floor(Date.now() / 1000)): number | null {
  if (!value?.trim()) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Math.max(0, Math.ceil(Number(value)));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil(timestamp / 1000 - nowSeconds)) : null;
}

export function providerHttpError(statusCode: number, label: string, retryAfter: string | null = null, nowSeconds?: number): ProviderRequestError {
  return new ProviderRequestError({
    statusCode, message: `${label} failed with HTTP ${statusCode}`,
    category: statusCode === 401 ? "unauthorized" : statusCode === 403 ? "provider_forbidden"
      : statusCode === 429 ? "provider_limit" : statusCode >= 500 ? "provider_unavailable" : "unknown",
    retryAfterSeconds: parseRetryAfter(retryAfter, nowSeconds), requiresReauth: statusCode === 401,
    retryable: statusCode === 429 || statusCode >= 500
  });
}

function errorText(error: unknown): string {
  if (error instanceof Error) return redactSensitiveText(error.message);
  return redactSensitiveText(String(error));
}

export function classifyQuotaRefreshError(error: unknown): QuotaRefreshErrorCategory {
  if (error && typeof error === "object" && "category" in error) {
    const category = (error as { category: unknown }).category;
    if (typeof category === "string" && ["cooldown", "network", "unauthorized", "provider_forbidden", "provider_limit", "provider_unavailable", "unknown"].includes(category)) {
      return category as QuotaRefreshErrorCategory;
    }
  }
  const message = errorText(error).toLowerCase();

  if (/cooldown|temporarily delayed|временно отложено|повторите через/.test(message)) {
    return "cooldown";
  }
  if (/\b401\b|unauthorized|needs?_?reauth|invalid_grant|invalid refresh|not authenticated|not logged into a chatgpt(?:-compatible)? account|belongs to a different chatgpt account|login required|повторная авторизация/.test(message)) {
    return "unauthorized";
  }
  if (/\b403\b|forbidden|regional restriction|verification required|validation_required/.test(message)) return "provider_forbidden";
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
    provider_forbidden: "провайдер запретил доступ; причина не означает истечение credentials",
    provider_limit: "провайдер вернул ограничение лимитов",
    provider_unavailable: "провайдер временно недоступен",
    unknown: "причина не определена"
  };

  return `${action}: ${reason[category]}. Подробности доступны в журнале диагностики.`;
}
