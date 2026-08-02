import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";

const KEY_FILE = "vault.key";
const FALLBACK_KEY_FILE = "vault.local.key";

export interface SecureStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface VaultOptions {
  secureStorage?: SecureStorageAdapter;
  allowDegradedTestStorage?: boolean;
}

export class VaultUnavailableError extends Error {
  constructor() {
    super("Windows secure storage is unavailable. Secret account data cannot be opened safely.");
    this.name = "VaultUnavailableError";
  }
}

function atomicWrite(filePath: string, data: Buffer | string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function parseHexKey(value: string): Buffer | null {
  const normalized = value.trim();
  return /^[a-f0-9]{64}$/i.test(normalized) ? Buffer.from(normalized, "hex") : null;
}

function readPlaintextKey(filePath: string): Buffer | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return parseHexKey(fs.readFileSync(filePath, "utf8")) ?? null;
  } catch {
    return null;
  }
}

function readSafeStorageKey(filePath: string, storage: SecureStorageAdapter): Buffer | null {
  if (!storage.isEncryptionAvailable() || !fs.existsSync(filePath)) return null;
  try {
    return parseHexKey(storage.decryptString(fs.readFileSync(filePath))) ?? null;
  } catch {
    return null;
  }
}

function writeSafeStorageKey(filePath: string, key: Buffer, storage: SecureStorageAdapter): void {
  atomicWrite(filePath, storage.encryptString(key.toString("hex")));
}

function readOrCreateMasterKey(appDataDir: string, options: VaultOptions): { key: Buffer; degraded: boolean } {
  const keyPath = path.join(appDataDir, KEY_FILE);
  const fallbackKeyPath = path.join(appDataDir, FALLBACK_KEY_FILE);
  const storage = options.secureStorage ?? safeStorage;
  const encryptionAvailable = Boolean(storage?.isEncryptionAvailable());

  const encryptedKey = encryptionAvailable ? readSafeStorageKey(keyPath, storage) : null;
  if (encryptedKey) return { key: encryptedKey, degraded: false };

  const legacyKey = readPlaintextKey(keyPath) ?? readPlaintextKey(fallbackKeyPath);
  if (encryptionAvailable) {
    if (fs.existsSync(keyPath) && !legacyKey) {
      throw new VaultUnavailableError();
    }
    const key = legacyKey ?? crypto.randomBytes(32);
    writeSafeStorageKey(keyPath, key, storage);
    if (fs.existsSync(fallbackKeyPath)) fs.unlinkSync(fallbackKeyPath);
    return { key, degraded: false };
  }

  // Unit tests run without Electron's Windows DPAPI. Keep their data process-local
  // rather than recreating the insecure plaintext key fallback.
  if (options.allowDegradedTestStorage ?? process.env.NODE_ENV === "test") {
    return { key: crypto.randomBytes(32), degraded: true };
  }

  throw new VaultUnavailableError();
}

export class Vault {
  private readonly key: Buffer;
  private readonly degraded: boolean;

  constructor(appDataDir: string, options: VaultOptions = {}) {
    const state = readOrCreateMasterKey(appDataDir, options);
    this.key = state.key;
    this.degraded = state.degraded;
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  encryptUtf8(value: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `cam_v1_${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
  }

  decryptUtf8(payload: string): string {
    if (!payload.startsWith("cam_v1_")) {
      throw new Error("Unsupported encrypted payload format");
    }
    const raw = Buffer.from(payload.slice("cam_v1_".length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}

export function maskSecret(value: string): string {
  if (value.length <= 12) return "[secret]";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
