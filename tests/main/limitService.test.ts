import { describe, expect, it } from "vitest";
import { selectBestAccount } from "../../src/main/services/limitService";
import type { ManagedAccount } from "../../src/shared/types";

function account(input: Partial<ManagedAccount>): ManagedAccount {
  return {
    id: input.id ?? "a",
    platform: input.platform ?? "codex",
    label: input.label ?? "Аккаунт",
    email: input.email ?? "user@example.com",
    authMode: input.platform === "antigravity" ? null : "chatgpt",
    providerAccountId: null,
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: null,
    credentialState: "ready",
    lastAuthenticatedAt: null,
    expiresAt: null,
    version: 1,
    planType: "plus",
    profileDir: "",
    isActive: input.isActive ?? false,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    lastRefreshAt: input.lastRefreshAt ?? Math.floor(Date.now() / 1000),
    subscriptionEndsAt: null,
    status: input.status ?? "active",
    statusReason: input.statusReason ?? null,
    primaryUsedPercent: input.primaryUsedPercent ?? null,
    primaryResetsAt: input.primaryResetsAt ?? null,
    primaryWindowDurationMins: null,
    secondaryUsedPercent: null,
    secondaryResetsAt: null,
    secondaryWindowDurationMins: null,
    fiveHourUsedPercent: input.fiveHourUsedPercent ?? null,
    fiveHourResetsAt: input.fiveHourResetsAt ?? null,
    weeklyUsedPercent: input.weeklyUsedPercent ?? null,
    weeklyResetsAt: input.weeklyResetsAt ?? null,
    notes: null
  };
}

describe("limit recommendation", () => {
  it("excludes limited and stale accounts and explains the recommendation in Russian", () => {
    const result = selectBestAccount(
      [
        account({ id: "limited", status: "limited", fiveHourUsedPercent: 100 }),
        account({ id: "stale", lastRefreshAt: 1, fiveHourUsedPercent: 0 }),
        account({ id: "free", fiveHourUsedPercent: 10, weeklyUsedPercent: 20 })
      ],
      { staleAfterSeconds: 900 }
    );

    expect(result?.account.id).toBe("free");
    expect(result?.reason).toBe("Минимальная нагрузка по лимитам.");
  });
});
