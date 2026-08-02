import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AccountStore } from "../../src/main/db";

const dirs: string[] = [];
const oldAccountSchema = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    email TEXT NOT NULL,
    plan_type TEXT NOT NULL,
    profile_dir TEXT NOT NULL,
    encrypted_auth_json TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER,
    last_refresh_at INTEGER,
    subscription_ends_at INTEGER,
    status TEXT NOT NULL DEFAULT 'unknown',
    status_reason TEXT,
    rate_limit_json TEXT,
    notes TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-db-"));
  dirs.push(dir);
  return dir;
}

function dbPath(dir: string): string {
  return path.join(dir, "accounts.sqlite");
}

function readTables(dir: string): string[] {
  const db = new Database(dbPath(dir));
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    return tables.map((row) => row.name);
  } finally {
    db.close();
  }
}

function readLedger(dir: string): Array<{ version: number; name: string }> {
  const db = new Database(dbPath(dir));
  try {
    return db
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number; name: string }>;
  } finally {
    db.close();
  }
}

function readIndexNames(dir: string): string[] {
  const db = new Database(dbPath(dir));
  try {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
    return indexes.map((row) => row.name);
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("database migrations", () => {
  it("creates migration ledger and 2.0 tables", () => {
    const dir = tempDir();
    const store = new AccountStore(dir);
    try {
      const names = readTables(dir);
      const ledger = readLedger(dir);

      expect(names).toContain("schema_migrations");
      expect(names).toContain("switch_events");
      expect(names).toContain("rate_limit_snapshots");
      expect(names).toContain("settings");
      expect(names).toContain("account_tags");
      expect(names).toContain("antigravity_account_details");
      expect(names).toContain("switch_transactions");
      expect(ledger).toEqual([
        { version: 1, name: "initial_accounts_settings" },
        { version: 2, name: "v2_switch_limits_tags" },
        { version: 3, name: "v2_account_metadata" },
        { version: 4, name: "v3_platform_accounts" },
        { version: 5, name: "v3_codex_auth_identity" },
        { version: 6, name: "v3_auth_drift_candidates" },
        { version: 7, name: "v3_switch_transactions" },
        { version: 8, name: "v3_legacy_identity_review" },
        { version: 9, name: "v3_quota_refresh_health" },
        { version: 10, name: "v31_storage_invariants" }
      ]);
    } finally {
      store.close();
    }
  });

  it("does not duplicate ledger rows when reopened", () => {
    const dir = tempDir();
    new AccountStore(dir).close();
    new AccountStore(dir).close();

    expect(readLedger(dir)).toEqual([
      { version: 1, name: "initial_accounts_settings" },
      { version: 2, name: "v2_switch_limits_tags" },
      { version: 3, name: "v2_account_metadata" },
      { version: 4, name: "v3_platform_accounts" },
      { version: 5, name: "v3_codex_auth_identity" },
      { version: 6, name: "v3_auth_drift_candidates" },
      { version: 7, name: "v3_switch_transactions" },
      { version: 8, name: "v3_legacy_identity_review" },
      { version: 9, name: "v3_quota_refresh_health" },
      { version: 10, name: "v31_storage_invariants" }
    ]);
  });

  it("preserves rows when migrating a pre-migration database", () => {
    const dir = tempDir();
    const legacyDb = new Database(dbPath(dir));
    try {
      legacyDb.exec(oldAccountSchema);
      legacyDb
        .prepare(
          `INSERT INTO accounts (
            id, label, email, plan_type, profile_dir, encrypted_auth_json, is_active,
            created_at, updated_at, last_used_at, last_refresh_at, subscription_ends_at,
            status, status_reason, rate_limit_json, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "acct-legacy",
          "Legacy Plus",
          "legacy@example.com",
          "plus",
          "C:\\Users\\EGOIST\\AppData\\Roaming\\Codex\\Profiles\\legacy",
          "{\"token\":\"encrypted\"}",
          1,
          1_700_000_000,
          1_700_000_100,
          1_700_000_200,
          1_700_000_300,
          1_800_000_000,
          "active",
          null,
          JSON.stringify({
            limitId: "primary",
            limitName: "ChatGPT Plus",
            primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_700_018_000 },
            secondary: null,
            credits: null,
            planType: "plus",
            rateLimitReachedType: null
          }),
          "kept note"
        );
      legacyDb.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("privacyMode", "true");
    } finally {
      legacyDb.close();
    }

    const store = new AccountStore(dir);
    try {
      const accounts = store.list();
      const tables = readTables(dir);
      const ledger = readLedger(dir);

      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        id: "acct-legacy",
        label: "Legacy Plus",
        email: "legacy@example.com",
        planType: "plus",
        platform: "codex",
        isActive: true,
        authMode: null,
        credentialState: "needs_review",
        status: "error",
        primaryUsedPercent: 42,
        notes: "kept note"
      });
      expect(store.getSetting("privacyMode")).toBe("true");
      expect(tables).toEqual(expect.arrayContaining(["schema_migrations", "switch_events", "switch_transactions", "rate_limit_snapshots", "account_tags", "antigravity_account_details"]));
      expect(ledger).toEqual([
        { version: 1, name: "initial_accounts_settings" },
        { version: 2, name: "v2_switch_limits_tags" },
        { version: 3, name: "v2_account_metadata" },
        { version: 4, name: "v3_platform_accounts" },
        { version: 5, name: "v3_codex_auth_identity" },
        { version: 6, name: "v3_auth_drift_candidates" },
        { version: 7, name: "v3_switch_transactions" },
        { version: 8, name: "v3_legacy_identity_review" },
        { version: 9, name: "v3_quota_refresh_health" },
        { version: 10, name: "v31_storage_invariants" }
      ]);
      const backupFiles = fs
        .readdirSync(path.join(dir, "migration-backups"))
        .filter((entry) => entry.endsWith(".sqlite"));
      expect(backupFiles).toHaveLength(1);
      const backup = new Database(path.join(dir, "migration-backups", backupFiles[0]), {
        readonly: true,
        fileMustExist: true
      });
      try {
        expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
        expect(backup.prepare("SELECT id, status FROM accounts").get()).toEqual({
          id: "acct-legacy",
          status: "active"
        });
        const legacyColumns = (
          backup.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>
        ).map((column) => column.name);
        expect(legacyColumns).not.toContain("auth_mode");
      } finally {
        backup.close();
      }
    } finally {
      store.close();
    }
  });

  it("keeps the accounts email index after migration", () => {
    const dir = tempDir();
    const store = new AccountStore(dir);
    try {
      expect(readIndexNames(dir)).toContain("idx_accounts_email");
      expect(readIndexNames(dir)).toContain("idx_accounts_platform_email");
      expect(readIndexNames(dir)).toContain("idx_accounts_platform_active");
      expect(readIndexNames(dir)).toContain("idx_accounts_codex_identity");
      expect(readIndexNames(dir)).toEqual(expect.arrayContaining([
        "idx_accounts_single_active",
        "idx_accounts_email_ci",
        "idx_accounts_platform_email_ci",
        "idx_rate_limit_snapshots_account_captured",
        "idx_switch_events_started_at",
        "idx_switch_transactions_status_created"
      ]));
    } finally {
      store.close();
    }
  });

  it("keeps account CRUD and list behavior working after migration", () => {
    const dir = tempDir();
    const store = new AccountStore(dir);
    try {
      const first = store.upsert({
        id: "acct-1",
        label: "First Account",
        email: "first@example.com",
        planType: "plus",
        profileDir: "C:\\profiles\\first",
        encryptedAuthJson: "{\"token\":\"first\"}"
      });
      const second = store.upsert({
        id: "acct-2",
        label: "Second Account",
        email: "second@example.com",
        planType: "pro",
        profileDir: "C:\\profiles\\second",
        encryptedAuthJson: "{\"token\":\"second\"}"
      });

      expect(first.status).toBe("active");
      expect(first.platform).toBe("codex");
      expect(first).toMatchObject({
        authMode: "chatgpt",
        credentialState: "ready",
        version: 1
      });
      expect(second.status).toBe("active");
      expect(store.get("acct-1")?.email).toBe("first@example.com");
      expect(store.getByEmail("SECOND@example.com")?.id).toBe("acct-2");

      store.setActive("acct-2");
      store.updateMeta("acct-1", { label: "Renamed Account", notes: "manual note", subscriptionEndsAt: 1_800_000_000 });
      store.setSetting("confirmSwitch", "false");

      const accounts = store.list();
      expect(accounts.map((account) => account.id)).toEqual(["acct-2", "acct-1"]);
      expect(accounts[0].isActive).toBe(true);
      expect(store.get("acct-1")).toMatchObject({
        label: "Renamed Account",
        notes: "manual note",
        subscriptionEndsAt: 1_800_000_000
      });
      expect(store.getSetting("confirmSwitch")).toBe("false");
      store.delete("acct-1");
      expect(store.get("acct-1")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("stores Antigravity account details separately from Codex defaults", () => {
    const dir = tempDir();
    const store = new AccountStore(dir);
    try {
      const saved = store.upsert({
        id: "ag-1",
        platform: "antigravity",
        label: "Antigravity Work",
        email: "ag@example.com",
        planType: "unknown",
        profileDir: "C:\\Users\\User\\AppData\\Roaming\\Antigravity IDE",
        encryptedAuthJson: "{\"sealed\":\"auth\"}",
        antigravity: {
          googleProjectId: "project-1",
          fingerprintId: "fp-1",
          lastQuotaRefreshAt: 1_700_001_000,
          forbidden: false,
          ideStateDetected: true
        }
      });

      expect(saved.platform).toBe("antigravity");
      expect(saved.authMode).toBeNull();
      expect(saved.antigravity).toMatchObject({
        googleProjectId: "project-1",
        fingerprintId: "fp-1",
        lastQuotaRefreshAt: 1_700_001_000,
        forbidden: false,
        ideStateDetected: true
      });
      expect(store.get("ag-1")?.antigravity?.ideStateDetected).toBe(true);
    } finally {
      store.close();
    }
  });

  it("tracks active accounts independently for Codex and Antigravity", () => {
    const dir = tempDir();
    const store = new AccountStore(dir);
    try {
      store.upsert({
        id: "codex-1",
        label: "Codex One",
        email: "codex-1@example.com",
        planType: "pro",
        profileDir: "C:\\profiles\\codex-1",
        encryptedAuthJson: "{\"token\":\"codex-1\"}"
      });
      store.upsert({
        id: "codex-2",
        label: "Codex Two",
        email: "codex-2@example.com",
        planType: "pro",
        profileDir: "C:\\profiles\\codex-2",
        encryptedAuthJson: "{\"token\":\"codex-2\"}"
      });
      store.upsert({
        id: "ag-1",
        platform: "antigravity",
        label: "Antigravity One",
        email: "ag-1@example.com",
        planType: "unknown",
        profileDir: "C:\\profiles\\ag-1",
        encryptedAuthJson: "{\"sealed\":\"ag-1\"}"
      });

      store.setActive("codex-1");
      store.setActive("ag-1");
      store.setActive("codex-2");

      expect(store.get("codex-1")?.isActive).toBe(false);
      expect(store.get("codex-2")?.isActive).toBe(true);
      expect(store.get("ag-1")?.isActive).toBe(true);
    } finally {
      store.close();
    }
  });

  it("repairs duplicate active profiles and enforces one active row per platform", () => {
    const dir = tempDir();
    const legacy = new Database(dbPath(dir));
    try {
      legacy.exec(oldAccountSchema);
      legacy.exec("ALTER TABLE accounts ADD COLUMN platform TEXT NOT NULL DEFAULT 'codex'");
      const insert = legacy.prepare(`
        INSERT INTO accounts (
          id, label, email, plan_type, profile_dir, encrypted_auth_json, platform,
          is_active, created_at, updated_at, status
        ) VALUES (?, ?, ?, 'plus', ?, 'sealed', 'codex', 1, 1, ?, 'active')
      `);
      insert.run("older", "Older", "older@example.com", "older", 10);
      insert.run("newer", "Newer", "newer@example.com", "newer", 20);
    } finally {
      legacy.close();
    }

    const store = new AccountStore(dir);
    try {
      expect(store.list().filter((account) => account.platform === "codex" && account.isActive).map((account) => account.id)).toEqual(["newer"]);
      const db = new Database(dbPath(dir));
      try {
        expect(() => db.prepare("UPDATE accounts SET is_active = 1 WHERE id = 'older'").run()).toThrow();
      } finally {
        db.close();
      }
    } finally {
      store.close();
    }
  });

  it("preserves Antigravity platform when importing portable accounts", () => {
    const dir = tempDir();
    const store = new AccountStore(dir);
    try {
      const imported = store.importPortable({
        id: "ag-portable",
        platform: "antigravity",
        label: "Antigravity Portable",
        email: "ag-portable@example.com",
        planType: "unknown",
        profileDir: "portable",
        encryptedAuthJson: "{\"sealed\":\"none\"}",
        isActive: false,
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_000,
        lastUsedAt: null,
        lastRefreshAt: null,
        subscriptionEndsAt: null,
        status: "unknown",
        statusReason: null,
        rateLimitJson: null,
        notes: null
      });

      expect(imported.platform).toBe("antigravity");
      expect(store.listForExport().find((account) => account.id === "ag-portable")?.platform).toBe("antigravity");
    } finally {
      store.close();
    }
  });

  it("stores Codex auth identity metadata without exposing it through legacy defaults", () => {
    const dir = tempDir();
    const store = new AccountStore(dir);
    try {
      const saved = store.upsert({
        id: "codex-enterprise",
        label: "Enterprise",
        email: "owner@example.com",
        planType: "enterprise",
        profileDir: "C:\\profiles\\enterprise",
        encryptedAuthJson: "sealed",
        authMode: "enterpriseAccessToken",
        providerAccountId: "provider-1",
        workspaceAccountId: "workspace-1",
        workspaceLabel: "Egoist",
        authFingerprint: "fingerprint-1",
        credentialState: "ready",
        lastAuthenticatedAt: 1_800_000_000,
        expiresAt: 1_800_003_600,
        version: 3
      });

      expect(saved).toMatchObject({
        authMode: "enterpriseAccessToken",
        providerAccountId: "provider-1",
        workspaceAccountId: "workspace-1",
        workspaceLabel: "Egoist",
        authFingerprint: "fingerprint-1",
        credentialState: "ready",
        lastAuthenticatedAt: 1_800_000_000,
        expiresAt: 1_800_003_600,
        version: 3
      });
      expect(store.listForExport()[0]).toMatchObject({
        authMode: "enterpriseAccessToken",
        providerAccountId: "provider-1",
        version: 3
      });
    } finally {
      store.close();
    }
  });

  it("keeps externally changed auth as a separate encrypted drift candidate", () => {
    const dir = tempDir();
    const store = new AccountStore(dir);
    try {
      store.upsert({
        id: "codex-drift",
        label: "Drift",
        email: "drift@example.com",
        planType: "plus",
        profileDir: "C:\\profiles\\drift",
        encryptedAuthJson: "sealed-original",
        authFingerprint: "original"
      });
      const account = store.storeAuthDriftCandidate({
        accountId: "codex-drift",
        encryptedAuthJson: "sealed-candidate",
        fingerprint: "candidate",
        observedAt: 1_800_000_100
      });

      expect(account).toMatchObject({
        credentialState: "drifted",
        status: "error"
      });
      expect(store.get("codex-drift")?.encryptedAuthJson).toBe("sealed-original");
      expect(store.getAuthDriftCandidate("codex-drift")).toEqual({
        encryptedAuthJson: "sealed-candidate",
        fingerprint: "candidate",
        observedAt: 1_800_000_100
      });
    } finally {
      store.close();
    }
  });
});
