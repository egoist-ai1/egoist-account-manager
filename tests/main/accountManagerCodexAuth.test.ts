import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountManager } from "../../src/main/accountManager";
import { getAuthFilePath } from "../../src/main/codexRpc";
import { AccountStore } from "../../src/main/db";
import { Vault } from "../../src/main/security";
import { inspectCodexAuthJson } from "../../src/main/services/codexProfileVaultService";
import { AsyncKeyedLock } from "../../src/main/services/asyncKeyedLock";
import type { DurableAuthBundleAdapter } from "../../src/main/services/durableAuthBundleService";
import type { OpenAiDesktopIdentity } from "../../src/shared/types";

const dirs: string[] = [];
const exactDesktopIdentity: OpenAiDesktopIdentity = {
  product: "codex",
  packageName: "OpenAI.Codex",
  packageFullName: "OpenAI.Codex_26.721.4979.0_x64__test",
  packageFamilyName: "OpenAI.Codex_test",
  version: "26.721.4979.0",
  installLocation: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_test",
  executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_test\\app\\ChatGPT.exe",
  appUserModelId: "OpenAI.Codex_test!App"
};

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-codex-auth-"));
  dirs.push(dir);
  return dir;
}

function installFakeCodex(dir: string): string {
  const scriptPath = path.join(dir, "fake-codex.mjs");
  const commandPath = path.join(dir, "codex.cmd");
  fs.writeFileSync(scriptPath, `
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
const authPath = path.join(home, "auth.json");
const writeAuth = (value) => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(authPath, JSON.stringify(value), "utf8");
};

if (args[0] === "login" && args[1] === "--with-access-token") {
  let secret = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) secret += chunk;
  const payload = Buffer.from(JSON.stringify({ exp: 1_900_000_000 })).toString("base64url");
  writeAuth({
    kind: "enterprise",
    tokens: {
      account_id: "enterprise-account",
      access_token: "e30." + payload + ".signature",
      source_length: secret.length
    }
  });
  process.stdout.write("Login successful\\n");
  process.exit(0);
}

if (args[0] !== "app-server") process.exit(2);
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  const request = JSON.parse(line);
  if (request.method === "initialized") continue;
  if (request.method === "initialize" && fs.existsSync(path.join(home, ".force-incompatible"))) {
    process.stdout.write(JSON.stringify({ id: request.id, error: { code: -32000, message: "synthetic incompatible app-server" } }) + "\\n");
    continue;
  }
  let result;
  if (request.method === "initialize") {
    result = {
      userAgent: "fake-codex/3.0",
      codexHome: home,
      platformFamily: "windows",
      platformOs: "windows"
    };
  } else if (request.method === "account/login/start" && request.params?.type === "apiKey") {
    writeAuth({ OPENAI_API_KEY: request.params.apiKey });
    result = { type: "apiKey" };
  } else if (request.method === "account/read") {
    let auth = fs.existsSync(authPath) ? JSON.parse(fs.readFileSync(authPath, "utf8")) : null;
    if (request.params?.refreshToken && auth?.ROTATE_TO) {
      auth = { OPENAI_API_KEY: auth.ROTATE_TO };
      writeAuth(auth);
    }
    result = fs.existsSync(path.join(home, ".force-revoked"))
      ? { account: null, requiresOpenaiAuth: true }
      : auth?.OPENAI_API_KEY
      ? { account: { type: "apiKey" }, requiresOpenaiAuth: false }
      : auth?.kind === "test-chatgpt"
        ? {
            account: { type: "chatgpt", email: auth.email, planType: auth.planType ?? "plus" },
            requiresOpenaiAuth: true
          }
      : auth?.kind === "enterprise"
        ? {
            account: { type: "chatgpt", email: "enterprise@example.com", planType: "enterprise" },
            requiresOpenaiAuth: true
          }
        : { account: null, requiresOpenaiAuth: true };
  } else if (request.method === "account/rateLimits/read") {
    if (fs.existsSync(path.join(home, ".force-rate-error"))) {
      process.stdout.write(JSON.stringify({ id: request.id, error: { code: -32001, message: "synthetic network timeout" } }) + "\\n");
      continue;
    }
    result = {
      rateLimits: {
        limitId: "codex",
        limitName: "Enterprise",
        primary: null,
        secondary: null,
        credits: null,
        planType: "enterprise",
        rateLimitReachedType: null
      },
      rateLimitsByLimitId: null
    };
  } else {
    process.stdout.write(JSON.stringify({ id: request.id, error: { code: -1, message: "unsupported" } }) + "\\n");
    continue;
  }
  process.stdout.write(JSON.stringify({ id: request.id, result }) + "\\n");
}
`, "utf8");
  fs.writeFileSync(
    commandPath,
    `@echo off\r\n"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`,
    "utf8"
  );
  return commandPath;
}

function chatGptAuth(providerAccountId: string, email: string, revision: string): string {
  return JSON.stringify({
    kind: "test-chatgpt",
    email,
    planType: "plus",
    revision,
    tokens: {
      account_id: providerAccountId,
      access_token: `test-access-${revision}`
    }
  });
}

