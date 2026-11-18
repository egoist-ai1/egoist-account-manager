import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountManager, type AccountManagerDependencies } from "../../src/main/accountManager";
import { CodexRpcClient, type AccountReadResponse } from "../../src/main/codexRpc";
import { AccountStore } from "../../src/main/db";
import { getProfileDir } from "../../src/main/paths";
import { Vault } from "../../src/main/security";
import { AsyncKeyedLock } from "../../src/main/services/asyncKeyedLock";
import { ANTIGRAVITY_USER_STATUS_STATE_KEY } from "../../src/main/services/antigravityAccountAdapter";
import { parseAntigravityUnifiedUserStatus } from "../../src/main/services/antigravityUnifiedState";
import { inspectCodexAuthJson } from "../../src/main/services/codexProfileVaultService";
import { DurableAuthBundleService } from "../../src/main/services/durableAuthBundleService";
import type { AntigravityLiveSession } from "../../src/main/services/antigravityProfileReader";
import type { AuthEvent, CodexAuthMode, ManagedAccount } from "../../src/shared/types";

interface PendingLoginFixture {
  profileId: string; profileDir: string; client: CodexRpcClient; pollTimer: null; startedAt: number;
  authMode: CodexAuthMode; replaceAccountId?: string; previousProfileDir?: string;
}

interface ManagerSafetySeam {
  persistCodexProfile(input: {
    profileId: string; profileDir: string; client: CodexRpcClient; authMode: CodexAuthMode;
    replaceAccountId?: string; previousProfileDir?: string;
  }): Promise<ManagedAccount>;
  pendingLogins: Map<string, PendingLoginFixture>;
  completePendingLogin(loginId: string, profileId: string): Promise<void>;
}

const directories: string[] = [];
const fixtures: Array<{ manager: AccountManager; store: AccountStore }> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function createFixture(dependencies: AccountManagerDependencies = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "egoist-manager-safety-"));
  directories.push(root);
  const appData = path.join(root, "app-data");
  const codexHome = path.join(root, "isolated-codex");
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  const store = new AccountStore(appData);
  const vault = new Vault(appData, {
    secureStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error("Host secure storage is forbidden in this fixture"); },
      decryptString: () => { throw new Error("Host secure storage is forbidden in this fixture"); }
    },
    allowDegradedTestStorage: true
  });
  const operationLock = dependencies.operationLock ?? new AsyncKeyedLock();
  const manager = new AccountManager(store, vault, appData, path.join(root, "never-launch-codex.exe"), {
    codexHome, operationLock,
    antigravityPathInput: { platform: "win32", appData: path.join(root, "isolated-roaming"), home: root },
    readAntigravityCredentialStorePayload: () => null,
    writeAntigravityCredentialStoreToken: () => { throw new Error("Host Credential Manager write is forbidden"); },
    restoreAntigravityCredentialStorePayload: () => { throw new Error("Host Credential Manager restore is forbidden"); },
    detectAntigravityLiveSession: async () => null,
    readAntigravityOfficialAuthState: () => ({ email: null, oauth: null, googleProjectId: null }),
    fetchAntigravityLiveQuota: async () => null,
    fetchAntigravityQuota: async () => { throw new Error("Provider network is forbidden"); },
    fetchAntigravityGoogleUserInfo: async () => { throw new Error("Provider identity network is forbidden"); },
    quiesceAntigravity: () => { throw new Error("Host IDE termination is forbidden"); },
    launchAntigravity: () => { throw new Error("Host IDE launch is forbidden"); },
    verifyAntigravityRuntimeIdentity: async () => ({
      runtime: "unsupported", runtimeSource: null, observedEmail: null, observedAt: null, runtimePid: null,
      message: "Аккаунт работающей IDE не подтверждён"
    }),
    ...dependencies
  });
  fixtures.push({ manager, store });
  return { root, appData, codexHome, store, vault, operationLock, manager,
    privateManager: manager as unknown as ManagerSafetySeam };
}

