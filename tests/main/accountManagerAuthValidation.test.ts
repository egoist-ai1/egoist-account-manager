import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountManager, type AccountManagerDependencies } from "../../src/main/accountManager";
import { AccountStore } from "../../src/main/db";
import { Vault } from "../../src/main/security";
import { CodexRpcClient } from "../../src/main/codexRpc";
import { providerHttpError } from "../../src/shared/quotaRefreshError";

const dirs: string[] = [];
const stores = new Set<AccountStore>();

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-auth-validation-"));
  dirs.push(dir);
  return dir;
}

function fixture(dependencies: AccountManagerDependencies = {}) {
  const appDir = tempDir();
  const store = new AccountStore(appDir);
  stores.add(store);
  const vault = new Vault(appDir);
  const userInfo = vi.fn(async () => ({ id: "google-sub-expected", email: "ag@example.com", verifiedEmail: true, name: null }));
  const manager = new AccountManager(store, vault, appDir, null, {
    codexHome: path.join(appDir, "codex-fixture"),
    antigravityPathInput: { platform: "win32", home: appDir, appData: path.join(appDir, "AppData") },
    readAntigravityCredentialStorePayload: vi.fn(() => null),
    writeAntigravityCredentialStoreToken: vi.fn(() => { throw new Error("Credential writes are forbidden in auth validation"); }),
    restoreAntigravityCredentialStorePayload: vi.fn(() => { throw new Error("Credential restore is forbidden in auth validation"); }),
    detectAntigravityLiveSession: vi.fn(async () => null),
    fetchAntigravityLiveQuota: vi.fn(async () => null),
    quiesceAntigravity: vi.fn(() => { throw new Error("IDE process operations are forbidden in auth validation"); }),
    launchAntigravity: vi.fn(() => { throw new Error("IDE launch is forbidden in auth validation"); }),
    verifyAntigravityRuntimeIdentity: vi.fn(async () => { throw new Error("Runtime identity is separate from token validation"); }),
    fetchAntigravityQuota: vi.fn(async () => { throw new Error("Quota is forbidden in auth validation"); }),
    fetchAntigravityGoogleUserInfo: userInfo,
    ...dependencies
  });
  return { appDir, store, vault, manager, userInfo };
}

function storedCredential(input: ReturnType<typeof fixture>, authMode: "manual_credentials" | "google_oauth" = "manual_credentials") {
  const token = { accountId: "google-sub-expected", email: "ag@example.com", accessToken: "fixture-access-token",
    refreshToken: "fixture-refresh-token", expiresAt: Math.floor(Date.now() / 1000) + 3600,
    oauthClientId: "fixture-client", scope: [], tokenType: "Bearer", importedAt: 1 };
  return input.store.upsert({ id: "ag-auth", platform: "antigravity", label: "AG", email: token.email,
    providerAccountId: token.accountId, planType: "unknown", profileDir: path.join(input.appDir, "Antigravity IDE"),
    credentialState: "needs_review", encryptedAuthJson: input.vault.encryptUtf8(JSON.stringify({
      format: "one.egoist.codex-account-manager.antigravity.credentials", version: 1, authMode,
      ...(authMode === "google_oauth" ? { googleOAuth: token } : { credentials: token }), fingerprintId: null, importedAt: 1
    })) });
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unconfigured provider network is forbidden"); })));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const store of stores) store.close();
  stores.clear();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
});

