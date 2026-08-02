import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAuthFilePath } from "../../src/main/codexRpc";
import { AccountStore } from "../../src/main/db";
import { getProfileDir } from "../../src/main/paths";
import { Vault } from "../../src/main/security";
import {
  CodexProfileVaultService,
  inspectCodexAuthJson
} from "../../src/main/services/codexProfileVaultService";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-profile-vault-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("CodexProfileVaultService", () => {
  it("hydrates only on demand, backfills verified rotation and removes plaintext", () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const service = new CodexProfileVaultService(appDataDir, store, vault);
    const original = JSON.stringify({ tokens: { account_id: "acc-1", access_token: "original" } });
    const rotated = JSON.stringify({ tokens: { account_id: "acc-1", access_token: "rotated" } });
    const profileDir = getProfileDir(appDataDir, "acc-1");
    try {
      store.upsert({
        id: "acc-1",
        label: "Account",
        email: "account@example.com",
        planType: "plus",
        profileDir,
        encryptedAuthJson: vault.encryptUtf8(original),
        authFingerprint: inspectCodexAuthJson(original).authFingerprint
      });

      const account = store.get("acc-1")!;
      service.hydrate(account);
      expect(fs.readFileSync(getAuthFilePath(profileDir), "utf8")).toBe(original);

      fs.writeFileSync(getAuthFilePath(profileDir), rotated, "utf8");
      const sealed = service.sealVerified(store.get("acc-1")!);

      expect(fs.existsSync(getAuthFilePath(profileDir))).toBe(false);
      expect(vault.decryptUtf8(store.get("acc-1")!.encryptedAuthJson)).toBe(rotated);
      expect(sealed).toMatchObject({
        providerAccountId: "acc-1",
        credentialState: "ready",
        version: 2
      });
    } finally {
      store.close();
    }
  });

  it("seals matching legacy plaintext on startup without changing the vault", () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const service = new CodexProfileVaultService(appDataDir, store, vault);
    const authJson = JSON.stringify({ tokens: { account_id: "acc-2", access_token: "same" } });
    const profileDir = getProfileDir(appDataDir, "acc-2");
    try {
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(getAuthFilePath(profileDir), authJson, "utf8");
      store.upsert({
        id: "acc-2",
        label: "Account",
        email: "account@example.com",
        planType: "plus",
        profileDir,
        encryptedAuthJson: vault.encryptUtf8(authJson)
      });

      expect(service.secureExistingProfiles()).toEqual({ sealed: 1, drifted: 0 });
      expect(fs.existsSync(getAuthFilePath(profileDir))).toBe(false);
      expect(vault.decryptUtf8(store.get("acc-2")!.encryptedAuthJson)).toBe(authJson);
    } finally {
      store.close();
    }
  });

  it("quarantines external drift encrypted and never overwrites the stable vault entry", () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const service = new CodexProfileVaultService(appDataDir, store, vault);
    const stable = JSON.stringify({ tokens: { account_id: "acc-3", access_token: "stable" } });
    const external = JSON.stringify({ tokens: { account_id: "other", access_token: "external" } });
    const profileDir = getProfileDir(appDataDir, "acc-3");
    try {
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(getAuthFilePath(profileDir), external, "utf8");
      store.upsert({
        id: "acc-3",
        label: "Account",
        email: "account@example.com",
        planType: "plus",
        profileDir,
        encryptedAuthJson: vault.encryptUtf8(stable),
        authFingerprint: inspectCodexAuthJson(stable).authFingerprint
      });

      expect(service.secureExistingProfiles()).toEqual({ sealed: 0, drifted: 1 });
      expect(fs.existsSync(getAuthFilePath(profileDir))).toBe(false);
      expect(vault.decryptUtf8(store.get("acc-3")!.encryptedAuthJson)).toBe(stable);
      expect(store.get("acc-3")?.credentialState).toBe("drifted");
      expect(vault.decryptUtf8(store.getAuthDriftCandidate("acc-3")!.encryptedAuthJson)).toBe(external);
      const sqliteBytes = ["accounts.sqlite", "accounts.sqlite-wal", "accounts.sqlite-shm"]
        .filter((name) => fs.existsSync(path.join(appDataDir, name)))
        .map((name) => fs.readFileSync(path.join(appDataDir, name)).toString("latin1"))
        .join("");
      expect(sqliteBytes).not.toContain("stable");
      expect(sqliteBytes).not.toContain("external");
    } finally {
      store.close();
    }
  });

  it("refuses to hydrate or delete auth material outside managed profiles", () => {
    const appDataDir = tempDir();
    const store = new AccountStore(appDataDir);
    const vault = new Vault(appDataDir);
    const service = new CodexProfileVaultService(appDataDir, store, vault);
    const outside = path.join(tempDir(), "outside");
    const authJson = JSON.stringify({ tokens: { account_id: "outside" } });
    try {
      const account = store.upsert({
        id: "outside",
        label: "Outside",
        email: "outside@example.com",
        planType: "plus",
        profileDir: outside,
        encryptedAuthJson: vault.encryptUtf8(authJson)
      });

      expect(() => service.hydrate({ ...account, encryptedAuthJson: store.get("outside")!.encryptedAuthJson })).toThrow(
        "outside the application profiles directory"
      );
      expect(fs.existsSync(getAuthFilePath(outside))).toBe(false);
    } finally {
      store.close();
    }
  });
});
