import { describe, expect, it } from "vitest";
import type { ManagedAccount } from "../../src/shared/types";
import { profilePresentation, quotaWindowLabel } from "../../src/renderer/profilePresentation";
import { formatQuotaReset } from "../../src/renderer/components/v3/OverviewPage";

function managedAccount(input: Partial<ManagedAccount> & Pick<ManagedAccount, "id" | "label">): ManagedAccount {
  const { id, label, ...overrides } = input;
  return {
    id,
    platform: "codex",
    label,
    email: `${id}@example.com`,
    authMode: "chatgpt",
    providerAccountId: id,
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: `${id}-fingerprint`,
    credentialState: "ready",
    lastAuthenticatedAt: 1_800_000_000,
    expiresAt: null,
    version: 1,
    planType: "plus",
    profileDir: id,
    isActive: false,
    createdAt: 1_800_000_000,
    updatedAt: 1_800_000_000,
    lastUsedAt: null,
    lastRefreshAt: 1_800_000_000,
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
    weeklyUsedPercent: 20,
    weeklyResetsAt: null,
    notes: null,
    ...overrides
  };
}

describe("Egoist profile presentation", () => {
  const now = 1_800_000_000;
  it("preserves fractional positive quota and never presents unknown as availability", () => {
    const view = profilePresentation(managedAccount({ id: "fraction", label: "Fraction", weeklyUsedPercent: 99.6 }), now, "ru");
    expect(view.formatRemaining(view.windows[0].remaining)).toBe("<1%");
    expect(view.formatRemaining(null)).toBe("—");
    const unknown = profilePresentation(managedAccount({ id: "unknown", label: "Unknown", weeklyUsedPercent: null }), now, "ru");
    expect(unknown.readiness.state).toBe("needs_refresh");
    expect(unknown.readiness.canSwitchManually).toBe(true);
  });
  it("uses actual known periods and keeps unreported periods unnamed", () => {
    expect(quotaWindowLabel(120, "ru")).toBe("2 ч");
    expect(quotaWindowLabel(10_080, "en")).toBe("weekly");
    expect(quotaWindowLabel(null, "ru")).toBe("Период неизвестен");
  });
  it("ages without a provider refresh and preserves the last good quota on error", () => {
    const account = managedAccount({ id: "age", label: "Age", weeklyUsedPercent: 48 });
    expect(profilePresentation(account, now, "ru").freshness).toBe("Свежий");
    expect(profilePresentation(account, now + 960, "ru").freshness).toBe("Устарел");
    const failed = profilePresentation({ ...account, lastRefreshError: "offline", lastRefreshErrorAt: now + 1 }, now + 2, "en");
    expect(failed.freshness).toBe("Refresh failed");
    expect(failed.windows[0].remaining).toBe(52);
    expect(failed.readiness.canAutoSwitch).toBe(false);
  });
  it("does not promise restored quota when a timer elapsed", () => {
    expect(formatQuotaReset(now - 1, now, false)).toBe("Сброс требует проверки");
    expect(formatQuotaReset(null, now, true)).toBe("Reset time unknown");
  });
});
