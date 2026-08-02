export type QuotaFreshnessState = "fresh" | "stale" | "missing";

export interface QuotaFreshnessInput {
  lastRefreshAt: number | null;
}

export interface QuotaRefreshFailureInput extends QuotaFreshnessInput {
  lastRefreshErrorAt?: number | null;
  lastRefreshError?: string | null;
}

export interface QuotaFreshnessOptions {
  now: number;
  staleAfterSeconds: number;
}

export interface QuotaFreshness {
  state: QuotaFreshnessState;
  label: string;
  title: string;
}

function ageLabel(ageSeconds: number): string {
  const minutes = Math.max(0, Math.floor(ageSeconds / 60));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.floor(minutes / 60)} ч назад`;
}

export function hasCurrentQuotaRefreshFailure(input: QuotaRefreshFailureInput): boolean {
  if (!input.lastRefreshError) return false;
  if (!input.lastRefreshAt) return true;
  if (!input.lastRefreshErrorAt) return false;
  return input.lastRefreshErrorAt >= input.lastRefreshAt;
}

export function buildQuotaFreshness(input: QuotaFreshnessInput, options: QuotaFreshnessOptions): QuotaFreshness {
  if (!input.lastRefreshAt) {
    return {
      state: "missing",
      label: "нет снимка",
      title: "Лимиты ещё не проверялись"
    };
  }

  const ageSeconds = Math.max(0, options.now - input.lastRefreshAt);
  if (ageSeconds > options.staleAfterSeconds) {
    return {
      state: "stale",
      label: "устарел",
      title: `Снимок лимитов устарел: ${ageLabel(ageSeconds)}`
    };
  }

  return {
    state: "fresh",
    label: "свежий",
    title: `Снимок лимитов свежий: ${ageLabel(ageSeconds)}`
  };
}
