import { describe, expect, it } from "vitest";
import { QuotaAlertService } from "../../src/main/services/quotaAlertService";
import type { ManagedAccount } from "../../src/shared/types";

const now = 2_000_000;

function account(input: Partial<ManagedAccount> & Pick<ManagedAccount, "id" | "label">): ManagedAccount {
  return {
    id: input.id,
    platform: input.platform ?? "codex",
    label: input.label,
    email: input.email ?? `${input.id}@example.com`,
    authMode: input.authMode ?? "chatgpt",
    providerAccountId: null,
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: `${input.id}-fingerprint`,
    credentialState: "ready",
    lastAuthenticatedAt: now - 100,
    expiresAt: null,
    version: 1,
    planType: "pro",
    profileDir: input.id,
    isActive: input.isActive ?? false,
    createdAt: now - 1000,
    updatedAt: now - 10,
    lastUsedAt: now - 20,
    lastRefreshAt: input.lastRefreshAt === undefined ? now - 30 : input.lastRefreshAt,
    subscriptionEndsAt: null,
    status: input.status ?? "active",
    statusReason: null,
    primaryUsedPercent: input.primaryUsedPercent ?? input.fiveHourUsedPercent ?? 20,
    primaryResetsAt: input.primaryResetsAt ?? input.fiveHourResetsAt ?? now + 3600,
    primaryWindowDurationMins: 300,
    secondaryUsedPercent: input.secondaryUsedPercent ?? input.weeklyUsedPercent ?? 20,
    secondaryResetsAt: input.secondaryResetsAt ?? input.weeklyResetsAt ?? now + 86_400,
    secondaryWindowDurationMins: 10_080,
    fiveHourUsedPercent: input.fiveHourUsedPercent ?? 20,
    fiveHourResetsAt: input.fiveHourResetsAt ?? now + 3600,
    weeklyUsedPercent: input.weeklyUsedPercent ?? 20,
    weeklyResetsAt: input.weeklyResetsAt ?? now + 86_400,
    notes: null,
    archived: input.archived ?? false,
    favorite: input.favorite ?? false,
    antigravity: null
  };
}

function harness() {
  let raw: string | null = null;
  const service = new QuotaAlertService({
    now: () => now,
    readState: () => raw,
    writeState: (value) => {
      raw = value;
    }
  });
  return { service, state: () => raw };
}

describe("QuotaAlertService", () => {
  it("emits only once for the same confirmed quota window", () => {
    const { service, state } = harness();
    const accounts = [
      account({ id: "active", label: "main", isActive: true, fiveHourUsedPercent: 94, primaryUsedPercent: 94 }),
      account({ id: "spare", label: "reserve", fiveHourUsedPercent: 20, primaryUsedPercent: 20 })
    ];

    const first = service.evaluate(accounts, 10);
    const second = service.evaluate(accounts, 10);

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      accountId: "active",
      windowType: "5h",
      remainingPercent: 6,
      recommendedAccountId: "spare",
      recommendedAccountLabel: "reserve"
    });
    expect(second).toEqual([]);
    expect(state()).not.toContain("example.com");
  });

  it("emits again after the provider reports a new reset window", () => {
    const { service } = harness();
    const firstWindow = account({ id: "active", label: "main", isActive: true, fiveHourUsedPercent: 96, primaryUsedPercent: 96 });
    expect(service.evaluate([firstWindow], 10)).toHaveLength(1);

    const nextWindow = account({
      id: "active",
      label: "main",
      isActive: true,
      fiveHourUsedPercent: 95,
      primaryUsedPercent: 95,
      fiveHourResetsAt: now + 7200,
      primaryResetsAt: now + 7200
    });
    expect(service.evaluate([nextWindow], 10)).toHaveLength(1);
  });

  it("does not alert for stale, unknown, inferred, expired or non-active quotas", () => {
    const { service } = harness();
    const accounts = [
      account({ id: "stale", label: "stale", isActive: true, fiveHourUsedPercent: 99, primaryUsedPercent: 99, lastRefreshAt: now - 3600 }),
      account({ id: "unknown", label: "unknown", isActive: true, fiveHourUsedPercent: 99, primaryUsedPercent: 99, status: "unknown" }),
      account({ id: "expired", label: "expired", isActive: true, fiveHourUsedPercent: 99, primaryUsedPercent: 99, fiveHourResetsAt: now - 1, primaryResetsAt: now - 1 }),
      account({ id: "inactive", label: "inactive", fiveHourUsedPercent: 99, primaryUsedPercent: 99 }),
      account({ id: "antigravity", label: "ag", platform: "antigravity", authMode: null, isActive: true, primaryUsedPercent: 99 })
    ];

    expect(service.evaluate(accounts, 10)).toEqual([]);
  });

  it("does not recommend stale or threshold-crossed spare profiles", () => {
    const { service } = harness();
    const alerts = service.evaluate([
      account({ id: "active", label: "main", isActive: true, fiveHourUsedPercent: 95, primaryUsedPercent: 95 }),
      account({ id: "stale-spare", label: "stale", fiveHourUsedPercent: 10, primaryUsedPercent: 10, lastRefreshAt: now - 5000 }),
      account({ id: "low-spare", label: "low", fiveHourUsedPercent: 92, primaryUsedPercent: 92 })
    ], 10);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].recommendedAccountId).toBeNull();
  });
});
