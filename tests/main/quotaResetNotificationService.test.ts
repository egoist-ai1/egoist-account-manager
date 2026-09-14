import { describe, expect, it } from "vitest";
import { QuotaResetNotificationService, type QuotaResetNotification } from "../../src/main/services/quotaResetNotificationService.js";
import type { ManagedAccount } from "../../src/shared/types.js";

function mockAccount(overrides: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    id: "acc-1",
    platform: "codex",
    label: "Test Account",
    email: "test@example.com",
    authMode: "chatgpt",
    providerAccountId: "acc-1",
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: "fp",
    credentialState: "ready",
    lastAuthenticatedAt: 1000,
    expiresAt: null,
    version: 1,
    planType: "plus",
    profileDir: "p1",
    isActive: true,
    createdAt: 1000,
    updatedAt: 1000,
    lastUsedAt: 1000,
    lastRefreshAt: 1000,
    subscriptionEndsAt: null,
    status: "active",
    statusReason: null,
    primaryUsedPercent: 100,
    primaryResetsAt: 2000,
    primaryWindowDurationMins: 300,
    secondaryUsedPercent: 20,
    secondaryResetsAt: 10000,
    secondaryWindowDurationMins: 10080,
    fiveHourUsedPercent: null,
    fiveHourResetsAt: null,
    weeklyUsedPercent: null,
    weeklyResetsAt: null,
    notes: null,
    ...overrides
  };
}

describe("QuotaResetNotificationService", () => {
  it("does not fire notifications on startup for already passed reset times", () => {
    const notifications: QuotaResetNotification[] = [];
    const currentTime = 1500;
    const service = new QuotaResetNotificationService({
      onNotify: (n) => notifications.push(n),
      now: () => currentTime
    });

    // Account with reset in the past (1000 <= 1500)
    const account = mockAccount({ primaryResetsAt: 1000 });
    service.onAccountsUpdated([account]);
    service.checkTimeBasedResets();

    expect(notifications).toHaveLength(0);
  });

  it("fires notification and triggers refresh when time reaches resetAt", () => {
    const notifications: QuotaResetNotification[] = [];
    const refreshedIds: string[] = [];
    let currentTime = 1500;

    const service = new QuotaResetNotificationService({
      onNotify: (n) => notifications.push(n),
      onTriggerRefresh: (id) => refreshedIds.push(id),
      now: () => currentTime
    });

    const account = mockAccount({
      id: "codex-1",
      label: "My Codex",
      platform: "codex",
      primaryResetsAt: 2000
    });

    // Initial load: reset is at 2000, current is 1500
    service.onAccountsUpdated([account]);
    expect(notifications).toHaveLength(0);

    // Time advances to 1999: still nothing
    currentTime = 1999;
    service.checkTimeBasedResets();
    expect(notifications).toHaveLength(0);

    // Time reaches 2000: reset fires!
    currentTime = 2000;
    service.checkTimeBasedResets();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].accountId).toBe("codex-1");
    expect(notifications[0].title).toContain("Codex · Лимиты восстановлены");
    expect(notifications[0].body).toContain("My Codex");
    expect(refreshedIds).toEqual(["codex-1"]);

    // Subsequent tick: does not duplicate
    service.checkTimeBasedResets();
    expect(notifications).toHaveLength(1);
  });

  it("formats Antigravity notifications with distinctive styling", () => {
    const notifications: QuotaResetNotification[] = [];
    let currentTime = 1500;

    const service = new QuotaResetNotificationService({
      onNotify: (n) => notifications.push(n),
      now: () => currentTime
    });

    const account = mockAccount({
      id: "ag-1",
      label: "Google Antigravity",
      platform: "antigravity",
      primaryResetsAt: 1800
    });

    service.onAccountsUpdated([account]);
    currentTime = 1805;
    service.checkTimeBasedResets();

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain("Antigravity · Лимиты восстановлены");
    expect(notifications[0].body).toContain("Google Antigravity");
  });

  it("detects quota jump when account was low and is now refreshed", () => {
    const notifications: QuotaResetNotification[] = [];
    const currentTime = 1500;

    const service = new QuotaResetNotificationService({
      onNotify: (n) => notifications.push(n),
      now: () => currentTime
    });

    // Account currently at 100% used (0% remaining)
    const accountLow = mockAccount({
      id: "acc-jump",
      label: "Jump Account",
      primaryUsedPercent: 95
    });

    service.onAccountsUpdated([accountLow]);
    expect(notifications).toHaveLength(0);

    // Account refreshed, now at 5% used (95% remaining)
    const accountFull = mockAccount({
      id: "acc-jump",
      label: "Jump Account",
      primaryUsedPercent: 5,
      primaryResetsAt: 5000
    });

    service.onAccountsUpdated([accountFull]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].accountId).toBe("acc-jump");
  });
});
