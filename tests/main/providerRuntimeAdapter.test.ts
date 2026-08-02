import { describe, expect, it, vi } from "vitest";
import { createProviderRuntimeAdapters } from "../../src/main/services/providerRuntimeAdapter";
import type { AuthValidationState, LimitHistoryPoint, ManagedAccount } from "../../src/shared/types";

function account(input: Partial<ManagedAccount> & Pick<ManagedAccount, "id" | "platform" | "isActive">): ManagedAccount {
  return {
    label: input.id,
    email: `${input.id}@example.com`,
    providerAccountId: null,
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: null,
    credentialState: "ready",
    lastAuthenticatedAt: null,
    expiresAt: null,
    version: 1,
    planType: "unknown",
    profileDir: "profile",
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: null,
    lastRefreshAt: null,
    subscriptionEndsAt: null,
    status: "unknown",
    statusReason: null,
    primaryUsedPercent: null,
    primaryResetsAt: null,
    primaryWindowDurationMins: null,
    secondaryUsedPercent: null,
    secondaryResetsAt: null,
    secondaryWindowDurationMins: null,
    fiveHourUsedPercent: null,
    fiveHourResetsAt: null,
    weeklyUsedPercent: null,
    weeklyResetsAt: null,
    notes: null,
    ...input,
    authMode: input.authMode ?? (input.platform === "antigravity" ? null : "chatgpt")
  };
}

describe("provider runtime adapters", () => {
  it("detects the active account per provider without leaking provider internals", async () => {
    const codex = account({ id: "codex_active", platform: "codex", isActive: true });
    const antigravity = account({ id: "ag_active", platform: "antigravity", isActive: true });
    const manager = {
      list: () => [codex, antigravity],
      validateAuth: vi.fn(),
      refreshAccount: vi.fn(),
      switchAccount: vi.fn(),
      getLimitHistory: vi.fn()
    };

    const adapters = createProviderRuntimeAdapters(manager);

    await expect(adapters.codex.detectActiveAccount()).resolves.toEqual(codex);
    await expect(adapters.antigravity.detectActiveAccount()).resolves.toEqual(antigravity);
  });

  it("delegates auth validation and switching only for matching provider accounts", async () => {
    const auth: AuthValidationState = { state: "authorized", lastValidatedAt: 1_800_000_000, errorReason: null };
    const codex = account({ id: "codex_1", platform: "codex", isActive: false });
    const antigravity = account({ id: "ag_1", platform: "antigravity", isActive: false });
    const manager = {
      list: () => [codex, antigravity],
      validateAuth: vi.fn(async () => auth),
      refreshAccount: vi.fn(),
      switchAccount: vi.fn(async () => codex),
      getLimitHistory: vi.fn()
    };

    const adapters = createProviderRuntimeAdapters(manager);

    await expect(adapters.codex.validateAuth("codex_1")).resolves.toBe(auth);
    await expect(adapters.codex.switchAccount("codex_1")).resolves.toBe(codex);
    await expect(adapters.codex.validateAuth("ag_1")).rejects.toThrow("does not belong to provider codex");
    expect(manager.validateAuth).toHaveBeenCalledTimes(1);
    expect(manager.switchAccount).toHaveBeenCalledTimes(1);
  });

  it("returns quota and history through provider-neutral shapes", async () => {
    const history: LimitHistoryPoint[] = [{
      accountId: "codex_1",
      capturedAt: 1_800_000_000,
      status: "active",
      statusReason: null,
      fiveHourUsedPercent: 20,
      weeklyUsedPercent: 10,
      primaryUsedPercent: 20,
      secondaryUsedPercent: 10
    }];
    const codex = account({
      id: "codex_1",
      platform: "codex",
      isActive: true,
      primaryUsedPercent: 20,
      primaryResetsAt: 1_800_010_000,
      primaryWindowDurationMins: 300,
      lastRefreshAt: 1_800_000_000
    });
    const manager = {
      list: () => [codex],
      validateAuth: vi.fn(),
      refreshAccount: vi.fn(),
      switchAccount: vi.fn(),
      getLimitHistory: vi.fn(() => history)
    };

    const adapters = createProviderRuntimeAdapters(manager);

    expect(await adapters.codex.getQuotaState("codex_1")).toMatchObject({
      provider: "codex",
      accountId: "codex_1",
      used: 20,
      source: "official_api"
    });
    expect(await adapters.codex.getHistory("codex_1")).toBe(history);
  });
});
