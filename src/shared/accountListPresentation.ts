import { buildProviderQuotaState, type ProviderLimitWindowType } from "./providerAdapter.js";
import type { ManagedAccount } from "./types.js";

export type AccountListSort = "smart" | "subscription" | "remaining" | "reset" | "freshness" | "added" | "name";

export interface AccountListQuota {
  remainingPercent: number | null;
  resetAt: number | null;
  windowType: ProviderLimitWindowType;
}

function finiteTimestamp(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function selectAccountListQuota(account: ManagedAccount, now: number): AccountListQuota {
  const windows = buildProviderQuotaState(account).windows
    .filter((window) => typeof window.remaining === "number" && Number.isFinite(window.remaining))
    .slice()
    .sort((left, right) =>
      (left.remaining ?? Number.POSITIVE_INFINITY) - (right.remaining ?? Number.POSITIVE_INFINITY) ||
      ((finiteTimestamp(left.resetAt) ?? 0) > now ? finiteTimestamp(left.resetAt)! : Number.POSITIVE_INFINITY) -
        ((finiteTimestamp(right.resetAt) ?? 0) > now ? finiteTimestamp(right.resetAt)! : Number.POSITIVE_INFINITY)
    );
  const current = windows[0];
  if (!current) return { remainingPercent: null, resetAt: null, windowType: "unknown" };
  return {
    remainingPercent: current.remaining,
    resetAt: finiteTimestamp(current.resetAt),
    windowType: current.windowType
  };
}

function nextFutureReset(account: ManagedAccount, now: number): number | null {
  const future = buildProviderQuotaState(account).windows
    .map((window) => finiteTimestamp(window.resetAt))
    .filter((value): value is number => value !== null && value > now);
  return future.length > 0 ? Math.min(...future) : null;
}

function readinessRank(account: ManagedAccount): number {
  if (account.archived) return 4;
  if (account.credentialState !== "ready") return 3;
  if (account.status === "error" || account.status === "limited") return 2;
  if (account.status === "near_limit") return 1;
  return 0;
}

export function accountPlanPriority(account: ManagedAccount): number {
  const key = String(account.planType ?? "unknown").toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "enterprise" || key === "edu") return 90;
  if (key.includes("20") || key === "googleaiultrax20") return 80;
  if (key.includes("10") || key === "prolite" || key === "googleaiultra") return 70;
  if (key.includes("5")) return 60;
  if (key === "pro") return 55;
  if (key === "team" || key === "business") return 50;
  if (key === "plus" || key === "googleaipro") return 40;
  if (key === "go") return 30;
  if (key === "free") return 20;
  return 10;
}

function compareNullableNumber(left: number | null, right: number | null, direction: "asc" | "desc"): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === "asc" ? left - right : right - left;
}

export function sortAccountList(accounts: ManagedAccount[], sort: AccountListSort, now: number): ManagedAccount[] {
  const quotaById = new Map(accounts.map((account) => [account.id, selectAccountListQuota(account, now)]));
  const resetById = new Map(accounts.map((account) => [account.id, nextFutureReset(account, now)]));
  const compareCodePoints = (left: string, right: string): number => left === right ? 0 : left < right ? -1 : 1;
  const byName = (left: ManagedAccount, right: ManagedAccount) => {
    const leftName = left.label.normalize("NFKC");
    const rightName = right.label.normalize("NFKC");
    return compareCodePoints(leftName.toLocaleLowerCase("en-US"), rightName.toLocaleLowerCase("en-US")) ||
      compareCodePoints(leftName, rightName) ||
      compareCodePoints(left.id, right.id);
  };
  const remaining = (account: ManagedAccount) => quotaById.get(account.id)?.remainingPercent ?? null;
  const reset = (account: ManagedAccount) => resetById.get(account.id) ?? null;
  const freshness = (account: ManagedAccount) => finiteTimestamp(account.lastRefreshAt);

  return accounts.slice().sort((left, right) => {
    if (sort === "smart") {
      return Number(right.isActive) - Number(left.isActive) ||
        readinessRank(left) - readinessRank(right) ||
        accountPlanPriority(right) - accountPlanPriority(left) ||
        compareNullableNumber(remaining(left), remaining(right), "desc") ||
        compareNullableNumber(reset(left), reset(right), "asc") ||
        compareNullableNumber(freshness(left), freshness(right), "desc") ||
        byName(left, right);
    }
    if (sort === "subscription") {
      return accountPlanPriority(right) - accountPlanPriority(left) ||
        readinessRank(left) - readinessRank(right) ||
        compareNullableNumber(remaining(left), remaining(right), "desc") ||
        byName(left, right);
    }
    if (sort === "remaining") {
      return compareNullableNumber(remaining(left), remaining(right), "desc") ||
        compareNullableNumber(reset(left), reset(right), "asc") ||
        byName(left, right);
    }
    if (sort === "reset") {
      return compareNullableNumber(reset(left), reset(right), "asc") ||
        compareNullableNumber(remaining(left), remaining(right), "desc") ||
        byName(left, right);
    }
    if (sort === "freshness") {
      return compareNullableNumber(freshness(left), freshness(right), "desc") || byName(left, right);
    }
    if (sort === "added") {
      return right.createdAt - left.createdAt || byName(left, right);
    }
    return byName(left, right);
  });
}

export function formatResetTimeShort(
  timestamp: number | null | undefined,
  language: "ru" | "en" = "ru",
  now: number = Math.floor(Date.now() / 1000)
): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return language === "en" ? "no data" : "нет данных";
  }
  const date = new Date(timestamp * 1000);
  const nowDate = new Date(now * 1000);
  const isToday =
    date.getDate() === nowDate.getDate() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getFullYear() === nowDate.getFullYear();

  if (isToday) {
    return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatRemainingCountdown(
  resetAt: number | null | undefined,
  now: number,
  isEnglish = false
): string | null {
  if (!resetAt || !Number.isFinite(resetAt)) return null;
  const diff = resetAt - now;
  if (diff <= 0) return isEnglish ? "now" : "сейчас";
  if (diff < 60) return isEnglish ? "< 1m" : "< 1м";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m}${isEnglish ? "m" : "м"}`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    if (m === 0) return `${h}${isEnglish ? "h" : "ч"}`;
    return `${h}${isEnglish ? "h" : "ч"} ${m}${isEnglish ? "m" : "м"}`;
  }
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  if (h === 0) return `${d}${isEnglish ? "d" : "д"}`;
  return `${d}${isEnglish ? "d" : "д"} ${h}${isEnglish ? "h" : "ч"}`;
}

