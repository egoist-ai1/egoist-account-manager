import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AntigravityPathInput } from "./antigravityPaths.js";
import { resolveAntigravityPaths } from "./antigravityPaths.js";
import {
  createAntigravityProfileBackup,
  restoreAntigravityProfileBackup,
  type AntigravityProfileBackupManifest
} from "./antigravityProfileBackup.js";

export interface AntigravityStateWriteItem {
  key: string;
  value: string | Buffer;
}

export interface AntigravityProfileWriteInput extends AntigravityPathInput {
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, value);
  fs.renameSync(tempPath, filePath);
}

function writeStateItems(stateDbPath: string, items: AntigravityStateWriteItem[]): void {
  if (items.length === 0) return;
  fs.mkdirSync(path.dirname(stateDbPath), { recursive: true });
  const db = new Database(stateDbPath);
  try {
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
  fs.mkdirSync(path.dirname(stateDbPath), { recursive: true });
  const db = new Database(stateDbPath);
  try {
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

export function writePreparedAntigravityProfile(input: AntigravityProfileWriteInput): AntigravityProfileWriteResult {
  ensureAllowed("state", input.stateItems.map((item) => item.key), input.allowedStateKeys);
  ensureAllowed("state", input.stateDeleteKeys ?? [], input.allowedStateKeys);
  ensureAllowed("storage", Object.keys(input.storagePatch), input.allowedStorageKeys);
  if (input.machineId !== undefined && !input.allowMachineIdWrite) {
    throw new Error("machineId write is not allowlisted");
  }

  const paths = resolveAntigravityPaths(input);
  const backup = createAntigravityProfileBackup(input);
  try {
    writeStateItems(paths.stateDbPath, input.stateItems);
    deleteStateItems(paths.stateDbPath, input.stateDeleteKeys ?? []);
    input.hooks?.afterStateWrite?.();
    const writtenStorageKeys = writeStoragePatch(paths.storageJsonPath, input.storagePatch);
    const machineIdWritten = input.machineId !== undefined;
    if (machineIdWritten) writeFileAtomically(paths.machineIdPath, input.machineId ?? "");
    return {
      applied: true,
      restoredOnError: false,
      backup,
      writtenStateItems: input.stateItems.length,
      writtenStorageKeys,
      machineIdWritten
    };
  } catch (error) {
    restoreAntigravityProfileBackup(backup);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Antigravity profile write failed and was rolled back: ${reason}`);
  }
}
