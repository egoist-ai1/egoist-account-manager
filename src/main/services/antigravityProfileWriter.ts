import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { assertManagedPath } from "../paths.js";
import type { AntigravityPathInput } from "./antigravityPaths.js";
import { resolveAntigravityPaths } from "./antigravityPaths.js";
import {
  createAntigravityProfileBackup,
  restoreAntigravityProfileBackup,
  validateAntigravityProfileBackup,
  type AntigravityBackupProtection,
  type AntigravityProfileBackupManifest
} from "./antigravityProfileBackup.js";

export interface AntigravityStateWriteItem {
  key: string;
  value: string | Buffer;
}

export interface AntigravityProfileWriteInput extends AntigravityPathInput, AntigravityBackupProtection {
  backupRoot: string;
  allowedStateKeys: string[];
  stateItems: AntigravityStateWriteItem[];
  stateDeleteKeys?: string[];
  allowedStorageKeys: string[];
  storagePatch: Record<string, unknown>;
  machineId?: string;
  allowMachineIdWrite: boolean;
  hooks?: {
    afterStateWrite?: () => void;
  };
}

export interface AntigravityProfileWriteResult {
  applied: boolean;
  restoredOnError: boolean;
  backup: AntigravityProfileBackupManifest;
  writtenStateItems: number;
  writtenStorageKeys: string[];
  machineIdWritten: boolean;
}

function ensureAllowed(label: string, keys: string[], allowedKeys: string[]): void {
  const allowed = new Set(allowedKeys);
  const denied = keys.find((key) => !allowed.has(key));
  if (denied) {
    throw new Error(`${label} key is not allowlisted: ${denied}`);
  }
}