function addChatGptAccount(
  store: AccountStore,
  vault: Vault,
  appDataDir: string,
  id: string,
  email: string,
  providerAccountId: string,
  authJson: string
) {
  const metadata = inspectCodexAuthJson(authJson);
  return store.upsert({
    id,
    label: email.split("@")[0],
    email,
    planType: "plus",
    profileDir: path.join(appDataDir, "profiles", id),
    encryptedAuthJson: vault.encryptUtf8(authJson),
    authMode: "chatgpt",
    providerAccountId,
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: metadata.authFingerprint,
    credentialState: "ready",
    lastAuthenticatedAt: 1_800_000_000,
    expiresAt: null,
    status: "active"
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "win32")("AccountManager Codex auth modes", () => {
  it("captures active token rotation locally without starting or restarting Codex", () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const original = chatGptAuth("provider-rotation", "rotation@example.com", "before");
    const rotated = chatGptAuth("provider-rotation", "rotation@example.com", "after");
    const originalMetadata = inspectCodexAuthJson(original);
    const account = store.upsert({
      id: "rotation",
      label: "rotation",
      email: "rotation@example.com",
      planType: "plus",
      profileDir: path.join(appDataDir, "profiles", "rotation"),
      encryptedAuthJson: vault.encryptUtf8(original),
      authMode: null,
      providerAccountId: "provider-rotation",
      workspaceAccountId: null,
      workspaceLabel: null,
      authFingerprint: originalMetadata.authFingerprint,
      credentialState: "ready",
      status: "active"
    });
    store.setActive(account.id);
    fs.mkdirSync(globalCodexHome, { recursive: true });
    fs.writeFileSync(getAuthFilePath(globalCodexHome), rotated, "utf8");
    const manager = new AccountManager(store, vault, appDataDir, null, { codexHome: globalCodexHome });
    try {
      expect(manager.syncActiveCodexSession()).toEqual({ status: "updated", accountId: account.id });
      const saved = store.get(account.id)!;
      expect(vault.decryptUtf8(saved.encryptedAuthJson)).toBe(rotated);
      expect(saved.authFingerprint).toBe(inspectCodexAuthJson(rotated).authFingerprint);
      expect(saved.authMode).toBe("chatgpt");
      expect(fs.readFileSync(getAuthFilePath(globalCodexHome), "utf8")).toBe(rotated);
    } finally {
      store.close();
    }
  });

  it("preserves the last good quota and skips a fleet refresh while the account is in backoff", async () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const authJson = chatGptAuth("provider-quota", "quota@example.com", "stable");
    const account = addChatGptAccount(store, vault, appDataDir, "quota", "quota@example.com", "provider-quota", authJson);
    const good = store.setRateLimits(account.id, {
      limitId: "codex",
      limitName: null,
      primary: { usedPercent: 22, resetsAt: 1_900_000_000, windowDurationMins: 300 },
      secondary: { usedPercent: 6, resetsAt: 1_900_100_000, windowDurationMins: 10_080 },
      credits: null,
      planType: "plus",
      rateLimitReachedType: null
    }, "active", null);
    fs.mkdirSync(account.profileDir, { recursive: true });
    fs.writeFileSync(path.join(account.profileDir, ".force-rate-error"), "1", "utf8");
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir));
    try {
      const failed = await manager.refreshAccount(account.id);
      expect(failed).toMatchObject({
        status: "active",
        credentialState: "ready",
        lastRefreshAt: good.lastRefreshAt,
        lastRefreshError: "synthetic network timeout",
        fiveHourUsedPercent: 22
      });
      fs.rmSync(path.join(account.profileDir, ".force-rate-error"), { force: true });

      const afterFleetRefresh = (await manager.refreshAllAccounts()).find((item) => item.id === account.id)!;
      expect(afterFleetRefresh.lastRefreshAt).toBe(good.lastRefreshAt);
      expect(afterFleetRefresh.lastRefreshErrorAt).toBe(failed.lastRefreshErrorAt);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("excludes an active tray probe from an overlapping fleet refresh", async () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const authJson = chatGptAuth("provider-tray", "tray@example.com", "stable");
    const account = addChatGptAccount(store, vault, appDataDir, "tray", "tray@example.com", "provider-tray", authJson);
    fs.mkdirSync(account.profileDir, { recursive: true });
    fs.writeFileSync(path.join(account.profileDir, ".force-rate-error"), "1", "utf8");
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir));
    try {
      const refreshed = await manager.refreshAllAccounts({ excludeAccountIds: new Set([account.id]) });
      expect(refreshed.find((item) => item.id === account.id)).toMatchObject({
        lastRefreshAt: null,
        lastRefreshError: null
      });
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("does not rotate credentials during a quota refresh", async () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const authJson = JSON.stringify({
      ...JSON.parse(chatGptAuth("provider-passive", "passive@example.com", "stable")),
      ROTATE_TO: "sk-rotation-must-not-run"
    });
    const account = addChatGptAccount(store, vault, appDataDir, "passive", "passive@example.com", "provider-passive", authJson);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir));
    try {
      const refreshed = await manager.refreshAccount(account.id);
      expect(refreshed.lastRefreshError).toBeNull();
      expect(vault.decryptUtf8(store.get(account.id)!.encryptedAuthJson)).toBe(authJson);
      expect(fs.existsSync(getAuthFilePath(account.profileDir))).toBe(false);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("keeps an active account usable from the encrypted vault when Codex Desktop is signed out", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "signed-out-global-codex");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const authJson = chatGptAuth("provider-vault-fallback", "vault@example.com", "stable");
    const account = addChatGptAccount(store, vault, appDataDir, "vault-fallback", "vault@example.com", "provider-vault-fallback", authJson);
    store.setActive(account.id);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), { codexHome: globalCodexHome });
    try {
      expect(fs.existsSync(getAuthFilePath(globalCodexHome))).toBe(false);
      const refreshed = await manager.refreshAccount(account.id);
      expect(refreshed.credentialState).toBe("ready");
      expect(refreshed.status).toBe("active");
      expect(refreshed.lastRefreshError).toBeNull();
      expect(vault.decryptUtf8(store.get(account.id)!.encryptedAuthJson)).toBe(authJson);
      expect(fs.existsSync(getAuthFilePath(account.profileDir))).toBe(false);
      expect(fs.existsSync(getAuthFilePath(globalCodexHome))).toBe(false);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("keeps the last verified vault when explicit auth validation mutates to a mismatched identity", async () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const authJson = JSON.stringify({
      ...JSON.parse(chatGptAuth("provider-verified", "verified@example.com", "stable")),
      ROTATE_TO: "sk-mismatched-profile"
    });
    const account = addChatGptAccount(store, vault, appDataDir, "verified", "verified@example.com", "provider-verified", authJson);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir));
    try {
      const result = await manager.validateAuth(account.id);
      expect(result.state).toBe("needs_reauth");
      expect(store.get(account.id)?.credentialState).toBe("needs_reauth");
      expect(vault.decryptUtf8(store.get(account.id)!.encryptedAuthJson)).toBe(authJson);
      expect(fs.existsSync(getAuthFilePath(account.profileDir))).toBe(false);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("classifies the app-server not-authenticated response as reauthentication required", async () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const authJson = chatGptAuth("provider-revoked", "revoked@example.com", "stable");
    const account = addChatGptAccount(store, vault, appDataDir, "revoked", "revoked@example.com", "provider-revoked", authJson);
    fs.mkdirSync(account.profileDir, { recursive: true });
    fs.writeFileSync(path.join(account.profileDir, ".force-revoked"), "1", "utf8");
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir));
    try {
      const refreshed = await manager.refreshAccount(account.id);
      expect(refreshed.credentialState).toBe("needs_reauth");
      expect(refreshed.status).toBe("error");
      expect(vault.decryptUtf8(store.get(account.id)!.encryptedAuthJson)).toBe(authJson);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("skips active-session snapshots while a Codex operation owns the provider gate", async () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const operationLock = new AsyncKeyedLock();
    const manager = new AccountManager(store, vault, appDataDir, null, { operationLock });
    let release: () => void = () => undefined;
    const blocked = operationLock.runExclusive("provider:codex", () => new Promise<void>((resolve) => {
      release = resolve;
    }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      expect(manager.syncActiveCodexSession()).toEqual({ status: "busy", accountId: null });
    } finally {
      release();
      await blocked;
      await manager.shutdown();
      store.close();
    }
  });

  it("persists API-key login without exposing the submitted secret in account metadata", async () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir));
    const secret = "sk-test-never-expose-this-value";
    const log: string[] = [];
    manager.on("log", (message) => log.push(String(message)));
    try {
      const result = await manager.startLogin({ type: "apiKey", credential: secret });
      const stored = store.get(result.account!.id)!;

      expect(result).toMatchObject({ type: "apiKey", completed: true });
      expect(stored).toMatchObject({
        authMode: "apiKey",
        credentialState: "ready",
        status: "active",
        providerAccountId: null
      });
      expect(stored.authFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.encryptedAuthJson).not.toContain(secret);
      expect(fs.existsSync(getAuthFilePath(stored.profileDir))).toBe(false);
      expect(JSON.stringify(result.account)).not.toContain(secret);
      expect(log.join("\n")).not.toContain(secret);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("uses the official CLI stdin path for enterprise access tokens", async () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir));
    const secret = "enterprise-token-never-expose-this-value";
    try {
      const result = await manager.startLogin({ type: "enterpriseAccessToken", credential: secret });
      const stored = store.get(result.account!.id)!;

      expect(result).toMatchObject({ type: "enterpriseAccessToken", completed: true });
      expect(stored).toMatchObject({
        authMode: "enterpriseAccessToken",
        providerAccountId: "enterprise-account",
        email: "enterprise@example.com",
        planType: "enterprise",
        expiresAt: 1_900_000_000,
        credentialState: "ready"
      });
      expect(stored.encryptedAuthJson).not.toContain(secret);
      expect(fs.existsSync(getAuthFilePath(stored.profileDir))).toBe(false);
      expect(JSON.stringify(result.account)).not.toContain(secret);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("backfills a rotated active credential before switching API-key profiles", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome
    });
    try {
      const first = await manager.startLogin({ type: "apiKey", credential: "sk-first-original" });
      const second = await manager.startLogin({ type: "apiKey", credential: "sk-second-target" });
      store.setActive(first.account!.id);
      fs.mkdirSync(globalCodexHome, { recursive: true });
      const rotated = JSON.stringify({ OPENAI_API_KEY: "sk-first-rotated" });
      fs.writeFileSync(getAuthFilePath(globalCodexHome), rotated, "utf8");

      await manager.switchAccount(second.account!.id);

      expect(store.get(second.account!.id)?.isActive).toBe(true);
      expect(vault.decryptUtf8(store.get(first.account!.id)!.encryptedAuthJson)).toBe(rotated);
      expect(fs.readFileSync(getAuthFilePath(globalCodexHome), "utf8")).toContain("sk-second-target");
      expect(manager.listSwitchTransactions()[0]).toMatchObject({
        targetAccountId: second.account!.id,
        status: "committed",
        phase: "committed"
      });
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("reconciles a stale active marker to the real managed ChatGPT session before switching", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome
    });
    const firstAuth = chatGptAuth("provider-first", "first@example.com", "stable");
    const secondAuth = chatGptAuth("provider-second", "second@example.com", "stable");
    const rotatedSecondAuth = chatGptAuth("provider-second", "second@example.com", "rotated");
    try {
      const first = addChatGptAccount(
        store,
        vault,
        appDataDir,
        "first-managed",
        "first@example.com",
        "provider-first",
        firstAuth
      );
      const second = addChatGptAccount(
        store,
        vault,
        appDataDir,
        "second-managed",
        "second@example.com",
        "provider-second",
        secondAuth
      );
      store.setActive(first.id);
      fs.mkdirSync(globalCodexHome, { recursive: true });
      fs.writeFileSync(getAuthFilePath(globalCodexHome), rotatedSecondAuth, "utf8");
      store.storeAuthDriftCandidate({
        accountId: first.id,
        encryptedAuthJson: vault.encryptUtf8(rotatedSecondAuth),
        fingerprint: inspectCodexAuthJson(rotatedSecondAuth).authFingerprint
      });

      const preparation = await manager.prepareSwitchAccount(first.id);

      expect(preparation.transaction.previousAccountId).toBe(second.id);
      expect(store.get(second.id)?.isActive).toBe(true);
      expect(store.get(first.id)?.credentialState).toBe("ready");
      expect(store.getAuthDriftCandidate(first.id)).toBeNull();
      expect(vault.decryptUtf8(store.get(second.id)!.encryptedAuthJson)).toBe(rotatedSecondAuth);

      await manager.switchAccount(first.id, preparation.transaction.id);

      expect(store.get(first.id)?.isActive).toBe(true);
      expect(fs.readFileSync(getAuthFilePath(globalCodexHome), "utf8")).toBe(firstAuth);
      expect(manager.listSwitchTransactions()[0]).toMatchObject({
        previousAccountId: second.id,
        targetAccountId: first.id,
        status: "committed",
        phase: "committed"
      });
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("switches from a signed-out global Codex session instead of blocking on a stale active marker", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome
    });
    try {
      const first = await manager.startLogin({ type: "apiKey", credential: "sk-signed-out-first" });
      const second = await manager.startLogin({ type: "apiKey", credential: "sk-signed-out-target" });
      store.setActive(first.account!.id);

      await manager.switchAccount(second.account!.id);

      expect(store.get(second.account!.id)?.isActive).toBe(true);
      expect(fs.readFileSync(getAuthFilePath(globalCodexHome), "utf8")).toContain("sk-signed-out-target");
      expect(manager.listSwitchTransactions()[0]).toMatchObject({
        previousAccountId: null,
        status: "committed",
        phase: "committed"
      });
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("does not mutate global auth when graceful desktop shutdown times out", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome,
      desktopLifecycle: {
        quiesce: async () => ({
          status: "blocked",
          identity: null,
          capturedProcessCount: 4,
          remainingProcessCount: 1,
          gracefulCloseAccepted: true,
          usedExactTreeFallback: false,
          message: "synthetic timeout"
        }),
        launchAndWaitReady: async () => {
          throw new Error("launch must not run after a quiesce timeout");
        }
      }
    });
    try {
      const first = await manager.startLogin({ type: "apiKey", credential: "sk-first-safe-profile" });
      const second = await manager.startLogin({ type: "apiKey", credential: "sk-second-never-written" });
      store.setActive(first.account!.id);
      fs.mkdirSync(globalCodexHome, { recursive: true });
      const originalAuth = vault.decryptUtf8(store.get(first.account!.id)!.encryptedAuthJson);
      fs.writeFileSync(getAuthFilePath(globalCodexHome), originalAuth, "utf8");

      await expect(manager.switchAccount(second.account!.id)).rejects.toThrow("synthetic timeout");

      expect(fs.readFileSync(getAuthFilePath(globalCodexHome), "utf8")).toBe(originalAuth);
      expect(store.get(first.account!.id)?.isActive).toBe(true);
      expect(store.get(second.account!.id)?.isActive).toBe(false);
      expect(manager.listSwitchTransactions()[0]).toMatchObject({
        targetAccountId: second.account!.id,
        status: "failed",
        phase: "failed"
      });
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("keeps the previous account active and verifies rollback after a locked auth replace", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    const authPath = getAuthFilePath(globalCodexHome);
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    let replaceAttempts = 0;
    const durableAdapter: DurableAuthBundleAdapter = {
      exists: (filePath) => fs.existsSync(filePath),
      readUtf8: (filePath) => fs.readFileSync(filePath, "utf8"),
      writeDurableUtf8(filePath, contents) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, contents, "utf8");
      },
      mkdir: (directoryPath) => fs.mkdirSync(directoryPath, { recursive: true }),
      rename(sourcePath, targetPath) {
        if (sourcePath.includes(`${path.sep}stage${path.sep}`) && targetPath === authPath) {
          replaceAttempts += 1;
          throw Object.assign(new Error("synthetic sharing violation"), { code: "EBUSY", win32Code: 32 });
        }
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.renameSync(sourcePath, targetPath);
      },
      remove: (targetPath, recursive = false) => fs.rmSync(targetPath, { recursive, force: true })
    };
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome,
      desktopLifecycle: {
        quiesce: async () => ({
          status: "not-running",
          identity: null,
          capturedProcessCount: 0,
          remainingProcessCount: 0,
          gracefulCloseAccepted: false,
          usedExactTreeFallback: false,
          message: "test"
        }),
        launchAndWaitReady: async () => {
          throw new Error("launch must not run after activation rollback");
        }
      },
      durableAuthBundleAdapter: durableAdapter,
      durableAuthRenameRetryDelaysMs: [0, 0],
      durableAuthSleep: async () => undefined,
      durableAuthStableCheckIntervalMs: 0
    });
    try {
      const first = await manager.startLogin({ type: "apiKey", credential: "sk-locked-first-profile" });
      const second = await manager.startLogin({ type: "apiKey", credential: "sk-locked-second-profile" });
      store.setActive(first.account!.id);
      fs.mkdirSync(globalCodexHome, { recursive: true });
      const originalAuth = vault.decryptUtf8(store.get(first.account!.id)!.encryptedAuthJson);
      fs.writeFileSync(authPath, originalAuth, "utf8");

      await expect(manager.switchAccount(second.account!.id)).rejects.toThrow("synthetic sharing violation");

      expect(replaceAttempts).toBe(3);
      expect(fs.readFileSync(authPath, "utf8")).toBe(originalAuth);
      expect(store.get(first.account!.id)?.isActive).toBe(true);
      expect(store.get(second.account!.id)?.isActive).toBe(false);
      expect(manager.listSwitchTransactions()[0]).toMatchObject({
        targetAccountId: second.account!.id,
        status: "rolled_back",
        phase: "rolled_back",
        errorCode: "ACTIVATION_ROLLED_BACK"
      });
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("changes the active account only after exact launch readiness and official identity verification", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const activeDuringLaunch: string[] = [];
    let launchCount = 0;
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome,
      desktopLifecycle: {
        quiesce: async () => ({
          status: "quiesced",
          identity: exactDesktopIdentity,
          capturedProcessCount: 5,
          remainingProcessCount: 0,
          gracefulCloseAccepted: true,
          usedExactTreeFallback: false,
          message: "test tree closed"
        }),
        launchAndWaitReady: async () => {
          launchCount += 1;
          activeDuringLaunch.push(store.list().find((account) => account.isActive)?.id ?? "none");
          return {
            identity: exactDesktopIdentity,
            rootPid: 700,
            visibleWindowHandle: 7000,
            capturedProcessCount: 5,
            readyAt: Date.now()
          };
        }
      },
      durableAuthStableCheckIntervalMs: 0
    });
    try {
      const first = await manager.startLogin({ type: "apiKey", credential: "sk-readiness-first-profile" });
      const second = await manager.startLogin({ type: "apiKey", credential: "sk-readiness-second-profile" });
      store.setActive(first.account!.id);
      fs.mkdirSync(globalCodexHome, { recursive: true });
      fs.writeFileSync(
        getAuthFilePath(globalCodexHome),
        vault.decryptUtf8(store.get(first.account!.id)!.encryptedAuthJson),
        "utf8"
      );

      const switched = await manager.switchAccount(second.account!.id);

      expect(switched.id).toBe(second.account!.id);
      expect(activeDuringLaunch).toEqual([first.account!.id]);
      expect(launchCount).toBe(1);
      expect(store.get(second.account!.id)?.isActive).toBe(true);
      expect(manager.listSwitchTransactions()[0]).toMatchObject({
        targetAccountId: second.account!.id,
        status: "committed",
        phase: "committed"
      });
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("rolls auth and the active marker back when atomic terminal commit fails", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    const authPath = getAuthFilePath(globalCodexHome);
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const originalFinalize = store.finalizeSwitchTransactionWithActiveAccount.bind(store);
    let syntheticCommitFailure = true;
    store.finalizeSwitchTransactionWithActiveAccount = ((...args: Parameters<typeof originalFinalize>) => {
      if (args[2].phase === "committed" && syntheticCommitFailure) {
        syntheticCommitFailure = false;
        throw new Error("synthetic atomic journal commit failure");
      }
      return originalFinalize(...args);
    }) as typeof store.finalizeSwitchTransactionWithActiveAccount;
    let launchCount = 0;
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome,
      desktopLifecycle: {
        quiesce: async (policy) => ({
          status: "quiesced",
          identity: exactDesktopIdentity,
          capturedProcessCount: 4,
          remainingProcessCount: 0,
          gracefulCloseAccepted: true,
          usedExactTreeFallback: policy === "exact-tree-fallback",
          message: "synthetic exact tree stopped"
        }),
        launchAndWaitReady: async (identity) => {
          launchCount += 1;
          expect(identity).toEqual(exactDesktopIdentity);
          return {
            identity: exactDesktopIdentity,
            rootPid: 950 + launchCount,
            visibleWindowHandle: 9_500 + launchCount,
            capturedProcessCount: 4,
            readyAt: Date.now()
          };
        }
      },
      durableAuthStableCheckIntervalMs: 0
    });
    try {
      const first = await manager.startLogin({ type: "apiKey", credential: "sk-atomic-first" });
      const second = await manager.startLogin({ type: "apiKey", credential: "sk-atomic-second" });
      store.setActive(first.account!.id);
      fs.mkdirSync(globalCodexHome, { recursive: true });
      const previousAuth = vault.decryptUtf8(store.get(first.account!.id)!.encryptedAuthJson);
      fs.writeFileSync(authPath, previousAuth, "utf8");

      await expect(manager.switchAccount(second.account!.id)).rejects.toThrow(
        "synthetic atomic journal commit failure"
      );

      expect(launchCount).toBe(2);
      expect(fs.readFileSync(authPath, "utf8")).toBe(previousAuth);
      expect(store.get(first.account!.id)?.isActive).toBe(true);
      expect(store.get(second.account!.id)?.isActive).toBe(false);
      expect(manager.listSwitchTransactions()[0]).toMatchObject({
        status: "rolled_back",
        phase: "rolled_back",
        errorCode: "POST_ACTIVATION_VERIFICATION_FAILED"
      });
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("refreshes the active account through global CODEX_HOME without forcing token rotation", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome
    });
    try {
      const login = await manager.startLogin({ type: "apiKey", credential: "sk-before-global-refresh" });
      store.setActive(login.account!.id);
      fs.mkdirSync(globalCodexHome, { recursive: true });
      const original = JSON.stringify({
        OPENAI_API_KEY: "sk-before-global-refresh",
        ROTATE_TO: "sk-after-global-refresh"
      });
      fs.writeFileSync(
        getAuthFilePath(globalCodexHome),
        original,
        "utf8"
      );

      await manager.refreshAccount(login.account!.id);

      expect(fs.readFileSync(getAuthFilePath(globalCodexHome), "utf8")).toBe(original);
      expect(vault.decryptUtf8(store.get(login.account!.id)!.encryptedAuthJson)).toBe(original);
      expect(store.get(login.account!.id)?.authFingerprint).toBe(
        inspectCodexAuthJson(original).authFingerprint
      );
      expect(fs.existsSync(getAuthFilePath(store.get(login.account!.id)!.profileDir))).toBe(false);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("blocks file-bundle switching when the user selected the OS keyring", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    fs.mkdirSync(globalCodexHome, { recursive: true });
    const configPath = path.join(globalCodexHome, "config.toml");
    const config = 'cli_auth_credentials_store = "keyring"\n';
    fs.writeFileSync(configPath, config, "utf8");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome
    });
    try {
      const target = await manager.startLogin({ type: "apiKey", credential: "sk-keyring-target" });

      await expect(manager.switchAccount(target.account!.id)).rejects.toThrow(
        /OS keyring/
      );
      expect(fs.readFileSync(configPath, "utf8")).toBe(config);
      expect(manager.listSwitchTransactions()).toEqual([]);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it.each([
    "launch-timeout",
    "wrong-identity",
    "wrong-workspace",
    "revoked-auth",
    "incompatible-app-server"
  ] as const)("fully restores and relaunches the previous account after %s", async (failureMode) => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    const authPath = getAuthFilePath(globalCodexHome);
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    let launchCount = 0;
    let quiesceCount = 0;
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome,
      desktopLifecycle: {
        quiesce: async (policy) => {
          quiesceCount += 1;
          return {
            status: "quiesced",
            identity: exactDesktopIdentity,
            capturedProcessCount: 4,
            remainingProcessCount: 0,
            gracefulCloseAccepted: true,
            usedExactTreeFallback: policy === "exact-tree-fallback",
            message: "test tree closed"
          };
        },
        launchAndWaitReady: async () => {
          launchCount += 1;
          if (launchCount === 1) {
            if (failureMode === "launch-timeout") throw new Error("synthetic launch timeout");
            if (failureMode === "wrong-identity") {
              fs.writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: "sk-unexpected-account" }), "utf8");
            }
            if (failureMode === "revoked-auth") {
              fs.writeFileSync(path.join(globalCodexHome, ".force-revoked"), "", "utf8");
            }
            if (failureMode === "incompatible-app-server") {
              fs.writeFileSync(path.join(globalCodexHome, ".force-incompatible"), "", "utf8");
            }
          } else {
            fs.rmSync(path.join(globalCodexHome, ".force-revoked"), { force: true });
            fs.rmSync(path.join(globalCodexHome, ".force-incompatible"), { force: true });
          }
          return {
            identity: exactDesktopIdentity,
            rootPid: 800 + launchCount,
            visibleWindowHandle: 8000 + launchCount,
            capturedProcessCount: 4,
            readyAt: Date.now()
          };
        }
      },
      durableAuthStableCheckIntervalMs: 0
    });
    try {
      const first = await manager.startLogin({ type: "apiKey", credential: "sk-rollback-first-profile" });
      const second = await manager.startLogin({ type: "apiKey", credential: "sk-rollback-second-profile" });
      if (failureMode === "wrong-workspace") {
        const target = store.get(second.account!.id)!;
        store.updateCodexAuthMaterial(target.id, {
          encryptedAuthJson: target.encryptedAuthJson,
          authFingerprint: target.authFingerprint!,
          providerAccountId: target.providerAccountId,
          workspaceAccountId: "expected-workspace-account",
          workspaceLabel: "Expected Workspace",
          expiresAt: target.expiresAt
        });
      }
      store.setActive(first.account!.id);
      fs.mkdirSync(globalCodexHome, { recursive: true });
      const originalAuth = vault.decryptUtf8(store.get(first.account!.id)!.encryptedAuthJson);
      fs.writeFileSync(authPath, originalAuth, "utf8");

      await expect(manager.switchAccount(second.account!.id)).rejects.toThrow();

      expect(launchCount).toBe(2);
      expect(quiesceCount).toBe(2);
      expect(fs.readFileSync(authPath, "utf8")).toBe(originalAuth);
      expect(store.get(first.account!.id)?.isActive).toBe(true);
      expect(store.get(second.account!.id)?.isActive).toBe(false);
      expect(manager.listSwitchTransactions()[0]).toMatchObject({
        targetAccountId: second.account!.id,
        status: "rolled_back",
        phase: "rolled_back",
        errorCode: "POST_ACTIVATION_VERIFICATION_FAILED"
      });
      expect(manager.getSwitchHistory()[0]?.status).toBe("rolled_back");
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("serializes switch, refresh, and reauthentication for the Codex provider", async () => {
    const appDataDir = tempDir();
    const globalCodexHome = path.join(appDataDir, "global-codex-home");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    let enterQuiesce: () => void = () => undefined;
    let releaseQuiesce: () => void = () => undefined;
    const quiesceEntered = new Promise<void>((resolve) => {
      enterQuiesce = resolve;
    });
    const quiesceGate = new Promise<void>((resolve) => {
      releaseQuiesce = resolve;
    });
    const manager = new AccountManager(store, vault, appDataDir, installFakeCodex(appDataDir), {
      codexHome: globalCodexHome,
      desktopLifecycle: {
        quiesce: async () => {
          enterQuiesce();
          await quiesceGate;
          return {
            status: "quiesced",
            identity: exactDesktopIdentity,
            capturedProcessCount: 4,
            remainingProcessCount: 0,
            gracefulCloseAccepted: true,
            usedExactTreeFallback: false,
            message: "test"
          };
        },
        launchAndWaitReady: async () => ({
          identity: exactDesktopIdentity,
          rootPid: 900,
          visibleWindowHandle: 9000,
          capturedProcessCount: 4,
          readyAt: Date.now()
        })
      },
      durableAuthStableCheckIntervalMs: 0
    });
    try {
      const first = await manager.startLogin({ type: "apiKey", credential: "sk-race-first-profile" });
      const second = await manager.startLogin({ type: "apiKey", credential: "sk-race-second-profile" });
      store.setActive(first.account!.id);
      fs.mkdirSync(globalCodexHome, { recursive: true });
      fs.writeFileSync(
        getAuthFilePath(globalCodexHome),
        vault.decryptUtf8(store.get(first.account!.id)!.encryptedAuthJson),
        "utf8"
      );

      const switching = manager.switchAccount(second.account!.id);
      await quiesceEntered;
      let refreshSettled = false;
      let reauthSettled = false;
      const refreshing = manager.refreshAccount(first.account!.id).finally(() => {
        refreshSettled = true;
      });
      const reauthenticating = manager.reauthenticateAccount(first.account!.id, {
        type: "apiKey",
        credential: "sk-race-first-reauthenticated"
      }).finally(() => {
        reauthSettled = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(refreshSettled).toBe(false);
      expect(reauthSettled).toBe(false);

      releaseQuiesce();
      await switching;
      await refreshing;
      await reauthenticating;

      expect(store.get(second.account!.id)?.isActive).toBe(true);
      expect(refreshSettled).toBe(true);
      expect(reauthSettled).toBe(true);
    } finally {
      releaseQuiesce();
      await manager.shutdown();
      store.close();
    }
  });

  it("allows only one Manager instance to own a shared CODEX_HOME switch", async () => {
    const rootDir = tempDir();
    const appDataOne = path.join(rootDir, "manager-one");
    const appDataTwo = path.join(rootDir, "manager-two");
    const globalCodexHome = path.join(rootDir, "shared-codex-home");
    fs.mkdirSync(appDataOne, { recursive: true });
    fs.mkdirSync(appDataTwo, { recursive: true });
    const storeOne = new AccountStore(appDataOne);
    const storeTwo = new AccountStore(appDataTwo);
    const vaultOne = new Vault(appDataOne);
    const vaultTwo = new Vault(appDataTwo);
    let enterQuiesce: () => void = () => undefined;
    let releaseQuiesce: () => void = () => undefined;
    const quiesceEntered = new Promise<void>((resolve) => {
      enterQuiesce = resolve;
    });
    const quiesceGate = new Promise<void>((resolve) => {
      releaseQuiesce = resolve;
    });
    const lifecycleOne = {
      quiesce: async () => {
        enterQuiesce();
        await quiesceGate;
        return {
          status: "quiesced" as const,
          identity: exactDesktopIdentity,
          capturedProcessCount: 4,
          remainingProcessCount: 0,
          gracefulCloseAccepted: true,
          usedExactTreeFallback: false,
          message: "test"
        };
      },
      launchAndWaitReady: async () => ({
        identity: exactDesktopIdentity,
        rootPid: 1001,
        visibleWindowHandle: 10001,
        capturedProcessCount: 4,
        readyAt: Date.now()
      })
    };
    const lifecycleTwo = {
      quiesce: async () => {
        throw new Error("second Manager must not reach desktop quiesce");
      },
      launchAndWaitReady: async () => {
        throw new Error("second Manager must not reach desktop launch");
      }
    };
    const managerOne = new AccountManager(
      storeOne,
      vaultOne,
      appDataOne,
      installFakeCodex(appDataOne),
      { codexHome: globalCodexHome, desktopLifecycle: lifecycleOne, durableAuthStableCheckIntervalMs: 0 }
    );
    const managerTwo = new AccountManager(
      storeTwo,
      vaultTwo,
      appDataTwo,
      installFakeCodex(appDataTwo),
      { codexHome: globalCodexHome, desktopLifecycle: lifecycleTwo, durableAuthStableCheckIntervalMs: 0 }
    );
    try {
      const oneFirst = await managerOne.startLogin({ type: "apiKey", credential: "sk-manager-one-first" });
      const oneSecond = await managerOne.startLogin({ type: "apiKey", credential: "sk-manager-one-second" });
      const twoFirst = await managerTwo.startLogin({ type: "apiKey", credential: "sk-manager-two-first" });
      const twoSecond = await managerTwo.startLogin({ type: "apiKey", credential: "sk-manager-two-second" });
      storeOne.setActive(oneFirst.account!.id);
      storeTwo.setActive(twoFirst.account!.id);
      fs.mkdirSync(globalCodexHome, { recursive: true });
      fs.writeFileSync(
        getAuthFilePath(globalCodexHome),
        vaultOne.decryptUtf8(storeOne.get(oneFirst.account!.id)!.encryptedAuthJson),
        "utf8"
      );

      const firstSwitch = managerOne.switchAccount(oneSecond.account!.id);
      await quiesceEntered;
      await expect(managerTwo.switchAccount(twoSecond.account!.id)).rejects.toThrow("Another Codex Account Manager process");
      expect(storeTwo.get(twoFirst.account!.id)?.isActive).toBe(true);
      expect(managerTwo.listSwitchTransactions()).toEqual([]);

      releaseQuiesce();
      await firstSwitch;
      expect(storeOne.get(oneSecond.account!.id)?.isActive).toBe(true);
    } finally {
      releaseQuiesce();
      await Promise.all([managerOne.shutdown(), managerTwo.shutdown()]);
      storeOne.close();
      storeTwo.close();
    }
  });
});
