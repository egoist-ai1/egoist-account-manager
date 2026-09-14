import { describe, expect, it, vi } from "vitest";
import { QuotaWarmupService } from "../../src/main/services/quotaWarmupService.js";
import type { AccountManager } from "../../src/main/accountManager.js";
import type { ManagedAccount } from "../../src/shared/types.js";

function mockAccount(overrides: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    id: "acc-warmup-1",
    platform: "codex",
    label: "Warmup Codex",
    email: "warmup@example.com",
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
    primaryUsedPercent: 10,
    primaryResetsAt: null,
    primaryWindowDurationMins: 300,
    secondaryUsedPercent: null,
    secondaryResetsAt: null,
    secondaryWindowDurationMins: null,
    fiveHourUsedPercent: null,
    fiveHourResetsAt: null,
    weeklyUsedPercent: null,
    weeklyResetsAt: null,
    notes: null,
    ...overrides
  };
}

describe("QuotaWarmupService", () => {
  it("skips account if timer is already active with remaining time", async () => {
    const futureReset = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now
    const account = mockAccount({ primaryResetsAt: futureReset });

    const mockStore = {
      get: vi.fn().mockReturnValue(account),
      list: vi.fn().mockReturnValue([account])
    };

    const mockManager = {
      getStore: () => mockStore,
      list: () => [account],
      refreshAccount: vi.fn(),
      requireCodexPath: () => null
    } as unknown as AccountManager;

    const service = new QuotaWarmupService(mockManager);
    const result = await service.warmupAccount(account.id);

    expect(result.status).toBe("already_active");
    expect(result.message).toContain("Таймер уже запущен");
    expect(mockManager.refreshAccount).not.toHaveBeenCalled();
  });

  it("triggers warmup and returns refreshed timer when account has no active reset", async () => {
    const account = mockAccount({ primaryResetsAt: null });
    const futureReset = Math.floor(Date.now() / 1000) + 18000;
    const refreshedAccount = { ...account, primaryResetsAt: futureReset };

    const mockStore = {
      get: vi.fn().mockReturnValue(account),
      list: vi.fn().mockReturnValue([account])
    };

    const mockManager = {
      getStore: () => mockStore,
      list: () => [account],
      refreshAccount: vi.fn().mockResolvedValue(refreshedAccount),
      requireCodexPath: () => null
    } as unknown as AccountManager;

    const service = new QuotaWarmupService(mockManager);
    const result = await service.warmupAccount(account.id);

    expect(result.status).toBe("triggered");
    expect(result.resetsAt).toBe(futureReset);
    expect(result.message).toContain("Таймер успешно запущен");
    expect(mockManager.refreshAccount).toHaveBeenCalledWith(account.id);
  });

  it("warms up all non-archived accounts across fleet", async () => {
    const acc1 = mockAccount({ id: "acc-1", label: "Codex 1", primaryResetsAt: null });
    const acc2 = mockAccount({ id: "acc-2", label: "Codex 2", primaryResetsAt: Math.floor(Date.now() / 1000) + 5000 });
    const accArchived = mockAccount({ id: "acc-3", label: "Archived", archived: true });

    const mockStore = {
      get: vi.fn((id) => (id === "acc-1" ? acc1 : id === "acc-2" ? acc2 : accArchived)),
      list: vi.fn().mockReturnValue([acc1, acc2, accArchived])
    };

    const mockManager = {
      getStore: () => mockStore,
      list: () => [acc1, acc2, accArchived],
      refreshAccount: vi.fn().mockResolvedValue({ ...acc1, primaryResetsAt: Math.floor(Date.now() / 1000) + 18000 }),
      requireCodexPath: () => null
    } as unknown as AccountManager;

    const service = new QuotaWarmupService(mockManager);
    const summary = await service.warmupAll();

    expect(summary.total).toBe(2); // Excludes archived
    expect(summary.triggered).toBe(1);
    expect(summary.alreadyActive).toBe(1);
    expect(summary.failed).toBe(0);
  });
});
