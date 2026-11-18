import { describe, expect, it, vi } from "vitest";
import { getAccountQuotaSelection, getAccountReadiness, rankSwitchCandidates, selectAutoSwitchAccount, selectSmartAccount } from "../../src/shared/smartSelection";
import { fetchAntigravityQuota, parseSummaryGroups } from "../../src/main/services/antigravityQuotaService";
import { buildProviderQuotaState } from "../../src/shared/providerAdapter";
import { classifyAuthValidationError } from "../../src/shared/authState";
import type { ManagedAccount } from "../../src/shared/types";

const now = 1_900_000_000;
const context = { googleProjectId: null, tier: "free" as const, tierId: "free-tier", source: "code_assist" as const, errorReason: null };

function account(id: string, extra: Partial<ManagedAccount> = {}): ManagedAccount {
  return { id, label: id, platform: "codex", credentialState: "ready", status: "active", isActive: false,
    fiveHourUsedPercent: 40, weeklyUsedPercent: 20, primaryUsedPercent: null, secondaryUsedPercent: null,
    lastRefreshAt: now, ...extra } as ManagedAccount;
}

describe("quota evidence regressions", () => {
  it("does not rank unknown quota as less loaded than a known profile", () => {
    const result = selectSmartAccount([
      account("unknown", { fiveHourUsedPercent: null, weeklyUsedPercent: null }), account("known")
    ], null, { now });
    expect(result?.accountId).toBe("known");
  });

  it("uses a bounded default freshness policy and rejects a passed reset", () => {
    expect(selectSmartAccount([account("stale", { lastRefreshAt: now - 16 * 60 })], null, { now })).toBeNull();
    expect(rankSwitchCandidates([account("reset", { fiveHourResetsAt: now - 1 })], { now })[0]?.state).toBe("needs_refresh");
  });

  it("allows Antigravity recommendations and requires runtime proof before automatic actions", () => {
    expect(rankSwitchCandidates([account("ag", { platform: "antigravity" })], { now })[0]?.account.id).toBe("ag");
    expect(selectAutoSwitchAccount([
      account("selected", { isActive: true, fiveHourUsedPercent: 98 }), account("target")
    ], { now })).toBeNull();
  });

  it("retains manual switching but disables automatic decisions for explicitly unknown ordinary usage", () => {
    const selected = account("selected", { isActive: true, runtimeVerification: { profileApplied: true,
      credentials: "online_verified", credentialMethod: "fixture", launch: "process_started", runtime: "verified",
      runtimeSource: "fixture", observedEmail: null, observedAt: now, runtimePid: 1, message: "fixture" },
      quotaSnapshot: { limitId: "codex", limitName: "Codex", primary: { usedPercent: 98, windowDurationMins: 300, resetsAt: now + 1000 },
        secondary: null, credits: null, planType: "plus", rateLimitReachedType: null, capturedAt: now, ordinaryUsageAllowed: null } });
    expect(getAccountReadiness(selected, { now })).toMatchObject({ canSwitchManually: true, canAutoSwitch: false });
    expect(selectAutoSwitchAccount([selected, account("target")], { now })).toBeNull();
  });

  it("preserves fractional usage in provider-neutral display data", () => {
    const state = buildProviderQuotaState(account("fraction", { primaryUsedPercent: 99.6 }));
    expect(state.used).toBe(99.6);
    expect(state.remaining).toBeCloseTo(0.4);
  });

  it("applies a model spend-control flag to that model without exhausting an unrelated aggregate", () => {
    const window = { usedPercent: 20, windowDurationMins: 300, resetsAt: now + 1000 };
    const input = account("scoped", { quotaSnapshot: { limitId: "codex", limitName: "Codex", primary: window,
      secondary: null, credits: null, planType: "plus", rateLimitReachedType: null, capturedAt: now,
      buckets: [
        { limitId: "codex", limitName: "Codex", primary: window, secondary: null },
        { limitId: "model-limit", limitName: "Model", modelId: "model-a", primary: window, secondary: null, spendControlReached: true }
      ] } });
    expect(getAccountReadiness(input, { now }).state).toBe("ready");
    expect(getAccountReadiness(input, { now, modelId: "model-a" })).toMatchObject({ state: "unavailable", reason: "blocked" });
  });

  it("does not prefer a blocked Antigravity model over another usable model", () => {
    const window = (usedPercent: number) => ({ usedPercent, windowDurationMins: 300, resetsAt: now + 1000 });
    const input = account("ag-flags", { platform: "antigravity", quotaSnapshot: { limitId: "model-limit-a", limitName: "A", primary: window(20),
      secondary: null, credits: null, planType: "unknown", rateLimitReachedType: null, capturedAt: now,
      buckets: [
        { limitId: "model-limit-a", limitName: "A", modelId: "model-a", primary: window(20), secondary: null, spendControlReached: true },
        { limitId: "model-limit-b", limitName: "B", modelId: "model-b", primary: window(50), secondary: null }
      ] } });
    expect(getAccountQuotaSelection(input).remainingPercent).toBe(50);
    expect(getAccountReadiness(input, { now }).state).toBe("ready");
    expect(getAccountReadiness(input, { now, modelId: "model-a" }).state).toBe("unavailable");
  });

  it("does not interpret a generic provider prohibition as an expired credential", () => {
    expect(classifyAuthValidationError(new Error("HTTP 403 regional restriction"))).toBe("validation_failed");
  });

  it("keeps a positive fractional balance and does not guess window duration from reset time", () => {
    const groups = { groups: [{ buckets: [{ bucketId: "a", remainingFraction: 0.004, resetTime: new Date((now + 5 * 3600) * 1000).toISOString() }] }] };
    const [earlier] = parseSummaryGroups(groups, now - 2 * 3600);
    const [later] = parseSummaryGroups(groups, now);
    expect(later.usedPercent).toBe(99.6);
    expect(earlier.windowDurationMins).toBeNull();
    expect(later.windowDurationMins).toBeNull();
    expect(parseSummaryGroups({ groups: [{ buckets: [{ window: "1 hour", remainingFraction: 0.5 }] }] }, now)[0]?.windowDurationMins).toBe(60);
  });

  it.each([401, 429])("stops at the first HTTP %s instead of querying nine environments", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "provider rejected request" } }), {
      status, headers: { "Retry-After": "600" }
    }));
    await expect(fetchAntigravityQuota({ accessToken: "fixture", accountContext: context, fetchImpl: fetchImpl as typeof fetch, now: () => now }))
      .rejects.toMatchObject({ statusCode: status, retryAfterSeconds: 600 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
