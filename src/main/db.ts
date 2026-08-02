import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AccountPlatform,
  AntigravityAccountDetails,
  CodexAuthMode,
  CredentialState,
  LimitHistoryPoint,
  ManagedAccount,
  PlanType,
  RateLimitSnapshot,
  SwitchTransaction,
  SwitchTransactionPhase,
  SwitchTransactionStatus,
  SwitchHistoryItem
} from "../shared/types.js";
import type { LimitSnapshotRecord } from "./services/limitService.js";

type Row = {
  id: string;
  label: string;
  email: string;
  plan_type: string;
  profile_dir: string;
  encrypted_auth_json: string;
  platform?: AccountPlatform | string;
  auth_mode?: string | null;
  provider_account_id?: string | null;
  workspace_account_id?: string | null;
  workspace_label?: string | null;
  auth_fingerprint?: string | null;
  credential_state?: string | null;
  last_authenticated_at?: number | null;
  expires_at?: number | null;
  version?: number | null;
  is_active: 0 | 1;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  last_refresh_at: number | null;
  last_refresh_error_at?: number | null;
  last_refresh_error?: string | null;
  subscription_ends_at: number | null;
  status: ManagedAccount["status"];
  status_reason: string | null;
  rate_limit_json: string | null;
  notes: string | null;
  favorite?: 0 | 1;
  archived?: 0 | 1;
  google_project_id?: string | null;
  fingerprint_id?: string | null;
  last_quota_refresh_at?: number | null;
  forbidden?: 0 | 1;
  ide_state_detected?: 0 | 1;
};

const authDriftReason = "Profile credentials changed outside Codex Account Manager. Review or reauthenticate this profile.";

type Migration = {
  version: number;
  name: string;
  sql?: string;
  run?: (db: Database.Database) => void;
};

type SwitchTransactionRow = {
  id: string;
  platform: string;
  target_account_id: string;
  previous_account_id: string | null;
  status: SwitchTransactionStatus;
  phase: SwitchTransactionPhase;
  target_fingerprint: string | null;
  previous_fingerprint: string | null;
  backup_path: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  version: number;
};

export interface AccountExportRecord {
  id: string;
  label: string;
  email: string;
  planType: PlanType;
  profileDir: string;
  encryptedAuthJson: string;
  platform?: AccountPlatform;
  authMode?: CodexAuthMode | null;
  providerAccountId?: string | null;
  workspaceAccountId?: string | null;
  workspaceLabel?: string | null;
  authFingerprint?: string | null;
  credentialState?: CredentialState;
  lastAuthenticatedAt?: number | null;
  expiresAt?: number | null;
  version?: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  lastRefreshAt: number | null;
  subscriptionEndsAt: number | null;
  status: ManagedAccount["status"];
  statusReason: string | null;
  rateLimitJson: string | null;
  notes: string | null;
  antigravity?: AntigravityAccountDetails | null;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_accounts_settings",
    sql: `
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
    `
  },
  {
    version: 2,
    name: "v2_switch_limits_tags",
    sql: `
      CREATE TABLE IF NOT EXISTS switch_events (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        previous_account_id TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        status TEXT NOT NULL,
        error TEXT,
        backup_path TEXT,
        codex_desktop_path TEXT,
        codex_app_user_model_id TEXT
      );
      CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        captured_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        status_reason TEXT,
        primary_used_percent REAL,
        primary_resets_at INTEGER,
        primary_window_duration_mins INTEGER,
        secondary_used_percent REAL,
        secondary_resets_at INTEGER,
        secondary_window_duration_mins INTEGER,
        raw_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_tags (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (account_id, tag)
      );
    `
  },
  {
    version: 3,
    name: "v2_account_metadata",
    run: (db) => {
      const columns = new Set((db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>).map((column) => column.name));
      if (!columns.has("favorite")) db.exec("ALTER TABLE accounts ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
      if (!columns.has("archived")) db.exec("ALTER TABLE accounts ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
      db.exec(`
        CREATE TABLE IF NOT EXISTS account_tags (
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          tag TEXT NOT NULL,
          PRIMARY KEY (account_id, tag)
        );
      `);
    }
  },
  {
    version: 4,
    name: "v3_platform_accounts",
    run: (db) => {
      const columns = new Set((db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>).map((column) => column.name));
      if (!columns.has("platform")) db.exec("ALTER TABLE accounts ADD COLUMN platform TEXT NOT NULL DEFAULT 'codex'");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_accounts_platform_email ON accounts(platform, email);
        CREATE INDEX IF NOT EXISTS idx_accounts_platform_active ON accounts(platform, is_active);
        CREATE TABLE IF NOT EXISTS antigravity_account_details (
          account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
          google_project_id TEXT,
          fingerprint_id TEXT,
          last_quota_refresh_at INTEGER,
          forbidden INTEGER NOT NULL DEFAULT 0,
          ide_state_detected INTEGER NOT NULL DEFAULT 0
        );
      `);
    }
  },
  {
    version: 5,
    name: "v3_codex_auth_identity",
    run: (db) => {
      const columns = new Set((db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>).map((column) => column.name));
      if (!columns.has("auth_mode")) db.exec("ALTER TABLE accounts ADD COLUMN auth_mode TEXT");
      if (!columns.has("provider_account_id")) db.exec("ALTER TABLE accounts ADD COLUMN provider_account_id TEXT");
      if (!columns.has("workspace_account_id")) db.exec("ALTER TABLE accounts ADD COLUMN workspace_account_id TEXT");
      if (!columns.has("workspace_label")) db.exec("ALTER TABLE accounts ADD COLUMN workspace_label TEXT");
      if (!columns.has("auth_fingerprint")) db.exec("ALTER TABLE accounts ADD COLUMN auth_fingerprint TEXT");
      if (!columns.has("credential_state")) db.exec("ALTER TABLE accounts ADD COLUMN credential_state TEXT NOT NULL DEFAULT 'ready'");
      if (!columns.has("last_authenticated_at")) db.exec("ALTER TABLE accounts ADD COLUMN last_authenticated_at INTEGER");
      if (!columns.has("expires_at")) db.exec("ALTER TABLE accounts ADD COLUMN expires_at INTEGER");
      if (!columns.has("version")) db.exec("ALTER TABLE accounts ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
      db.exec(`
        UPDATE accounts
        SET
          credential_state = 'needs_review',
          status = 'error',
          status_reason = COALESCE(
            status_reason,
            'Legacy Codex credentials require identity validation or reauthentication.'
          )
        WHERE platform = 'codex' AND auth_fingerprint IS NULL;
        CREATE INDEX IF NOT EXISTS idx_accounts_codex_identity
          ON accounts(platform, auth_mode, provider_account_id, workspace_account_id);
      `);
    }
  },
  {
    version: 6,
    name: "v3_auth_drift_candidates",
    sql: `
      CREATE TABLE IF NOT EXISTS auth_drift_candidates (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        encrypted_auth_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        observed_at INTEGER NOT NULL
      );
    `
  },
  {
    version: 7,
    name: "v3_switch_transactions",
    sql: `
      CREATE TABLE IF NOT EXISTS switch_transactions (
        id TEXT PRIMARY KEY,
        singleton_key INTEGER NOT NULL DEFAULT 1 CHECK(singleton_key = 1),
        platform TEXT NOT NULL,
        target_account_id TEXT NOT NULL,
        previous_account_id TEXT,
        status TEXT NOT NULL CHECK(status IN (
          'pending', 'running', 'rolling_back', 'committed', 'rolled_back',
          'aborted', 'failed', 'recovery_required'
        )),
        phase TEXT NOT NULL,
        target_fingerprint TEXT,
        previous_fingerprint TEXT,
        backup_path TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_switch_transactions_single_active
        ON switch_transactions(singleton_key)
        WHERE status IN ('pending', 'running', 'rolling_back');
      CREATE INDEX IF NOT EXISTS idx_switch_transactions_recent
        ON switch_transactions(created_at DESC);
    `
  },
  {
    version: 8,
    name: "v3_legacy_identity_review",
    sql: `
      UPDATE accounts
      SET
        auth_mode = NULL,
        credential_state = 'needs_review',
        status = 'error',
        status_reason = COALESCE(
          status_reason,
          'Legacy Codex credentials require identity validation or reauthentication.'
        )
      WHERE
        platform = 'codex'
        AND auth_fingerprint IS NULL;
    `
  },
  {
    version: 9,
    name: "v3_quota_refresh_health",
    run: (db) => {
      const columns = new Set((db.prepare("PRAGMA table_info(accounts)").all() as Array<{ name: string }>).map((column) => column.name));
      if (!columns.has("last_refresh_error_at")) db.exec("ALTER TABLE accounts ADD COLUMN last_refresh_error_at INTEGER");
      if (!columns.has("last_refresh_error")) db.exec("ALTER TABLE accounts ADD COLUMN last_refresh_error TEXT");
    }
  },
  {
    version: 10,
    name: "v31_storage_invariants",
    run: (db) => {
      const activeRows = db.prepare(`
        SELECT id, platform
        FROM accounts
        WHERE is_active = 1
        ORDER BY platform ASC, COALESCE(last_used_at, updated_at) DESC, updated_at DESC, id ASC
      `).all() as Array<{ id: string; platform: string }>;
      const activePlatforms = new Set<string>();
      const deactivate = db.prepare("UPDATE accounts SET is_active = 0 WHERE id = ?");
      for (const row of activeRows) {
        if (activePlatforms.has(row.platform)) deactivate.run(row.id);
        else activePlatforms.add(row.platform);
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_single_active
          ON accounts(platform) WHERE is_active = 1;
        CREATE INDEX IF NOT EXISTS idx_accounts_active_updated
          ON accounts(is_active DESC, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_accounts_email_ci
          ON accounts(lower(email), is_active DESC, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_accounts_platform_email_ci
          ON accounts(platform, lower(email), is_active DESC, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_rate_limit_snapshots_account_captured
          ON rate_limit_snapshots(account_id, captured_at DESC);
        CREATE INDEX IF NOT EXISTS idx_switch_events_started_at
          ON switch_events(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_switch_transactions_status_created
          ON switch_transactions(status, created_at ASC);
      `);
    }
  }
];

function mapSwitchTransaction(row: SwitchTransactionRow): SwitchTransaction {
  return {
    id: row.id,
    platform: row.platform === "antigravity" ? "antigravity" : "codex",
    targetAccountId: row.target_account_id,
    previousAccountId: row.previous_account_id,
    status: row.status,
    phase: row.phase,
    targetFingerprint: row.target_fingerprint,
    previousFingerprint: row.previous_fingerprint,
    backupPath: row.backup_path,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    version: row.version
  };
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version)
  );
  const apply = db.transaction((migration: Migration) => {
    if (migration.sql) db.exec(migration.sql);
    migration.run?.(db);
    db.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      migration.version,
      migration.name,
      Math.floor(Date.now() / 1000)
    );
  });
  for (const migration of migrations) {
    if (!applied.has(migration.version)) apply(migration);
  }
}

