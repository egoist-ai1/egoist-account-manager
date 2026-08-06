import { describe, expect, it } from "vitest";
import { accountPlanPriority, selectAccountListQuota, sortAccountList } from "../../src/shared/accountListPresentation";
import type { ManagedAccount } from "../../src/shared/types";

const now = 1_900_000_000;

function account(id: string, input: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    id,
    platform: "codex",
    label: id,
    email: `${id}@example.com`,
    authMode: "chatgpt",
    providerAccountId: id,
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: id,
    credentialState: "ready",
    lastAuthenticatedAt: now - 100,
    expiresAt: null,
    version: 1,
    planType: "plus",
    profileDir: id,
    isActive: false,
    createdAt: now - 1000,
    updatedAt: now - 100,
    lastUsedAt: null,
    lastRefreshAt: now - 60,
    lastRefreshErrorAt: null,
    lastRefreshError: null,
    subscriptionEndsAt: null,
    status: "active",
    statusReason: null,
    primaryUsedPercent: null,
    primaryResetsAt: null,
    primaryWindowDurationMins: null,
    secondaryUsedPercent: null,
    secondaryResetsAt: null,
    secondaryWindowDurationMins: null,
    fiveHourUsedPercent: null,
    fiveHourResetsAt: null,
    weeklyUsedPercent: 50,
    weeklyResetsAt: now + 7 * 86400,
    notes: null,
    tags: [],
    favorite: false,
    archived: false,
    antigravity: null,
    ...input
  };
}

describe("account list presentation", () => {
  it("pins the active account, then ranks usable profiles by plan before remaining quota", () => {
    const active = account("active-go", { isActive: true, planType: "go", weeklyUsedPercent: 99 });
    const plus = account("plus-roomy", { planType: "plus", weeklyUsedPercent: 5 });
    const pro5 = account("pro-x5", { planType: "pro-x5", weeklyUsedPercent: 90 });
    const pro20 = account("pro-x20", { planType: "pro-x20", weeklyUsedPercent: 98 });

    expect(sortAccountList([plus, pro5, active, pro20], "smart", now).map((item) => item.id)).toEqual([
      "active-go",
      "pro-x20",
      "pro-x5",
      "plus-roomy"
    ]);
  });

  it("keeps broken profiles below usable ones even when their plan is stronger", () => {
    const readyPlus = account("ready-plus", { planType: "plus" });
    const brokenPro20 = account("broken-pro20", { planType: "pro-x20", credentialState: "needs_reauth" });

    expect(sortAccountList([brokenPro20, readyPlus], "smart", now).map((item) => item.id)).toEqual([
      "ready-plus",
      "broken-pro20"
    ]);
  });

  it("uses remaining quota, reset, freshness, added date and plan as explicit orders", () => {
    const olderPlus = account("older-plus", { planType: "plus", weeklyUsedPercent: 20, weeklyResetsAt: now + 500, lastRefreshAt: now - 20, createdAt: now - 900 });
    const newerGo = account("newer-go", { planType: "go", weeklyUsedPercent: 10, weeklyResetsAt: now + 900, lastRefreshAt: now - 10, createdAt: now - 100 });

    expect(sortAccountList([olderPlus, newerGo], "remaining", now)[0].id).toBe("newer-go");
    expect(sortAccountList([olderPlus, newerGo], "reset", now)[0].id).toBe("older-plus");
    expect(sortAccountList([olderPlus, newerGo], "freshness", now)[0].id).toBe("newer-go");
    expect(sortAccountList([olderPlus, newerGo], "added", now)[0].id).toBe("newer-go");
    expect(sortAccountList([newerGo, olderPlus], "subscription", now)[0].id).toBe("older-plus");
  });

  it("selects the most restrictive known limit for the compact list", () => {
    const profile = account("dual-window", {
      fiveHourUsedPercent: 25,
      fiveHourResetsAt: now + 3600,
      weeklyUsedPercent: 80,
      weeklyResetsAt: now + 86400
    });

    expect(selectAccountListQuota(profile, now)).toMatchObject({
      remainingPercent: 20,
      resetAt: now + 86400,
      windowType: "weekly"
    });
  });

  it("recognizes the requested subscription hierarchy", () => {
    expect(accountPlanPriority(account("free", { planType: "free" }))).toBeLessThan(accountPlanPriority(account("go", { planType: "go" })));
    expect(accountPlanPriority(account("go", { planType: "go" }))).toBeLessThan(accountPlanPriority(account("plus", { planType: "plus" })));
    expect(accountPlanPriority(account("plus", { planType: "plus" }))).toBeLessThan(accountPlanPriority(account("pro5", { planType: "pro-x5" })));
    expect(accountPlanPriority(account("pro5", { planType: "pro-x5" }))).toBeLessThan(accountPlanPriority(account("pro20", { planType: "pro-x20" })));
  });

  it("uses normalized codepoint names and immutable ids as the final deterministic tie-break", () => {
    const sameLabelB = account("id-b", { label: "Alpha" });
    const sameLabelA = account("id-a", { label: "Alpha" });
    const lowerCase = account("id-lower", { label: "alpha" });
    const accented = account("id-accent", { label: "éclair" });

    expect(sortAccountList([sameLabelB, accented, lowerCase, sameLabelA], "name", now).map((item) => item.id)).toEqual([
      "id-a",
      "id-b",
      "id-lower",
      "id-accent"
    ]);
    expect(sortAccountList([sameLabelB, sameLabelA], "smart", now).map((item) => item.id)).toEqual(["id-a", "id-b"]);
  });
});