function writeFileAtomically(filePath: string, value: string | Buffer): void {
  assertManagedPath(path.dirname(filePath), filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = assertManagedPath(path.dirname(filePath), `${filePath}.tmp-${process.pid}-${Date.now()}`);
  try {
    const descriptor = fs.openSync(tempPath, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, value);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    assertManagedPath(path.dirname(filePath), filePath);
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(assertManagedPath(path.dirname(filePath), tempPath), { force: true });
  }
}

function writeStateItems(stateDbPath: string, items: AntigravityStateWriteItem[]): void {
  if (items.length === 0) return;
  for (const suffix of ["", "-wal", "-shm"]) assertManagedPath(path.dirname(stateDbPath), `${stateDbPath}${suffix}`);
  fs.mkdirSync(path.dirname(stateDbPath), { recursive: true });
  const db = new Database(stateDbPath);
  try {
    db.pragma("synchronous = FULL");
    db.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    const upsert = db.prepare(`
      INSERT INTO ItemTable (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const run = db.transaction(() => {
      for (const item of items) upsert.run(item.key, item.value);
    });
    run();
  } finally {
    db.close();
  }
}

function deleteStateItems(stateDbPath: string, keys: string[]): void {
  if (keys.length === 0) return;
  for (const suffix of ["", "-wal", "-shm"]) assertManagedPath(path.dirname(stateDbPath), `${stateDbPath}${suffix}`);
  fs.mkdirSync(path.dirname(stateDbPath), { recursive: true });
  const db = new Database(stateDbPath);
  try {
    db.pragma("synchronous = FULL");
    db.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    const remove = db.prepare("DELETE FROM ItemTable WHERE key = ?");
    const run = db.transaction(() => {
      for (const key of keys) remove.run(key);
    });
    run();
  } finally {
    db.close();
  }
}

function writeStoragePatch(storageJsonPath: string, patch: Record<string, unknown>): string[] {
  const keys = Object.keys(patch);
  if (keys.length === 0) return [];
  const existing = fs.existsSync(storageJsonPath)
    ? JSON.parse(fs.readFileSync(storageJsonPath, "utf8")) as unknown
    : {};
  const next = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...existing as Record<string, unknown>, ...patch }
    : { ...patch };
  writeFileAtomically(storageJsonPath, JSON.stringify(next));
  return keys;
}

function verifyStateWriteSet(stateDbPath: string, items: AntigravityStateWriteItem[], deleteKeys: string[]): void {
  if (items.length === 0 && deleteKeys.length === 0) return;
  for (const suffix of ["", "-wal", "-shm"]) assertManagedPath(path.dirname(stateDbPath), stateDbPath + suffix);
  const db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("Antigravity written SQLite integrity check failed");
    const query = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
    const removed = new Set(deleteKeys);
    const lastWrites = new Map(items.map(item => [item.key, item.value]));
    for (const [key, expected] of lastWrites) {
      if (removed.has(key)) continue;
      const row = query.get(key) as { value: string | Buffer } | undefined;
      if (!row || !(typeof row.value === "string" || Buffer.isBuffer(row.value))
        || !Buffer.from(row.value).equals(Buffer.from(expected))) {
        throw new Error("Antigravity written SQLite value failed readback");
      }
    }
    for (const key of removed) {
      if (query.get(key)) throw new Error("Antigravity deleted SQLite value failed readback");
    }
  } finally { db.close(); }
}

function verifyRegularFile(filePath: string): void {
  assertManagedPath(path.dirname(filePath), filePath);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Antigravity written file is not regular");
}

export function writePreparedAntigravityProfile(input: AntigravityProfileWriteInput): AntigravityProfileWriteResult {
  ensureAllowed("state", input.stateItems.map((item) => item.key), input.allowedStateKeys);
  ensureAllowed("state", input.stateDeleteKeys ?? [], input.allowedStateKeys);
  ensureAllowed("storage", Object.keys(input.storagePatch), input.allowedStorageKeys);
  if (input.machineId !== undefined && !input.allowMachineIdWrite) {
    throw new Error("machineId write is not allowlisted");
  }

  if (!input.sealBackup || !input.unsealBackup) throw new Error("A vault protector is required before Antigravity profile writes");
  const paths = resolveAntigravityPaths(input);
  const backup = input.existingBackup ?? createAntigravityProfileBackup(input);
  validateAntigravityProfileBackup(backup, { unsealBackup: input.unsealBackup, pathInput: input, backupRoot: input.backupRoot });
  try {
    const writtenStateDbs = [paths.stateDbPath];
    writeStateItems(paths.stateDbPath, input.stateItems);
    deleteStateItems(paths.stateDbPath, input.stateDeleteKeys ?? []);
    if (paths.secondaryStateDbPath && fs.existsSync(path.dirname(paths.secondaryStateDbPath))) {
      writeStateItems(paths.secondaryStateDbPath, input.stateItems);
      deleteStateItems(paths.secondaryStateDbPath, input.stateDeleteKeys ?? []);
      writtenStateDbs.push(paths.secondaryStateDbPath);
    }
    input.hooks?.afterStateWrite?.();
    const writtenStorageKeys = writeStoragePatch(paths.storageJsonPath, input.storagePatch);
    const machineIdWritten = input.machineId !== undefined;
    if (machineIdWritten) writeFileAtomically(paths.machineIdPath, input.machineId ?? "");
    for (const dbPath of writtenStateDbs) verifyStateWriteSet(dbPath, input.stateItems, input.stateDeleteKeys ?? []);
    if (writtenStorageKeys.length) {
      verifyRegularFile(paths.storageJsonPath);
      const actualStorage = JSON.parse(fs.readFileSync(paths.storageJsonPath, "utf8")) as Record<string, unknown>;
      for (const key of writtenStorageKeys) {
        if (!Object.hasOwn(actualStorage, key) || JSON.stringify(actualStorage[key]) !== JSON.stringify(input.storagePatch[key])) {
          throw new Error("Antigravity written storage value failed readback");
        }
      }
    }
    if (machineIdWritten) {
      verifyRegularFile(paths.machineIdPath);
      if (fs.readFileSync(paths.machineIdPath, "utf8") !== input.machineId) throw new Error("Antigravity written machine identifier failed readback");
    }
    return {
      applied: true,
      restoredOnError: false,
      backup,
      writtenStateItems: input.stateItems.length,
      writtenStorageKeys,
      machineIdWritten
    };
  } catch (error) {
    if (!input.unsealBackup) throw new Error("Antigravity write failed and backup protector is unavailable", { cause: error });
    restoreAntigravityProfileBackup(backup, { unsealBackup: input.unsealBackup, pathInput: input, backupRoot: input.backupRoot });
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Antigravity profile write failed and was rolled back: ${reason}`);
  }
}
