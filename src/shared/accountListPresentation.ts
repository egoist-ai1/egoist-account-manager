import { buildProviderQuotaState, type ProviderLimitWindowType } from "./providerAdapter.js";
import { getAccountQuotaSelection, getAccountReadiness } from "./smartSelection.js";
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
  const windowIds = new Set(getAccountQuotaSelection(account).windows.map(window => window.id));
  const windows = buildProviderQuotaState(account).windows
    .filter((window) => windowIds.has(window.id) && typeof window.remaining === "number" && Number.isFinite(window.remaining))
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
  const future = getAccountQuotaSelection(account).windows
    .map((window) => finiteTimestamp(window.resetsAt))
    .filter((value): value is number => value !== null && value > now);
  return future.length > 0 ? Math.min(...future) : null;
}

function readinessRank(account: ManagedAccount, now: number): number {
  if (account.archived) return 4;
  const order = { ready: 0, needs_refresh: 1, needs_reauth: 2, unavailable: 3 } as const;
  return order[getAccountReadiness(account, { now }).state];
}

// Display order only: these exact provider/legacy names do not imply measured quota multipliers.
const planPriorities: Readonly<Record<string, number>> = {
  enterprise: 90, edu: 90, ent26: 90, enterprisecbpautomation: 90, enterprisecbpusagebased: 90, eduplus: 90, edupro: 90,
  prox20: 80, googleaiultrax20: 80, promax: 80,
  prox10: 70, prolite: 70, googleaiultra: 70,
  prox5: 60, pro: 55,
  team: 50, business: 50, selfservebusinessprolite: 50, selfservebusinessusagebased: 50,
  plus: 40, googleaipro: 40, go: 30, free: 20
};

export function accountPlanPriority(account: ManagedAccount): number {
  const key = String(account.planType ?? "unknown").toLowerCase().replace(/[\s_-]+/g, "");
  return Object.hasOwn(planPriorities, key) ? planPriorities[key] : 10;
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
  const freshness = (account: ManagedAccount) => finiteTimestamp(account.quotaSnapshot?.capturedAt ?? account.lastRefreshAt);

  return accounts.slice().sort((left, right) => {
    if (sort === "smart") {
      return Number(right.isActive) - Number(left.isActive) ||
        readinessRank(left, now) - readinessRank(right, now) ||
        accountPlanPriority(right) - accountPlanPriority(left) ||
        compareNullableNumber(remaining(left), remaining(right), "desc") ||
        compareNullableNumber(reset(left), reset(right), "asc") ||
        compareNullableNumber(freshness(left), freshness(right), "desc") ||
        byName(left, right);
    }
    if (sort === "subscription") {
      return accountPlanPriority(right) - accountPlanPriority(left) ||
        readinessRank(left, now) - readinessRank(right, now) ||
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

