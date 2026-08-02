import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAntigravityProfileBackup, restoreAntigravityProfileBackup } from "../../src/main/services/antigravityProfileBackup";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-backup-"));
  tempDirs.push(dir);
  return dir;
}

function writeProfile(appData: string) {
  const userDataDir = path.join(appData, "Antigravity IDE");
  const storageDir = path.join(userDataDir, "User", "globalStorage");
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(path.join(storageDir, "state.vscdb"), "state-secret", "utf8");
  fs.writeFileSync(path.join(storageDir, "storage.json"), "{\"token\":\"storage-secret\"}", "utf8");
  fs.writeFileSync(path.join(userDataDir, "machineid"), "machine-secret", "utf8");
  return {
    userDataDir,
    stateDbPath: path.join(storageDir, "state.vscdb"),
    storageJsonPath: path.join(storageDir, "storage.json"),
    machineIdPath: path.join(userDataDir, "machineid")
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("antigravity profile backup", () => {
  it("creates a metadata-only backup manifest while copying profile files", () => {
    const appData = tempDir();
    const backupRoot = tempDir();
    writeProfile(appData);

    const manifest = createAntigravityProfileBackup({
      platform: "win32",
      appData,
      home: path.dirname(appData),
      backupRoot
    });

    expect(manifest.id).toMatch(/^ag-backup-/);
    expect(manifest.files).toHaveLength(3);
    expect(manifest.files.every((file) => file.existed && file.sizeBytes && file.sizeBytes > 0)).toBe(true);
    expect(fs.existsSync(path.join(manifest.backupDir, "state.vscdb"))).toBe(true);
    expect(fs.existsSync(path.join(manifest.backupDir, "storage.json"))).toBe(true);
    expect(fs.existsSync(path.join(manifest.backupDir, "machineid"))).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("state-secret");
    expect(JSON.stringify(manifest)).not.toContain("storage-secret");
    expect(JSON.stringify(manifest)).not.toContain("machine-secret");
  });

  it("restores backed up profile files atomically over changed files", () => {
    const appData = tempDir();
    const backupRoot = tempDir();
    const paths = writeProfile(appData);
    const manifest = createAntigravityProfileBackup({
      platform: "win32",
      appData,
      home: path.dirname(appData),
      backupRoot
    });

    fs.writeFileSync(paths.stateDbPath, "changed-state", "utf8");
    fs.writeFileSync(paths.storageJsonPath, "{\"changed\":true}", "utf8");
    fs.rmSync(paths.machineIdPath);

    const result = restoreAntigravityProfileBackup(manifest);

    expect(result.restoredFiles).toBe(3);
    expect(fs.readFileSync(paths.stateDbPath, "utf8")).toBe("state-secret");
    expect(fs.readFileSync(paths.storageJsonPath, "utf8")).toBe("{\"token\":\"storage-secret\"}");
    expect(fs.readFileSync(paths.machineIdPath, "utf8")).toBe("machine-secret");
  });
});
