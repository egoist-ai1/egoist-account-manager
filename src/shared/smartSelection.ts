import type { AccountPlatform, ManagedAccount, RateLimitBucket, RateLimitSnapshot, RateLimitWindow, SmartRecommendation, WorkspaceBinding } from "./types.js";
import { hasCurrentQuotaRefreshFailure } from "./quotaFreshness.js";

export const QUOTA_STALE_AFTER_SECONDS = 15 * 60;

export interface SmartSelectionOptions {
  now?: number;
  staleAfterSeconds?: number;
  provider?: AccountPlatform;
  modelId?: string;
}

export interface AutoSwitchOptions extends SmartSelectionOptions {
  thresholdPercent?: number;
}

export type SwitchCandidateState = "ready" | "needs_refresh" | "needs_reauth" | "unavailable";
export type ReadinessReason = "ready" | "stale" | "missing" | "refresh_failed" | "reset_passed" | "model_unknown" | "needs_reauth" | "blocked";

export interface AccountQuotaWindow extends RateLimitWindow {
  id: string;
  modelId: string | null;
  scope: string | null;
  label: string | null;
}

export interface AccountReadiness {
  state: SwitchCandidateState;
  reason: ReadinessReason;
  remainingPercent: number | null;
  canSwitchManually: boolean;
  canAutoSwitch: boolean;
}

export interface RankedSwitchCandidate extends AccountReadiness {
  account: ManagedAccount;
}

function optionsWithDefaults(options: SmartSelectionOptions) {
  return {
    ...options,
    now: options.now ?? Math.floor(Date.now() / 1000),
    staleAfterSeconds: Number.isFinite(options.staleAfterSeconds)
      ? Math.max(0, options.staleAfterSeconds!)
      : QUOTA_STALE_AFTER_SECONDS
  };
}