function createVerifiedPreMigrationBackup(db: Database.Database, databasePath: string): string | null {
  const latestVersion = migrations[migrations.length - 1]?.version ?? 0;
  const hasAccounts = Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get()
  );
  if (!hasAccounts) return null;
  const hasLedger = Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  );
  const currentVersion = hasLedger
    ? (db.prepare("SELECT max(version) AS version FROM schema_migrations").get() as { version: number | null }).version ?? 0
    : 0;
  if (currentVersion >= latestVersion) return null;

  const checkpoint = db.pragma("wal_checkpoint(FULL)") as Array<{
    busy: number;
    log: number;
    checkpointed: number;
  }>;
  const checkpointResult = checkpoint[0];
  if (
    checkpointResult
    && (checkpointResult.busy !== 0 || checkpointResult.checkpointed < checkpointResult.log)
  ) {
    throw new Error("Could not checkpoint SQLite before the pre-migration backup");
  }
  const backupDir = path.join(path.dirname(databasePath), "migration-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `accounts.pre-v${latestVersion}.from-v${currentVersion}.${Date.now()}.${process.pid}.sqlite`
  );
  fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
  try {
    fs.chmodSync(backupPath, 0o600);
  } catch {
    // Windows ACLs inherited from the private application data directory remain authoritative.
  }

  const sourceAccountCount = (db.prepare("SELECT count(*) AS count FROM accounts").get() as { count: number }).count;
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = backup.pragma("integrity_check", { simple: true });
    const backupAccountCount = (
      backup.prepare("SELECT count(*) AS count FROM accounts").get() as { count: number }
    ).count;
    if (integrity !== "ok" || backupAccountCount !== sourceAccountCount) {
      throw new Error("Pre-migration SQLite backup verification failed");
    }
  } finally {
    backup.close();
    fs.rmSync(`${backupPath}-shm`, { force: true });
    fs.rmSync(`${backupPath}-wal`, { force: true });
  }
  return backupPath;
}

function pickWindow(limits: RateLimitSnapshot | null, kind: "five-hour" | "weekly"): { usedPercent: number | null; resetsAt: number | null } {
  const windows = [limits?.primary, limits?.secondary].filter(Boolean) as NonNullable<RateLimitSnapshot["primary"]>[];
  if (kind === "weekly") {
    const weekly = windows.find((window) => (window.windowDurationMins ?? 0) >= 7 * 24 * 60 - 60);
    return { usedPercent: weekly?.usedPercent ?? null, resetsAt: weekly?.resetsAt ?? null };
  }
  const fiveHour =
    windows.find((window) => {
      const mins = window.windowDurationMins ?? 0;
      return mins >= 240 && mins <= 360;
    }) ?? windows.find((window) => (window.windowDurationMins ?? 0) < 24 * 60);
  return { usedPercent: fiveHour?.usedPercent ?? null, resetsAt: fiveHour?.resetsAt ?? null };
}