function addCodex(f: ReturnType<typeof createFixture>, id: string, authJson: string, profileDir = getProfileDir(f.appData, id)) {
  const metadata = inspectCodexAuthJson(authJson);
  return f.store.upsert({
    id, label: id, email: id + "@example.invalid", planType: "unknown", profileDir,
    encryptedAuthJson: f.vault.encryptUtf8(authJson), authMode: "apiKey",
    authFingerprint: metadata.authFingerprint, credentialState: "ready", lastAuthenticatedAt: 100
  });
}

function addAntigravity(f: ReturnType<typeof createFixture>, id: string) {
  return f.store.upsert({
    id, platform: "antigravity", label: id, email: id + "@example.invalid", planType: "unknown",
    profileDir: path.join(f.root, "isolated-roaming", "Antigravity IDE"),
    encryptedAuthJson: f.vault.encryptUtf8(JSON.stringify({
      format: "one.egoist.codex-account-manager.antigravity.credentials", version: 1,
      authMode: "google_oauth", importedAt: 100, fingerprintId: null,
      googleOAuth: {
        accountId: id, email: id + "@example.invalid", label: id,
        accessToken: "access-" + id, refreshToken: "refresh-" + id,
        expiresAt: 1_900_000_000, scope: null, tokenType: "Bearer",
        oauthClientId: "fixture-client", redirectUri: "fixture", googleProjectId: null,
        tier: "unknown", tierId: null, importedAt: 100, source: "google_oauth_browser"
      }
    })),
    credentialState: "ready", lastAuthenticatedAt: 100
  });
}

function requireRecovery(f: ReturnType<typeof createFixture>, platform: "codex" | "antigravity", accountId: string) {
  const created = f.store.createSwitchTransaction({
    id: "fixture-recovery-" + platform, platform, targetAccountId: accountId,
    previousAccountId: accountId, targetFingerprint: null, previousFingerprint: null
  });
  return f.store.updateSwitchTransaction(created.id, {
    status: "recovery_required", phase: "recovery_required", errorCode: "FIXTURE_ROLLBACK_FAILED"
  }, created.version);
}

function createAntigravitySwitchFixture(dependencies: AccountManagerDependencies = {}) {
  let credentialPayload: string | null = JSON.stringify({
    token: { access_token: "access-switch-previous", refresh_token: "refresh-switch-previous" }
  });
  const restored = vi.fn((snapshot: { existed: boolean; value: string | null }) => {
    credentialPayload = snapshot.existed ? snapshot.value : null;
  });
  const launched = vi.fn((_input?: Parameters<NonNullable<AccountManagerDependencies["launchAntigravity"]>>[0]) => ({
    supported: true, attempted: true, restarted: true, exePath: "fixture.exe", reason: "fixture"
  }));
  const f = createFixture({
    readAntigravityCredentialStorePayload: () => credentialPayload === null ? null : ({
      payload: credentialPayload, strategy: "windows-credential-manager"
    }),
    writeAntigravityCredentialStoreToken: input => {
      credentialPayload = JSON.stringify({ token: { access_token: input.accessToken, refresh_token: input.refreshToken } });
      return { applied: true, strategy: "windows-credential-manager" };
    },
    restoreAntigravityCredentialStorePayload: restored,
    quiesceAntigravity: () => ({ supported: true, attempted: true, wasRunning: true, quiesced: true, reason: "fixture" }),
    launchAntigravity: launched,
    fetchAntigravityGoogleUserInfo: async ({ accessToken }) => ({
      id: accessToken.slice("access-".length), email: accessToken.slice("access-".length) + "@example.invalid",
      verifiedEmail: true, name: "Fixture"
    }),
    ...dependencies
  });
  const userData = path.join(f.root, "isolated-roaming", "Antigravity IDE");
  const storageDir = path.join(userData, "User", "globalStorage");
  fs.mkdirSync(storageDir, { recursive: true });
  const stateDb = path.join(storageDir, "state.vscdb");
  const db = new Database(stateDb);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
  db.close();
  fs.writeFileSync(path.join(storageDir, "storage.json"), "{}");
  fs.writeFileSync(path.join(userData, "machineid"), "fixture-machine");
  const cachePath = path.join(userData, "DevToolsActivePort");
  fs.writeFileSync(cachePath, "previous-cache");
  const previous = addAntigravity(f, "switch-previous");
  const target = addAntigravity(f, "switch-target");
  f.store.setActive(previous.id);
  return { ...f, previous, target, stateDb, cachePath, restored, launched,
    getCredentialPayload: () => credentialPayload };
}

