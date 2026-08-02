import { describe, expect, it } from "vitest";
import type { ManagedAccount, WorkspaceBinding } from "../../src/shared/types";
import { rankSwitchCandidates, selectAutoSwitchAccount, selectSmartAccount } from "../../src/shared/smartSelection";

function account(input: Partial<ManagedAccount> & Pick<ManagedAccount, "id" | "label">): ManagedAccount {
  const { id, label, email, ...rest } = input;
  return {
    id,
    platform: input.platform ?? "codex",
    label,
    email: email ?? `${id}@example.com`,
    providerAccountId: null,
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: null,
    credentialState: "ready",
    lastAuthenticatedAt: null,
    expiresAt: null,
    version: 1,
    planType: "pro",
    profileDir: "test",
    isActive: false,
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: null,
    lastRefreshAt: null,
    subscriptionEndsAt: null,
    status: "active",
    statusReason: null,
    primaryUsedPercent: null,
    primaryResetsAt: null,
    primaryWindowDurationMins: null,
    secondaryUsedPercent: null,
    secondaryResetsAt: null,
    secondaryWindowDurationMins: null,
    fiveHourUsedPercent: 50,
    fiveHourResetsAt: null,
    weeklyUsedPercent: 10,
    weeklyResetsAt: null,
    notes: null,
    ...rest,
    authMode: rest.authMode ?? (input.platform === "antigravity" ? null : "chatgpt")
  };
}

describe("selectSmartAccount", () => {
  it("ignores limited and error accounts", () => {
    const recommendation = selectSmartAccount([
      account({ id: "blocked", label: "blocked", status: "limited", fiveHourUsedPercent: 1 }),
      account({ id: "broken", label: "broken", status: "error", fiveHourUsedPercent: 1 }),
      account({ id: "ready", label: "ready", fiveHourUsedPercent: 45 })
    ]);

    expect(recommendation?.accountId).toBe("ready");
  });

  it("prefers a usable workspace-bound account", () => {
    const binding: WorkspaceBinding = {
      workspacePath: "C:/work",
      accountId: "workspace",
      accountLabel: "workspace",
      accountEmail: "workspace@example.com"
    };

    const recommendation = selectSmartAccount([
      account({ id: "low", label: "low", fiveHourUsedPercent: 4 }),
      account({ id: "workspace", label: "workspace", fiveHourUsedPercent: 33 })
    ], binding);

    expect(recommendation).toMatchObject({ accountId: "workspace", workspaceMatched: true });
    expect(recommendation?.reason).toContain("рабочей папке");
  });

  it("chooses the lower loaded account when there is no binding", () => {
    const recommendation = selectSmartAccount([
      account({ id: "busy", label: "busy", fiveHourUsedPercent: 82 }),
      account({ id: "calm", label: "calm", fiveHourUsedPercent: 12 })
    ]);

    expect(recommendation?.accountId).toBe("calm");
  });

  it("ignores archived and stale accounts before auto switching", () => {
    const recommendation = selectSmartAccount([
      account({ id: "archived", label: "archived", archived: true, fiveHourUsedPercent: 1, lastRefreshAt: 100 }),
      account({ id: "stale", label: "stale", fiveHourUsedPercent: 2, lastRefreshAt: 1 }),
      account({ id: "fresh", label: "fresh", fiveHourUsedPercent: 35, lastRefreshAt: 100 })
    ], null, { now: 100, staleAfterSeconds: 15 });

    expect(recommendation?.accountId).toBe("fresh");
  });

  it("does not prefer a workspace-bound account when its snapshot is stale", () => {
    const binding: WorkspaceBinding = {
      workspacePath: "C:/work",
      accountId: "workspace",
      accountLabel: "workspace",
      accountEmail: "workspace@example.com"
    };

    const recommendation = selectSmartAccount([
      account({ id: "workspace", label: "workspace", fiveHourUsedPercent: 1, lastRefreshAt: 1 }),
      account({ id: "fresh", label: "fresh", fiveHourUsedPercent: 40, lastRefreshAt: 100 })
    ], binding, { now: 100, staleAfterSeconds: 15 });

    expect(recommendation).toMatchObject({ accountId: "fresh", workspaceMatched: false });
  });
});

describe("selectAutoSwitchAccount", () => {
  it("does not switch away from a healthy active account", () => {
    const recommendation = selectAutoSwitchAccount([
      account({ id: "active", label: "active", isActive: true, fiveHourUsedPercent: 50, weeklyUsedPercent: 20, lastRefreshAt: 100 }),
      account({ id: "fresh", label: "fresh", fiveHourUsedPercent: 2, weeklyUsedPercent: 2, lastRefreshAt: 100 })
    ], { now: 100, staleAfterSeconds: 15, thresholdPercent: 20 });

    expect(recommendation).toBeNull();
  });

  it("switches only when active account crosses threshold and candidate is above it", () => {
    const recommendation = selectAutoSwitchAccount([
      account({ id: "active", label: "active", isActive: true, fiveHourUsedPercent: 84, weeklyUsedPercent: 20, lastRefreshAt: 100 }),
      account({ id: "low", label: "low", fiveHourUsedPercent: 81, weeklyUsedPercent: 20, lastRefreshAt: 100 }),
      account({ id: "ready", label: "ready", fiveHourUsedPercent: 30, weeklyUsedPercent: 40, lastRefreshAt: 100 })
    ], { now: 100, staleAfterSeconds: 15, thresholdPercent: 20 });

    expect(recommendation?.accountId).toBe("ready");
  });
});

describe("rankSwitchCandidates", () => {
  it("never presents unknown or stale quota as a real zero-percent reserve", () => {
    const ranked = rankSwitchCandidates([
      account({ id: "active", label: "active", isActive: true, lastRefreshAt: 100 }),
      account({ id: "missing", label: "missing", fiveHourUsedPercent: null, weeklyUsedPercent: null, lastRefreshAt: null }),
      account({ id: "stale", label: "stale", lastRefreshAt: 1 })
    ], { now: 100, staleAfterSeconds: 15 });

    expect(ranked).toMatchObject([
      { account: { id: "missing" }, state: "needs_refresh", remainingPercent: null, reason: "missing" },
      { account: { id: "stale" }, state: "needs_refresh", remainingPercent: null, reason: "stale" }
    ]);
  });

  it("ranks a protected fresh profile ahead of accounts needing attention", () => {
    const ranked = rankSwitchCandidates([
      account({ id: "active", label: "active", isActive: true, lastRefreshAt: 100 }),
      account({ id: "reauth", label: "reauth", credentialState: "needs_reauth", lastRefreshAt: 100 }),
      account({ id: "ready", label: "ready", fiveHourUsedPercent: 25, weeklyUsedPercent: 10, lastRefreshAt: 100 })
    ], { now: 100, staleAfterSeconds: 15 });

    expect(ranked[0]).toMatchObject({ account: { id: "ready" }, state: "ready", remainingPercent: 75 });
    expect(ranked[1]).toMatchObject({ account: { id: "reauth" }, state: "needs_reauth", remainingPercent: null });
  });
});
