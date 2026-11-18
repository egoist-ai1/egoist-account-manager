import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountManager, type AccountManagerDependencies } from "../../src/main/accountManager";
import { AccountStore } from "../../src/main/db";
import { Vault } from "../../src/main/security";
import { ANTIGRAVITY_AUTH_STATE_KEY } from "../../src/main/services/antigravityAccountAdapter";
import { parseAntigravityUnifiedOAuthToken } from "../../src/main/services/antigravityUnifiedState";
import { buildAntigravityCredentialStorePayload, type AntigravityCredentialStoreTokenInput } from "../../src/main/services/antigravityCredentialStore";

const tempDirs: string[] = [];
const openStores = new Set<AccountStore>();

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-manager-ag-"));
  tempDirs.push(dir);
  return dir;
}

function createManager(store: AccountStore, vault: Vault, appDir: string, codexPath: string | null = null,
  dependencies: AccountManagerDependencies = {}): AccountManager {
  if (!openStores.has(store)) {
    const close = store.close.bind(store);
    store.close = () => { if (openStores.delete(store)) close(); };
    openStores.add(store);
  }
  let credentialPayload: string | null = null;
  return new AccountManager(store, vault, appDir, codexPath, {
    codexHome: path.join(appDir, "codex-fixture"),
    antigravityPathInput: { platform: "win32", home: appDir,
      get appData() { return path.dirname(store.list().find(account => account.platform === "antigravity")?.profileDir ?? path.join(appDir, "Antigravity IDE")); } },
    readAntigravityCredentialStorePayload: vi.fn(() => credentialPayload === null ? null : { payload: credentialPayload, strategy: "windows-credential-manager" as const }),
    writeAntigravityCredentialStoreToken: vi.fn((input: AntigravityCredentialStoreTokenInput) => {
      credentialPayload = buildAntigravityCredentialStorePayload(input);
      return { applied: true, strategy: "windows-credential-manager" as const };
    }),
    restoreAntigravityCredentialStorePayload: vi.fn(snapshot => { credentialPayload = snapshot.existed ? snapshot.value : null; }),
    detectAntigravityLiveSession: async () => null,
    fetchAntigravityLiveQuota: async () => null,
    quiesceAntigravity: vi.fn(() => ({ supported: true, attempted: true, wasRunning: true, quiesced: true, reason: "fixture" })),
    launchAntigravity: vi.fn(() => ({ supported: true, attempted: true, restarted: true, exePath: "fixture.exe", reason: "fixture" })),
    verifyAntigravityRuntimeIdentity: async () => ({ runtime: "unsupported", runtimeSource: null, observedEmail: null,
      observedAt: null, runtimePid: null, message: "Аккаунт работающей IDE не подтверждён" }),
    fetchAntigravityGoogleUserInfo: async ({ accessToken }) => {
      for (const account of store.list()) {
        const record = JSON.parse(vault.decryptUtf8(store.get(account.id)!.encryptedAuthJson)) as {
          googleOAuth?: { accessToken?: string; accountId?: string; email?: string };
          credentials?: { accessToken?: string; accountId?: string; email?: string }
        };
        const token = record.googleOAuth ?? record.credentials;
        if (token?.accessToken === accessToken) return { id: token.accountId ?? null, email: token.email ?? account.email, verifiedEmail: true, name: "Fixture" };
      }
      throw new Error("No provider identity configured for this fixture token");
    },
    fetchAntigravityQuota: async () => { throw new Error("Quota provider network is disabled in this fixture"); },
    ...dependencies
  });
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unconfigured provider network is forbidden in manager fixtures"); })));

function createAntigravityProfile(appData: string): string {
  const userDataDir = path.join(appData, "Antigravity IDE");
  const storageDir = path.join(userDataDir, "User", "globalStorage");
  fs.mkdirSync(storageDir, { recursive: true });
  const stateDbPath = path.join(storageDir, "state.vscdb");
  const db = new Database(stateDbPath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
  } finally {
    db.close();
  }
  fs.writeFileSync(path.join(storageDir, "storage.json"), "{}", "utf8");
  fs.writeFileSync(path.join(userDataDir, "machineid"), "machine-old", "utf8");
  return stateDbPath;
}

function createAntigravityHubProfile(appData: string, home: string): void {
  const hubDir = path.join(appData, "Antigravity");
  const geminiDir = path.join(home, ".gemini", "antigravity");
  fs.mkdirSync(hubDir, { recursive: true });
  fs.mkdirSync(geminiDir, { recursive: true });
  fs.writeFileSync(path.join(hubDir, "app_storage.json"), "{}", "utf8");
  fs.writeFileSync(path.join(geminiDir, "installation_id"), "hub-installation-id", "utf8");
}

function readStateValue(stateDbPath: string, key: string): string | null {
  const db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key) as { value: string | Buffer } | undefined;
    return row ? String(row.value) : null;
  } finally {
    db.close();
  }
}

