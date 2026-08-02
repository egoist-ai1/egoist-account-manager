import { describe, expect, it } from "vitest";
import {
  buildProviderQuotaState,
  getProviderAdapterMetadata,
  knownProviderAdapterMetadata,
  providerCapabilities,
  providerDisplayName
} from "../../src/shared/providerAdapter";
import type { ManagedAccount } from "../../src/shared/types";

describe("provider adapter metadata", () => {
  it("defines one metadata entry for each supported account platform", () => {
    expect(knownProviderAdapterMetadata.map((provider) => provider.id)).toEqual(["codex", "antigravity"]);
    expect(providerDisplayName("codex")).toBe("OpenAI Codex");
    expect(providerDisplayName("antigravity")).toBe("Google Antigravity");
  });

  it("marks Codex quota/auth as official app-server capabilities", () => {
    const codex = getProviderAdapterMetadata("codex");

    expect(codex.docsSource.some((source) => source.includes("github.com/openai/codex"))).toBe(true);
    expect(codex.capabilities.validateAuth).toMatchObject({
      supported: true,
      source: "official_app_server",
      confidence: "confirmed"
    });
    expect(codex.capabilities.getQuotaState).toMatchObject({
      supported: true,
      source: "official_app_server",
      confidence: "confirmed"
    });
    expect(codex.knownLimitWindows.map((window) => window.windowType)).toEqual(["5h", "weekly", "rolling", "unknown"]);
  });

  it("marks Antigravity session transfer unsupported while allowing inferred quota refresh", () => {
    const antigravity = getProviderAdapterMetadata("antigravity");

    expect(antigravity.supportsEncryptedExport).toBe(true);
    expect(antigravity.supportsSessionTransfer).toBe(false);
    expect(antigravity.capabilities.getQuotaState).toMatchObject({
      supported: true,
      source: "local_status",
      confidence: "inferred"
    });
    expect(antigravity.capabilities.validateAuth.reason).toContain("keyring");
    expect(antigravity.docsSource.some((source) => source.includes("antigravity.google"))).toBe(true);
  });

  it("keeps safety language out of provider capability metadata", () => {
    const text = JSON.stringify(providerCapabilities("codex")) + JSON.stringify(providerCapabilities("antigravity"));

    expect(text).not.toMatch(/bypass|evade|avoid provider limits|rotate around limits/i);
  });

  it("builds honest provider-neutral quota state from known Codex account fields", () => {
    const account = {
      id: "acc_codex",
      platform: "codex",
      planType: "pro",
      primaryUsedPercent: 42,
      primaryResetsAt: 1_800_001_000,
      primaryWindowDurationMins: 300,
      lastRefreshAt: 1_800_000_000
    } as ManagedAccount;

    expect(buildProviderQuotaState(account)).toMatchObject({
      provider: "codex",
      accountId: "acc_codex",
      planType: "pro",
      used: 42,
      remaining: 58,
      resetAt: 1_800_001_000,
      windowType: "5h",
      confidence: "confirmed",
      source: "official_api",
      lastCheckedAt: 1_800_000_000
    });
  });

  it("keeps Antigravity quota state unknown until a quota refresh succeeds", () => {
    const account = {
      id: "acc_ag",
      platform: "antigravity",
      planType: "unknown",
      lastRefreshAt: null
    } as ManagedAccount;

    expect(buildProviderQuotaState(account)).toMatchObject({
      provider: "antigravity",
      accountId: "acc_ag",
      used: null,
      remaining: null,
      resetAt: null,
      windowType: "unknown",
      confidence: "unknown",
      source: "unknown",
      lastCheckedAt: null
    });
  });

  it("builds inferred Antigravity quota state from refreshed model quota fields", () => {
    const account = {
      id: "acc_ag",
      platform: "antigravity",
      planType: "pro",
      primaryUsedPercent: 75,
      primaryResetsAt: 1_800_001_000,
      lastRefreshAt: 1_800_000_000,
      antigravity: { lastQuotaRefreshAt: 1_800_000_000 }
    } as ManagedAccount;

    expect(buildProviderQuotaState(account)).toMatchObject({
      provider: "antigravity",
      accountId: "acc_ag",
      used: 75,
      remaining: 25,
      resetAt: 1_800_001_000,
      windowType: "unknown",
      confidence: "inferred",
      source: "local_status",
      lastCheckedAt: 1_800_000_000
    });
  });
});
