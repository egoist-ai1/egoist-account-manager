import { describe, expect, it } from "vitest";
import type { CodexCredentialStoreDiagnostics, ManagedAccount } from "../../src/shared/types";
import {
  formatCredentialStore,
  formatQuotaReset,
  selectNearestQuotaReset
} from "../../src/renderer/components/v3/OverviewPage";

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

function credentialStore(
  input: Partial<CodexCredentialStoreDiagnostics> = {}
): CodexCredentialStoreDiagnostics {
  return {
    configuredMode: "file",
    effectiveStore: "file",
    authJsonPresent: true,
    managerCompatible: true,
    message: "compatible",
    ...input
  };
}

describe("OverviewPage presentation model", () => {
  it("presents the documented default as a file store instead of raw unspecified state", () => {
    const diagnostics = credentialStore({ configuredMode: "unspecified" });

    expect(formatCredentialStore(diagnostics, false)).toBe("Файл · по умолчанию");
    expect(formatCredentialStore(diagnostics, true)).toBe("File · default");
  });

  it("keeps incompatible credential modes explicit", () => {
    expect(formatCredentialStore(credentialStore({ configuredMode: "keyring", effectiveStore: "keyring" }), false))
      .toBe("Хранилище Windows");
    expect(formatCredentialStore(credentialStore({ configuredMode: "auto", effectiveStore: "unknown" }), false))
      .toBe("Автовыбор");
    expect(formatCredentialStore(credentialStore({ configuredMode: "invalid", effectiveStore: "unknown" }), false))
      .toBe("Ошибка настройки");
  });

  it("formats reset windows with readable Russian plurals", () => {
    const now = 1_000_000;

    expect(formatQuotaReset(now + 60, now, false)).toBe("Сброс через 1 минуту");
    expect(formatQuotaReset(now + 2 * 3600, now, false)).toBe("Сброс через 2 часа");
    expect(formatQuotaReset(now + 5 * 3600, now, false)).toBe("Сброс через 5 часов");
    expect(formatQuotaReset(now + 6 * 86_400, now, false)).toBe("Сброс через 6 дней");
    expect(formatQuotaReset(null, now, false)).toBe("Обновите, чтобы узнать сброс");
  });

  it("selects the nearest truthful reset across protected non-archived profiles", () => {
    const now = 1_800_000_000;
    const active = managedAccount({
      id: "active",
      label: "Активный",
      isActive: true,
      weeklyResetsAt: now + 7 * 86_400
    });
    const reserve = managedAccount({
      id: "reserve",
      label: "Резерв",
      weeklyResetsAt: now + 5 * 86_400
    });
    const archived = managedAccount({
      id: "archived",
      label: "Архивный",
      archived: true,
      weeklyResetsAt: now + 86_400
    });
    const needsReauth = managedAccount({
      id: "reauth",
      label: "Нужен вход",
      credentialState: "needs_reauth",
      weeklyResetsAt: now + 2 * 86_400
    });

    expect(selectNearestQuotaReset([active, reserve, archived, needsReauth], now, "codex")).toMatchObject({
      accountId: "reserve",
      accountLabel: "Резерв",
      resetAt: now + 5 * 86_400,
      windowType: "weekly",
      protectedProfiles: 2,
      profilesWithReset: 2,
      freshness: "fresh"
    });
  });

  it("uses provider windows, excludes another platform and marks an old snapshot honestly", () => {
    const now = 1_800_000_000;
    const savedCodex = managedAccount({
      id: "saved-codex",
      label: "Сохранённый Codex",
      lastRefreshAt: now - 3_600,
      weeklyUsedPercent: null,
      primaryUsedPercent: 35,
      primaryResetsAt: now + 3 * 86_400,
      primaryWindowDurationMins: 10_080
    });
    const otherProvider = managedAccount({
      id: "antigravity",
      label: "Antigravity",
      platform: "antigravity",
      weeklyResetsAt: now + 3_600
    });

    expect(selectNearestQuotaReset([savedCodex, otherProvider], now, "codex")).toMatchObject({
      accountId: "saved-codex",
      resetAt: now + 3 * 86_400,
      windowType: "weekly",
      freshness: "saved",
      protectedProfiles: 1,
      profilesWithReset: 1
    });
  });
});
