import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseAntigravityCredentialPayload,
  readAntigravityExternalCredentialPayloads
} from "../../src/main/services/antigravityCredentialImportService";
import { createAntigravityUnifiedOAuthToken } from "../../src/main/services/antigravityUnifiedState";

const tempRoots: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-import-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("antigravityCredentialImportService", () => {
  it("parses a raw refresh token as an importable credential", () => {
    const parsed = parseAntigravityCredentialPayload({
      payload: "1//refresh-token-value-with-enough-length",
      source: "manual"
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      refreshToken: "1//refresh-token-value-with-enough-length",
      source: "manual"
    });
    expect(parsed[0].accountId).toMatch(/^refresh:/);
  });

  it("parses Cockpit-style account arrays and nested token objects", () => {
    const parsed = parseAntigravityCredentialPayload({
      source: "fixture",
      payload: JSON.stringify({
        state: {
          accounts: [
            {
              email: "User@Example.com",
              name: "Work AG",
              token: {
                refresh_token: "1//nested-refresh-token-value-with-enough-length",
                access_token: "access-token-value"
              },
              projectId: "project-one"
            }
          ]
        }
      })
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      email: "user@example.com",
      label: "Work AG",
      googleProjectId: "project-one",
      refreshToken: "1//nested-refresh-token-value-with-enough-length"
    });
  });

  it("reads Antigravity Tools JSON files from the expected local folder", () => {
    const home = tempDir();
    const accountsDir = path.join(home, ".antigravity_tools", "accounts");
    fs.mkdirSync(accountsDir, { recursive: true });
    fs.writeFileSync(
      path.join(accountsDir, "user.json"),
      JSON.stringify({ email: "tools@example.com", refreshToken: "1//tools-refresh-token-value-with-enough-length" }),
      "utf8"
    );

    const payloads = readAntigravityExternalCredentialPayloads({
      source: "antigravity_tools",
      platform: "win32",
      home
    });
    const parsed = payloads.flatMap((payload) => parseAntigravityCredentialPayload(payload));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].email).toBe("tools@example.com");
  });

  it("extracts Cockpit WebView local-storage JSON fragments without printing secrets", () => {
    const home = tempDir();
    const localAppData = path.join(home, "AppData", "Local");
    const levelDb = path.join(localAppData, "com.jlcodes.cockpit-tools", "EBWebView", "Default", "Local Storage", "leveldb");
    fs.mkdirSync(levelDb, { recursive: true });
    fs.writeFileSync(
      path.join(levelDb, "000003.log"),
      `prefix agtools.accounts.store.v1 {"state":{"accounts":[{"email":"cockpit@example.com","refreshToken":"1//cockpit-refresh-token-value-with-enough-length"}]}} suffix`,
      "utf8"
    );

    const payloads = readAntigravityExternalCredentialPayloads({
      source: "cockpit",
      platform: "win32",
      home,
      localAppData
    });
    const parsed = payloads.flatMap((payload) => parseAntigravityCredentialPayload(payload));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].email).toBe("cockpit@example.com");
  });

  it("decodes Antigravity unified state DB OAuth rows into importable credentials", () => {
    const home = tempDir();
    const appData = path.join(home, "AppData", "Roaming");
    const globalStorage = path.join(appData, "Antigravity", "User", "globalStorage");
    fs.mkdirSync(globalStorage, { recursive: true });
    const dbPath = path.join(globalStorage, "state.vscdb");
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
      db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
        "antigravityUnifiedStateSync.oauthToken",
        createAntigravityUnifiedOAuthToken({
          accessToken: "access-token-value-with-enough-length",
          refreshToken: "1//local-db-refresh-token-value-with-enough-length",
          expiresAt: 1_800_000_000
        })
      );
    } finally {
      db.close();
    }

    const payloads = readAntigravityExternalCredentialPayloads({
      source: "local_db",
      platform: "win32",
      home,
      appData
    });
    const parsed = payloads.flatMap((payload) => parseAntigravityCredentialPayload(payload));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      refreshToken: "1//local-db-refresh-token-value-with-enough-length",
      accessToken: "access-token-value-with-enough-length",
      expiresAt: 1_800_000_000
    });
  });
});
