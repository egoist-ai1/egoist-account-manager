import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityProfileBackup, restoreAntigravityProfileBackup } from "../../src/main/services/antigravityProfileBackup";
import { createMemoryBackupProtection } from "../helpers/safetyFixtures";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-backup-")); tempDirs.push(dir); return dir;
}
function makeDb(filePath: string, value = "state-secret"): Database.Database {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL"); db.pragma("wal_autocheckpoint = 0");
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO ItemTable VALUES ('token', ?)").run(value);
  return db;
}
function readValue(filePath: string): string {
  const db = new Database(filePath, { readonly: true });
  try { return (db.prepare("SELECT value FROM ItemTable WHERE key = 'token'").get() as { value: string }).value; } finally { db.close(); }
}
function writeProfile(appData: string) {
  const userDataDir = path.join(appData, "Antigravity IDE");
  const storageDir = path.join(userDataDir, "User", "globalStorage");
  const stateDbPath = path.join(storageDir, "state.vscdb");
  const db = makeDb(stateDbPath); db.close();
  fs.writeFileSync(path.join(storageDir, "storage.json"), '{"token":"storage-secret"}');
  fs.writeFileSync(path.join(userDataDir, "machineid"), "machine-secret");
  return { stateDbPath, storageJsonPath: path.join(storageDir, "storage.json"), machineIdPath: path.join(userDataDir, "machineid") };
}
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("sealed Antigravity profile backup", () => {
  it("seals every write-set target, including absence and Credential Manager material", () => {
    const appData = tempDir(); const backupRoot = tempDir(); writeProfile(appData);
    const protection = createMemoryBackupProtection();
    const manifest = createAntigravityProfileBackup({ platform: "win32", appData, home: appData, backupRoot, ...protection, credentialSnapshot: { existed: true, value: "credential-secret" } });
    expect(manifest.version).toBe(2);
    expect(manifest.files.map((file) => file.kind)).toEqual(expect.arrayContaining(["stateDb", "secondaryStateDb", "sessionCache", "appStorage", "installationId"]));
    for (const name of fs.readdirSync(manifest.backupDir)) {
      const text = fs.readFileSync(path.join(manifest.backupDir, name), "utf8");
      for (const secret of ["state-secret", "storage-secret", "machine-secret", "credential-secret"]) expect(text).not.toContain(secret);
    }
    const restored = restoreAntigravityProfileBackup(manifest, { ...protection, pathInput: { platform: "win32", appData, home: appData }, backupRoot });
    expect(restored.verified).toBe(true);
    expect(restored.credentialSnapshot).toEqual({ existed: true, value: "credential-secret" });
  });
  it("captures uncheckpointed WAL rows and restores both databases and original absence", () => {
    const appData = tempDir(); const backupRoot = tempDir(); const protection = createMemoryBackupProtection();
    const primary = path.join(appData, "Antigravity IDE", "User", "globalStorage", "state.vscdb");
    const secondary = path.join(appData, "Antigravity", "User", "globalStorage", "state.vscdb");
    const primaryDb = makeDb(primary, "wal-secret"); const secondaryDb = makeDb(secondary, "secondary-secret");
    let manifest;
    try {
      expect(fs.existsSync(`${primary}-wal`)).toBe(true);
      manifest = createAntigravityProfileBackup({ platform: "win32", appData, home: appData, backupRoot, ...protection });
    } finally { primaryDb.close(); secondaryDb.close(); }
    for (const filePath of [primary, secondary]) { const db = new Database(filePath); try { db.prepare("UPDATE ItemTable SET value = 'changed'").run(); } finally { db.close(); } }
    const createdAfterSnapshot = path.join(appData, "Antigravity IDE", "machineid"); fs.writeFileSync(createdAfterSnapshot, "new-machine");
    restoreAntigravityProfileBackup(manifest!, { ...protection, pathInput: { platform: "win32", appData, home: appData }, backupRoot });
    expect(readValue(primary)).toBe("wal-secret"); expect(readValue(secondary)).toBe("secondary-secret"); expect(fs.existsSync(createdAfterSnapshot)).toBe(false);
  });
  it("rejects damaged late snapshot material before changing any target", () => {
    const appData = tempDir(); const backupRoot = tempDir(); const paths = writeProfile(appData); const protection = createMemoryBackupProtection();
    const manifest = createAntigravityProfileBackup({ platform: "win32", appData, home: appData, backupRoot, ...protection });
    fs.writeFileSync(paths.machineIdPath, "preserve-changed-machine");
    fs.writeFileSync(manifest.files.at(-1)!.backupPath, "corrupted-seal");
    expect(() => restoreAntigravityProfileBackup(manifest, { ...protection, pathInput: { platform: "win32", appData, home: appData }, backupRoot })).toThrow();
    expect(fs.readFileSync(paths.machineIdPath, "utf8")).toBe("preserve-changed-machine");
  });
  it("refuses redirected source files without touching the foreign sentinel", () => {
    const appData = tempDir(); const backupRoot = tempDir(); const foreign = tempDir(); const paths = writeProfile(appData);
    const sentinel = path.join(foreign, "machineid"); fs.writeFileSync(sentinel, "foreign");
    const profileDir = path.dirname(paths.machineIdPath); fs.renameSync(profileDir, path.join(appData, "original-profile")); fs.symlinkSync(foreign, profileDir, "junction");
    expect(() => createAntigravityProfileBackup({ platform: "win32", appData, home: appData, backupRoot, ...createMemoryBackupProtection() })).toThrow(/reparse/);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("foreign");
  });
  it("requires a vault protector before creating plaintext or mutating a profile", () => {
    const appData = tempDir(); const backupRoot = tempDir(); const paths = writeProfile(appData);
    expect(() => createAntigravityProfileBackup({ platform: "win32", appData, backupRoot })).toThrow(/vault protector/);
    expect(fs.readdirSync(backupRoot)).toEqual([]); expect(readValue(paths.stateDbPath)).toBe("state-secret");
  });
  it("authenticates Credential Manager snapshot presence before any restore", () => {
    const appData = tempDir(); const backupRoot = tempDir(); const paths = writeProfile(appData);
    const protection = createMemoryBackupProtection();
    const manifest = createAntigravityProfileBackup({
      platform: "win32", appData, home: appData, backupRoot, ...protection,
      credentialSnapshot: { existed: true, value: "previous-credential-secret" }
    });
    fs.writeFileSync(paths.machineIdPath, "preserve-current-machine");
    const tampered = { ...manifest };
    delete tampered.credentialSnapshot;
    fs.writeFileSync(path.join(tampered.backupDir, "manifest.json"), JSON.stringify(tampered));
    expect(() => restoreAntigravityProfileBackup(tampered, {
      ...protection, pathInput: { platform: "win32", appData, home: appData }, backupRoot
    })).toThrow(/sealed manifest metadata mismatch/i);
    expect(fs.readFileSync(paths.machineIdPath, "utf8")).toBe("preserve-current-machine");
  });

});
