import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountManager } from "../../src/main/accountManager";
import { AccountStore } from "../../src/main/db";
import { getAuthFilePath } from "../../src/main/codexRpc";
import { Vault } from "../../src/main/security";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-transfer-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("AccountManager transfer", () => {
  it("exports and imports real encrypted account records", async () => {
    const sourceDir = tempDir();
    const targetDir = tempDir();
    const exportPath = path.join(tempDir(), "accounts.cam-export");
    const authJson = JSON.stringify({ auths: { chatgpt: { accountId: "acc_real", accessToken: "token" } } });

    const sourceStore = new AccountStore(sourceDir);
    const targetStore = new AccountStore(targetDir);
    try {
      const sourceVault = new Vault(sourceDir);
      const profileDir = path.join(sourceDir, "profiles", "acc_real");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(getAuthFilePath(profileDir), authJson, "utf8");
      sourceStore.upsert({
        id: "acc_real",
        label: "Рабочий",
        email: "real@example.com",
        planType: "plus",
        profileDir,
        encryptedAuthJson: sourceVault.encryptUtf8(authJson)
      });

      const sourceManager = new AccountManager(sourceStore, sourceVault, sourceDir, "codex");
      const targetVault = new Vault(targetDir);
      const targetManager = new AccountManager(targetStore, targetVault, targetDir, "codex");

      await expect(sourceManager.exportAccounts(exportPath, "strong-password")).resolves.toMatchObject({ exportedCount: 1 });
      const envelope = JSON.parse(fs.readFileSync(exportPath, "utf8")) as { version: number; kdf: { name: string } };
      expect(envelope).toMatchObject({ version: 3, kdf: { name: "scrypt" } });
      await expect(targetManager.importAccounts(exportPath, "strong-password")).resolves.toMatchObject({ importedCount: 1 });

      const imported = targetStore.getByEmail("real@example.com");
      expect(imported?.label).toBe("Рабочий");
      expect(imported?.planType).toBe("plus");
      expect(fs.existsSync(getAuthFilePath(imported!.profileDir))).toBe(false);
      expect(targetVault.decryptUtf8(imported!.encryptedAuthJson)).toBe(authJson);
    } finally {
      sourceStore.close();
      targetStore.close();
    }
  });

  it("binds the current workspace to an account", async () => {
    const appDir = tempDir();
    const store = new AccountStore(appDir);
    try {
      const vault = new Vault(appDir);
      const authJson = JSON.stringify({ account_id: "acc_workspace" });
      store.upsert({
        id: "acc_workspace",
        label: "Проектный",
        email: "project@example.com",
        planType: "pro",
        profileDir: path.join(appDir, "profiles", "acc_workspace"),
        encryptedAuthJson: vault.encryptUtf8(authJson)
      });
      store.setSetting("workspacePath", "C:\\work\\project");

      const manager = new AccountManager(store, vault, appDir, "codex");
      expect(manager.bindWorkspaceAccount("acc_workspace")).toMatchObject({
        workspacePath: "C:\\work\\project",
        accountId: "acc_workspace",
        accountLabel: "Проектный",
        accountEmail: "project@example.com"
      });
      expect(manager.bindWorkspaceAccount(null)).toMatchObject({ accountId: null });
    } finally {
      store.close();
    }
  });

  it("reports profile integrity without exposing auth content", () => {
    const appDir = tempDir();
    const store = new AccountStore(appDir);
    try {
      const vault = new Vault(appDir);
      const authJson = JSON.stringify({ accessToken: "secret-token" });
      const profileDir = path.join(appDir, "profiles", "acc_integrity");
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(getAuthFilePath(profileDir), authJson, "utf8");
      store.upsert({
        id: "acc_integrity",
        label: "Integrity",
        email: "integrity@example.com",
        planType: "pro",
        profileDir,
        encryptedAuthJson: vault.encryptUtf8(authJson)
      });

      const manager = new AccountManager(store, vault, appDir, "codex");
      manager.secureManagedProfileHomes();
      const report = manager.getProfileIntegrity();

      expect(report).toMatchObject({ total: 1, ok: 1, warnings: 0, errors: 0 });
      expect(JSON.stringify(report)).not.toContain("secret-token");
    } finally {
      store.close();
    }
  });
});
