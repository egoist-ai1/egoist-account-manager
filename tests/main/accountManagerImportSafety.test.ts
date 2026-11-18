import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AccountManager } from "../../src/main/accountManager";
import { AccountStore } from "../../src/main/db";
import { Vault } from "../../src/main/security";

const format = "one.egoist.codex-account-manager.accounts";
const password = "synthetic-import-password";
const dirs: string[] = [];

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "egoist-import-test-"));
  dirs.push(directory);
  const store = new AccountStore(directory);
  const vault = new Vault(directory);
  const manager = new AccountManager(store, vault, directory, null, { codexHome: path.join(directory, "codex-home") });
  return { directory, store, vault, manager };
}

function account(id: string, email: string) {
  return { id, label: email, email, planType: "plus", platform: "codex",
    authJson: JSON.stringify({ tokens: { account_id: id, access_token: "synthetic-token-" + id } }),
    createdAt: 100, updatedAt: 100, lastUsedAt: null, lastRefreshAt: null, subscriptionEndsAt: null,
    status: "active", statusReason: null, rateLimitJson: null, notes: null };
}

function exportFile(directory: string, accounts: unknown[], version = 3) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const iterations = 100_000;
  const key = version === 3 ? crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 67108864 })
    : crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = JSON.stringify({ format, version, exportedAt: 100, accounts });
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const target = path.join(directory, crypto.randomUUID() + ".cam-export");
  fs.writeFileSync(target, JSON.stringify({ format, version, exportedAt: 100,
    kdf: version === 3 ? { name: "scrypt", N: 32768, r: 8, p: 1, maxmem: 67108864, salt: salt.toString("base64") }
      : { name: "pbkdf2-sha256", iterations, salt: salt.toString("base64") },
    cipher: { name: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64") } }));
  return target;
}

afterEach(() => {
  for (const directory of dirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("Account import preflight and atomic application", () => {
  it.each([1, 2, 3])("preserves export version %i and creates only encrypted UUID records", async (version) => {
    const { directory, store, vault, manager } = fixture();
    try {
      const original = account("../../outside", "fixture@example.com");
      const target = exportFile(directory, [original], version);
      const preview = manager.previewImport(target, password);
      expect(preview).toMatchObject({ total: 1, importableCount: 1, skippedCount: 0 });
      expect(store.list()).toHaveLength(0);
      expect(fs.existsSync(path.join(directory, "profiles"))).toBe(false);
      expect(JSON.stringify(preview)).not.toContain("synthetic-token");
      const applied = await manager.applyImport(preview.previewId);
      const imported = applied.accounts[0];
      expect(imported.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(imported.id).not.toBe(original.id);
      expect(imported.credentialState).toBe("needs_review");
      expect(imported.lastAuthenticatedAt).toBeNull();
      expect(imported.lastRefreshAt).toBeNull();
      expect(fs.existsSync(imported.profileDir)).toBe(false);
      expect(vault.decryptUtf8(store.get(imported.id)!.encryptedAuthJson)).toBe(original.authJson);
    } finally { store.close(); }
  });

  it("checks a malformed final entry before applying any earlier entry", () => {
    const { directory, store, manager } = fixture();
    try {
      const invalid = { ...account("invalid", "invalid@example.com"), authJson: "{}" };
      const target = exportFile(directory, [account("valid", "valid@example.com"), invalid]);
      expect(() => manager.previewImport(target, password)).toThrow("usable credential");
      expect(store.list()).toHaveLength(0);
      expect(fs.existsSync(path.join(directory, "profiles"))).toBe(false);
    } finally { store.close(); }
  });

  it("skips existing identities and duplicate entries without replacing credentials", async () => {
    const { directory, store, vault, manager } = fixture();
    try {
      const first = exportFile(directory, [account("same", "same@example.com")]);
      await manager.importAccounts(first, password);
      const existing = store.list()[0];
      const before = vault.decryptUtf8(store.get(existing.id)!.encryptedAuthJson);
      const preview = manager.previewImport(exportFile(directory, [
        { ...account("replacement", "same@example.com"), label: "Overwrite attempt" },
        account("new", "new@example.com"), account("duplicate", "new@example.com")
      ]), password);
      expect(preview).toMatchObject({ importableCount: 1, skippedCount: 2 });
      const result = await manager.applyImport(preview.previewId);
      expect(result).toMatchObject({ importedCount: 1, skippedCount: 2 });
      expect(store.list()).toHaveLength(2);
      expect(vault.decryptUtf8(store.get(existing.id)!.encryptedAuthJson)).toBe(before);
    } finally { store.close(); }
  });

  it("rolls back the whole SQLite batch if the final insert fails", async () => {
    const { directory, store, manager } = fixture();
    const db = new Database(path.join(directory, "accounts.sqlite"));
    try {
      db.exec("CREATE TRIGGER synthetic_import_failure BEFORE INSERT ON accounts WHEN NEW.email = 'last@example.com' BEGIN SELECT RAISE(ABORT, 'synthetic last insert failure'); END");
      const preview = manager.previewImport(exportFile(directory, [account("first", "first@example.com"), account("last", "last@example.com")]), password);
      await expect(manager.applyImport(preview.previewId)).rejects.toThrow("synthetic last insert failure");
      expect(store.list()).toHaveLength(0);
      expect(fs.existsSync(path.join(directory, "profiles"))).toBe(false);
    } finally { db.close(); store.close(); }
  });

  it("rejects stale and already applied preview receipts", async () => {
    const { directory, store, manager } = fixture();
    try {
      const first = manager.previewImport(exportFile(directory, [account("first", "first@example.com")]), password);
      const second = manager.previewImport(exportFile(directory, [account("second", "second@example.com")]), password);
      await manager.applyImport(second.previewId);
      await expect(manager.applyImport(second.previewId)).rejects.toThrow("expired");
      await expect(manager.applyImport(first.previewId)).rejects.toThrow("changed");
      expect(store.list()).toHaveLength(1);
    } finally { store.close(); }
  });

  it("rejects authentication failure without plaintext or partial database records", () => {
    const { directory, store, manager } = fixture();
    try {
      const target = exportFile(directory, [account("one", "one@example.com")]);
      expect(() => manager.previewImport(target, "different-password")).toThrow();
      expect(store.list()).toHaveLength(0);
      expect(fs.existsSync(path.join(directory, "profiles"))).toBe(false);
    } finally { store.close(); }
  });
});