describe("AccountManager auth validation", () => {
  it("returns needs_reauth for Antigravity accounts when the local IDE profile is missing", async () => {
      const { appDir, store, vault, manager } = fixture();
      const missingProfileDir = path.join(appDir, "AppData", "Roaming", "missing-antigravity-profile");
      const account = store.upsert({
        id: "ag-auth",
        platform: "antigravity",
        label: "AG",
        email: "ag@example.com",
        planType: "unknown",
        profileDir: missingProfileDir,
        encryptedAuthJson: vault.encryptUtf8(JSON.stringify({ refreshToken: "refresh-secret-token-value" })),
        antigravity: {
          googleProjectId: null,
          fingerprintId: null,
          lastQuotaRefreshAt: null,
          forbidden: false,
          ideStateDetected: false
        }
      });
      await expect(manager.validateAuth(account.id)).resolves.toMatchObject({
        state: "needs_reauth",
        errorReason: "Antigravity local profile was not detected."
      });
      expect(store.get(account.id)?.credentialState).toBe("needs_reauth");
  });

  it.each(["manual_credentials", "google_oauth"] as const)("authorizes %s only after online token identity matches", async (mode) => {
    const input = fixture();
    const account = storedCredential(input, mode);
    await expect(input.manager.validateAuth(account.id)).resolves.toMatchObject({ state: "authorized" });
    expect(input.userInfo).toHaveBeenCalledOnce();
    expect(input.store.get(account.id)).toMatchObject({ credentialState: "ready", isActive: false, runtimeVerification: null });
  });

  it.each([
    { id: "google-sub-expected", email: "other@example.com" },
    { id: "google-sub-other", email: "ag@example.com" }
  ])("does not authorize a different online identity (%j)", async (user) => {
    const input = fixture({ fetchAntigravityGoogleUserInfo: async () => ({ ...user, verifiedEmail: true, name: null }) });
    const account = storedCredential(input);
    await expect(input.manager.validateAuth(account.id)).resolves.toMatchObject({ state: "validation_failed", errorReason: expect.stringContaining("identity mismatch") });
    expect(input.store.get(account.id)?.credentialState).toBe("needs_review");
  });

  it.each([403, 429])( "preserves ready credentials after HTTP %i token-validation failure", async (status) => {
    const input = fixture({ fetchAntigravityGoogleUserInfo: async () => { throw providerHttpError(status, "userinfo", "60"); } });
    const account = storedCredential(input);
    input.store.setCredentialState(account.id, "ready", null);
    await expect(input.manager.validateAuth(account.id)).resolves.toMatchObject({ state: "validation_failed" });
    expect(input.store.get(account.id)?.credentialState).toBe("ready");
  });

  it("requires reauthorization after a typed HTTP 401", async () => {
    const input = fixture({ fetchAntigravityGoogleUserInfo: async () => { throw providerHttpError(401, "userinfo"); } });
    const account = storedCredential(input);
    input.store.setCredentialState(account.id, "ready", null);
    await expect(input.manager.validateAuth(account.id)).resolves.toMatchObject({ state: "expired" });
    expect(input.store.get(account.id)?.credentialState).toBe("needs_reauth");
  });

  it("does not turn a network failure into expired credentials", async () => {
    const input = fixture({ fetchAntigravityGoogleUserInfo: async () => { throw new Error("network timeout"); } });
    const account = storedCredential(input);
    input.store.setCredentialState(account.id, "ready", null);
    await expect(input.manager.validateAuth(account.id)).resolves.toMatchObject({ state: "validation_failed" });
    expect(input.store.get(account.id)?.credentialState).toBe("ready");
  });

  it("never uses an independent Codex app-server probe to confirm Desktop runtime identity", async () => {
    const input = fixture();
    const account = input.store.upsert({ id: "desktop-a", platform: "codex", label: "Desktop A", email: "a@example.com",
      planType: "plus", profileDir: path.join(input.appDir, "codex-a"), credentialState: "ready",
      encryptedAuthJson: input.vault.encryptUtf8(JSON.stringify({ OPENAI_API_KEY: "fixture-only-key" })) });
    input.store.setActive(account.id);
    const probe = vi.spyOn(CodexRpcClient.prototype, "readAccount").mockResolvedValue({ account: { type: "chatgpt", email: "b@example.com", planType: "plus" }, requiresOpenaiAuth: true });
    await expect(input.manager.verifyRuntimeAccount(account.id)).resolves.toMatchObject({ runtime: "unsupported",
      observedEmail: null, message: "Аккаунт работающей IDE не подтверждён" });
    expect(probe).not.toHaveBeenCalled();
    expect(input.store.get(account.id)?.isActive).toBe(true);
  });
});