function getTags(db: Database.Database, accountId: string): string[] {
  return (
    db.prepare("SELECT tag FROM account_tags WHERE account_id = ? ORDER BY tag ASC").all(accountId) as Array<{ tag: string }>
  ).map((tagRow) => tagRow.tag);
}

function getTagsByAccount(db: Database.Database): Map<string, string[]> {
  const tags = db.prepare("SELECT account_id, tag FROM account_tags ORDER BY account_id ASC, tag ASC").all() as Array<{ account_id: string; tag: string }>;
  const byAccount = new Map<string, string[]>();
  for (const row of tags) byAccount.set(row.account_id, [...(byAccount.get(row.account_id) ?? []), row.tag]);
  return byAccount;
}

function mapRow(row: Row, tags: string[] = []): ManagedAccount {
  const limits = row.rate_limit_json ? (JSON.parse(row.rate_limit_json) as RateLimitSnapshot) : null;
  const fiveHour = pickWindow(limits, "five-hour");
  const weekly = pickWindow(limits, "weekly");
  const platform: AccountPlatform = row.platform === "antigravity" ? "antigravity" : "codex";
  const authMode: CodexAuthMode | null = platform === "codex"
    ? row.auth_mode === "chatgpt" || row.auth_mode === "apiKey" || row.auth_mode === "enterpriseAccessToken"
      ? row.auth_mode
      : null
    : null;
  const credentialState: CredentialState =
    row.credential_state === "drifted" || row.credential_state === "needs_reauth" || row.credential_state === "needs_review"
      ? row.credential_state
      : "ready";
  const antigravity: AntigravityAccountDetails | null = platform === "antigravity" ? {
    googleProjectId: row.google_project_id ?? null,
    fingerprintId: row.fingerprint_id ?? null,
    lastQuotaRefreshAt: row.last_quota_refresh_at ?? null,
    forbidden: row.forbidden === 1,
    ideStateDetected: row.ide_state_detected === 1
  } : null;
  return {
    id: row.id,
    platform,
    label: row.label,
    email: row.email,
    authMode,
    providerAccountId: row.provider_account_id ?? null,
    workspaceAccountId: row.workspace_account_id ?? null,
    workspaceLabel: row.workspace_label ?? null,
    authFingerprint: row.auth_fingerprint ?? null,
    credentialState,
    lastAuthenticatedAt: row.last_authenticated_at ?? null,
    expiresAt: row.expires_at ?? null,
    version: row.version ?? 1,
    planType: row.plan_type as PlanType,
    profileDir: row.profile_dir,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    lastRefreshAt: row.last_refresh_at,
    lastRefreshErrorAt: row.last_refresh_error_at ?? null,
    lastRefreshError: row.last_refresh_error ?? null,
    subscriptionEndsAt: row.subscription_ends_at,
    status: row.status,
    statusReason: row.status_reason,
    primaryUsedPercent: limits?.primary?.usedPercent ?? null,
    primaryResetsAt: limits?.primary?.resetsAt ?? null,
    primaryWindowDurationMins: limits?.primary?.windowDurationMins ?? null,
    secondaryUsedPercent: limits?.secondary?.usedPercent ?? null,
    secondaryResetsAt: limits?.secondary?.resetsAt ?? null,
    secondaryWindowDurationMins: limits?.secondary?.windowDurationMins ?? null,
    fiveHourUsedPercent: fiveHour.usedPercent,
    fiveHourResetsAt: fiveHour.resetsAt,
    weeklyUsedPercent: weekly.usedPercent,
    weeklyResetsAt: weekly.resetsAt,
    notes: row.notes,
    tags,
    favorite: row.favorite === 1,
    archived: row.archived === 1,
    antigravity
  };
}

export class AccountStore {
  private readonly db: Database.Database;

  constructor(appDataDir: string) {
    fs.mkdirSync(appDataDir, { recursive: true });
    const databasePath = path.join(appDataDir, "accounts.sqlite");
    this.db = new Database(databasePath, { timeout: 5_000 });
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("foreign_keys = ON");
    createVerifiedPreMigrationBackup(this.db, databasePath);
    runMigrations(this.db);
    this.db.pragma("optimize = 0x10002");
  }

  close(): void {
    this.db.pragma("optimize");
    this.db.close();
  }

  getSchemaVersion(): number {
    const row = this.db.prepare("SELECT max(version) AS version FROM schema_migrations").get() as { version: number | null };
    return row.version ?? 0;
  }

  list(): ManagedAccount[] {
    const rows = this.db.prepare(`
      SELECT accounts.*, antigravity_account_details.google_project_id, antigravity_account_details.fingerprint_id,
        antigravity_account_details.last_quota_refresh_at, antigravity_account_details.forbidden,
        antigravity_account_details.ide_state_detected
      FROM accounts
      LEFT JOIN antigravity_account_details ON antigravity_account_details.account_id = accounts.id
      ORDER BY is_active DESC, updated_at DESC
    `).all() as Row[];
    const tags = getTagsByAccount(this.db);
    return rows.map((row) => mapRow(row, tags.get(row.id) ?? []));
  }