function readAntigravityAppliedEmail(stateDb: string): string | null {
  const db = new Database(stateDb, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(ANTIGRAVITY_USER_STATUS_STATE_KEY) as { value: string } | undefined;
    return row ? parseAntigravityUnifiedUserStatus(row.value).email : null;
  } finally { db.close(); }
}

function stubCodexClient(profileDir: string, response: Promise<AccountReadResponse> = Promise.resolve({
  account: { type: "apiKey" }, requiresOpenaiAuth: false
})) {
  const client = new CodexRpcClient(profileDir, "forbidden-fixture-binary");
  vi.spyOn(client, "readAccount").mockImplementation(() => response);
  vi.spyOn(client, "stop").mockResolvedValue();
  return client;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unconfigured network is forbidden in safety fixtures"); }));
});

afterEach(async () => {
  for (const { manager, store } of fixtures.splice(0)) {
    await manager.shutdown();
    store.close();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

describe("AccountManager safety integration", () => {
  it("reauthenticates into the vault without replacing Desktop files or deleting a foreign previous profile", async () => {
    const f = createFixture();
    const previousProfile = path.join(f.root, "app-data-foreign", "external-profile");
    fs.mkdirSync(previousProfile, { recursive: true });
    const foreignSentinel = path.join(previousProfile, "foreign.txt");
    fs.writeFileSync(foreignSentinel, "preserve");
    const previousAuth = '{"OPENAI_API_KEY":"fixture-before"}';
    const rotatedAuth = '{"OPENAI_API_KEY":"fixture-after"}';
    const original = addCodex(f, "reauth-account", previousAuth, previousProfile);
    f.store.setActive(original.id);
    fs.writeFileSync(path.join(f.codexHome, "auth.json"), previousAuth);
    fs.writeFileSync(path.join(f.codexHome, ".codex-global-state.json"), '{"desktop":"untouched"}');
    const profileId = "new-authentication";
    const profileDir = getProfileDir(f.appData, profileId);
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "auth.json"), rotatedAuth);
    await f.privateManager.persistCodexProfile({
      profileId, profileDir, client: stubCodexClient(profileDir), authMode: "apiKey",
      replaceAccountId: original.id, previousProfileDir: previousProfile
    });
    expect(fs.readFileSync(path.join(f.codexHome, "auth.json"), "utf8")).toBe(previousAuth);
    expect(fs.readFileSync(path.join(f.codexHome, ".codex-global-state.json"), "utf8")).toBe('{"desktop":"untouched"}');
    expect(fs.readFileSync(foreignSentinel, "utf8")).toBe("preserve");
    expect(f.vault.decryptUtf8(f.store.get(original.id)!.encryptedAuthJson)).toBe(rotatedAuth);
    expect(f.store.get(original.id)).toMatchObject({ credentialState: "ready", isActive: false, runtimeVerification: null });
    expect(fs.existsSync(path.join(profileDir, "auth.json"))).toBe(false);
  });

  it("rechecks recovery after an awaited login identity read before replacing encrypted credentials", async () => {
    const f = createFixture();
    const original = addCodex(f, "awaiting-login", '{"OPENAI_API_KEY":"fixture-original"}');
    f.store.setActive(original.id);
    const oldSealed = f.store.get(original.id)!.encryptedAuthJson;
    const profileDir = getProfileDir(f.appData, "waiting-profile");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "auth.json"), '{"OPENAI_API_KEY":"fixture-replacement"}');
    const identity = deferred<AccountReadResponse>();
    const saving = f.privateManager.persistCodexProfile({
      profileId: "waiting-profile", profileDir, client: stubCodexClient(profileDir, identity.promise),
      authMode: "apiKey", replaceAccountId: original.id, previousProfileDir: original.profileDir
    });
    const rejection = expect(saving).rejects.toThrow(/recovery/i);
    requireRecovery(f, "codex", original.id);
    identity.resolve({ account: { type: "apiKey" }, requiresOpenaiAuth: false });
    await rejection;
    expect(f.store.get(original.id)!.encryptedAuthJson).toBe(oldSealed);
    expect(f.store.get(original.id)!.isActive).toBe(true);
  });

  it("does not apply a pending login queued behind a failed switch", async () => {
    const f = createFixture();
    const original = addCodex(f, "pending-existing", '{"OPENAI_API_KEY":"fixture-existing"}');
    f.store.setActive(original.id);
    const oldSealed = f.store.get(original.id)!.encryptedAuthJson;
    const profileId = "pending-login-profile";
    const profileDir = getProfileDir(f.appData, profileId);
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "auth.json"), '{"OPENAI_API_KEY":"fixture-pending"}');
    const release = deferred<void>();
    const acquired = deferred<void>();
    const blocker = f.operationLock.runExclusive("provider:codex", async () => { acquired.resolve(); await release.promise; });
    await acquired.promise;
    f.privateManager.pendingLogins.set("fixture-login", {
      profileId, profileDir, client: stubCodexClient(profileDir), pollTimer: null,
      startedAt: Date.now(), authMode: "apiKey", replaceAccountId: original.id, previousProfileDir: original.profileDir
    });
    const events: AuthEvent[] = [];
    f.manager.on("auth-event", (event: AuthEvent) => events.push(event));
    const completion = f.privateManager.completePendingLogin("fixture-login", profileId);
    requireRecovery(f, "codex", original.id);
    release.resolve();
    await blocker;
    await completion;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ success: false });
    expect(events[0].error).toMatch(/recovery/i);
    expect(f.store.get(original.id)!.encryptedAuthJson).toBe(oldSealed);
    expect(f.store.get(original.id)!.isActive).toBe(true);
  });

  it("leaves passive Codex observation inert while recovery is required", () => {
    const f = createFixture();
    const original = addCodex(f, "passive-codex", '{"OPENAI_API_KEY":"fixture-passive"}');
    f.store.setActive(original.id);
    const oldSealed = f.store.get(original.id)!.encryptedAuthJson;
    requireRecovery(f, "codex", original.id);
    expect(f.manager.syncActiveCodexSession()).toEqual({ status: "busy", accountId: null });
    expect(f.store.get(original.id)!.encryptedAuthJson).toBe(oldSealed);
    expect(f.store.get(original.id)!.isActive).toBe(true);
  });

  it("does not copy account B Credential Manager tokens into runtime account A", async () => {
    const f = createFixture({
      detectAntigravityLiveSession: async () => ({ email: "runtime-a@example.invalid", name: null, tier: null }),
      readAntigravityCredentialStorePayload: () => ({
        strategy: "windows-credential-manager",
        payload: JSON.stringify({ token: { access_token: "access-runtime-b", refresh_token: "refresh-runtime-b" } })
      })
    });
    const a = addAntigravity(f, "runtime-a");
    addAntigravity(f, "runtime-b");
    f.store.setActive(a.id);
    const sealed = f.store.get(a.id)!.encryptedAuthJson;
    await f.manager.syncActiveAntigravitySession();
    expect(f.store.get(a.id)!.encryptedAuthJson).toBe(sealed);
    expect(f.vault.decryptUtf8(f.store.get(a.id)!.encryptedAuthJson)).not.toContain("access-runtime-b");
    expect(f.store.get(a.id)!.isActive).toBe(true);
  });

  it("rechecks recovery after awaited passive Antigravity runtime observation", async () => {
    const observed = deferred<AntigravityLiveSession | null>();
    const f = createFixture({ detectAntigravityLiveSession: () => observed.promise });
    const account = addAntigravity(f, "observed-ag");
    const sealed = f.store.get(account.id)!.encryptedAuthJson;
    const syncing = f.manager.syncActiveAntigravitySession();
    await Promise.resolve();
    requireRecovery(f, "antigravity", account.id);
    observed.resolve({ email: account.email, name: null, tier: null });
    await syncing.catch(() => undefined);
    expect(f.store.get(account.id)!.encryptedAuthJson).toBe(sealed);
    expect(f.store.get(account.id)!.isActive).toBe(false);
  });

  it("serializes current Codex session adoption with provider mutations", async () => {
    const f = createFixture();
    const existing = addCodex(f, "adopt-current", '{"OPENAI_API_KEY":"fixture-adopt"}');
    fs.writeFileSync(path.join(f.codexHome, "auth.json"), '{"OPENAI_API_KEY":"fixture-adopt"}');
    const acquired = deferred<void>();
    const release = deferred<void>();
    const blocker = f.operationLock.runExclusive("provider:codex", async () => { acquired.resolve(); await release.promise; });
    await acquired.promise;
    const adoption = f.manager.importCurrentCodexSession();
    let selectedDuringLock = true;
    try {
      await Promise.resolve();
      selectedDuringLock = f.store.get(existing.id)!.isActive;
    } finally {
      release.resolve();
      await blocker;
      await adoption;
    }
    expect(selectedDuringLock).toBe(false);
    expect(f.store.get(existing.id)!.isActive).toBe(true);
  });

  it("restores every compatibility file before concluding startup rollback for a matching previous auth", async () => {
    const f = createFixture();
    const previousAuth = '{"OPENAI_API_KEY":"fixture-recovery-previous"}';
    const targetAuth = '{"OPENAI_API_KEY":"fixture-recovery-target"}';
    const previous = addCodex(f, "recovery-previous", previousAuth);
    const target = addCodex(f, "recovery-target", targetAuth);
    f.store.setActive(previous.id);
    const statePath = path.join(f.codexHome, ".codex-global-state.json");
    fs.writeFileSync(path.join(f.codexHome, "auth.json"), previousAuth);
    fs.writeFileSync(statePath, '{"selected":"previous"}');
    const transactionId = "mixed-startup-fixture";
    const durable = new DurableAuthBundleService({
      codexHome: f.codexHome, sealBackup: value => f.vault.encryptUtf8(value),
      unsealBackup: value => f.vault.decryptUtf8(value), stableCheckCount: 1, stableCheckIntervalMs: 0
    });
    const activation = await durable.activate({ transactionId, files: [
      { relativePath: "auth.json", contents: targetAuth },
      { relativePath: ".codex-global-state.json", contents: '{"selected":"target"}' }
    ] });
    fs.writeFileSync(path.join(f.codexHome, "auth.json"), previousAuth);
    const created = f.store.createSwitchTransaction({
      id: transactionId, platform: "codex", targetAccountId: target.id, previousAccountId: previous.id,
      targetFingerprint: target.authFingerprint, previousFingerprint: previous.authFingerprint
    });
    f.store.updateSwitchTransaction(created.id, {
      status: "running", phase: "activating", backupPath: activation.backupPath
    }, created.version);
    vi.spyOn(CodexRpcClient.prototype, "readAccount").mockResolvedValue({ account: { type: "apiKey" }, requiresOpenaiAuth: false });
    vi.spyOn(CodexRpcClient.prototype, "stop").mockResolvedValue();
    const recovered = await f.manager.recoverInterruptedSwitches();
    expect(recovered[0]).toMatchObject({ status: "rolled_back" });
    expect(fs.readFileSync(path.join(f.codexHome, "auth.json"), "utf8")).toBe(previousAuth);
    expect(fs.readFileSync(statePath, "utf8")).toBe('{"selected":"previous"}');
    expect(durable.verifyPreviousFiles(activation.backupPath)).toBe(true);
    expect(f.store.get(previous.id)!.isActive).toBe(true);
  });
  it("keeps a verified Antigravity profile applied when runtime identity is unsupported and retains its sealed snapshot", async () => {
    const f = createAntigravitySwitchFixture();
    const result = await f.manager.switchAccount(f.target.id);
    expect(result).toMatchObject({ id: f.target.id, isActive: true, runtimeVerification: {
      profileApplied: true, credentials: "online_verified", launch: "process_started", runtime: "unsupported",
      message: "Аккаунт работающей IDE не подтверждён"
    } });
    expect(readAntigravityAppliedEmail(f.stateDb)).toBe(f.target.email);
    expect(JSON.parse(f.getCredentialPayload()!).token.access_token).toBe("access-switch-target");
    const transaction = f.store.listSwitchTransactions()[0];
    expect(transaction.status).toBe("committed");
    expect(fs.existsSync(path.join(transaction.backupPath!, "manifest.json"))).toBe(true);
    expect(f.restored).not.toHaveBeenCalled();
  });

  it("uses Credential Manager and launches Antigravity Hub without modifying the IDE database", async () => {
    const f = createAntigravitySwitchFixture();
    const hubDir = path.join(f.root, "isolated-roaming", "Antigravity");
    fs.mkdirSync(hubDir);
    fs.writeFileSync(path.join(hubDir, "app_storage.json"), "{}");
    const result = await f.manager.switchAccount(f.target.id);
    expect(result.isActive).toBe(true);
    expect(f.launched.mock.calls.map(([input]) => input?.target)).toEqual(["hub"]);
    expect(readAntigravityAppliedEmail(f.stateDb)).toBeNull();
    expect(fs.readFileSync(f.cachePath, "utf8")).toBe("previous-cache");
    expect(fs.existsSync(path.join(hubDir, "User"))).toBe(false);
    expect(JSON.parse(f.getCredentialPayload()!).token.refresh_token).toBe("refresh-switch-target");
  });

  it("retains the Hub selection when stale IDE state and a temporary credential read failure are present", async () => {
    const stateReader = vi.fn(() => ({
      email: "switch-previous@example.invalid", oauth: null, googleProjectId: null
    }));
    const f = createAntigravitySwitchFixture({ readAntigravityOfficialAuthState: stateReader });
    const hubDir = path.join(f.root, "isolated-roaming", "Antigravity");
    fs.mkdirSync(hubDir);
    fs.writeFileSync(path.join(hubDir, "app_storage.json"), "{}");
    await f.manager.switchAccount(f.target.id);
    const deps = (f.manager as unknown as { dependencies: AccountManagerDependencies }).dependencies;
    deps.readAntigravityCredentialStorePayload = () => { throw new Error("Fixture temporary read failure"); };
    expect(await f.manager.syncActiveAntigravitySession()).toEqual({ status: "unchanged", accountId: f.target.id });
    expect(stateReader).not.toHaveBeenCalled();
    expect(f.store.get(f.target.id)?.isActive).toBe(true);
  });

  it("reopens the previous Antigravity session when backup creation fails after closing the app", async () => {
    const f = createAntigravitySwitchFixture({
      readAntigravityCredentialStorePayload: () => { throw new Error("Fixture snapshot failure"); }
    });
    await expect(f.manager.switchAccount(f.target.id)).rejects.toThrow("Fixture snapshot failure");
    expect(f.launched).toHaveBeenCalledTimes(1);
    expect(f.store.get(f.previous.id)?.isActive).toBe(true);
    expect(readAntigravityAppliedEmail(f.stateDb)).toBeNull();
    expect(f.restored).not.toHaveBeenCalled();
  });

  it("reopens Antigravity with restored credentials when launching the new account fails", async () => {
    const launch = vi.fn()
      .mockReturnValueOnce({ supported: true, attempted: true, restarted: false, exePath: "fixture.exe", reason: "Fixture launch failure" })
      .mockReturnValueOnce({ supported: true, attempted: true, restarted: true, exePath: "fixture.exe", reason: "Fixture window observed" });
    const f = createAntigravitySwitchFixture({ launchAntigravity: launch });
    const hubDir = path.join(f.root, "isolated-roaming", "Antigravity");
    fs.mkdirSync(hubDir);
    fs.writeFileSync(path.join(hubDir, "app_storage.json"), "{}");
    await expect(f.manager.switchAccount(f.target.id)).rejects.toThrow(/launch failure/i);
    expect(launch.mock.calls.map(([input]) => input?.target)).toEqual(["hub", "hub"]);
    expect(f.restored).toHaveBeenCalledTimes(1);
    expect(f.store.get(f.previous.id)?.isActive).toBe(true);
    expect(f.store.listSwitchTransactions()[0].status).toBe("rolled_back");
    expect(JSON.parse(f.getCredentialPayload()!).token.refresh_token).toBe("refresh-switch-previous");
  });

  it("rejects a prepared switch when a different profile became active", async () => {
    const f = createAntigravitySwitchFixture();
    const prepared = await f.manager.prepareSwitchAccount(f.target.id);
    const other = addAntigravity(f, "switch-other");
    f.store.setActive(other.id);
    const result = await f.manager.switchAccount(f.target.id, prepared.transaction.id).then(() => null, (error: Error) => error.message);
    expect(result).toMatch(/active.*changed/i);
    expect(f.launched).not.toHaveBeenCalled();
    expect(f.store.get(other.id)?.isActive).toBe(true);
  });
  it("rolls back Antigravity files and Credential Manager when an applied write fails readback", async () => {
    const f = createAntigravitySwitchFixture({
      writeAntigravityCredentialStoreToken: () => ({ applied: true, strategy: "windows-credential-manager" })
    });
    await expect(f.manager.switchAccount(f.target.id)).rejects.toThrow(/readback mismatch/i);
    expect(f.store.listSwitchTransactions()[0]).toMatchObject({ status: "rolled_back" });
    expect(f.store.get(f.previous.id)!.isActive).toBe(true);
    expect(f.store.get(f.target.id)!.isActive).toBe(false);
    expect(readAntigravityAppliedEmail(f.stateDb)).toBeNull();
    expect(fs.readFileSync(f.cachePath, "utf8")).toBe("previous-cache");
    expect(JSON.parse(f.getCredentialPayload()!).token.access_token).toBe("access-switch-previous");
    expect(f.restored).toHaveBeenCalledTimes(1);
  });

  it("keeps refreshed credentials verified in the vault for the next switch", async () => {
    const refresh = vi.fn(async () => ({
      accessToken: "access-switch-target", refreshToken: "rotated-switch-target", expiresAt: 1_900_000_000,
      scope: [], tokenType: "Bearer"
    }));
    const f = createAntigravitySwitchFixture({ refreshAntigravityGoogleAccessToken: refresh });
    const record = JSON.parse(f.vault.decryptUtf8(f.store.get(f.target.id)!.encryptedAuthJson));
    record.googleOAuth.expiresAt = 100;
    f.store.updateObservedAuthMaterial(f.target.id, f.vault.encryptUtf8(JSON.stringify(record)));
    f.store.markCredentialVerified(f.target.id);

    const result = await f.manager.switchAccount(f.target.id);
    expect(result.credentialState).toBe("ready");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.getCredentialPayload()!).token.refresh_token).toBe("rotated-switch-target");
    await f.manager.switchAccount(f.previous.id);
    await f.manager.switchAccount(f.target.id);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("requires recovery after an actual runtime mismatch and a failed Credential Manager restore", async () => {
    const f = createAntigravitySwitchFixture({
      verifyAntigravityRuntimeIdentity: async () => ({
        runtime: "mismatch", runtimeSource: "antigravity.get_user_status.os_bound_email",
        observedEmail: "unexpected@example.invalid", observedAt: 100, runtimePid: 123,
        message: "Runtime account mismatch"
      }),
      restoreAntigravityCredentialStorePayload: () => { throw new Error("Fixture credential restore failed"); }
    });
    await expect(f.manager.switchAccount(f.target.id)).rejects.toThrow(/mismatch/i);
    expect(f.store.getRecoveryRequired("antigravity")).toMatchObject({
      status: "recovery_required", errorCode: "ANTIGRAVITY_RECOVERY_REQUIRED"
    });
    expect(f.store.get(f.target.id)!.isActive).toBe(false);
    await expect(f.manager.refreshAccount(f.target.id)).rejects.toThrow(/recovery/i);
    expect(await f.manager.syncActiveAntigravitySession()).toEqual({ status: "busy", accountId: null });
  });

  it.each(["credential_manager", "state_vscdb"] as const)(
    "marks passively observed Antigravity %s token rotation unverified for the current credential version",
    async (source) => {
      const email = "passive-rotation@example.invalid";
      const f = createFixture({
        detectAntigravityLiveSession: async () => source === "credential_manager" ? ({ email, name: null, tier: null }) : null,
        readAntigravityCredentialStorePayload: () => source === "credential_manager" ? ({
          strategy: "windows-credential-manager",
          payload: JSON.stringify({ token: { access_token: "observed-new-access", refresh_token: "refresh-passive-rotation" } })
        }) : null,
        readAntigravityOfficialAuthState: () => ({
          email, googleProjectId: null,
          oauth: { accessToken: "observed-new-access", refreshToken: "refresh-passive-rotation", expiresAt: 1_900_000_000 }
        })
      });
      const account = addAntigravity(f, "passive-rotation");
      f.store.setActive(account.id);
      f.store.setRuntimeVerification(account.id, {
        profileApplied: true, credentials: "online_verified", credentialMethod: "fixture",
        launch: "process_started", runtime: "verified", runtimeSource: "fixture", observedEmail: email,
        observedAt: 100, runtimePid: 20, message: "Fixture previous proof"
      });
      const previousVersion = f.store.get(account.id)!.version;
      await f.manager.syncActiveAntigravitySession();
      const observed = f.store.get(account.id)!;
      expect(observed).toMatchObject({
        credentialState: "needs_review", lastAuthenticatedAt: null, runtimeVerification: null,
        status: "unknown", version: previousVersion + 1, isActive: true
      });
      expect(f.vault.decryptUtf8(observed.encryptedAuthJson)).toContain("observed-new-access");
    }
  );

  it("discards runtime proof when credential material changes while its identity RPC is pending", async () => {
    const observed = deferred<Awaited<ReturnType<NonNullable<AccountManagerDependencies["verifyAntigravityRuntimeIdentity"]>>>>();
    const reading = deferred<void>();
    const f = createFixture({
      verifyAntigravityRuntimeIdentity: () => { reading.resolve(); return observed.promise; }
    });
    const account = addAntigravity(f, "late-runtime");
    f.store.setActive(account.id);
    f.store.setRuntimeVerification(account.id, {
      profileApplied: true, credentials: "online_verified", credentialMethod: "fixture",
      launch: "process_started", runtime: "unsupported", runtimeSource: null,
      observedEmail: null, observedAt: null, runtimePid: null, message: "Fixture"
    });
    const tx = f.store.createSwitchTransaction({
      id: "late-runtime-fixture", platform: "antigravity", targetAccountId: account.id,
      previousAccountId: null, targetFingerprint: null, previousFingerprint: null
    });
    f.store.updateSwitchTransaction(tx.id, { status: "committed", phase: "committed" }, tx.version);
    const verifying = f.manager.verifyRuntimeAccount(account.id);
    const rejection = expect(verifying).rejects.toThrow(/changed during runtime verification/i);
    await reading.promise;
    f.store.updateObservedAuthMaterial(account.id, f.vault.encryptUtf8('{"fixture":"new-material"}'));
    observed.resolve({
      runtime: "verified", runtimeSource: "antigravity.get_user_status.os_bound_email",
      observedEmail: account.email, observedAt: 100, runtimePid: 20, message: "Fixture runtime email"
    });
    await rejection;
    expect(f.store.get(account.id)!.runtimeVerification).toBeNull();
    expect(f.store.getSwitchTransaction(tx.id)!.verification).toBeNull();
  });

});
