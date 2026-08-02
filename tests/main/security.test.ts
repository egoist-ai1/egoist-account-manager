import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  Vault,
  VaultUnavailableError,
  type SecureStorageAdapter
} from "../../src/main/security";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-security-"));
  dirs.push(dir);
  return dir;
}

function fakeSecureStorage(options: { available?: boolean; locked?: boolean } = {}): SecureStorageAdapter {
  return {
    isEncryptionAvailable: () => options.available ?? true,
    encryptString: (value) => Buffer.from(`dpapi:${value}`, "utf8"),
    decryptString: (value) => {
      if (options.locked) throw new Error("locked");
      const decoded = value.toString("utf8");
      if (!decoded.startsWith("dpapi:")) throw new Error("invalid");
      return decoded.slice("dpapi:".length);
    }
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Vault secure storage lifecycle", () => {
  it("persists a DPAPI-wrapped master key and reopens ciphertext across processes", () => {
    const dir = tempDir();
    const storage = fakeSecureStorage();
    const first = new Vault(dir, { secureStorage: storage, allowDegradedTestStorage: false });
    const ciphertext = first.encryptUtf8("credential-secret");
    const keyFile = fs.readFileSync(path.join(dir, "vault.key"), "utf8");

    expect(keyFile).not.toMatch(/^[a-f0-9]{64}$/i);
    expect(keyFile).not.toContain("credential-secret");
    expect(new Vault(dir, { secureStorage: storage, allowDegradedTestStorage: false }).decryptUtf8(ciphertext)).toBe(
      "credential-secret"
    );
  });

  it("fails closed when secure storage is unavailable outside the test fallback", () => {
    const dir = tempDir();
    expect(() => new Vault(dir, {
      secureStorage: fakeSecureStorage({ available: false }),
      allowDegradedTestStorage: false
    })).toThrow(VaultUnavailableError);
    expect(fs.existsSync(path.join(dir, "vault.local.key"))).toBe(false);
  });

  it("does not overwrite an existing master key when secure storage is locked", () => {
    const dir = tempDir();
    const storage = fakeSecureStorage();
    new Vault(dir, { secureStorage: storage, allowDegradedTestStorage: false });
    const before = fs.readFileSync(path.join(dir, "vault.key"));

    expect(() => new Vault(dir, {
      secureStorage: fakeSecureStorage({ locked: true }),
      allowDegradedTestStorage: false
    })).toThrow(VaultUnavailableError);
    expect(fs.readFileSync(path.join(dir, "vault.key"))).toEqual(before);
  });

  it("migrates a legacy plaintext key into secure storage and removes the fallback", () => {
    const dir = tempDir();
    const legacy = "a".repeat(64);
    fs.writeFileSync(path.join(dir, "vault.local.key"), legacy, "utf8");

    const vault = new Vault(dir, {
      secureStorage: fakeSecureStorage(),
      allowDegradedTestStorage: false
    });
    const ciphertext = vault.encryptUtf8("migrated");

    expect(fs.existsSync(path.join(dir, "vault.local.key"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "vault.key"), "utf8")).not.toBe(legacy);
    expect(vault.decryptUtf8(ciphertext)).toBe("migrated");
  });
});