function onceAccountsUpdated(manager: AccountManager): Promise<void> {
  return new Promise((resolve) => manager.once("accounts-updated", () => resolve()));
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const store of openStores) store.close();
  openStores.clear();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
});

describe("AccountManager Antigravity credentials", () => {
  it("does not trigger session detection when accounts are read repeatedly", () => {
    const appDir = tempDir();
    const store = new AccountStore(appDir);
    const detector = vi.fn(async () => null);
    const manager = createManager(store, new Vault(appDir), appDir, null, { detectAntigravityLiveSession: detector });
    try {
      for (let i = 0; i < 100; i += 1) expect(manager.list()).toEqual([]);
      expect(detector).not.toHaveBeenCalled();
    } finally { store.close(); }
  });

  it("imports an authorized local Antigravity IDE profile as metadata without token fields", async () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    createAntigravityProfile(antigravityAppData);
    const storagePath = path.join(antigravityAppData, "Antigravity IDE", "User", "globalStorage", "storage.json");
    fs.writeFileSync(storagePath, JSON.stringify({ account: { email: "local-ag@example.com" }, refreshToken: "do-not-store" }), "utf8");
    const store = new AccountStore(appDir);
    const manager = createManager(store, new Vault(appDir), appDir, "codex");

    const result = await manager.importAntigravityFromIde({
      platform: "win32",
      appData: antigravityAppData,
      home: path.dirname(antigravityAppData)
    });

    expect(result.imported).toBe(true);
    expect(result.account?.email).toBe("local-ag@example.com");
    expect(result.identity?.email).toBe("local-ag@example.com");
    expect(JSON.stringify(result)).not.toContain("do-not-store");
    const rawSaved = result.account ? store.get(result.account.id) : null;
    expect(rawSaved?.encryptedAuthJson).not.toContain("do-not-store");

    store.close();
  });

  it("imports credentials into the vault without applying them to the IDE", async () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    const stateDbPath = createAntigravityProfile(antigravityAppData);
    const store = new AccountStore(appDir);
    const vault = new Vault(appDir);
    const manager = createManager(store, vault, appDir, "codex", {
      fetchAntigravityQuota: async () => ({
        limits: {
          limitId: "gemini-3-pro",
          limitName: "Gemini 3 Pro",
          primary: { usedPercent: 70, resetsAt: 1_800_000_000, windowDurationMins: null },
          secondary: null,
          credits: null,
          planType: "pro",
          rateLimitReachedType: null
        },
        status: "active",
        statusReason: null,
        accountContext: {
          googleProjectId: "project-oauth",
          tier: "paid",
          tierId: "g1-pro-tier",
          source: "code_assist",
          errorReason: null
        },
        forbidden: false
      }),
      fetchAntigravityGoogleUserInfo: async () => ({
        id: "google-sub-oauth",
        email: "oauth-ag@example.com",
        verifiedEmail: true,
        name: "OAuth AG"
      })
    });

    const result = await manager.importAntigravityCredentials({
      label: "AG рабочий",
      email: "ag@example.com",
      accountId: "google-sub-1",
      refreshToken: "refresh-secret-token-123456",
      accessToken: "access-secret-token-123456",
      googleProjectId: "project-1",
      fingerprintId: "fingerprint-1",
      machineId: "machine-new"
    }, {
      platform: "win32",
      appData: antigravityAppData,
      home: path.dirname(antigravityAppData)
    });

    const saved = store.list().find((account) => account.email === "ag@example.com");
    const rawSaved = saved ? store.get(saved.id) : null;
    expect(result.imported).toBe(true);
    expect(result.account.platform).toBe("antigravity");
    expect(result.account.antigravity).toMatchObject({
      googleProjectId: "project-1",
      fingerprintId: null,
      ideStateDetected: true
    });
    expect(readStateValue(stateDbPath, ANTIGRAVITY_AUTH_STATE_KEY)).toBeNull();
    expect(result.account.credentialState).toBe("needs_review");
    expect(result.account.isActive).toBe(false);
    expect(fs.readFileSync(path.join(antigravityAppData, "Antigravity IDE", "machineid"), "utf8")).toBe("machine-old");
    expect(rawSaved?.encryptedAuthJson).not.toContain("refresh-secret-token-123456");
    expect(JSON.stringify(result)).not.toContain("refresh-secret-token-123456");
    expect(JSON.stringify(result)).not.toContain("access-secret-token-123456");
    expect(JSON.stringify(result)).not.toContain("machine-new");

    store.close();
  });

  it("imports Google OAuth into encrypted storage and refreshes quota without attaching IDE credentials", async () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    const stateDbPath = createAntigravityProfile(antigravityAppData);
    const store = new AccountStore(appDir);
    const vault = new Vault(appDir);
    const manager = createManager(store, vault, appDir, "codex", {
      fetchAntigravityQuota: async () => ({
        limits: {
          limitId: "gemini-3-pro",
          limitName: "Gemini 3 Pro",
          primary: { usedPercent: 70, resetsAt: 1_800_000_000, windowDurationMins: null },
          secondary: null,
          credits: null,
          planType: "pro",
          rateLimitReachedType: null
        },
        status: "active",
        statusReason: null,
        accountContext: {
          googleProjectId: "project-oauth",
          tier: "paid",
          tierId: "g1-pro-tier",
          source: "code_assist",
          errorReason: null
        },
        forbidden: false
      }),
      fetchAntigravityGoogleUserInfo: async () => ({
        id: "google-sub-oauth",
        email: "oauth-ag@example.com",
        verifiedEmail: true,
        name: "OAuth AG"
      })
    });

    const updated = onceAccountsUpdated(manager);
    const result = await manager.importAntigravityGoogleOAuth({
      clientId: "client-id",
      redirectUri: "http://localhost:36742/oauth-callback",
      accountContext: {
        googleProjectId: "project-oauth",
        tier: "paid",
        tierId: "g1-pro-tier",
        source: "code_assist",
        errorReason: null
      },
      user: {
        id: "google-sub-oauth",
        email: "oauth-ag@example.com",
        verifiedEmail: true,
        name: "OAuth AG"
      },
      tokens: {
        accessToken: "access-token-oauth-secret",
        refreshToken: "refresh-token-oauth-secret",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        scope: ["scope-a"],
        tokenType: "Bearer"
      }
    }, {
      platform: "win32",
      appData: antigravityAppData,
      home: path.dirname(antigravityAppData)
    });

    const saved = result.account ? store.get(result.account.id) : null;
    expect(result.imported).toBe(true);
    expect(result.account?.email).toBe("oauth-ag@example.com");
    expect(result.account?.planType).toBe("unknown");
    expect(result.account?.primaryUsedPercent).toBeNull();
    expect(result.account?.antigravity?.googleProjectId).toBe("project-oauth");
    await updated;
    expect(store.get(result.account!.id)?.primaryUsedPercent).toBe(70);
    expect(store.get(result.account!.id)?.planType).toBe("pro");
    expect(readStateValue(stateDbPath, ANTIGRAVITY_AUTH_STATE_KEY)).toBeNull();
    expect(store.get(result.account!.id)?.isActive).toBe(false);
    expect(saved?.encryptedAuthJson).not.toContain("access-token-oauth-secret");
    expect(saved?.encryptedAuthJson).not.toContain("refresh-token-oauth-secret");
    expect(JSON.stringify(result)).not.toContain("access-token-oauth-secret");
    expect(await manager.validateAuth(result.account!.id)).toMatchObject({
      state: "authorized",
      errorReason: null
    });

    store.close();
  });

  it("does not block Google OAuth import while Antigravity quota refresh is still pending", async () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    createAntigravityProfile(antigravityAppData);
    const store = new AccountStore(appDir);
    const vault = new Vault(appDir);
    const pendingQuota = vi.fn(async () => new Promise<never>(() => undefined));
    const manager = createManager(store, vault, appDir, "codex", {
      fetchAntigravityQuota: pendingQuota
    });

    try {
    const result = await manager.importAntigravityGoogleOAuth({
      clientId: "client-id",
      redirectUri: "http://localhost:36742/oauth-callback",
      accountContext: {
        googleProjectId: "project-oauth",
        tier: "paid",
        tierId: "g1-pro-tier",
        source: "code_assist",
        errorReason: null
      },
      user: {
        id: "google-sub-pending",
        email: "pending-ag@example.com",
        verifiedEmail: true,
        name: "Pending AG"
      },
      tokens: {
        accessToken: "access-token-pending-secret",
        refreshToken: "refresh-token-pending-secret",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        scope: ["scope-a"],
        tokenType: "Bearer"
      }
    }, {
      platform: "win32",
      appData: antigravityAppData,
      home: path.dirname(antigravityAppData)
    });

    expect(pendingQuota).toHaveBeenCalled();
    expect(result.imported).toBe(true);
    expect(result.account?.email).toBe("pending-ag@example.com");
    expect(result.account?.primaryUsedPercent).toBeNull();

    } finally { store.close(); }
  });

  it("uses Antigravity Hub detection without creating legacy state.vscdb during Google OAuth import", async () => {
    const appDir = tempDir();
    const home = tempDir();
    const antigravityAppData = path.join(home, "AppData", "Roaming");
    createAntigravityHubProfile(antigravityAppData, home);
    const store = new AccountStore(appDir);
    const vault = new Vault(appDir);
    const logs: string[] = [];
    const manager = createManager(store, vault, appDir, "codex", {
      fetchAntigravityQuota: async () => ({
        limits: {
          limitId: "gemini-3-pro",
          limitName: "Gemini 3 Pro",
          primary: { usedPercent: 10, resetsAt: 1_800_000_000, windowDurationMins: null },
          secondary: null,
          credits: null,
          planType: "unknown",
          rateLimitReachedType: null
        },
        status: "active",
        statusReason: null,
        accountContext: {
          googleProjectId: "project-hub",
          tier: "unknown",
          tierId: "g1-pro-tier",
          source: "code_assist",
          errorReason: null
        },
        forbidden: false
      }),
      writeAntigravityCredentialStoreToken: vi.fn(() => ({ applied: true as const, strategy: "windows-credential-manager" as const }))
    });
    manager.on("log", (message) => logs.push(String(message)));

    const updated = onceAccountsUpdated(manager);
    const result = await manager.importAntigravityGoogleOAuth({
      clientId: "client-id",
      redirectUri: "http://localhost:36742/oauth-callback",
      accountContext: {
        googleProjectId: null,
        tier: "unknown",
        tierId: null,
        source: "unavailable",
        errorReason: "deferred"
      },
      user: {
        id: "google-sub-hub",
        email: "hub-ag@example.com",
        verifiedEmail: true,
        name: "Hub AG"
      },
      tokens: {
        accessToken: "access-token-hub-secret",
        refreshToken: "refresh-token-hub-secret",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        scope: ["scope-a"],
        tokenType: "Bearer"
      }
    }, {
      platform: "win32",
      appData: antigravityAppData,
      home
    });
    await updated;

    expect(result.status.diagnostics.profileKind).toBe("hub");
    expect(result.status.readyForWriteActions).toBe(true);
    expect(result.account?.antigravity?.ideStateDetected).toBe(true);
    expect(fs.existsSync(path.join(antigravityAppData, "Antigravity", "User", "globalStorage", "state.vscdb"))).toBe(false);
    expect(logs.join("\n")).not.toContain("unified auth state update failed");
    expect(JSON.stringify(result)).not.toContain("refresh-token-hub-secret");

    store.close();
  });

  it("keeps listing read-only while freshness/readiness handles missing quota separately", () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    createAntigravityProfile(antigravityAppData);
    const store = new AccountStore(appDir);
    const vault = new Vault(appDir);
    const manager = createManager(store, vault, appDir, "codex");

    const stale = store.upsert({
      id: "ag_stale",
      platform: "antigravity",
      label: "Stale",
      email: "stale@example.com",
      planType: "pro",
      profileDir: path.join(antigravityAppData, "Antigravity IDE"),
      encryptedAuthJson: vault.encryptUtf8(JSON.stringify({
        format: "one.egoist.codex-account-manager.antigravity.credentials",
        version: 1,
        authMode: "local_profile",
        localProfile: {
          accountId: "stale",
          email: "stale@example.com",
          label: "Stale",
          profileDir: path.join(antigravityAppData, "Antigravity IDE"),
          fingerprintId: "fingerprint",
          googleProjectId: null,
          importedAt: 1,
          source: "profile_path",
          confidence: "inferred"
        },
        fingerprintId: "fingerprint",
        importedAt: 1
      })),
      rateLimits: null,
      antigravity: {
        googleProjectId: null,
        fingerprintId: "fingerprint",
        lastQuotaRefreshAt: null,
        forbidden: false,
        ideStateDetected: true
      },
      status: "active",
      statusReason: null
    });

    expect(stale.status).toBe("active");
    const listed = manager.list().find((account) => account.id === stale.id);
    expect(listed).toMatchObject({
      planType: "pro",
      status: "active"
    });

    store.close();
  });

  it("preserves a stored raw plan rather than rewriting it during a read", () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    createAntigravityProfile(antigravityAppData);
    const store = new AccountStore(appDir);
    const vault = new Vault(appDir);
    const manager = createManager(store, vault, appDir, "codex");

    const account = store.upsert({
      id: "ag_generic_pro",
      platform: "antigravity",
      label: "Generic Pro",
      email: "generic-pro@example.com",
      planType: "pro",
      profileDir: path.join(antigravityAppData, "Antigravity IDE"),
      encryptedAuthJson: vault.encryptUtf8(JSON.stringify({
        format: "one.egoist.codex-account-manager.antigravity.credentials",
        version: 1,
        authMode: "google_oauth",
        googleOAuth: {
          googleAccountId: "google-sub",
          email: "generic-pro@example.com",
          accessToken: "access-token-secret",
          refreshToken: "refresh-token-secret",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          scope: [],
          tokenType: "Bearer",
          oauthClientId: "client-id",
          googleProjectId: "project",
          tier: "unknown",
          tierId: "g1-pro-tier",
          importedAt: 1
        },
        importedAt: 1
      })),
      rateLimits: {
        limitId: "claude-opus",
        limitName: "Claude Opus",
        primary: { usedPercent: 0, resetsAt: 1_800_000_000, windowDurationMins: null },
        secondary: null,
        credits: null,
        planType: "pro",
        rateLimitReachedType: null
      },
      antigravity: {
        googleProjectId: "project",
        fingerprintId: null,
        lastQuotaRefreshAt: 1_800_000_000,
        forbidden: false,
        ideStateDetected: true
      },
      status: "active",
      statusReason: null
    });

    expect(account.planType).toBe("pro");
    const listed = manager.list().find((item) => item.id === account.id);
    expect(listed).toMatchObject({
      planType: "pro",
      status: "active"
    });

    store.close();
  });

  it("refreshes Antigravity quota with a still-valid access token even without refresh token", async () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    createAntigravityProfile(antigravityAppData);
    const store = new AccountStore(appDir);
    const vault = new Vault(appDir);
    const manager = createManager(store, vault, appDir, "codex", {
      fetchAntigravityQuota: async () => ({
        limits: {
          limitId: "claude-sonnet",
          limitName: "Claude Sonnet",
          primary: { usedPercent: 25, resetsAt: 1_800_000_000, windowDurationMins: null },
          secondary: null,
          credits: null,
          planType: "pro",
          rateLimitReachedType: null
        },
        status: "active",
        statusReason: null,
        accountContext: {
          googleProjectId: "project-oauth",
          tier: "paid",
          tierId: "g1-pro-tier",
          source: "code_assist",
          errorReason: null
        },
        forbidden: false
      })
    });

    const updated = onceAccountsUpdated(manager);
    const imported = await manager.importAntigravityGoogleOAuth({
      clientId: "client-id",
      redirectUri: "http://localhost:36742/oauth-callback",
      accountContext: {
        googleProjectId: "project-oauth",
        tier: "paid",
        tierId: "g1-pro-tier",
        source: "code_assist",
        errorReason: null
      },
      user: {
        id: "google-sub-no-refresh",
        email: "no-refresh-ag@example.com",
        verifiedEmail: true,
        name: "No Refresh AG"
      },
      tokens: {
        accessToken: "access-token-no-refresh-secret",
        refreshToken: null,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        scope: ["scope-a"],
        tokenType: "Bearer"
      }
    }, {
      platform: "win32",
      appData: antigravityAppData,
      home: path.dirname(antigravityAppData)
    });

    await updated;
    const refreshed = await manager.refreshAccount(imported.account!.id);
    expect(refreshed.primaryUsedPercent).toBe(25);
    expect(refreshed.planType).toBe("pro");
    expect(refreshed.status).toBe("active");

    store.close();
  });

  it("refreshes an Antigravity access token before quota when the token expires within five minutes", async () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    createAntigravityProfile(antigravityAppData);
    const store = new AccountStore(appDir);
    const vault = new Vault(appDir);
    const quotaAccessTokens: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({
          access_token: "fresh-access-token-secret",
          refresh_token: "fresh-refresh-token-secret",
          expires_in: 3600,
          scope: "scope-a",
          token_type: "Bearer"
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const manager = createManager(store, vault, appDir, "codex", {
      fetchAntigravityQuota: async (input) => {
        quotaAccessTokens.push(input.accessToken);
        return {
          limits: {
            limitId: "ag-five-hour",
            limitName: "5 часов",
            primary: { usedPercent: 10, resetsAt: 1_800_000_000, windowDurationMins: 300 },
            secondary: null,
            credits: null,
            planType: "unknown",
            rateLimitReachedType: null
          },
          status: "active",
          statusReason: null,
          accountContext: {
            googleProjectId: null,
            tier: "unknown",
            tierId: null,
            source: "code_assist",
            errorReason: null
          },
          forbidden: false
        };
      }
    });

    const account = store.upsert({
      id: "ag-near-expiry",
      platform: "antigravity",
      label: "Near Expiry",
      email: "near-expiry@example.com",
      planType: "unknown",
      profileDir: path.join(antigravityAppData, "Antigravity IDE"),
      encryptedAuthJson: vault.encryptUtf8(JSON.stringify({
        format: "one.egoist.codex-account-manager.antigravity.credentials",
        version: 1,
        authMode: "google_oauth",
        googleOAuth: {
          accountId: "google-sub-near-expiry",
          email: "near-expiry@example.com",
          label: "Near Expiry",
          accessToken: "stale-access-token-secret",
          refreshToken: "refresh-token-near-expiry-secret",
          expiresAt: Math.floor(Date.now() / 1000) + 240,
          scope: ["scope-a"],
          tokenType: "Bearer",
          oauthClientId: "client-id",
          redirectUri: "http://localhost:36742/oauth-callback",
          googleProjectId: null,
          tier: "unknown",
          tierId: null,
          importedAt: 1,
          source: "google_oauth_browser"
        },
        fingerprintId: null,
        importedAt: 1
      })),
      rateLimits: null,
      antigravity: {
        googleProjectId: null,
        fingerprintId: null,
        lastQuotaRefreshAt: null,
        forbidden: false,
        ideStateDetected: true
      },
      status: "unknown",
      statusReason: null
    });

    try {
      await manager.refreshAccount(account.id);
      expect(quotaAccessTokens).toEqual(["fresh-access-token-secret"]);
      const saved = JSON.parse(vault.decryptUtf8(store.get(account.id)!.encryptedAuthJson)) as { googleOAuth: { accessToken: string; refreshToken: string } };
      expect(saved.googleOAuth.accessToken).toBe("fresh-access-token-secret");
      expect(saved.googleOAuth.refreshToken).toBe("fresh-refresh-token-secret");
    } finally {
      global.fetch = originalFetch;
      store.close();
    }
  });

  it("switches a stored Antigravity account by replaying its encrypted credential package", async () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    const stateDbPath = createAntigravityProfile(antigravityAppData);
    const store = new AccountStore(appDir);
    const manager = createManager(store, new Vault(appDir), appDir, "codex");
    const logs: string[] = [];
    manager.on("log", (message) => logs.push(String(message)));

    const first = await manager.importAntigravityCredentials({
      email: "first@example.com",
      accountId: "google-sub-first",
      refreshToken: "refresh-secret-token-first",
      accessToken: "access-secret-token-first"
    }, {
      platform: "win32",
      appData: antigravityAppData,
      home: path.dirname(antigravityAppData)
    });
    await manager.importAntigravityCredentials({
      email: "second@example.com",
      accountId: "google-sub-second",
      refreshToken: "refresh-secret-token-second",
      accessToken: "access-secret-token-second"
    }, {
      platform: "win32",
      appData: antigravityAppData,
      home: path.dirname(antigravityAppData)
    });

    await expect(manager.validateAuth(first.account.id)).resolves.toMatchObject({ state: "authorized" });
    const switched = await manager.switchAccount(first.account.id);
    expect(switched.id).toBe(first.account.id);
    expect(switched.isActive).toBe(true);
    expect(switched.runtimeVerification).toMatchObject({ profileApplied: true, credentials: "online_verified",
      launch: "process_started", runtime: "unsupported", message: "Аккаунт работающей IDE не подтверждён" });
    expect(logs.join("\n")).toContain("Аккаунт работающей IDE не подтверждён");
    expect(logs.join("\n")).not.toContain("first@example.com");
    expect(logs.join("\n")).not.toContain("refresh-secret-token-first");
    expect(parseAntigravityUnifiedOAuthToken(readStateValue(stateDbPath, ANTIGRAVITY_AUTH_STATE_KEY)!)).toMatchObject({
      accessToken: "access-secret-token-first",
      refreshToken: "refresh-secret-token-first"
    });
    const history = manager.getSwitchHistory();
    expect(history[0]).toMatchObject({
      accountId: first.account.id,
      status: "completed"
    });
    expect(history[0].backupPath).toContain("ag-backup-");

    store.close();
  });

  it("refuses a Hub switch if Credential Manager readback does not match", async () => {
    const appDir = tempDir();
    const home = tempDir();
    const antigravityAppData = path.join(home, "AppData", "Roaming");
    createAntigravityHubProfile(antigravityAppData, home);
    const store = new AccountStore(appDir);
    const writeCredential = vi.fn(() => ({ applied: true as const, strategy: "windows-credential-manager" as const }));
    const launch = vi.fn(() => ({
      supported: true,
      attempted: true,
      restarted: true,
      exePath: "C:\\Users\\User\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe",
      reason: "ok"
    }));
    const manager = createManager(store, new Vault(appDir), appDir, "codex", {
      writeAntigravityCredentialStoreToken: writeCredential,
      launchAntigravity: launch,
      quiesceAntigravity: () => ({ supported: true, attempted: false, wasRunning: false, quiesced: true, reason: "fixture" }),
      fetchAntigravityQuota: async () => ({
        limits: {
          limitId: "gemini-3-pro",
          limitName: "Gemini 3 Pro",
          primary: { usedPercent: 5, resetsAt: 1_800_000_000, windowDurationMins: null },
          secondary: null,
          credits: null,
          planType: "unknown",
          rateLimitReachedType: null
        },
        status: "active",
        statusReason: null,
        accountContext: {
          googleProjectId: "project-switch-hub",
          tier: "unknown",
          tierId: "g1-pro-tier",
          source: "code_assist",
          errorReason: null
        },
        forbidden: false
      })
    });

    const imported = await manager.importAntigravityGoogleOAuth({
      clientId: "client-id",
      redirectUri: "http://localhost:36742/oauth-callback",
      accountContext: {
        googleProjectId: "project-switch-hub",
        tier: "unknown",
        tierId: "g1-pro-tier",
        source: "code_assist",
        errorReason: null
      },
      user: {
        id: "google-sub-switch-hub",
        email: "switch-hub@example.com",
        verifiedEmail: true,
        name: "Switch Hub"
      },
      tokens: {
        accessToken: "access-token-switch-hub-secret",
        refreshToken: "refresh-token-switch-hub-secret",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        scope: ["scope-a"],
        tokenType: "Bearer"
      }
    }, {
      platform: "win32",
      appData: antigravityAppData,
      home
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    writeCredential.mockClear();
    await expect(manager.switchAccount(imported.account!.id)).rejects.toThrow(/readback mismatch/);
    expect(store.get(imported.account!.id)?.isActive).toBe(false);
    expect(writeCredential).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(antigravityAppData, "Antigravity", "User", "globalStorage", "state.vscdb"))).toBe(false);

    store.close();
  });

  it("refuses to delete the active account", async () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    createAntigravityProfile(antigravityAppData);
    const store = new AccountStore(appDir);
    const manager = createManager(store, new Vault(appDir), appDir, "codex");

    const active = await manager.importAntigravityCredentials({
      email: "active@example.com",
      accountId: "google-sub-active",
      refreshToken: "refresh-secret-token-active",
      accessToken: "access-secret-token-active"
    }, {
      platform: "win32",
      appData: antigravityAppData,
      home: path.dirname(antigravityAppData)
    });
    await manager.validateAuth(active.account.id);
    await manager.switchAccount(active.account.id);

    await expect(manager.deleteAccount(active.account.id)).rejects.toThrow(/Selected account/);
    expect(store.get(active.account.id)?.isActive).toBe(true);

    store.close();
  });

  it("restores the previous Antigravity active account after rollback", async () => {
    const appDir = tempDir();
    const antigravityAppData = tempDir();
    createAntigravityProfile(antigravityAppData);
    const store = new AccountStore(appDir);
    const manager = createManager(store, new Vault(appDir), appDir, "codex");
    try {
      const first = await manager.importAntigravityCredentials({
        email: "rollback-first@example.com",
        accountId: "google-sub-rollback-first",
        refreshToken: "refresh-secret-token-rollback-first",
        accessToken: "access-secret-token-rollback-first"
      }, {
        platform: "win32",
        appData: antigravityAppData,
        home: path.dirname(antigravityAppData)
      });
      const second = await manager.importAntigravityCredentials({
        email: "rollback-second@example.com",
        accountId: "google-sub-rollback-second",
        refreshToken: "refresh-secret-token-rollback-second",
        accessToken: "access-secret-token-rollback-second"
      }, {
        platform: "win32",
        appData: antigravityAppData,
        home: path.dirname(antigravityAppData)
      });

      await manager.validateAuth(first.account.id);
      await manager.validateAuth(second.account.id);
      await manager.switchAccount(first.account.id);
      await manager.switchAccount(second.account.id);
      const switchEvent = manager.getSwitchHistory().find((event) => event.accountId === second.account.id && event.status === "completed");
      expect(switchEvent?.previousAccountId).toBe(first.account.id);

      const history = await manager.rollbackSwitch(switchEvent!.id);
      const rollbackEvent = history.find((event) => event.status === "rolled_back");

      expect(store.get(first.account.id)?.isActive).toBe(true);
      expect(store.get(second.account.id)?.isActive).toBe(false);
      expect(rollbackEvent).toMatchObject({
        accountId: first.account.id,
        previousAccountId: second.account.id,
        status: "rolled_back"
      });
    } finally {
      store.close();
    }
  });

  it("exports and imports Antigravity accounts without plaintext secrets in the portable file", async () => {
    const sourceDir = tempDir();
    const targetDir = tempDir();
    const antigravityAppData = tempDir();
    const exportPath = path.join(tempDir(), "accounts.cam-export");
    createAntigravityProfile(antigravityAppData);
    const sourceStore = new AccountStore(sourceDir);
    const targetStore = new AccountStore(targetDir);
    const sourceManager = createManager(sourceStore, new Vault(sourceDir), sourceDir, "codex");
    const targetManager = createManager(targetStore, new Vault(targetDir), targetDir, "codex");

    await sourceManager.importAntigravityCredentials({
      label: "AG перенос",
      email: "transfer-ag@example.com",
      accountId: "google-sub-transfer",
      refreshToken: "refresh-secret-token-transfer",
      accessToken: "access-secret-token-transfer",
      googleProjectId: "project-transfer",
      fingerprintId: null
    }, {
      platform: "win32",
      appData: antigravityAppData,
      home: path.dirname(antigravityAppData)
    });

    await expect(sourceManager.exportAccounts(exportPath, "strong-password")).resolves.toMatchObject({ exportedCount: 1 });
    expect(fs.readFileSync(exportPath, "utf8")).not.toContain("refresh-secret-token-transfer");
    await expect(targetManager.importAccounts(exportPath, "strong-password")).resolves.toMatchObject({ importedCount: 1 });

    const imported = targetStore.getByPlatformEmail("antigravity", "transfer-ag@example.com");
    expect(imported?.platform).toBe("antigravity");
    expect(imported?.antigravity).toMatchObject({
      googleProjectId: "project-transfer",
      fingerprintId: null
    });
    expect(JSON.stringify(targetStore.list())).not.toContain("refresh-secret-token-transfer");

    sourceStore.close();
    targetStore.close();
  });
});
