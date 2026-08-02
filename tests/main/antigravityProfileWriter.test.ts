import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { writePreparedAntigravityProfile } from "../../src/main/services/antigravityProfileWriter";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-writer-"));
  tempDirs.push(dir);
  return dir;
}

function createProfile(appData: string) {
  const userDataDir = path.join(appData, "Antigravity IDE");
  const storageDir = path.join(userDataDir, "User", "globalStorage");
  fs.mkdirSync(storageDir, { recursive: true });
  const stateDbPath = path.join(storageDir, "state.vscdb");
  const db = new Database(stateDbPath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("cam.allowed.existing", "old-state-secret");
  } finally {
    db.close();
  }
  fs.writeFileSync(path.join(storageDir, "storage.json"), JSON.stringify({ "cam.allowed.existing": "old-storage-secret" }), "utf8");
  fs.writeFileSync(path.join(userDataDir, "machineid"), "old-machine-secret", "utf8");
  return {
    stateDbPath,
    storageJsonPath: path.join(storageDir, "storage.json"),
    machineIdPath: path.join(userDataDir, "machineid")
  };
}

function readStateValue(dbPath: string, key: string): string | null {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key) as { value: Buffer | string } | undefined;
    return row ? String(row.value) : null;
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("writePreparedAntigravityProfile", () => {
  it("writes only explicit allowlisted keys after creating a metadata-only backup", () => {
    const appData = tempDir();
    const backupRoot = tempDir();
    const paths = createProfile(appData);

    const result = writePreparedAntigravityProfile({
      platform: "win32",
      appData,
      home: path.dirname(appData),
      backupRoot,
      allowedStateKeys: ["cam.allowed.token"],
      stateItems: [{ key: "cam.allowed.token", value: "new-state-secret" }],
      allowedStorageKeys: ["cam.allowed.storage"],
      storagePatch: { "cam.allowed.storage": "new-storage-secret" },
      machineId: "new-machine-secret",
      allowMachineIdWrite: true
    });

    expect(result.applied).toBe(true);
    expect(result.restoredOnError).toBe(false);
    expect(result.writtenStateItems).toBe(1);
    expect(result.writtenStorageKeys).toEqual(["cam.allowed.storage"]);
    expect(result.machineIdWritten).toBe(true);
    expect(readStateValue(paths.stateDbPath, "cam.allowed.token")).toBe("new-state-secret");
    expect(JSON.parse(fs.readFileSync(paths.storageJsonPath, "utf8"))["cam.allowed.storage"]).toBe("new-storage-secret");
    expect(fs.readFileSync(paths.machineIdPath, "utf8")).toBe("new-machine-secret");
    expect(JSON.stringify(result.backup)).not.toContain("new-state-secret");
    expect(JSON.stringify(result.backup)).not.toContain("new-storage-secret");
    expect(JSON.stringify(result.backup)).not.toContain("new-machine-secret");
  });

  it("rejects non-allowlisted writes before changing the profile", () => {
    const appData = tempDir();
    const backupRoot = tempDir();
    const paths = createProfile(appData);

    expect(() => writePreparedAntigravityProfile({
      platform: "win32",
      appData,
      home: path.dirname(appData),
      backupRoot,
      allowedStateKeys: ["cam.allowed.token"],
      stateItems: [{ key: "unexpected.token", value: "blocked-secret" }],
      allowedStorageKeys: [],
      storagePatch: {},
      allowMachineIdWrite: false
    })).toThrow(/not allowlisted/i);

    expect(readStateValue(paths.stateDbPath, "unexpected.token")).toBeNull();
    expect(fs.readFileSync(paths.machineIdPath, "utf8")).toBe("old-machine-secret");
  });

  it("restores the backup if a later write step fails", () => {
    const appData = tempDir();
    const backupRoot = tempDir();
    const paths = createProfile(appData);

    expect(() => writePreparedAntigravityProfile({
      platform: "win32",
      appData,
      home: path.dirname(appData),
      backupRoot,
      allowedStateKeys: ["cam.allowed.token"],
      stateItems: [{ key: "cam.allowed.token", value: "new-state-secret" }],
      allowedStorageKeys: ["cam.allowed.storage"],
      storagePatch: { "cam.allowed.storage": "new-storage-secret" },
      allowMachineIdWrite: false,
      hooks: {
        afterStateWrite: () => {
          throw new Error("simulated storage failure");
        }
      }
    })).toThrow(/rolled back/i);

    expect(readStateValue(paths.stateDbPath, "cam.allowed.token")).toBeNull();
    expect(readStateValue(paths.stateDbPath, "cam.allowed.existing")).toBe("old-state-secret");
    expect(fs.readFileSync(paths.storageJsonPath, "utf8")).toBe(JSON.stringify({ "cam.allowed.existing": "old-storage-secret" }));
  });
});
