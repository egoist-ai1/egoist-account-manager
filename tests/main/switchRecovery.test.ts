import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountManager } from "../../src/main/accountManager";
import { AccountStore } from "../../src/main/db";
import { Vault } from "../../src/main/security";
import { inspectCodexAuthJson } from "../../src/main/services/codexProfileVaultService";
import { SwitchService } from "../../src/main/services/switchService";
import type { OpenAiDesktopIdentity, SwitchTransactionPhase } from "../../src/shared/types";

const dirs: string[] = [];
const exactDesktopIdentity: OpenAiDesktopIdentity = {
  product: "codex",
  packageName: "OpenAI.Codex",
  packageFullName: "OpenAI.Codex_26.721.4979.0_x64__recovery",
  packageFamilyName: "OpenAI.Codex_recovery",
  version: "26.721.4979.0",
  installLocation: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_recovery",
  executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_recovery\\app\\ChatGPT.exe",
  appUserModelId: "OpenAI.Codex_recovery!App"
};

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-switch-recovery-"));
  dirs.push(dir);
  return dir;
}

function installRecoveryCodex(dir: string): string {
  const scriptPath = path.join(dir, "recovery-codex.mjs");
  const commandPath = path.join(dir, "codex.cmd");
  fs.writeFileSync(scriptPath, `
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
if (process.argv[2] !== "app-server") process.exit(2);
const home = process.env.CODEX_HOME;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  const request = JSON.parse(line);
  if (request.method === "initialized") continue;
  let result;
  if (request.method === "initialize") {
    result = { userAgent: "recovery-codex/3.0", codexHome: home, platformFamily: "windows", platformOs: "windows" };
  } else if (request.method === "account/read") {
    const authPath = path.join(home, "auth.json");
    const auth = fs.existsSync(authPath) ? JSON.parse(fs.readFileSync(authPath, "utf8")) : null;
    result = auth?.OPENAI_API_KEY
      ? { account: { type: "apiKey" }, requiresOpenaiAuth: false }
      : { account: null, requiresOpenaiAuth: true };
  } else {
    process.stdout.write(JSON.stringify({ id: request.id, error: { code: -1, message: "unsupported" } }) + "\\n");
    continue;
  }
  process.stdout.write(JSON.stringify({ id: request.id, result }) + "\\n");
}
`, "utf8");
  fs.writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "%~dp0recovery-codex.mjs" %*\r\n`, "utf8");
  return commandPath;
}

function addApiAccount(
  store: AccountStore,
  vault: Vault,
  appDataDir: string,
  id: string,
  authJson: string
) {
  const metadata = inspectCodexAuthJson(authJson);
  return store.upsert({
    id,
    label: id,
    email: `codex:apiKey:${id}`,
    planType: "unknown",
    profileDir: path.join(appDataDir, "profiles", id),
    encryptedAuthJson: vault.encryptUtf8(authJson),
    authMode: "apiKey",
    authFingerprint: metadata.authFingerprint,
    providerAccountId: metadata.providerAccountId,
    workspaceAccountId: metadata.workspaceAccountId,
    workspaceLabel: metadata.workspaceLabel,
    credentialState: "ready",
    status: "active"
  });
}

function createInterrupted(
  store: AccountStore,
  targetId: string,
  previousId: string,
  targetFingerprint: string,
  previousFingerprint: string,
  phase: SwitchTransactionPhase
) {
  const created = store.createSwitchTransaction({
    id: `recovery-${phase.replace(/_/g, "-")}-${Date.now()}`,
    platform: "codex",
    targetAccountId: targetId,
    previousAccountId: previousId,
    targetFingerprint,
    previousFingerprint
  });
  return store.updateSwitchTransaction(created.id, {
    status: phase === "ready" ? "pending" : phase === "rolling_back" ? "rolling_back" : "running",
    phase
  }, created.version);
}

async function activateTarget(
  store: AccountStore,
  vault: Vault,
  codexHome: string,
  transactionId: string,
  targetId: string,
  previousId: string,
  targetAuth: string
) {
  return new SwitchService({
    codexHome,
    sealBackup: (contents) => vault.encryptUtf8(contents),
    unsealBackup: (ciphertext) => vault.decryptUtf8(ciphertext),
    stableCheckIntervalMs: 0,
    afterWrite: async () => undefined,
    recordEvent: async (event) => store.recordSwitchEvent(event)
  }).switchTo({
    transactionId,
    accountId: targetId,
    previousAccountId: previousId,
    expectedAuthAccountId: null,
    authJson: targetAuth
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "win32")("switch startup recovery", () => {
  it.each([
    "preparing",
    "validating_previous",
    "validating_target",
    "ready",
    "quiescing"
  ] as const)("aborts interrupted pre-write phase %s without changing auth", async (phase) => {
    const appDataDir = tempDir();
    const codexHome = path.join(appDataDir, "codex-home");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const previousAuth = JSON.stringify({ OPENAI_API_KEY: "previous" });
    const targetAuth = JSON.stringify({ OPENAI_API_KEY: "target" });
    const previous = addApiAccount(store, vault, appDataDir, "previous", previousAuth);
    const target = addApiAccount(store, vault, appDataDir, "target", targetAuth);
    store.setActive(previous.id);
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "auth.json"), previousAuth, "utf8");
    createInterrupted(store, target.id, previous.id, target.authFingerprint!, previous.authFingerprint!, phase);
    const manager = new AccountManager(store, vault, appDataDir, installRecoveryCodex(appDataDir), { codexHome });
    try {
      const recovered = await manager.recoverInterruptedSwitches();

      expect(recovered[0]).toMatchObject({ status: "aborted", phase: "aborted" });
      expect(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")).toBe(previousAuth);
      expect(store.get(previous.id)?.isActive).toBe(true);
      expect(await manager.recoverInterruptedSwitches()).toEqual([]);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it.each(["activating", "launching", "verifying"] as const)(
    "commits an interrupted target at phase %s only after target hashes and official identity verify",
    async (phase) => {
      const appDataDir = tempDir();
      const codexHome = path.join(appDataDir, "codex-home");
      const store = new AccountStore(appDataDir);
      const vault = new Vault(appDataDir);
      const previousAuth = JSON.stringify({ OPENAI_API_KEY: "previous" });
      const targetAuth = JSON.stringify({ OPENAI_API_KEY: "target" });
      const previous = addApiAccount(store, vault, appDataDir, "previous", previousAuth);
      const target = addApiAccount(store, vault, appDataDir, "target", targetAuth);
      store.setActive(previous.id);
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(path.join(codexHome, "auth.json"), previousAuth, "utf8");
      const transaction = createInterrupted(
        store,
        target.id,
        previous.id,
        target.authFingerprint!,
        previous.authFingerprint!,
        phase
      );
      const activation = await activateTarget(store, vault, codexHome, transaction.id, target.id, previous.id, targetAuth);
      const orphanStage = path.join(activation.backupPath, "stage", "orphan.tmp");
      fs.mkdirSync(path.dirname(orphanStage), { recursive: true });
      fs.writeFileSync(orphanStage, targetAuth, "utf8");
      const manager = new AccountManager(store, vault, appDataDir, installRecoveryCodex(appDataDir), { codexHome });
      try {
        const recovered = await manager.recoverInterruptedSwitches();

        expect(recovered[0]).toMatchObject({ status: "committed", phase: "committed" });
        expect(store.get(target.id)?.isActive).toBe(true);
        expect(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")).toBe(targetAuth);
        expect(fs.existsSync(orphanStage)).toBe(false);
        expect(await manager.recoverInterruptedSwitches()).toEqual([]);
      } finally {
        await manager.shutdown();
        store.close();
      }
    }
  );

  it("restores a manifest-backed previous bundle when active bytes are ambiguous", async () => {
    const appDataDir = tempDir();
    const codexHome = path.join(appDataDir, "codex-home");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const previousAuth = JSON.stringify({ OPENAI_API_KEY: "previous" });
    const targetAuth = JSON.stringify({ OPENAI_API_KEY: "target" });
    const previous = addApiAccount(store, vault, appDataDir, "previous", previousAuth);
    const target = addApiAccount(store, vault, appDataDir, "target", targetAuth);
    store.setActive(previous.id);
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "auth.json"), previousAuth, "utf8");
    const transaction = createInterrupted(
      store,
      target.id,
      previous.id,
      target.authFingerprint!,
      previous.authFingerprint!,
      "activating"
    );
    await activateTarget(store, vault, codexHome, transaction.id, target.id, previous.id, targetAuth);
    fs.writeFileSync(path.join(codexHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "intruder" }), "utf8");
    const lifecycleOrder: string[] = [];
    const manager = new AccountManager(store, vault, appDataDir, installRecoveryCodex(appDataDir), {
      codexHome,
      desktopLifecycle: {
        getDiagnostics: async () => {
          lifecycleOrder.push("diagnostics");
          return {
            status: "running",
            selected: exactDesktopIdentity,
            candidates: [exactDesktopIdentity],
            selectionReason: "synthetic recovery target",
            runningRootCount: 1,
            capturedProcessCount: 4,
            message: "synthetic target is still running"
          };
        },
        quiesce: async (policy) => {
          lifecycleOrder.push(`quiesce:${policy}`);
          fs.writeFileSync(path.join(codexHome, "auth.json"), targetAuth, "utf8");
          return {
            status: "quiesced",
            identity: exactDesktopIdentity,
            capturedProcessCount: 4,
            remainingProcessCount: 0,
            gracefulCloseAccepted: true,
            usedExactTreeFallback: true,
            message: "synthetic target stopped after its final auth write"
          };
        },
        launchAndWaitReady: async (identity) => {
          lifecycleOrder.push("launch");
          expect(identity).toEqual(exactDesktopIdentity);
          expect(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")).toBe(previousAuth);
          return {
            identity: exactDesktopIdentity,
            rootPid: 902,
            visibleWindowHandle: 9002,
            capturedProcessCount: 4,
            readyAt: Date.now()
          };
        }
      }
    });
    try {
      const recovered = await manager.recoverInterruptedSwitches();

      expect(recovered[0]).toMatchObject({ status: "rolled_back", phase: "rolled_back" });
      expect(lifecycleOrder).toEqual([
        "diagnostics",
        "quiesce:exact-tree-fallback",
        "launch"
      ]);
      expect(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")).toBe(previousAuth);
      expect(store.get(previous.id)?.isActive).toBe(true);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });

  it("surfaces recovery-required when neither fingerprint nor rollback manifest is trustworthy", async () => {
    const appDataDir = tempDir();
    const codexHome = path.join(appDataDir, "codex-home");
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const previousAuth = JSON.stringify({ OPENAI_API_KEY: "previous" });
    const targetAuth = JSON.stringify({ OPENAI_API_KEY: "target" });
    const previous = addApiAccount(store, vault, appDataDir, "previous", previousAuth);
    const target = addApiAccount(store, vault, appDataDir, "target", targetAuth);
    store.setActive(previous.id);
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "unknown" }), "utf8");
    createInterrupted(
      store,
      target.id,
      previous.id,
      target.authFingerprint!,
      previous.authFingerprint!,
      "activating"
    );
    const manager = new AccountManager(store, vault, appDataDir, installRecoveryCodex(appDataDir), { codexHome });
    try {
      const recovered = await manager.recoverInterruptedSwitches();

      expect(recovered[0]).toMatchObject({
        status: "recovery_required",
        phase: "recovery_required",
        errorCode: "INTERRUPTED_STATE_AMBIGUOUS"
      });
      expect(store.get(previous.id)?.isActive).toBe(true);
    } finally {
      await manager.shutdown();
      store.close();
    }
  });
});