  listForExport(): AccountExportRecord[] {
    const rows = this.db.prepare(`
      SELECT accounts.*, antigravity_account_details.google_project_id, antigravity_account_details.fingerprint_id,
        antigravity_account_details.last_quota_refresh_at, antigravity_account_details.forbidden,
        antigravity_account_details.ide_state_detected
      FROM accounts
      LEFT JOIN antigravity_account_details ON antigravity_account_details.account_id = accounts.id
      ORDER BY is_active DESC, updated_at DESC
    `).all() as Row[];
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      email: row.email,
      planType: row.plan_type as PlanType,
      profileDir: row.profile_dir,
      encryptedAuthJson: row.encrypted_auth_json,
      platform: row.platform === "antigravity" ? "antigravity" : "codex",
      authMode: row.platform === "antigravity"
        ? null
        : row.auth_mode === "apiKey" || row.auth_mode === "enterpriseAccessToken" ? row.auth_mode : "chatgpt",
      providerAccountId: row.provider_account_id ?? null,
      workspaceAccountId: row.workspace_account_id ?? null,
      workspaceLabel: row.workspace_label ?? null,
      authFingerprint: row.auth_fingerprint ?? null,
      credentialState: row.credential_state === "drifted" || row.credential_state === "needs_reauth" || row.credential_state === "needs_review"
        ? row.credential_state
        : "ready",
      lastAuthenticatedAt: row.last_authenticated_at ?? null,
      expiresAt: row.expires_at ?? null,
      version: row.version ?? 1,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsedAt: row.last_used_at,
      lastRefreshAt: row.last_refresh_at,
      subscriptionEndsAt: row.subscription_ends_at,
      status: row.status,
      statusReason: row.status_reason,
      rateLimitJson: row.rate_limit_json,
      notes: row.notes,
      antigravity: row.platform === "antigravity" ? {
        googleProjectId: row.google_project_id ?? null,
        fingerprintId: row.fingerprint_id ?? null,
        lastQuotaRefreshAt: row.last_quota_refresh_at ?? null,
        forbidden: row.forbidden === 1,
        ideStateDetected: row.ide_state_detected === 1
      } : null
    }));
  }

  get(id: string): (ManagedAccount & { encryptedAuthJson: string }) | null {
    const row = this.db.prepare(`
      SELECT accounts.*, antigravity_account_details.google_project_id, antigravity_account_details.fingerprint_id,
        antigravity_account_details.last_quota_refresh_at, antigravity_account_details.forbidden,
        antigravity_account_details.ide_state_detected
      FROM accounts
      LEFT JOIN antigravity_account_details ON antigravity_account_details.account_id = accounts.id
      WHERE accounts.id = ?
    `).get(id) as Row | undefined;
    return row ? { ...mapRow(row, getTags(this.db, row.id)), encryptedAuthJson: row.encrypted_auth_json } : null;
  }

  getByEmail(email: string): (ManagedAccount & { encryptedAuthJson: string }) | null {
    const row = this.db
      .prepare(`
        SELECT accounts.*, antigravity_account_details.google_project_id, antigravity_account_details.fingerprint_id,
          antigravity_account_details.last_quota_refresh_at, antigravity_account_details.forbidden,
          antigravity_account_details.ide_state_detected
        FROM accounts
        LEFT JOIN antigravity_account_details ON antigravity_account_details.account_id = accounts.id
        WHERE lower(email) = lower(?)
        ORDER BY is_active DESC, updated_at DESC
        LIMIT 1
      `)
      .get(email) as Row | undefined;
    return row ? { ...mapRow(row, getTags(this.db, row.id)), encryptedAuthJson: row.encrypted_auth_json } : null;
  }

  getByPlatformEmail(platform: AccountPlatform, email: string): (ManagedAccount & { encryptedAuthJson: string }) | null {
    const row = this.db
      .prepare(`
        SELECT accounts.*, antigravity_account_details.google_project_id, antigravity_account_details.fingerprint_id,
          antigravity_account_details.last_quota_refresh_at, antigravity_account_details.forbidden,
          antigravity_account_details.ide_state_detected
        FROM accounts
        LEFT JOIN antigravity_account_details ON antigravity_account_details.account_id = accounts.id
        WHERE accounts.platform = ? AND lower(email) = lower(?)
        ORDER BY is_active DESC, updated_at DESC
        LIMIT 1
      `)
      .get(platform, email) as Row | undefined;
    return row ? { ...mapRow(row, getTags(this.db, row.id)), encryptedAuthJson: row.encrypted_auth_json } : null;
  }

  upsert(input: {
    id: string;
    label: string;
    email: string;
    planType: PlanType;
    profileDir: string;
    encryptedAuthJson: string;
    rateLimits?: RateLimitSnapshot | null;
    platform?: AccountPlatform;
    antigravity?: AntigravityAccountDetails | null;
    status?: ManagedAccount["status"];
    statusReason?: string | null;
    authMode?: CodexAuthMode | null;
    providerAccountId?: string | null;
    workspaceAccountId?: string | null;
    workspaceLabel?: string | null;
    authFingerprint?: string | null;
    credentialState?: CredentialState;
    clearRefreshError?: boolean;
    lastAuthenticatedAt?: number | null;
    expiresAt?: number | null;
    version?: number;
  }): ManagedAccount {
    const now = Math.floor(Date.now() / 1000);
    const existing = this.get(input.id);
    this.db
      .prepare(
        `INSERT INTO accounts (
          id, platform, label, email, plan_type, profile_dir, encrypted_auth_json, created_at, updated_at,
          last_refresh_at, status, status_reason, rate_limit_json, auth_mode, provider_account_id,
          workspace_account_id, workspace_label, auth_fingerprint, credential_state,
          last_authenticated_at, expires_at, version
        ) VALUES (
          @id, @platform, @label, @email, @planType, @profileDir, @encryptedAuthJson, @now, @now,
          @lastRefreshAt, @status, @statusReason, @rateLimitJson, @authMode, @providerAccountId,
          @workspaceAccountId, @workspaceLabel, @authFingerprint, @credentialState,
          @lastAuthenticatedAt, @expiresAt, @version
        )
        ON CONFLICT(id) DO UPDATE SET
          platform = excluded.platform,
          label = excluded.label,
          email = excluded.email,
          plan_type = excluded.plan_type,
          profile_dir = excluded.profile_dir,
          encrypted_auth_json = excluded.encrypted_auth_json,
          updated_at = excluded.updated_at,
          last_refresh_at = CASE
            WHEN excluded.rate_limit_json IS NOT NULL THEN excluded.last_refresh_at
            ELSE accounts.last_refresh_at
          END,
          last_refresh_error_at = CASE
            WHEN @clearRefreshError = 1 OR excluded.rate_limit_json IS NOT NULL THEN NULL
            ELSE accounts.last_refresh_error_at
          END,
          last_refresh_error = CASE
            WHEN @clearRefreshError = 1 OR excluded.rate_limit_json IS NOT NULL THEN NULL
            ELSE accounts.last_refresh_error
          END,
          status = excluded.status,
          status_reason = excluded.status_reason,
          rate_limit_json = COALESCE(excluded.rate_limit_json, accounts.rate_limit_json),
          auth_mode = excluded.auth_mode,
          provider_account_id = excluded.provider_account_id,
          workspace_account_id = excluded.workspace_account_id,
          workspace_label = excluded.workspace_label,
          auth_fingerprint = excluded.auth_fingerprint,
          credential_state = excluded.credential_state,
          last_authenticated_at = excluded.last_authenticated_at,
          expires_at = excluded.expires_at,
          version = excluded.version`
      )
      .run({
        ...input,
        platform: input.platform ?? "codex",
        label: existing?.label ?? input.label,
        status: input.status ?? "active",
        statusReason: input.statusReason ?? null,
        now,
        lastRefreshAt: input.rateLimits ? now : existing?.lastRefreshAt ?? null,
        rateLimitJson: input.rateLimits ? JSON.stringify(input.rateLimits) : null,
        authMode: input.authMode === undefined ? existing?.authMode ?? ((input.platform ?? "codex") === "codex" ? "chatgpt" : null) : input.authMode,
        providerAccountId: input.providerAccountId === undefined ? existing?.providerAccountId ?? null : input.providerAccountId,
        workspaceAccountId: input.workspaceAccountId === undefined ? existing?.workspaceAccountId ?? null : input.workspaceAccountId,
        workspaceLabel: input.workspaceLabel === undefined ? existing?.workspaceLabel ?? null : input.workspaceLabel,
        authFingerprint: input.authFingerprint === undefined ? existing?.authFingerprint ?? null : input.authFingerprint,
        credentialState: input.credentialState ?? existing?.credentialState ?? "ready",
        clearRefreshError: input.clearRefreshError ? 1 : 0,
        lastAuthenticatedAt: input.lastAuthenticatedAt === undefined ? existing?.lastAuthenticatedAt ?? null : input.lastAuthenticatedAt,
        expiresAt: input.expiresAt === undefined ? existing?.expiresAt ?? null : input.expiresAt,
        version: input.version ?? existing?.version ?? 1
      });
    if ((input.platform ?? "codex") === "antigravity") {
      const details = input.antigravity ?? {
        googleProjectId: null,
        fingerprintId: null,
        lastQuotaRefreshAt: null,
        forbidden: false,
        ideStateDetected: false
      };
      this.db
        .prepare(
          `INSERT INTO antigravity_account_details (
            account_id, google_project_id, fingerprint_id, last_quota_refresh_at, forbidden, ide_state_detected
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET
            google_project_id = excluded.google_project_id,
            fingerprint_id = excluded.fingerprint_id,
            last_quota_refresh_at = excluded.last_quota_refresh_at,
            forbidden = excluded.forbidden,
            ide_state_detected = excluded.ide_state_detected`
        )
        .run(input.id, details.googleProjectId, details.fingerprintId, details.lastQuotaRefreshAt, details.forbidden ? 1 : 0, details.ideStateDetected ? 1 : 0);
    }
    const saved = this.get(input.id);
    if (!saved) throw new Error("Failed to save account");
    return saved;
  }

  setRateLimits(id: string, limits: RateLimitSnapshot, status: ManagedAccount["status"], reason: string | null): ManagedAccount {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        "UPDATE accounts SET rate_limit_json = ?, plan_type = COALESCE(?, plan_type), status = ?, status_reason = ?, last_refresh_at = ?, last_refresh_error_at = NULL, last_refresh_error = NULL, updated_at = ? WHERE id = ?"
      )
      .run(JSON.stringify(limits), limits.planType, status, reason, now, now, id);
    const saved = this.get(id);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  recordRateLimitFailure(id: string, reason: string): ManagedAccount {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE accounts SET
          last_refresh_error_at = ?,
          last_refresh_error = ?,
          status = CASE
            WHEN status = 'error' AND credential_state = 'ready' THEN 'unknown'
            ELSE status
          END,
          status_reason = CASE
            WHEN status = 'error' AND credential_state = 'ready' THEN NULL
            ELSE status_reason
          END,
          updated_at = ?
        WHERE id = ?`
      )
      .run(now, reason, now, id);
    const saved = this.get(id);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  setCredentialState(id: string, state: CredentialState, reason: string | null): ManagedAccount {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE accounts SET
          credential_state = ?,
          status = CASE WHEN ? = 'ready' THEN status ELSE 'error' END,
          status_reason = CASE WHEN ? = 'ready' THEN status_reason ELSE ? END,
          updated_at = ?
        WHERE id = ?`
      )
      .run(state, state, state, reason, now, id);
    const saved = this.get(id);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  updateAntigravityDetails(id: string, details: Partial<AntigravityAccountDetails>): ManagedAccount {
    const current = this.get(id);
    if (!current || current.platform !== "antigravity") throw new Error("Antigravity account not found");
    const merged: AntigravityAccountDetails = {
      googleProjectId: details.googleProjectId ?? current.antigravity?.googleProjectId ?? null,
      fingerprintId: details.fingerprintId ?? current.antigravity?.fingerprintId ?? null,
      lastQuotaRefreshAt: details.lastQuotaRefreshAt ?? current.antigravity?.lastQuotaRefreshAt ?? null,
      forbidden: details.forbidden ?? current.antigravity?.forbidden ?? false,
      ideStateDetected: details.ideStateDetected ?? current.antigravity?.ideStateDetected ?? false
    };
    this.db
      .prepare(
        `INSERT INTO antigravity_account_details (
          account_id, google_project_id, fingerprint_id, last_quota_refresh_at, forbidden, ide_state_detected
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
          google_project_id = excluded.google_project_id,
          fingerprint_id = excluded.fingerprint_id,
          last_quota_refresh_at = excluded.last_quota_refresh_at,
          forbidden = excluded.forbidden,
          ide_state_detected = excluded.ide_state_detected`
      )
      .run(id, merged.googleProjectId, merged.fingerprintId, merged.lastQuotaRefreshAt, merged.forbidden ? 1 : 0, merged.ideStateDetected ? 1 : 0);
    const saved = this.get(id);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  insertRateLimitSnapshot(record: LimitSnapshotRecord): void {
    this.db
      .prepare(
        `INSERT INTO rate_limit_snapshots (
          id, account_id, captured_at, status, status_reason,
          primary_used_percent, primary_resets_at, primary_window_duration_mins,
          secondary_used_percent, secondary_resets_at, secondary_window_duration_mins,
          raw_json
        ) VALUES (
          @id, @accountId, @capturedAt, @status, @statusReason,
          @primaryUsedPercent, @primaryResetsAt, @primaryWindowDurationMins,
          @secondaryUsedPercent, @secondaryResetsAt, @secondaryWindowDurationMins,
          @rawJson
        )`
      )
      .run({
        id: record.id,
        accountId: record.accountId,
        capturedAt: record.capturedAt,
        status: record.status,
        statusReason: record.statusReason,
        primaryUsedPercent: record.limits.primary?.usedPercent ?? null,
        primaryResetsAt: record.limits.primary?.resetsAt ?? null,
        primaryWindowDurationMins: record.limits.primary?.windowDurationMins ?? null,
        secondaryUsedPercent: record.limits.secondary?.usedPercent ?? null,
        secondaryResetsAt: record.limits.secondary?.resetsAt ?? null,
        secondaryWindowDurationMins: record.limits.secondary?.windowDurationMins ?? null,
        rawJson: JSON.stringify(record.limits)
      });
  }

  listRateLimitHistory(accountId: string, limit = 18): LimitHistoryPoint[] {
    const rows = this.db
      .prepare(
        `SELECT
          account_id AS accountId,
          captured_at AS capturedAt,
          status,
          status_reason AS statusReason,
          primary_used_percent AS primaryUsedPercent,
          secondary_used_percent AS secondaryUsedPercent,
          primary_window_duration_mins AS primaryWindowDurationMins,
          secondary_window_duration_mins AS secondaryWindowDurationMins
        FROM rate_limit_snapshots
        WHERE account_id = ?
        ORDER BY captured_at DESC
        LIMIT ?`
      )
      .all(accountId, limit) as Array<{
      accountId: string;
      capturedAt: number;
      status: ManagedAccount["status"];
      statusReason: string | null;
      primaryUsedPercent: number | null;
      secondaryUsedPercent: number | null;
      primaryWindowDurationMins: number | null;
      secondaryWindowDurationMins: number | null;
    }>;

    return rows.reverse().map((row) => {
      const primary = row.primaryUsedPercent === null ? null : {
        usedPercent: row.primaryUsedPercent,
        resetsAt: null,
        windowDurationMins: row.primaryWindowDurationMins
      };
      const secondary = row.secondaryUsedPercent === null ? null : {
        usedPercent: row.secondaryUsedPercent,
        resetsAt: null,
        windowDurationMins: row.secondaryWindowDurationMins
      };
      const limits = { limitId: null, limitName: null, primary, secondary, credits: null, planType: null, rateLimitReachedType: null };
      const fiveHour = pickWindow(limits, "five-hour");
      const weekly = pickWindow(limits, "weekly");
      return {
        accountId: row.accountId,
        capturedAt: row.capturedAt,
        status: row.status,
        statusReason: row.statusReason,
        fiveHourUsedPercent: fiveHour.usedPercent,
        weeklyUsedPercent: weekly.usedPercent,
        primaryUsedPercent: row.primaryUsedPercent,
        secondaryUsedPercent: row.secondaryUsedPercent
      };
    });
  }

  setStatus(id: string, status: ManagedAccount["status"], reason: string | null): ManagedAccount {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare("UPDATE accounts SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?")
      .run(status, reason, now, id);
    const saved = this.get(id);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  setPlanAndStatus(id: string, planType: PlanType, status: ManagedAccount["status"], reason: string | null): ManagedAccount {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare("UPDATE accounts SET plan_type = ?, status = ?, status_reason = ?, updated_at = ? WHERE id = ?")
      .run(planType, status, reason, now, id);
    const saved = this.get(id);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  updateEncryptedAuthJson(id: string, encryptedAuthJson: string): ManagedAccount {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare("UPDATE accounts SET encrypted_auth_json = ?, updated_at = ?, status_reason = NULL WHERE id = ?")
      .run(encryptedAuthJson, now, id);
    const saved = this.get(id);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  updateCodexAuthMaterial(id: string, input: {
    encryptedAuthJson: string;
    authFingerprint: string;
    providerAccountId: string | null;
    workspaceAccountId: string | null;
    workspaceLabel: string | null;
    expiresAt: number | null;
    credentialState?: CredentialState;
    lastAuthenticatedAt?: number | null;
    authMode?: CodexAuthMode | null;
  }): ManagedAccount {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE accounts SET
          encrypted_auth_json = @encryptedAuthJson,
          auth_fingerprint = @authFingerprint,
          provider_account_id = @providerAccountId,
          workspace_account_id = @workspaceAccountId,
          workspace_label = @workspaceLabel,
          expires_at = @expiresAt,
          auth_mode = COALESCE(@authMode, auth_mode),
          credential_state = @credentialState,
          last_authenticated_at = COALESCE(@lastAuthenticatedAt, last_authenticated_at),
          version = version + 1,
          updated_at = @now,
          status = CASE
            WHEN credential_state != 'ready' AND @credentialState = 'ready' AND status = 'error' THEN 'unknown'
            WHEN status = 'error' AND status_reason = @authDriftReason THEN 'unknown'
            ELSE status
          END,
          status_reason = CASE
            WHEN credential_state != 'ready' AND @credentialState = 'ready' THEN NULL
            WHEN status_reason = @authDriftReason THEN NULL
            ELSE status_reason
          END
        WHERE id = @id`
      )
      .run({
        id,
        ...input,
        authDriftReason,
        credentialState: input.credentialState ?? "ready",
        lastAuthenticatedAt: input.lastAuthenticatedAt ?? null,
        authMode: input.authMode ?? null,
        now
      });
    this.db.prepare("DELETE FROM auth_drift_candidates WHERE account_id = ?").run(id);
    const saved = this.get(id);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  storeAuthDriftCandidate(input: {
    accountId: string;
    encryptedAuthJson: string;
    fingerprint: string;
    observedAt?: number;
  }): ManagedAccount {
    const observedAt = input.observedAt ?? Math.floor(Date.now() / 1000);
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO auth_drift_candidates (account_id, encrypted_auth_json, fingerprint, observed_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET
            encrypted_auth_json = excluded.encrypted_auth_json,
            fingerprint = excluded.fingerprint,
            observed_at = excluded.observed_at`
        )
        .run(input.accountId, input.encryptedAuthJson, input.fingerprint, observedAt);
      this.db
        .prepare(
          `UPDATE accounts SET
            credential_state = 'drifted',
            status = 'error',
            status_reason = ?,
            updated_at = ?
          WHERE id = ?`
        )
        .run(authDriftReason, observedAt, input.accountId);
    });
    tx();
    const saved = this.get(input.accountId);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  getAuthDriftCandidate(accountId: string): {
    encryptedAuthJson: string;
    fingerprint: string;
    observedAt: number;
  } | null {
    const row = this.db
      .prepare(
        `SELECT
          encrypted_auth_json AS encryptedAuthJson,
          fingerprint,
          observed_at AS observedAt
        FROM auth_drift_candidates
        WHERE account_id = ?`
      )
      .get(accountId) as { encryptedAuthJson: string; fingerprint: string; observedAt: number } | undefined;
    return row ?? null;
  }

  clearAuthDriftCandidate(accountId: string): ManagedAccount {
    const now = Math.floor(Date.now() / 1000);
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM auth_drift_candidates WHERE account_id = ?").run(accountId);
      this.db
        .prepare(
          `UPDATE accounts SET
            credential_state = 'ready',
            status = CASE
              WHEN status = 'error' AND status_reason = ? THEN 'unknown'
              ELSE status
            END,
            status_reason = CASE
              WHEN status_reason = ? THEN NULL
              ELSE status_reason
            END,
            updated_at = ?
          WHERE id = ?`
        )
        .run(authDriftReason, authDriftReason, now, accountId);
    });
    tx();
    const saved = this.get(accountId);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  clearActive(platform: AccountPlatform): void {
    this.db.prepare("UPDATE accounts SET is_active = 0 WHERE platform = ?").run(platform);
  }

  setActive(id: string): ManagedAccount {
    const target = this.get(id);
    if (!target) throw new Error("Account not found");
    const now = Math.floor(Date.now() / 1000);
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE accounts SET is_active = 0 WHERE platform = ?").run(target.platform);
      this.db.prepare("UPDATE accounts SET is_active = 1, last_used_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
    });
    tx();
    const saved = this.get(id);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  createSwitchTransaction(input: {
    id: string;
    platform: AccountPlatform;
    targetAccountId: string;
    previousAccountId: string | null;
    targetFingerprint: string | null;
    previousFingerprint: string | null;
    now?: number;
  }): SwitchTransaction {
    const now = input.now ?? Math.floor(Date.now() / 1000);
    try {
      this.db
        .prepare(
          `INSERT INTO switch_transactions (
            id, platform, target_account_id, previous_account_id, status, phase,
            target_fingerprint, previous_fingerprint, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'running', 'preparing', ?, ?, ?, ?)`
        )
        .run(
          input.id,
          input.platform,
          input.targetAccountId,
          input.previousAccountId,
          input.targetFingerprint,
          input.previousFingerprint,
          now,
          now
        );
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error))) {
        throw new Error("Another switch transaction is already active");
      }
      throw error;
    }
    const created = this.getSwitchTransaction(input.id);
    if (!created) throw new Error("Failed to create switch transaction");
    return created;
  }

  updateSwitchTransaction(
    id: string,
    input: {
      status: SwitchTransactionStatus;
      phase: SwitchTransactionPhase;
      backupPath?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      completedAt?: number | null;
    },
    expectedVersion?: number
  ): SwitchTransaction {
    const current = this.getSwitchTransaction(id);
    if (!current) throw new Error("Switch transaction not found");
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new Error("Switch transaction was modified concurrently");
    }
    const now = Math.floor(Date.now() / 1000);
    const terminal = ["committed", "rolled_back", "aborted", "failed", "recovery_required"].includes(input.status);
    const result = this.db
      .prepare(
        `UPDATE switch_transactions SET
          status = @status,
          phase = @phase,
          backup_path = @backupPath,
          error_code = @errorCode,
          error_message = @errorMessage,
          updated_at = @now,
          completed_at = @completedAt,
          version = version + 1
        WHERE id = @id AND version = @currentVersion`
      )
      .run({
        id,
        status: input.status,
        phase: input.phase,
        backupPath: input.backupPath === undefined ? current.backupPath : input.backupPath,
        errorCode: input.errorCode === undefined ? current.errorCode : input.errorCode,
        errorMessage: input.errorMessage === undefined ? current.errorMessage : input.errorMessage,
        now,
        completedAt: input.completedAt === undefined ? (terminal ? now : current.completedAt) : input.completedAt,
        currentVersion: current.version
      });
    if (result.changes !== 1) throw new Error("Switch transaction was modified concurrently");
    const updated = this.getSwitchTransaction(id);
    if (!updated) throw new Error("Switch transaction not found after update");
    return updated;
  }

  finalizeSwitchTransactionWithActiveAccount(
    id: string,
    accountId: string,
    input: {
      phase: "committed" | "rolled_back";
      backupPath?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
    expectedVersion: number
  ): { account: ManagedAccount; transaction: SwitchTransaction } {
    const finalize = this.db.transaction(() => {
      const current = this.getSwitchTransaction(id);
      if (!current) throw new Error("Switch transaction not found");
      if (current.version !== expectedVersion) {
        throw new Error("Switch transaction was modified concurrently");
      }
      const target = this.get(accountId);
      if (!target) throw new Error("Account not found");
      if (target.platform !== current.platform) {
        throw new Error("Switch transaction and active account platforms do not match");
      }

      const now = Math.floor(Date.now() / 1000);
      this.db.prepare("UPDATE accounts SET is_active = 0 WHERE platform = ?").run(target.platform);
      const accountResult = this.db
        .prepare("UPDATE accounts SET is_active = 1, last_used_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, accountId);
      if (accountResult.changes !== 1) throw new Error("Account not found during switch finalization");

      const transactionResult = this.db
        .prepare(
          `UPDATE switch_transactions SET
            status = @status,
            phase = @phase,
            backup_path = @backupPath,
            error_code = @errorCode,
            error_message = @errorMessage,
            updated_at = @now,
            completed_at = @now,
            version = version + 1
          WHERE id = @id AND version = @currentVersion`
        )
        .run({
          id,
          status: input.phase,
          phase: input.phase,
          backupPath: input.backupPath === undefined ? current.backupPath : input.backupPath,
          errorCode: input.errorCode === undefined ? current.errorCode : input.errorCode,
          errorMessage: input.errorMessage === undefined ? current.errorMessage : input.errorMessage,
          now,
          currentVersion: current.version
        });
      if (transactionResult.changes !== 1) {
        throw new Error("Switch transaction was modified concurrently");
      }

      const account = this.get(accountId);
      const transaction = this.getSwitchTransaction(id);
      if (!account || !transaction) throw new Error("Switch finalization could not be verified");
      return { account, transaction };
    });
    return finalize.immediate();
  }

  getSwitchTransaction(id: string): SwitchTransaction | null {
    const row = this.db
      .prepare("SELECT * FROM switch_transactions WHERE id = ?")
      .get(id) as SwitchTransactionRow | undefined;
    return row ? mapSwitchTransaction(row) : null;
  }

  listSwitchTransactions(limit = 30): SwitchTransaction[] {
    const rows = this.db
      .prepare("SELECT * FROM switch_transactions ORDER BY created_at DESC LIMIT ?")
      .all(limit) as SwitchTransactionRow[];
    return rows.map(mapSwitchTransaction);
  }

  reconcileInterruptedSwitchTransactions(): SwitchTransaction[] {
    const nonTerminal = this.db
      .prepare(
        `SELECT * FROM switch_transactions
        WHERE status IN ('pending', 'running', 'rolling_back')
        ORDER BY created_at ASC`
      )
      .all() as SwitchTransactionRow[];
    const reconciled: SwitchTransaction[] = [];
    for (const row of nonTerminal) {
      const transaction = mapSwitchTransaction(row);
      const preWrite = [
        "preparing",
        "validating_previous",
        "validating_target",
        "ready",
        "quiescing"
      ].includes(transaction.phase);
      reconciled.push(this.updateSwitchTransaction(transaction.id, preWrite
        ? {
            status: "aborted",
            phase: "aborted",
            errorCode: "INTERRUPTED_PRE_WRITE",
            errorMessage: "Interrupted before auth activation; no active credentials were changed."
          }
        : {
            status: "recovery_required",
            phase: "recovery_required",
            errorCode: "INTERRUPTED_AFTER_WRITE",
            errorMessage: "Interrupted after auth activation began; deterministic recovery is required."
          }));
    }
    return reconciled;
  }

  recordSwitchEvent(event: {
    id: string;
    accountId: string;
    previousAccountId: string | null;
    startedAt: number;
    completedAt: number | null;
    status: string;
    error: string | null;
    backupPath: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO switch_events (
          id, account_id, previous_account_id, started_at, completed_at, status, error, backup_path
        ) VALUES (
          @id, @accountId, @previousAccountId, @startedAt, @completedAt, @status, @error, @backupPath
        )
        ON CONFLICT(id) DO UPDATE SET
          completed_at = excluded.completed_at,
          status = excluded.status,
          error = excluded.error,
          backup_path = excluded.backup_path`
      )
      .run(event);
  }

  setAccountMetadata(accountId: string, metadata: { tags: string[]; favorite: boolean; archived: boolean }): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE accounts SET favorite = ?, archived = ?, updated_at = ? WHERE id = ?").run(
        metadata.favorite ? 1 : 0,
        metadata.archived ? 1 : 0,
        Math.floor(Date.now() / 1000),
        accountId
      );
      this.db.prepare("DELETE FROM account_tags WHERE account_id = ?").run(accountId);
      const insert = this.db.prepare("INSERT INTO account_tags (account_id, tag) VALUES (?, ?)");
      for (const tag of metadata.tags) insert.run(accountId, tag);
    });
    tx();
  }

  getAccountMetadata(accountId: string): { tags: string[]; favorite: boolean; archived: boolean } {
    const row = this.db.prepare("SELECT favorite, archived FROM accounts WHERE id = ?").get(accountId) as
      | { favorite: 0 | 1; archived: 0 | 1 }
      | undefined;
    const tags = (
      this.db.prepare("SELECT tag FROM account_tags WHERE account_id = ? ORDER BY tag ASC").all(accountId) as Array<{ tag: string }>
    ).map((tagRow) => tagRow.tag);
    return { tags, favorite: row?.favorite === 1, archived: row?.archived === 1 };
  }

  listSwitchEvents(limit = 8): SwitchHistoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT
          switch_events.id,
          switch_events.account_id AS accountId,
          accounts.label AS accountLabel,
          accounts.email AS accountEmail,
          switch_events.previous_account_id AS previousAccountId,
          switch_events.started_at AS startedAt,
          switch_events.completed_at AS completedAt,
          switch_events.status,
          switch_events.error,
          switch_events.backup_path AS backupPath
        FROM switch_events
        LEFT JOIN accounts ON accounts.id = switch_events.account_id
        ORDER BY switch_events.started_at DESC
        LIMIT ?`
      )
      .all(limit) as SwitchHistoryItem[];
    return rows;
  }

  getSwitchEvent(id: string): SwitchHistoryItem | null {
    const row = this.db
      .prepare(
        `SELECT
          switch_events.id,
          switch_events.account_id AS accountId,
          accounts.label AS accountLabel,
          accounts.email AS accountEmail,
          switch_events.previous_account_id AS previousAccountId,
          switch_events.started_at AS startedAt,
          switch_events.completed_at AS completedAt,
          switch_events.status,
          switch_events.error,
          switch_events.backup_path AS backupPath
        FROM switch_events
        LEFT JOIN accounts ON accounts.id = switch_events.account_id
        WHERE switch_events.id = ?
        LIMIT 1`
      )
      .get(id) as SwitchHistoryItem | undefined;
    return row ?? null;
  }

  updateMeta(id: string, input: {
    label?: string;
    notes?: string | null;
    subscriptionEndsAt?: number | null;
    tags?: string[];
    favorite?: boolean;
    archived?: boolean;
  }): ManagedAccount {
    const current = this.get(id);
    if (!current) throw new Error("Account not found");
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare("UPDATE accounts SET label = ?, notes = ?, subscription_ends_at = ?, updated_at = ? WHERE id = ?")
      .run(input.label ?? current.label, input.notes ?? current.notes, input.subscriptionEndsAt ?? current.subscriptionEndsAt, now, id);
    if (input.tags || input.favorite !== undefined || input.archived !== undefined) {
      this.setAccountMetadata(id, {
        tags: input.tags ?? current.tags ?? [],
        favorite: input.favorite ?? current.favorite ?? false,
        archived: input.archived ?? current.archived ?? false
      });
    }
    const saved = this.get(id);
    if (!saved) throw new Error("Account not found");
    return saved;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  }

  importPortable(input: AccountExportRecord & { profileDir: string }): ManagedAccount {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO accounts (
          id, platform, label, email, plan_type, profile_dir, encrypted_auth_json, is_active,
          created_at, updated_at, last_used_at, last_refresh_at, subscription_ends_at,
          status, status_reason, rate_limit_json, notes, auth_mode, provider_account_id,
          workspace_account_id, workspace_label, auth_fingerprint, credential_state,
          last_authenticated_at, expires_at, version
        ) VALUES (
          @id, @platform, @label, @email, @planType, @profileDir, @encryptedAuthJson, 0,
          @createdAt, @now, @lastUsedAt, @lastRefreshAt, @subscriptionEndsAt,
          @status, @statusReason, @rateLimitJson, @notes, @authMode, @providerAccountId,
          @workspaceAccountId, @workspaceLabel, @authFingerprint, @credentialState,
          @lastAuthenticatedAt, @expiresAt, @version
        )
        ON CONFLICT(id) DO UPDATE SET
          platform = excluded.platform,
          label = excluded.label,
          email = excluded.email,
          plan_type = excluded.plan_type,
          profile_dir = excluded.profile_dir,
          encrypted_auth_json = excluded.encrypted_auth_json,
          updated_at = excluded.updated_at,
          last_used_at = excluded.last_used_at,
          last_refresh_at = excluded.last_refresh_at,
          subscription_ends_at = excluded.subscription_ends_at,
          status = excluded.status,
          status_reason = excluded.status_reason,
          rate_limit_json = excluded.rate_limit_json,
          notes = excluded.notes,
          auth_mode = excluded.auth_mode,
          provider_account_id = excluded.provider_account_id,
          workspace_account_id = excluded.workspace_account_id,
          workspace_label = excluded.workspace_label,
          auth_fingerprint = excluded.auth_fingerprint,
          credential_state = excluded.credential_state,
          last_authenticated_at = excluded.last_authenticated_at,
          expires_at = excluded.expires_at,
          version = excluded.version`
      )
      .run({
        ...input,
        platform: input.platform ?? "codex",
        createdAt: input.createdAt || now,
        now,
        status: input.status ?? "unknown",
        statusReason: input.statusReason ?? null,
        rateLimitJson: input.rateLimitJson ?? null,
        notes: input.notes ?? null,
        authMode: input.authMode === undefined ? ((input.platform ?? "codex") === "codex" ? "chatgpt" : null) : input.authMode,
        providerAccountId: input.providerAccountId ?? null,
        workspaceAccountId: input.workspaceAccountId ?? null,
        workspaceLabel: input.workspaceLabel ?? null,
        authFingerprint: input.authFingerprint ?? null,
        credentialState: input.credentialState ?? "ready",
        lastAuthenticatedAt: input.lastAuthenticatedAt ?? null,
        expiresAt: input.expiresAt ?? null,
        version: input.version ?? 1
      });
    if ((input.platform ?? "codex") === "antigravity") {
      const details = input.antigravity ?? {
        googleProjectId: null,
        fingerprintId: null,
        lastQuotaRefreshAt: null,
        forbidden: false,
        ideStateDetected: false
      };
      this.db
        .prepare(
          `INSERT INTO antigravity_account_details (
            account_id, google_project_id, fingerprint_id, last_quota_refresh_at, forbidden, ide_state_detected
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET
            google_project_id = excluded.google_project_id,
            fingerprint_id = excluded.fingerprint_id,
            last_quota_refresh_at = excluded.last_quota_refresh_at,
            forbidden = excluded.forbidden,
            ide_state_detected = excluded.ide_state_detected`
        )
        .run(input.id, details.googleProjectId, details.fingerprintId, details.lastQuotaRefreshAt, details.forbidden ? 1 : 0, details.ideStateDetected ? 1 : 0);
    }
    const saved = this.get(input.id);
    if (!saved) throw new Error("Failed to import account");
    return saved;
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }
}
