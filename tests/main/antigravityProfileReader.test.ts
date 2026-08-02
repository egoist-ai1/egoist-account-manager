import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { inspectAntigravityProfile } from "../../src/main/services/antigravityProfileReader";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-reader-"));
  tempDirs.push(dir);
  return dir;
}

function createProfile(appData: string): string {
  const userDataDir = path.join(appData, "Antigravity IDE");
  const storageDir = path.join(userDataDir, "User", "globalStorage");
  fs.mkdirSync(storageDir, { recursive: true });
  return userDataDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("inspectAntigravityProfile", () => {
  it("summarizes IDE profile files without exposing stored values", () => {
    const appData = tempDir();
    const userDataDir = createProfile(appData);
    const storageDir = path.join(userDataDir, "User", "globalStorage");
    const dbPath = path.join(storageDir, "state.vscdb");
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
      db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("google.auth.refresh", "refresh-token-secret");
      db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("window.layout", "layout-secret");
    } finally {
      db.close();
    }
    fs.writeFileSync(path.join(storageDir, "storage.json"), JSON.stringify({
      accessToken: "storage-secret",
      theme: "dark"
    }), "utf8");
    fs.writeFileSync(path.join(userDataDir, "machineid"), "machine-secret", "utf8");

    const inspection = inspectAntigravityProfile({
      platform: "win32",
      appData,
      home: path.dirname(appData)
    });

    expect(inspection.stateDb).toMatchObject({
      exists: true,
      readable: true,
      itemTableFound: true,
      itemCount: 2,
      authRelatedItemCount: 1
    });
    expect(inspection.storageJson).toMatchObject({
      exists: true,
      readable: true,
      validJson: true,
      topLevelKeyCount: 2,
      authRelatedKeyCount: 1
    });
    expect(inspection.machineId).toMatchObject({
      exists: true,
      readable: true
    });
    expect(inspection.machineId.hashPrefix).toHaveLength(12);
    expect(JSON.stringify(inspection)).not.toContain("refresh-token-secret");
    expect(JSON.stringify(inspection)).not.toContain("storage-secret");
    expect(JSON.stringify(inspection)).not.toContain("machine-secret");
  });

  it("reports corrupt profile files with sanitized errors", () => {
    const appData = tempDir();
    const userDataDir = createProfile(appData);
    const storageDir = path.join(userDataDir, "User", "globalStorage");
    fs.writeFileSync(path.join(storageDir, "state.vscdb"), "not sqlite", "utf8");
    fs.writeFileSync(path.join(storageDir, "storage.json"), "{\"accessToken\":", "utf8");

    const inspection = inspectAntigravityProfile({
      platform: "win32",
      appData,
      home: path.dirname(appData)
    });

    expect(inspection.stateDb.exists).toBe(true);
    expect(inspection.stateDb.readable).toBe(false);
    expect(inspection.storageJson.exists).toBe(true);
    expect(inspection.storageJson.validJson).toBe(false);
    expect(JSON.stringify(inspection)).not.toContain("accessToken");
    expect(JSON.stringify(inspection)).not.toContain(storageDir);
  });
});
