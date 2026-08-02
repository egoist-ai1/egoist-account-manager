import type { ManagedAccount, SmartRecommendation, WorkspaceBinding } from "./types.js";
import { hasCurrentQuotaRefreshFailure } from "./quotaFreshness.js";

export interface SmartSelectionOptions {
  now?: number;
  staleAfterSeconds?: number;
}

export interface AutoSwitchOptions extends SmartSelectionOptions {
  thresholdPercent?: number;
}

export type SwitchCandidateState = "ready" | "needs_refresh" | "needs_reauth" | "unavailable";

export interface RankedSwitchCandidate {
  account: ManagedAccount;
  state: SwitchCandidateState;
  remainingPercent: number | null;
  reason: "ready" | "stale" | "missing" | "refresh_failed" | "needs_reauth" | "blocked";
}

function usage(account: ManagedAccount): number {
  return Math.max(account.fiveHourUsedPercent ?? 0, account.weeklyUsedPercent ?? 0);
}

function knownUsageWindows(account: ManagedAccount): number[] {
  return [account.fiveHourUsedPercent, account.weeklyUsedPercent].filter((value): value is number => typeof value === "number");
}

function remaining(account: ManagedAccount): number {
  const windows = knownUsageWindows(account);
  if (windows.length === 0) return 0;
  return Math.min(...windows.map((value) => Math.max(0, 100 - value)));
}

function isUsable(account: ManagedAccount, options: Required<SmartSelectionOptions>): boolean {
  if (account.archived) return false;
  if (account.credentialState !== "ready") return false;
  if (account.status === "limited" || account.status === "error") return false;
  if (hasCurrentQuotaRefreshFailure(account)) return false;
  if (!Number.isFinite(options.staleAfterSeconds)) return true;
  if (!account.lastRefreshAt) return false;
  return options.now - account.lastRefreshAt <= options.staleAfterSeconds;
}

function candidateState(
  account: ManagedAccount,
  options: Required<SmartSelectionOptions>
): Pick<RankedSwitchCandidate, "state" | "reason"> {
  if (account.credentialState !== "ready") return { state: "needs_reauth", reason: "needs_reauth" };
  if (account.status === "limited" || account.status === "error" || account.archived) {
    return { state: "unavailable", reason: "blocked" };
  }
  if (hasCurrentQuotaRefreshFailure(account)) return { state: "needs_refresh", reason: "refresh_failed" };
  if (!account.lastRefreshAt) return { state: "needs_refresh", reason: "missing" };
  if (options.now - account.lastRefreshAt > options.staleAfterSeconds) {
    return { state: "needs_refresh", reason: "stale" };
  }
  if (knownUsageWindows(account).length === 0) return { state: "needs_refresh", reason: "missing" };
  return { state: "ready", reason: "ready" };
}

export function rankSwitchCandidates(
  accounts: ManagedAccount[],
  options: SmartSelectionOptions = {}
): RankedSwitchCandidate[] {
  const resolvedOptions: Required<SmartSelectionOptions> = {
    now: options.now ?? Math.floor(Date.now() / 1000),
    staleAfterSeconds: options.staleAfterSeconds ?? 15 * 60
  };
  const priority: Record<SwitchCandidateState, number> = {
    ready: 0,
    needs_refresh: 1,
    needs_reauth: 2,
    unavailable: 3
  };

  return accounts
    .filter((account) => !account.isActive && account.platform !== "antigravity")
    .map((account): RankedSwitchCandidate => {
      const state = candidateState(account, resolvedOptions);
      return {
        account,
        ...state,
        remainingPercent: state.state === "ready" ? remaining(account) : null
      };
    })
    .sort((left, right) =>
      priority[left.state] - priority[right.state] ||
      (right.remainingPercent ?? -1) - (left.remainingPercent ?? -1) ||
      (left.account.lastUsedAt ?? 0) - (right.account.lastUsedAt ?? 0) ||
      left.account.label.localeCompare(right.account.label)
    );
}

function resetPenalty(account: ManagedAccount, now: number): number {
  const resets = [account.fiveHourResetsAt, account.weeklyResetsAt].filter(Boolean) as number[];
  if (resets.length === 0) return 20;
  const nextReset = Math.min(...resets);
  const hours = Math.max(0, (nextReset - now) / 3600);
  return Math.min(12, hours);
}

function scoreAccount(account: ManagedAccount, binding: WorkspaceBinding | null, options: Required<SmartSelectionOptions>): number {
  let score = usage(account) + resetPenalty(account, options.now);
  if (account.status === "near_limit") score += 28;
  if (binding?.accountId === account.id) score -= 42;
  if (account.isActive) score -= 8;
  if (account.favorite) score -= 10;
  if (account.lastUsedAt) score -= 3;
  return score;
}

function reasonFor(account: ManagedAccount, binding: WorkspaceBinding | null): string {
  if (binding?.accountId === account.id) return "Привязан к текущей рабочей папке и доступен по лимитам";
  if (account.status === "near_limit") return "Лучший доступный вариант, но лимиты уже близко";
  if (account.isActive) return "Активный аккаунт остаётся лучшим вариантом";
  return "Ниже нагрузка по лимитам и нет ошибок статуса";
}

export function selectSmartAccount(
  accounts: ManagedAccount[],
  binding: WorkspaceBinding | null = null,
  options: SmartSelectionOptions = {}
): SmartRecommendation | null {
  const resolvedOptions: Required<SmartSelectionOptions> = {
    now: options.now ?? Math.floor(Date.now() / 1000),
    staleAfterSeconds: options.staleAfterSeconds ?? Number.POSITIVE_INFINITY
  };
  const candidates = accounts.filter((account) => isUsable(account, resolvedOptions));
  if (candidates.length === 0) return null;
  const selected = candidates
    .map((account) => ({ account, score: scoreAccount(account, binding, resolvedOptions) }))
    .sort((a, b) => a.score - b.score || a.account.label.localeCompare(b.account.label))[0];
  return {
    accountId: selected.account.id,
    accountLabel: selected.account.label,
    accountEmail: selected.account.email,
    score: selected.score,
    reason: reasonFor(selected.account, binding),
    workspaceMatched: binding?.accountId === selected.account.id
  };
}

export function selectAutoSwitchAccount(
  accounts: ManagedAccount[],
  options: AutoSwitchOptions = {}
): SmartRecommendation | null {
  const resolvedOptions: Required<AutoSwitchOptions> = {
    now: options.now ?? Math.floor(Date.now() / 1000),
    staleAfterSeconds: options.staleAfterSeconds ?? Number.POSITIVE_INFINITY,
    thresholdPercent: options.thresholdPercent ?? 10
  };
  const active = accounts.find((account) => account.isActive && account.platform !== "antigravity");
  if (!active) return null;
  const activeWindows = knownUsageWindows(active);
  if (activeWindows.length === 0) return null;
  const activeBelowThreshold = activeWindows.some((usedPercent) => 100 - usedPercent <= resolvedOptions.thresholdPercent);
  if (!activeBelowThreshold) return null;

  const candidates = rankSwitchCandidates(accounts, resolvedOptions)
    .filter((candidate) =>
      candidate.state === "ready" &&
      candidate.remainingPercent !== null &&
      candidate.remainingPercent > resolvedOptions.thresholdPercent
    );

  const selected = candidates[0];
  if (!selected) return null;
  return {
    accountId: selected.account.id,
    accountLabel: selected.account.label,
    accountEmail: selected.account.email,
    score: 100 - (selected.remainingPercent ?? 0),
    reason: "Active Codex account crossed the configured limit threshold",
    workspaceMatched: false
  };
}
