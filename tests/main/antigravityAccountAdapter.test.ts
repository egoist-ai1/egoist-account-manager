import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_ACTIVE_ACCOUNT_STORAGE_KEY,
  ANTIGRAVITY_AUTH_STATE_KEY,
  ANTIGRAVITY_AUTH_STATUS_STATE_KEY,
  ANTIGRAVITY_ONBOARDING_STATE_KEY,
  ANTIGRAVITY_USER_STATUS_STATE_KEY,
  applyAntigravityAccountWritePlan,
  createAntigravityAccountWritePlan
} from "../../src/main/services/antigravityAccountAdapter";
import { parseAntigravityUnifiedOAuthToken } from "../../src/main/services/antigravityUnifiedState";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-adapter-"));
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
  } finally {
    db.close();
  }
  fs.writeFileSync(path.join(storageDir, "storage.json"), "{}", "utf8");
  fs.writeFileSync(path.join(userDataDir, "machineid"), "old-machine", "utf8");
  return {
    stateDbPath,
    storageJsonPath: path.join(storageDir, "storage.json"),
    machineIdPath: path.join(userDataDir, "machineid")
  };
}

function readStateValue(dbPath: string, key: string): string | null {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key) as { value: string | Buffer } | undefined;
    return row ? String(row.value) : null;
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("antigravity account adapter", () => {
  it("creates a sanitized allowlisted write plan from credentials", () => {
    const plan = createAntigravityAccountWritePlan({
      accountId: "ag_123",
      email: "user@example.com",
      refreshToken: "refresh-secret-token-123456",
      accessToken: "access-secret-token-123456",
      expiresAt: 1_800_000_000,
      googleProjectId: "project-1",
      scopes: ["openid", "email"],
      machineId: "machine-secret"
    });

    expect(plan.allowedStateKeys).toContain(ANTIGRAVITY_AUTH_STATE_KEY);
    expect(plan.allowedStorageKeys).toEqual([ANTIGRAVITY_ACTIVE_ACCOUNT_STORAGE_KEY]);
    expect(plan.stateItems.map((item) => item.key)).toEqual(expect.arrayContaining([
      ANTIGRAVITY_AUTH_STATE_KEY,
      ANTIGRAVITY_USER_STATUS_STATE_KEY,
      ANTIGRAVITY_AUTH_STATUS_STATE_KEY,
      ANTIGRAVITY_ONBOARDING_STATE_KEY
    ]));
    expect(plan.summary).toMatchObject({
      accountId: "ag_123",
      email: "user@example.com",
      writesMachineId: true
    });
    expect(JSON.stringify(plan.summary)).not.toContain("refresh-secret");
    expect(JSON.stringify(plan.summary)).not.toContain("access-secret");
    expect(JSON.stringify(plan.summary)).not.toContain("machine-secret");
  });

  it("rejects invalid credentials before creating a write plan", () => {
    expect(() => createAntigravityAccountWritePlan({
      accountId: "ag_123",
      email: "not-an-email",
      refreshToken: "short"
    })).toThrow(/email/i);

    expect(() => createAntigravityAccountWritePlan({
      accountId: "ag_123",
      email: "user@example.com",
      refreshToken: "short"
    })).toThrow(/refresh/i);
  });

  it("applies a plan through the guarded writer without leaking secrets in the result", () => {
    const appData = tempDir();
    const backupRoot = tempDir();
    const paths = createProfile(appData);

    const result = applyAntigravityAccountWritePlan({
      platform: "win32",
      appData,
      home: path.dirname(appData),
      backupRoot,
      credentials: {
        accountId: "ag_123",
        email: "user@example.com",
        refreshToken: "refresh-secret-token-123456",
        accessToken: "access-secret-token-123456",
        expiresAt: 1_800_000_000,
        machineId: "new-machine-secret"
      }
    });

    const stateValue = readStateValue(paths.stateDbPath, ANTIGRAVITY_AUTH_STATE_KEY);
    const storage = JSON.parse(fs.readFileSync(paths.storageJsonPath, "utf8"));
    expect(result.applied).toBe(true);
    expect(parseAntigravityUnifiedOAuthToken(stateValue!)).toMatchObject({
      accessToken: "access-secret-token-123456",
      refreshToken: "refresh-secret-token-123456",
      expiresAt: 1_800_000_000
    });
    expect(readStateValue(paths.stateDbPath, ANTIGRAVITY_USER_STATUS_STATE_KEY)).toBeTruthy();
    expect(storage[ANTIGRAVITY_ACTIVE_ACCOUNT_STORAGE_KEY]).toBe("new-machine-secret");
    expect(fs.readFileSync(paths.machineIdPath, "utf8")).toBe("new-machine-secret");
    expect(JSON.stringify(result)).not.toContain("refresh-secret");
    expect(JSON.stringify(result)).not.toContain("access-secret");
    expect(JSON.stringify(result)).not.toContain("new-machine-secret");
  });

  it("creates missing profile directories before writing a guarded state update", () => {
    const appData = tempDir();
    const backupRoot = tempDir();
    const result = applyAntigravityAccountWritePlan({
      platform: "win32",
      appData,
      home: path.dirname(appData),
      backupRoot,
      credentials: {
        accountId: "ag_123",
        email: "user@example.com",
        refreshToken: "refresh-secret-token-123456",
        accessToken: "access-secret-token-123456",
        expiresAt: 1_800_000_000
      }
    });

    const stateDbPath = path.join(appData, "Antigravity IDE", "User", "globalStorage", "state.vscdb");
    expect(result.applied).toBe(true);
    expect(fs.existsSync(stateDbPath)).toBe(true);
    expect(readStateValue(stateDbPath, ANTIGRAVITY_AUTH_STATE_KEY)).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("refresh-secret");
    expect(JSON.stringify(result)).not.toContain("access-secret");
  });
});