/** Stored provider snapshots are authoritative; legacy fields are a migration fallback. */
export function getAccountQuotaWindows(account: ManagedAccount, options: Pick<SmartSelectionOptions, "modelId"> = {}): AccountQuotaWindow[] {
  const snapshot = account.quotaSnapshot;
  const buckets = snapshot?.buckets?.length ? snapshot.buckets : snapshot ? [snapshot] : [];
  if (buckets.length > 0) {
    return buckets.flatMap((bucket, index) => {
      const rawModelId = "modelId" in bucket ? bucket.modelId : "normalModelSlug" in bucket ? bucket.normalModelSlug : null;
      const modelId = typeof rawModelId === "string" && rawModelId ? rawModelId : null;
      const scope = "scope" in bucket ? bucket.scope ?? null : null;
      if (options.modelId && modelId && modelId !== options.modelId) return [];
      // A model cannot be inferred from an undocumented Antigravity group mapping.
      if (options.modelId && account.platform === "antigravity" && !modelId && scope) return [];
      return [bucket.primary, bucket.secondary].flatMap((window, slot) => {
        if (!window || !Number.isFinite(window.usedPercent)) return [];
        return [{ ...window,
          usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
          id: `${bucket.limitId ?? index}:${slot}`,
          modelId, scope: window.scope ?? scope,
          label: window.label ?? bucket.limitName ?? null
        }];
      });
    });
  }
  if (options.modelId && account.platform === "antigravity") return [];
  const legacy = [
    { id: "primary", usedPercent: account.primaryUsedPercent, resetsAt: account.primaryResetsAt, windowDurationMins: account.primaryWindowDurationMins },
    { id: "secondary", usedPercent: account.secondaryUsedPercent, resetsAt: account.secondaryResetsAt, windowDurationMins: account.secondaryWindowDurationMins },
    { id: "five-hour", usedPercent: account.fiveHourUsedPercent, resetsAt: account.fiveHourResetsAt, windowDurationMins: 300 },
    { id: "weekly", usedPercent: account.weeklyUsedPercent, resetsAt: account.weeklyResetsAt, windowDurationMins: 10_080 }
  ];
  const seen = new Set<string>();
  return legacy.flatMap((window) => {
    if (typeof window.usedPercent !== "number" || !Number.isFinite(window.usedPercent)) return [];
    const key = `${window.windowDurationMins ?? "unknown"}:${window.resetsAt ?? "none"}:${window.usedPercent}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...window, usedPercent: Math.min(100, Math.max(0, window.usedPercent)), resetsAt: window.resetsAt ?? null,
      windowDurationMins: window.windowDurationMins ?? null, modelId: null, scope: null, label: null }];
  });
}

function remainingForWindows(account: ManagedAccount, windows: AccountQuotaWindow[]): number | null {
  if (windows.length === 0) return null;
  if (account.platform !== "antigravity") return Math.min(...windows.map((window) => 100 - window.usedPercent));
  // Models/groups have independent limits; one exhausted model does not exhaust all.
  const groups = new Map<string, number>();
  for (const window of windows) {
    const key = window.modelId ?? window.scope ?? "account";
    groups.set(key, Math.min(groups.get(key) ?? 100, 100 - window.usedPercent));
  }
  return Math.max(...groups.values());
}

function selectionQuotaWindows(account: ManagedAccount, options: SmartSelectionOptions): AccountQuotaWindow[] {
  const windows = getAccountQuotaWindows(account, options);
  const snapshot = account.quotaSnapshot;
  if (account.platform !== "codex" || !snapshot?.buckets?.length) return windows;
  const aggregateId = snapshot.buckets.find((bucket) => bucket.limitId === "codex")?.limitId ?? snapshot.limitId;
  if (!aggregateId) return windows;
  // Unrelated metered aliases remain visible but do not exhaust the aggregate or another model.
  return windows.filter((window) => window.id === `${aggregateId}:0` || window.id === `${aggregateId}:1`
    || Boolean(options.modelId && window.modelId === options.modelId));
}

/** The limiting windows for the requested model, or the best known Antigravity group. */
export function getAccountQuotaSelection(account: ManagedAccount, options: Pick<SmartSelectionOptions, "modelId"> = {}): {
  windows: AccountQuotaWindow[]; remainingPercent: number | null;
} {
  let windows = selectionQuotaWindows(account, options);
  if (account.platform === "antigravity" && !options.modelId) {
    const blockedIds = new Set((account.quotaSnapshot?.buckets ?? []).flatMap((bucket, index) =>
      quotaBucketIsBlocked(bucket) ? [`${bucket.limitId ?? index}:0`, `${bucket.limitId ?? index}:1`] : []));
    const blockedGroups = new Set(windows.filter(window => blockedIds.has(window.id)).map(window => window.modelId ?? window.scope ?? "account"));
    const available = windows.filter(window => !blockedGroups.has(window.modelId ?? window.scope ?? "account"));
    if (available.length) windows = available;
  }
  const remainingPercent = remainingForWindows(account, windows);
  if (account.platform !== "antigravity" || windows.length === 0) return { windows, remainingPercent };
  const groups = new Map<string, AccountQuotaWindow[]>();
  for (const window of windows) {
    const key = window.modelId ?? window.scope ?? "account";
    groups.set(key, [...(groups.get(key) ?? []), window]);
  }
  // Match the group whose worst window supplied the shared remaining value.
  return { windows: [...groups.values()].find(group => Math.min(...group.map(window => 100 - window.usedPercent)) === remainingPercent) ?? [], remainingPercent };
}

function quotaBucketIsBlocked(bucket: RateLimitBucket | RateLimitSnapshot): boolean {
  return bucket.ordinaryUsageAllowed === false || bucket.spendControlReached === true
    || Boolean(bucket.rateLimitReachedType && bucket.rateLimitReachedType !== "none");
}

function quotaBlocked(account: ManagedAccount, modelId?: string): boolean {
  const snapshot = account.quotaSnapshot;
  if (snapshot && quotaBucketIsBlocked(snapshot)) return true;
  const windows = new Set(getAccountQuotaSelection(account, { modelId }).windows.map(window => window.id));
  return (snapshot?.buckets ?? []).some((bucket, index) =>
    (windows.has(`${bucket.limitId ?? index}:0`) || windows.has(`${bucket.limitId ?? index}:1`)) && quotaBucketIsBlocked(bucket));
}

export function getAccountReadiness(account: ManagedAccount, options: SmartSelectionOptions = {}): AccountReadiness {
  const resolved = optionsWithDefaults(options);
  const canSwitchManually = !account.archived && account.credentialState === "ready";
  const result = (state: SwitchCandidateState, reason: ReadinessReason, remainingPercent: number | null = null): AccountReadiness => ({
    state, reason, remainingPercent, canSwitchManually,
    canAutoSwitch: state === "ready" && account.quotaSnapshot?.ordinaryUsageAllowed !== null
      && (!account.isActive || account.runtimeVerification?.runtime === "verified")
  });
  if (account.credentialState !== "ready") return result("needs_reauth", "needs_reauth");
  if (account.archived) return result("unavailable", "blocked");
  if (hasCurrentQuotaRefreshFailure(account)) return result("needs_refresh", "refresh_failed");
  const capturedAt = account.quotaSnapshot?.capturedAt ?? account.lastRefreshAt;
  if (!capturedAt) return result("needs_refresh", "missing");
  if (resolved.now - capturedAt > resolved.staleAfterSeconds || capturedAt > resolved.now + 60) return result("needs_refresh", "stale");
  const { windows, remainingPercent: remaining } = getAccountQuotaSelection(account, resolved);
  if (windows.length === 0) return result("needs_refresh", options.modelId ? "model_unknown" : "missing");
  if (windows.some((window) => window.resetsAt !== null && window.resetsAt <= resolved.now)) return result("needs_refresh", "reset_passed");
  if (quotaBlocked(account, options.modelId) || remaining === null || remaining <= 0) return result("unavailable", "blocked", remaining);
  if (account.status === "error" || (account.platform !== "antigravity" && account.status === "limited")) return result("unavailable", "blocked");
  return result("ready", "ready", remaining);
}

export function rankSwitchCandidates(accounts: ManagedAccount[], options: SmartSelectionOptions = {}): RankedSwitchCandidate[] {
  const priority: Record<SwitchCandidateState, number> = { ready: 0, needs_refresh: 1, needs_reauth: 2, unavailable: 3 };
  return accounts.filter((account) => !account.isActive && (!options.provider || account.platform === options.provider))
    .map((account) => ({ account, ...getAccountReadiness(account, options) }))
    .sort((left, right) => priority[left.state] - priority[right.state]
      || (right.remainingPercent ?? -1) - (left.remainingPercent ?? -1)
      || (left.account.lastUsedAt ?? 0) - (right.account.lastUsedAt ?? 0)
      || left.account.label.localeCompare(right.account.label));
}

function scoreAccount(account: ManagedAccount, readiness: AccountReadiness, binding: WorkspaceBinding | null): number {
  let score = 100 - (readiness.remainingPercent ?? 0);
  if (account.status === "near_limit") score += 28;
  if (binding?.accountId === account.id) score -= 42;
  if (account.isActive) score -= 8;
  if (account.favorite) score -= 10;
  if (account.lastUsedAt) score -= 3;
  return score;
}

export function selectSmartAccount(accounts: ManagedAccount[], binding: WorkspaceBinding | null = null, options: SmartSelectionOptions = {}): SmartRecommendation | null {
  const candidates = accounts.filter((account) => !options.provider || account.platform === options.provider)
    .map((account) => ({ account, readiness: getAccountReadiness(account, options) }))
    .filter(({ readiness }) => readiness.state === "ready")
    .map(({ account, readiness }) => ({ account, score: scoreAccount(account, readiness, binding) }))
    .sort((left, right) => left.score - right.score || left.account.label.localeCompare(right.account.label));
  const selected = candidates[0];
  if (!selected) return null;
  return { accountId: selected.account.id, accountLabel: selected.account.label, accountEmail: selected.account.email,
    score: selected.score, workspaceMatched: binding?.accountId === selected.account.id,
    reason: binding?.accountId === selected.account.id ? "Привязан к текущей рабочей папке и доступен по лимитам"
      : selected.account.isActive ? "Выбранный профиль остаётся лучшим доступным вариантом"
      : "Свежие лимиты подтверждают доступный остаток" };
}

export function selectAutoSwitchAccount(accounts: ManagedAccount[], options: AutoSwitchOptions = {}): SmartRecommendation | null {
  const provider = options.provider ?? "codex";
  const active = accounts.find((account) => account.isActive && account.platform === provider);
  if (!active || active.runtimeVerification?.runtime !== "verified" || active.credentialState !== "ready"
    || active.quotaSnapshot?.ordinaryUsageAllowed === null) return null;
  const resolved = optionsWithDefaults(options);
  if (hasCurrentQuotaRefreshFailure(active)) return null;
  const capturedAt = active.quotaSnapshot?.capturedAt ?? active.lastRefreshAt;
  if (!capturedAt || resolved.now - capturedAt > resolved.staleAfterSeconds || capturedAt > resolved.now + 60) return null;
  const { windows, remainingPercent: activeRemaining } = getAccountQuotaSelection(active, options);
  if (windows.length === 0 || windows.some((window) => window.resetsAt !== null && window.resetsAt <= resolved.now)) return null;
  const threshold = Math.min(100, Math.max(0, options.thresholdPercent ?? 10));
  if (activeRemaining === null || activeRemaining > threshold) return null;
  const selected = rankSwitchCandidates(accounts, { ...options, provider }).find((candidate) =>
    candidate.canAutoSwitch && candidate.remainingPercent !== null && candidate.remainingPercent > threshold);
  if (!selected) return null;
  return { accountId: selected.account.id, accountLabel: selected.account.label, accountEmail: selected.account.email,
    score: 100 - selected.remainingPercent!, reason: "Verified runtime account crossed the configured limit threshold", workspaceMatched: false };
}
