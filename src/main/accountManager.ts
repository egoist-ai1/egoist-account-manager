import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  AccountImportResult,
  AntigravityCredentialBatchImportResult,
  AntigravityImportResult,
  AntigravityManualImportInput,
  AntigravityManualImportResult,
  AntigravityLocalIdentity,
  AuthEvent,
  AuthValidationState,
  CodexAuthMode,
  CodexLoginRequest,
  DesktopClosePolicy,
  LoginStartResult,
  LimitHistoryPoint,
  ManagedAccount,
  PlanType,
  RateLimitSnapshot,
  SwitchPreparationResult,
  ProfileIntegrityReport,
  SwitchTransaction,
  SwitchHistoryItem,
  WorkspaceBinding
} from "../shared/types.js";
import type { AccountExportRecord } from "./db.js";
import { AccountStore } from "./db.js";
import { Vault } from "./security.js";
import { getAuthJsonPath, getDefaultCodexHome, getDefaultWorkspacePath, getProfileDir } from "./paths.js";
import {
  CodexRpcClient,
  classifyRateLimit,
  getAuthFilePath,
  normalizeCodexPlanType,
  runCodexCommand,
  selectBestRateLimit
} from "./codexRpc.js";
import {
  getCodexAppUserModelId,
  resolveCodexDesktopPath,
  resolveCodexPath
} from "./processManager.js";
import { SwitchService } from "./services/switchService.js";
import {
  DurableAuthActivationError,
  DurableAuthBundleService,
  type AuthBundleFile,
  type DurableAuthBundleAdapter
} from "./services/durableAuthBundleService.js";
import type { AntigravityPathInput } from "./services/antigravityPaths.js";
import { getAntigravityProfileStatus } from "./services/antigravityProfileService.js";
import { extractAntigravityLocalIdentity, readAntigravityOfficialAuthState } from "./services/antigravityProfileReader.js";
import {
  applyAntigravityAccountWritePlan,
  type AntigravityAccountApplyResult,
  type AntigravityCredentialPackage
} from "./services/antigravityAccountAdapter.js";
import {
  restoreAntigravityProfileBackup,
  type AntigravityProfileBackupManifest
} from "./services/antigravityProfileBackup.js";
import {
  fetchAntigravityGoogleUserInfo,
  refreshAntigravityGoogleAccessToken,
  resolveAntigravityOAuthClient,
  type AntigravityGoogleOAuthResult
} from "./services/antigravityGoogleAuthService.js";
import type {
  AntigravityCredentialStoreReadResult,
  AntigravityCredentialStoreTokenInput,
  AntigravityCredentialStoreWriteResult
} from "./services/antigravityCredentialStore.js";
import { readAntigravityCredentialStorePayload } from "./services/antigravityCredentialStore.js";
import type { AntigravityRestartResult } from "./services/antigravityProcessService.js";
import { restartAntigravityIntegration } from "./services/antigravityProcessService.js";
import { fetchAntigravityQuota } from "./services/antigravityQuotaService.js";
import {
  parseAntigravityCredentialPayload,
  readAntigravityExternalCredentialPayloads,
  type ParsedAntigravityCredential
} from "./services/antigravityCredentialImportService.js";
import { validateAntigravityAuthState, validateCodexAuthState } from "./services/authValidationService.js";
import { RefreshBackoff } from "./services/refreshBackoff.js";
import { redactSensitiveText } from "../shared/redaction.js";
import { hasCurrentQuotaRefreshFailure } from "../shared/quotaFreshness.js";
import {
  CodexProfileVaultService,
  inspectCodexAuthJson
} from "./services/codexProfileVaultService.js";
import { SwitchTransactionService } from "./services/switchTransactionService.js";
import {
  WindowsDesktopLifecycleService
} from "./services/windowsDesktopLifecycleService.js";
import { AsyncKeyedLock } from "./services/asyncKeyedLock.js";
import { CrossProcessLockService } from "./services/crossProcessLockService.js";
import { inspectCodexCredentialStore } from "./services/codexCredentialStoreService.js";

interface PendingLogin {
  profileId: string;
  profileDir: string;
  client: CodexRpcClient;
  pollTimer: NodeJS.Timeout | null;
  startedAt: number;
  authMode: CodexAuthMode;
  replaceAccountId?: string;
  previousProfileDir?: string;
}

export interface AccountManagerDependencies {
  codexHome?: string;
  readAntigravityCredentialStorePayload?: (
    platform?: NodeJS.Platform
  ) => AntigravityCredentialStoreReadResult | null;
  writeAntigravityCredentialStoreToken?: (
    input: AntigravityCredentialStoreTokenInput,
    platform?: NodeJS.Platform
  ) => AntigravityCredentialStoreWriteResult;
  fetchAntigravityQuota?: typeof fetchAntigravityQuota;
  fetchAntigravityGoogleUserInfo?: typeof fetchAntigravityGoogleUserInfo;
  restartAntigravityIntegration?: typeof restartAntigravityIntegration;
  desktopLifecycle?: Pick<WindowsDesktopLifecycleService, "quiesce" | "launchAndWaitReady">
    & Partial<Pick<WindowsDesktopLifecycleService, "getDiagnostics">>;
  getDesktopClosePolicy?: () => DesktopClosePolicy;
  durableAuthBundleAdapter?: DurableAuthBundleAdapter;
  durableAuthRenameRetryDelaysMs?: number[];
  durableAuthStableCheckCount?: number;
  durableAuthStableCheckIntervalMs?: number;
  durableAuthSleep?: (ms: number) => Promise<void>;
  operationLock?: AsyncKeyedLock;
  crossProcessSwitchLock?: Pick<CrossProcessLockService, "runExclusive">;
}

export interface ActiveCodexSessionSyncResult {
  status: "updated" | "unchanged" | "signed_out" | "unmanaged" | "invalid" | "busy";
  accountId: string | null;
}

const maximumAuthJsonBytes = 1024 * 1024;

function readStableAuthJson(filePath: string): string {
  const firstInfo = fs.lstatSync(filePath);
  if (!firstInfo.isFile() || firstInfo.isSymbolicLink()) {
    throw new Error("Codex auth.json must be a regular file, not a link or directory");
  }
  if (firstInfo.size <= 1 || firstInfo.size > maximumAuthJsonBytes) {
    throw new Error("Codex auth.json is empty or exceeds the 1 MiB safety limit");
  }

  const first = fs.readFileSync(filePath);
  const secondInfo = fs.lstatSync(filePath);
  const second = fs.readFileSync(filePath);
  if (
    firstInfo.size !== secondInfo.size
    || firstInfo.mtimeMs !== secondInfo.mtimeMs
    || !first.equals(second)
  ) {
    first.fill(0);
    second.fill(0);
    throw new Error("Codex auth.json changed while it was being read; the last verified vault was left unchanged");
  }
  const authJson = second.toString("utf8");
  first.fill(0);
  second.fill(0);
  let parsed: unknown;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    throw new Error("Codex auth.json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Codex auth.json must contain a JSON object");
  }
  return authJson;
}

const portableExportFormat = "one.egoist.codex-account-manager.accounts";
// Version 3 upgrades the current v2 PBKDF2 envelope to memory-hard scrypt.
// Versions 1 and 2 remain import-only for already exported user profiles.
const portableExportVersion = 3;
const supportedPortableExportVersions = new Set([1, 2, portableExportVersion]);
const portableExportScrypt = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

interface PortableAccount {
  id: string;
  platform?: "codex" | "antigravity";
  authMode?: CodexAuthMode | null;
  providerAccountId?: string | null;
  workspaceAccountId?: string | null;
  workspaceLabel?: string | null;
  authFingerprint?: string | null;
  credentialState?: ManagedAccount["credentialState"];
  lastAuthenticatedAt?: number | null;
  expiresAt?: number | null;
  accountVersion?: number;
  label: string;
  email: string;
  planType: PlanType;
  authJson?: string;
  antigravityVaultJson?: string;
  antigravity?: {
    googleProjectId: string | null;
    fingerprintId: string | null;
    ideStateDetected: boolean;
  } | null;
  exportedWasActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  lastRefreshAt: number | null;
  subscriptionEndsAt: number | null;
  status: ManagedAccount["status"];
  statusReason: string | null;
  rateLimitJson: string | null;
  notes: string | null;
}

interface PortablePayload {
  format: typeof portableExportFormat;
  version: typeof portableExportVersion;
  exportedAt: number;
  accounts: PortableAccount[];
}

interface PortableEnvelope {
  format: typeof portableExportFormat;
  version: number;
  exportedAt: number;
  kdf:
    | { name: "pbkdf2-sha256"; iterations: number; salt: string }
    | { name: "scrypt"; N: number; r: number; p: number; maxmem: number; salt: string };
  cipher: {
    name: "aes-256-gcm";
    iv: string;
    tag: string;
    ciphertext: string;
  };
}

const antigravityVaultFormat = "one.egoist.codex-account-manager.antigravity.credentials";
const antigravityVaultVersion = 1;
const antigravityRefreshSkewSeconds = 5 * 60;

interface AntigravityVaultRecord {
  format: typeof antigravityVaultFormat;
  version: typeof antigravityVaultVersion;
  authMode?: "manual_credentials" | "local_profile" | "google_oauth";
  credentials?: AntigravityCredentialPackage;
  localProfile?: {
    accountId: string;
    email: string | null;
    label: string;
    profileDir: string;
    fingerprintId: string;
    googleProjectId: string | null;
    importedAt: number;
    source: AntigravityLocalIdentity["source"];
    confidence: AntigravityLocalIdentity["confidence"];
  };
  googleOAuth?: {
    accountId: string;
    email: string;
    label: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
    scope: string[];
    tokenType: string | null;
    oauthClientId: string;
    redirectUri: string;
    googleProjectId?: string | null;
    tier?: "free" | "standard" | "paid" | "unknown";
    tierId?: string | null;
    importedAt: number;
    source: "google_oauth_browser";
  };
  fingerprintId: string | null;
  importedAt: number;
}

function atomicWrite(filePath: string, data: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, filePath);
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function antigravityAccountDbId(accountId: string): string {
  const digest = crypto.createHash("sha256").update(accountId).digest("hex").slice(0, 24);
  return `ag_${digest}`;
}

function antigravityPlanTypeFromContext(input: { tier: "free" | "standard" | "paid" | "unknown"; tierId: string | null }): PlanType {
  const normalized = (input.tierId ?? "").toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, "");
  if (input.tier === "unknown") return "unknown";
  if (input.tier === "free" || normalized.includes("free")) return "free";
  if (input.tier === "standard" || normalized.includes("standard-tier")) return "unknown";
  if (input.tier !== "paid") return "unknown";
  if (compact.includes("googleaiultrax20") || (compact.includes("ultra") && compact.includes("20"))) return "google-ai-ultra-x20";
  if (compact.includes("googleaiultra") || compact.includes("ultra")) return "google-ai-ultra";
  if (compact.includes("googleaipro") || compact.includes("aipro")) return "google-ai-pro";
  if (normalized.includes("team")) return "team";
  if (normalized.includes("business")) return "business";
  if (normalized.includes("enterprise")) return "enterprise";
  if (normalized.includes("edu")) return "edu";
  if (normalized.includes("plus")) return "plus";
  if (normalized.includes("go")) return "go";
  if (normalized.includes("10")) return "pro-x10";
  if (normalized.includes("20")) return "pro-x20";
  return "unknown";
}

function readAntigravityBackupManifest(backupDir: string): AntigravityProfileBackupManifest {
  return JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8")) as AntigravityProfileBackupManifest;
}

function restoreAntigravityBackupDir(backupDir: string): void {
  restoreAntigravityProfileBackup(readAntigravityBackupManifest(backupDir));
}

function deriveExportKey(passphrase: string, salt: Buffer, iterations: number): Buffer {
  if (passphrase.trim().length < 12) {
    throw new Error("Export password must contain at least 12 characters");
  }
  return crypto.pbkdf2Sync(passphrase, salt, iterations, 32, "sha256");
}

function deriveScryptExportKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.trim().length < 12) {
    throw new Error("Export password must contain at least 12 characters");
  }
  return crypto.scryptSync(passphrase, salt, 32, portableExportScrypt);
}

function encryptPortablePayload(payload: PortablePayload, passphrase: string): PortableEnvelope {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveScryptExportKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    format: portableExportFormat,
    version: portableExportVersion,
    exportedAt: payload.exportedAt,
    kdf: {
      name: "scrypt",
      ...portableExportScrypt,
      salt: salt.toString("base64")
    },
    cipher: {
      name: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    }
  };
}

function decryptPortablePayload(input: string, passphrase: string): PortablePayload {
  const envelope = JSON.parse(input) as PortableEnvelope;
  if (envelope.format !== portableExportFormat || !supportedPortableExportVersions.has(envelope.version)) {
    throw new Error("Unsupported account export file");
  }
  if ((envelope.kdf?.name !== "pbkdf2-sha256" && envelope.kdf?.name !== "scrypt") || envelope.cipher?.name !== "aes-256-gcm") {
    throw new Error("Unsupported account export encryption");
  }
  const salt = Buffer.from(envelope.kdf.salt, "base64");
  const iv = Buffer.from(envelope.cipher.iv, "base64");
  const tag = Buffer.from(envelope.cipher.tag, "base64");
  const ciphertext = Buffer.from(envelope.cipher.ciphertext, "base64");
  const key = envelope.kdf.name === "scrypt"
    ? deriveScryptExportKey(passphrase, salt)
    : deriveExportKey(passphrase, salt, envelope.kdf.iterations);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const payload = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as PortablePayload;
  if (payload.format !== portableExportFormat || !supportedPortableExportVersions.has(payload.version) || !Array.isArray(payload.accounts)) {
    throw new Error("Invalid account export payload");
  }
  return payload;
}

function backupFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const backupPath = `${filePath}.cam-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(filePath, backupPath);
  pruneAuthBackups(filePath);
}

function getAuthAccountId(authJson: string): string | null {
  try {
    const parsed = JSON.parse(authJson) as {
      account_id?: unknown;
      tokens?: { account_id?: unknown; chatgpt_account_id?: unknown };
    };
    for (const candidate of [parsed.tokens?.account_id, parsed.tokens?.chatgpt_account_id, parsed.account_id]) {
      if (typeof candidate === "string" && candidate) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

function replaceStateAccountIds(value: unknown, targetAccountId: string, previousAccountId: string | null): boolean {
  if (!value || typeof value !== "object") return false;
  let changed = false;
  const record = value as Record<string, unknown>;
  for (const [key, current] of Object.entries(record)) {
    if (current && typeof current === "object") {
      changed = replaceStateAccountIds(current, targetAccountId, previousAccountId) || changed;
      continue;
    }

    if (typeof current !== "string") continue;
    const isKnownAccountKey = ["creator_id", "creatorId", "account_id", "accountId", "providerAccountId"].includes(key);
    if (!isKnownAccountKey) continue;
    if (previousAccountId && current !== previousAccountId) continue;
    record[key] = targetAccountId;
    changed = true;
  }
  return changed;
}

function buildCodexCompatibilityFiles(
  codexHome: string,
  targetAuthJson: string,
  previousAuthJson: string | null
): AuthBundleFile[] {
  const targetAccountId = getAuthAccountId(targetAuthJson);
  if (!targetAccountId) return [];

  const previousAccountId = previousAuthJson ? getAuthAccountId(previousAuthJson) : null;
  const files: AuthBundleFile[] = [];
  for (const name of [".codex-global-state.json", ".codex-global-state.json.bak"]) {
    const filePath = path.join(codexHome, name);
    if (!fs.existsSync(filePath)) continue;

    try {
      const state = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!replaceStateAccountIds(state, targetAccountId, previousAccountId)) continue;
      files.push({
        relativePath: name as AuthBundleFile["relativePath"],
        contents: `${JSON.stringify(state, null, 2)}\n`
      });
    } catch {
      // Global-state sync is a compatibility helper; auth.json remains the source of truth.
    }
  }
  return files;
}

function syncCodexGlobalState(codexHome: string, targetAuthJson: string, previousAuthJson: string | null): number {
  const files = buildCodexCompatibilityFiles(codexHome, targetAuthJson, previousAuthJson);
  for (const file of files) {
    const filePath = path.join(codexHome, file.relativePath);
    backupFile(filePath);
    atomicWrite(filePath, file.contents);
  }
  return files.length;
}

function pruneAuthBackups(filePath: string, keep = 20): void {
  try {
    const dir = path.dirname(filePath);
    const prefix = `${path.basename(filePath)}.cam-backup-`;
    const backups = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map((entry) => {
        const fullPath = path.join(dir, entry.name);
        return { path: fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (const backup of backups.slice(keep)) {
      fs.rmSync(backup.path, { force: true });
    }
  } catch {
    // Backup pruning is best-effort and must never block account switching.
  }
}

function getDisplayLabel(email: string): string {
  return email.split("@")[0] || email;
}

interface CodexAccountIdentity {
  authMode: CodexAuthMode;
  email: string | null;
  planType: PlanType;
}

function getAccountIdentity(account: unknown, expectedAuthMode: CodexAuthMode = "chatgpt"): CodexAccountIdentity {
  const current = account as { type?: string; email?: string; planType?: string } | null;
  if (!current) throw new Error("Codex profile is not authenticated");
  if (expectedAuthMode === "apiKey") {
    if (current.type !== "apiKey") throw new Error("Codex profile is not authenticated with an API key");
    return { authMode: "apiKey", email: null, planType: "unknown" };
  }
  if (current.type !== "chatgpt") {
    throw new Error("Codex profile is not logged into a ChatGPT-compatible account");
  }
  return {
    authMode: expectedAuthMode,
    email: normalizeNullableString(current.email),
    planType: normalizeCodexPlanType(current.planType ?? "unknown")
  };
}

function isCodexProfileLoginError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /codex profile is not authenticated|codex profile is not logged into a chatgpt(?:-compatible)? account|codex profile belongs to a different chatgpt account|login required|reauth(?:entication)? required|sign.?in required/i.test(message);
}

function matchesCodexAccountIdentity(identity: CodexAccountIdentity, account: ManagedAccount): boolean {
  if (account.authMode === "apiKey") return identity.authMode === "apiKey";
  if (identity.authMode === "apiKey") return false;
  if (!identity.email || account.email.startsWith("codex:")) return true;
  return identity.email.trim().toLowerCase() === account.email.trim().toLowerCase();
}

function withCodexPlan(snapshot: RateLimitSnapshot, identityPlanType: PlanType): RateLimitSnapshot {
  return {
    ...snapshot,
    planType: normalizeCodexPlanType(snapshot.planType ?? identityPlanType, snapshot)
  };
}

function inferHomeFromAppData(appDataDir: string): string | null {
  const appDataParent = path.dirname(appDataDir);
  if (path.basename(appDataDir).toLowerCase() !== "roaming") return null;
  if (path.basename(appDataParent).toLowerCase() !== "appdata") return null;
  return path.dirname(appDataParent);
}

function isUnverifiedGenericAntigravityPlan(planType: PlanType | null | undefined): boolean {
  return planType === "standard" || planType === "pro" || planType === "prolite" || planType === "pro-x10" || planType === "pro-x20";
}

function sanitizeAntigravityLimits(limits: RateLimitSnapshot): RateLimitSnapshot {
  if (!isUnverifiedGenericAntigravityPlan(limits.planType)) return limits;
  return { ...limits, planType: "unknown" };
}

function canReadCurrentWindowsCredentialStore(pathInput: AntigravityPathInput): boolean {
  const platform = pathInput.platform ?? process.platform;
  if (platform !== "win32") return false;
  const home = pathInput.home ?? process.env.USERPROFILE ?? "";
  return home ? path.resolve(home).toLowerCase() === path.resolve(os.userInfo().homedir).toLowerCase() : true;
}

export class AccountManager extends EventEmitter {
  private readonly pendingLogins = new Map<string, PendingLogin>();
  private readonly codexPath: string | null;
  private readonly refreshBackoff = new RefreshBackoff({ baseDelayMs: 60_000, maxDelayMs: 30 * 60_000 });
  private readonly switchInFlight = new Map<ManagedAccount["platform"], { accountId: string; promise: Promise<ManagedAccount> }>();
  private readonly codexProfileVault: CodexProfileVaultService;
  private readonly switchTransactions: SwitchTransactionService;
  private readonly desktopLifecycle: (
    Pick<WindowsDesktopLifecycleService, "quiesce" | "launchAndWaitReady">
    & Partial<Pick<WindowsDesktopLifecycleService, "getDiagnostics">>
  ) | null;
  private readonly operationLock: AsyncKeyedLock;
  private readonly crossProcessSwitchLock: Pick<CrossProcessLockService, "runExclusive">;

  constructor(
    private readonly store: AccountStore,
    private readonly vault: Vault,
    private readonly appDataDir: string,
    codexPath?: string | null,
    private readonly dependencies: AccountManagerDependencies = {}
  ) {
    super();
    this.codexPath = codexPath ?? null;
    this.codexProfileVault = new CodexProfileVaultService(appDataDir, store, vault);
    this.switchTransactions = new SwitchTransactionService(store, (transaction) => {
      this.emit("switch-transaction", { transaction });
    });
    this.desktopLifecycle = dependencies.desktopLifecycle ??
      (process.platform === "win32" && process.env.VITEST !== "true"
        ? new WindowsDesktopLifecycleService()
        : null);
    this.operationLock = dependencies.operationLock ?? new AsyncKeyedLock();
    this.crossProcessSwitchLock = dependencies.crossProcessSwitchLock ?? new CrossProcessLockService({
      lockPath: path.join(this.getGlobalCodexHome(), ".codex-account-manager", "switch.lock")
    });
  }

  private emitLog(message: unknown): void {
    this.emit("log", redactSensitiveText(message));
  }

  list(): ManagedAccount[] {
    this.repairStaleAntigravityDisplayState();
    return this.store.list();
  }

  secureManagedProfileHomes(): { sealed: number; drifted: number } {
    return this.codexProfileVault.secureExistingProfiles();
  }

  repairLegacyQuotaRefreshState(): number {
    let repaired = 0;
    for (const account of this.store.list()) {
      if (account.credentialState !== "ready") continue;
      const refreshReason = hasCurrentQuotaRefreshFailure(account)
        ? account.lastRefreshError
        : account.statusReason;
      if (refreshReason && isCodexProfileLoginError(refreshReason)) {
        this.store.setCredentialState(account.id, "needs_reauth", refreshReason);
        repaired += 1;
        continue;
      }
      if (account.status !== "error" || !account.statusReason) continue;
      this.store.recordRateLimitFailure(account.id, account.statusReason);
      repaired += 1;
    }
    return repaired;
  }

  /**
   * Persist a locally observed Codex token rotation without starting app-server
   * or touching the desktop process. A profile is updated only after a unique
   * fingerprint, provider/workspace or signed JWT email match.
   */
  syncActiveCodexSession(): ActiveCodexSessionSyncResult {
    if (this.operationLock.isLocked("provider:codex")) {
      return { status: "busy", accountId: null };
    }
    const authPath = getAuthJsonPath(this.getGlobalCodexHome());
    if (!fs.existsSync(authPath)) return { status: "signed_out", accountId: null };

    let authJson: string;
    let metadata: ReturnType<typeof inspectCodexAuthJson>;
    try {
      authJson = readStableAuthJson(authPath);
      metadata = inspectCodexAuthJson(authJson);
    } catch (error) {
      this.emitLog(`Active Codex session snapshot is invalid; encrypted profiles were left unchanged: ${error instanceof Error ? error.message : String(error)}`);
      return { status: "invalid", accountId: null };
    }

    const accounts = this.store.list().filter((account) => account.platform === "codex");
    const exact = accounts.filter((account) => account.authFingerprint === metadata.authFingerprint);
    const provider = metadata.providerAccountId
      ? accounts.filter((account) =>
        account.providerAccountId === metadata.providerAccountId
        && account.workspaceAccountId === metadata.workspaceAccountId
      )
      : [];
    const matched = exact.length === 1
      ? exact[0]
      : provider.length === 1
        ? provider[0]
        : null;
    if (!matched) return { status: "unmanaged", accountId: null };

    const inferredAuthMode = matched.authMode ?? metadata.inferredAuthMode;
    const needsVaultUpdate = matched.authFingerprint !== metadata.authFingerprint
      || matched.providerAccountId !== metadata.providerAccountId
      || matched.workspaceAccountId !== metadata.workspaceAccountId
      || matched.workspaceLabel !== metadata.workspaceLabel
      || matched.expiresAt !== metadata.expiresAt
      || (matched.authMode === null && inferredAuthMode !== null)
      || matched.credentialState !== "ready";
    let saved = matched;
    if (needsVaultUpdate) {
      saved = this.store.updateCodexAuthMaterial(matched.id, {
        encryptedAuthJson: this.vault.encryptUtf8(authJson),
        authFingerprint: metadata.authFingerprint,
        providerAccountId: metadata.providerAccountId,
        workspaceAccountId: metadata.workspaceAccountId,
        workspaceLabel: metadata.workspaceLabel,
        expiresAt: metadata.expiresAt,
        credentialState: "ready",
        lastAuthenticatedAt: Math.floor(Date.now() / 1000),
        authMode: inferredAuthMode
      });
    }
    if (!saved.isActive) saved = this.store.setActive(saved.id);
    if (needsVaultUpdate) {
      this.emitLog(`Persisted a rotated active Codex session for managed profile ${saved.id}.`);
      this.emit("accounts-updated");
      return { status: "updated", accountId: saved.id };
    }
    return { status: "unchanged", accountId: saved.id };
  }

  private repairStaleAntigravityDisplayState(): void {
    for (const account of this.store.list()) {
      if (account.platform !== "antigravity") continue;
      const unverifiedPlan = isUnverifiedGenericAntigravityPlan(account.planType);
      if (account.antigravity?.lastQuotaRefreshAt !== null && !unverifiedPlan) continue;
      if (account.status !== "active" && account.planType === "unknown") continue;
      const hasQuotaEvidence = account.antigravity?.lastQuotaRefreshAt !== null;
      this.store.setPlanAndStatus(
        account.id,
        "unknown",
        unverifiedPlan && hasQuotaEvidence ? account.status : "unknown",
        unverifiedPlan
          ? "Antigravity plan is unknown: generic Code Assist tier is not treated as an active subscription."
          : "Antigravity Code Assist validation has not completed for this account."
      );
    }
  }

  async shutdown(): Promise<void> {
    const pending = [...this.pendingLogins.values()];
    this.pendingLogins.clear();
    for (const login of pending) {
      if (login.pollTimer) clearTimeout(login.pollTimer);
    }
    await Promise.allSettled(pending.map(async (login) => {
      await login.client.stop();
      if (this.codexProfileVault.isManagedProfile(login.profileDir)) {
        fs.rmSync(login.profileDir, { recursive: true, force: true });
      }
    }));
  }

  async startLogin(input: CodexLoginRequest): Promise<LoginStartResult> {
    return this.beginLogin(input);
  }

  async reauthenticateAccount(accountId: string, input: CodexLoginRequest): Promise<LoginStartResult> {
    const account = this.store.get(accountId);
    if (!account) throw new Error("Account not found");
    if (account.platform !== "codex") throw new Error("Codex authentication is only available for Codex accounts");
    return this.operationLock.runExclusive("provider:codex", async () => {
      await this.discardPendingReauthentication(account.id);
      return this.beginLogin(input, {
        replaceAccountId: account.id,
        previousProfileDir: account.profileDir
      });
    });
  }

  private async beginLogin(
    input: CodexLoginRequest,
    options: { replaceAccountId?: string; previousProfileDir?: string } = {}
  ): Promise<LoginStartResult> {
    const profileId = crypto.randomUUID();
    const profileDir = getProfileDir(this.appDataDir, profileId);
    fs.mkdirSync(profileDir, { recursive: true });

    const client = new CodexRpcClient(profileDir, this.requireCodexPath());
    if (input.type === "enterpriseAccessToken") {
      const loginId = `cli_${crypto.randomUUID()}`;
      try {
        const result = await runCodexCommand(this.requireCodexPath(), ["login", "--with-access-token"], {
          env: { CODEX_HOME: profileDir },
          timeoutMs: 45_000,
          maxOutputBytes: 64 * 1024,
          stdin: input.credential
        });
        if (result.exitCode !== 0) {
          throw new Error(`Codex access-token login failed with exit code ${result.exitCode}`);
        }
        const account = await this.persistCodexProfile({
          profileId,
          profileDir,
          client,
          authMode: "enterpriseAccessToken",
          replaceAccountId: options.replaceAccountId,
          previousProfileDir: options.previousProfileDir
        });
        this.emit("accounts-updated");
        return {
          profileId: account.id,
          loginId,
          type: input.type,
          completed: true,
          account
        };
      } catch (error) {
        fs.rmSync(profileDir, { recursive: true, force: true });
        throw error;
      } finally {
        await client.stop();
        const current = this.store.get(options.replaceAccountId ?? profileId);
        if (current) this.syncProfileAuthToVault(current);
      }
    }

    if (input.type === "apiKey") {
      const loginId = `api_${crypto.randomUUID()}`;
      try {
        const response = await client.startLogin({ type: "apiKey", apiKey: input.credential });
        if (response.type !== "apiKey") throw new Error("Unexpected Codex API-key login response");
        const account = await this.persistCodexProfile({
          profileId,
          profileDir,
          client,
          authMode: "apiKey",
          replaceAccountId: options.replaceAccountId,
          previousProfileDir: options.previousProfileDir
        });
        this.emit("accounts-updated");
        return {
          profileId: account.id,
          loginId,
          type: input.type,
          completed: true,
          account
        };
      } catch (error) {
        fs.rmSync(profileDir, { recursive: true, force: true });
        throw error;
      } finally {
        await client.stop();
        const current = this.store.get(options.replaceAccountId ?? profileId);
        if (current) this.syncProfileAuthToVault(current);
      }
    }

    client.on("account/login/completed", (params) => {
      void this.finalizeLogin(profileId, params as { loginId: string | null; success: boolean; error: string | null });
    });
    client.on("stderr", (chunk) => this.emitLog(String(chunk)));

    const response = await client.startLogin({ type: input.type });
    if (response.type !== "chatgpt" && response.type !== "chatgptDeviceCode") {
      await client.stop();
      throw new Error("Unexpected Codex login response");
    }

    this.pendingLogins.set(response.loginId, {
      profileId,
      profileDir,
      client,
      pollTimer: null,
      startedAt: Date.now(),
      authMode: "chatgpt",
      replaceAccountId: options.replaceAccountId,
      previousProfileDir: options.previousProfileDir
    });
    this.scheduleLoginPoll(response.loginId, profileId);
    return {
      profileId: options.replaceAccountId ?? profileId,
      loginId: response.loginId,
      type: response.type,
      authUrl: response.type === "chatgpt" ? response.authUrl : undefined,
      verificationUrl: response.type === "chatgptDeviceCode" ? response.verificationUrl : undefined,
      userCode: response.type === "chatgptDeviceCode" ? response.userCode : undefined
    };
  }

  async refreshAccount(accountId: string): Promise<ManagedAccount> {
    const account = this.store.get(accountId);
    if (!account) throw new Error("Account not found");
    return this.operationLock.runExclusive(`provider:${account.platform}`, () =>
      this.refreshAccountUnlocked(accountId)
    );
  }

  private async refreshAccountUnlocked(accountId: string): Promise<ManagedAccount> {
    const account = this.store.get(accountId);
    if (!account) throw new Error("Account not found");
    if (account.platform === "antigravity") {
      const blocked = this.refreshBackoff.getBlockedReason(account.id);
      if (blocked) {
        throw new Error(blocked.message);
      }
      try {
        const refreshed = await this.refreshAntigravityGoogleQuota(account);
        this.refreshBackoff.recordSuccess(account.id);
        return refreshed;
      } catch (error) {
        const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
        this.refreshBackoff.recordFailure(account.id, message);
        this.store.insertRateLimitSnapshot({
          id: crypto.randomUUID(),
          accountId: account.id,
          capturedAt: Math.floor(Date.now() / 1000),
          status: "error",
          statusReason: message,
          limits: {
            limitId: null,
            limitName: null,
            primary: null,
            secondary: null,
            credits: null,
            planType: account.planType,
            rateLimitReachedType: null
          }
        });
        return this.store.recordRateLimitFailure(account.id, message);
      }
    }
    const blocked = this.refreshBackoff.getBlockedReason(account.id);
    if (blocked) {
      throw new Error(blocked.message);
    }
    const usesActiveGlobalSession = account.isActive && fs.existsSync(getAuthJsonPath(this.getGlobalCodexHome()));
    const codexHome = usesActiveGlobalSession ? this.getGlobalCodexHome() : account.profileDir;
    if (!usesActiveGlobalSession) {
      // A desktop sign-out must not destroy or downgrade the manager-owned
      // last-known-good profile. Poll its isolated CODEX_HOME instead; an
      // official provider rejection will still transition to needs_reauth.
      this.ensureProfileAuth(account);
    }

    let client = new CodexRpcClient(codexHome, this.requireCodexPath());
    let identityVerified = false;
    try {
      // Quota polling must not rotate credentials. Explicit validation/repair
      // owns the refresh-token path; the three-minute background poll only
      // verifies the hydrated identity and reads limits.
      let accountResponse = await client.readAccount(false);
      let identity: CodexAccountIdentity;
      try {
        identity = getAccountIdentity(accountResponse.account, account.authMode ?? "chatgpt");
        if (!matchesCodexAccountIdentity(identity, account)) {
          throw new Error("Codex profile belongs to a different account");
        }
      } catch (error) {
        const restored = !usesActiveGlobalSession
          && isCodexProfileLoginError(error)
          && await this.restoreProfileAuthFromCurrentGlobalSession(account);
        if (!restored) throw error;

        await client.stop();
        client = new CodexRpcClient(account.profileDir, this.requireCodexPath());
        accountResponse = await client.readAccount(false);
        identity = getAccountIdentity(accountResponse.account, account.authMode ?? "chatgpt");
        if (!matchesCodexAccountIdentity(identity, account)) {
          throw new Error("Codex profile belongs to a different account");
        }
      }
      identityVerified = true;
      if (usesActiveGlobalSession) {
        this.syncActiveGlobalAuthToVault(account);
      } else {
        this.syncProfileAuthToVault(account);
      }
      if (account.authMode === "apiKey") {
        this.refreshBackoff.recordSuccess(account.id);
        return this.store.setStatus(
          account.id,
          "active",
          "API key authenticated. Codex does not expose ChatGPT quota windows for this mode."
        );
      }
      const response = await client.readRateLimits();
      const snapshot = withCodexPlan(selectBestRateLimit(response), identity.planType);
      const classified = classifyRateLimit(snapshot);
      this.store.insertRateLimitSnapshot({
        id: crypto.randomUUID(),
        accountId: account.id,
        capturedAt: Math.floor(Date.now() / 1000),
        status: classified.status,
        statusReason: classified.reason,
        limits: snapshot
      });
      this.refreshBackoff.recordSuccess(account.id);
      return this.store.setRateLimits(account.id, snapshot, classified.status, classified.reason);
    } catch (error) {
      const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
      const authenticationFailed = !identityVerified && isCodexProfileLoginError(error);
      if (authenticationFailed) this.refreshBackoff.recordSuccess(account.id);
      else this.refreshBackoff.recordFailure(account.id, message);
      this.store.insertRateLimitSnapshot({
        id: crypto.randomUUID(),
        accountId: account.id,
        capturedAt: Math.floor(Date.now() / 1000),
        status: "error",
        statusReason: message,
        limits: {
          limitId: null,
          limitName: null,
          primary: null,
          secondary: null,
          credits: null,
          planType: account.planType,
          rateLimitReachedType: null
        }
      });
      return authenticationFailed
        ? this.store.setCredentialState(account.id, "needs_reauth", message)
        : this.store.recordRateLimitFailure(account.id, message);
    } finally {
      await client.stop();
      // Never seal an auth.json that failed identity verification. A failed
      // app-server refresh can rewrite the file; persisting it would destroy
      // the last-known-good encrypted profile.
      if (!usesActiveGlobalSession) this.codexProfileVault.removePlaintext(account.profileDir);
    }
  }

  async validateAuth(accountId: string): Promise<AuthValidationState> {
    const account = this.store.get(accountId);
    if (!account) throw new Error("Account not found");
    if (account.platform === "antigravity") {
      let record: AntigravityVaultRecord | null = null;
      try {
        record = this.readAntigravityVaultRecord(account);
      } catch {
        record = null;
      }
      if (record?.googleOAuth) {
        const now = Math.floor(Date.now() / 1000);
        const googleOAuth = record.googleOAuth;
        if (googleOAuth.expiresAt && googleOAuth.expiresAt <= now + 90) {
          if (!googleOAuth.refreshToken) {
            return {
              state: "needs_reauth",
              lastValidatedAt: now,
              errorReason: "Antigravity Google access token expired and no refresh token is stored."
            };
          }
          try {
            const refreshed = await refreshAntigravityGoogleAccessToken({
              clientId: googleOAuth.oauthClientId,
              // PKCE desktop clients do not ship a client secret. Stored records
              // retain only the public client id that authorized the session.
              clientSecret: null,
              refreshToken: googleOAuth.refreshToken,
              requestTimeoutMs: 10_000
            });
            googleOAuth.accessToken = refreshed.accessToken;
            googleOAuth.refreshToken = refreshed.refreshToken ?? googleOAuth.refreshToken;
            googleOAuth.expiresAt = refreshed.expiresAt ?? googleOAuth.expiresAt;
            googleOAuth.scope = refreshed.scope.length ? refreshed.scope : googleOAuth.scope;
            googleOAuth.tokenType = refreshed.tokenType ?? googleOAuth.tokenType;
            this.store.updateEncryptedAuthJson(account.id, this.vault.encryptUtf8(JSON.stringify(record)));
          } catch (error) {
            return {
              state: "needs_reauth",
              lastValidatedAt: now,
              errorReason: redactSensitiveText(error instanceof Error ? error.message : String(error))
            };
          }
        }
        try {
          const userInfoFetcher = this.dependencies.fetchAntigravityGoogleUserInfo ?? fetchAntigravityGoogleUserInfo;
          await userInfoFetcher({
            accessToken: googleOAuth.accessToken,
            requestTimeoutMs: 10_000
          });
          return {
            state: "authorized",
            lastValidatedAt: now,
            errorReason: null
          };
        } catch (error) {
          return {
            state: "validation_failed",
            lastValidatedAt: now,
            errorReason: redactSensitiveText(error instanceof Error ? error.message : String(error))
          };
        }
      }
      const status = getAntigravityProfileStatus(this.getAntigravityPathInputForAccount(account));
      return validateAntigravityAuthState({ detected: status.detected });
    }

    this.ensureProfileAuth(account);
    const client = new CodexRpcClient(account.profileDir, this.requireCodexPath());
    try {
      const result = await validateCodexAuthState({
        readAccount: async (refreshToken) => {
          const response = await client.readAccount(refreshToken);
          const identity = getAccountIdentity(response.account, account.authMode ?? "chatgpt");
          if (!matchesCodexAccountIdentity(identity, account)) {
            throw new Error("Codex profile belongs to a different account");
          }
          return response;
        },
        expectedAuthMode: account.authMode ?? "chatgpt"
      });
      if (result.state === "authorized") {
        this.store.setCredentialState(account.id, "ready", null);
        this.syncProfileAuthToVault(account);
        this.refreshBackoff.recordSuccess(account.id);
      } else if (["expired", "revoked", "needs_reauth"].includes(result.state)) {
        this.store.setCredentialState(account.id, "needs_reauth", result.errorReason);
      }
      return result;
    } finally {
      await client.stop();
      // Only an identity-verified profile may update the encrypted vault.
      this.codexProfileVault.removePlaintext(account.profileDir);
    }
  }

  async refreshAllAccounts(options: { excludeAccountIds?: ReadonlySet<string> } = {}): Promise<ManagedAccount[]> {
    const accounts = this.store.list();
    const refreshed: ManagedAccount[] = [];
    for (const account of accounts) {
      if (options.excludeAccountIds?.has(account.id)) {
        refreshed.push(this.store.get(account.id) ?? account);
        continue;
      }
      if (account.platform === "codex" && account.status === "error" && isCodexProfileLoginError(account.statusReason ?? "")) {
        refreshed.push(account);
        continue;
      }
      if (this.refreshBackoff.getBlockedReason(account.id)) {
        refreshed.push(this.store.get(account.id) ?? account);
        continue;
      }
      try {
        refreshed.push(await this.refreshAccount(account.id));
      } catch (error) {
        this.emitLog(`Auto-refresh failed for ${account.email}: ${error instanceof Error ? error.message : String(error)}`);
        refreshed.push(this.store.get(account.id) ?? account);
      }
    }
    return refreshed;
  }

  repairEncryptedAuthCache(): number {
    for (const account of this.store.listForExport()) {
      try {
        this.vault.decryptUtf8(account.encryptedAuthJson);
      } catch (error) {
        this.emitLog(`Encrypted auth cache is unavailable for ${account.email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return 0;
  }

  async prepareSwitchAccount(accountId: string): Promise<SwitchPreparationResult> {
    let target = this.store.get(accountId);
    if (!target) throw new Error("Account not found");
    if (target.platform === "codex") {
      if (this.hasPendingReauthentication(target.id)) {
        throw new Error("The target Codex profile is still being reauthenticated. Finish the current sign-in before switching.");
      }
      this.assertCompatibleCodexCredentialStore();
      await this.reconcileActiveCodexAuth();
      target = this.store.get(accountId);
      if (!target) throw new Error("Account not found after active session reconciliation");
    }
    const previous = this.store.list().find((account) => account.platform === target.platform && account.isActive) ?? null;
    const targetFingerprint = target.platform === "codex"
      ? target.authFingerprint
      : target.antigravity?.fingerprintId ?? null;
    const previousFingerprint = previous?.platform === "codex"
      ? previous.authFingerprint
      : previous?.antigravity?.fingerprintId ?? null;
    return this.switchTransactions.prepare({
      platform: target.platform,
      targetAccountId: target.id,
      previousAccountId: previous?.id ?? null,
      targetFingerprint,
      previousFingerprint,
      validatePrevious: () => {
        if (!previous) return ["No previously active profile is recorded for this provider."];
        if (previous.credentialState !== "ready") {
          throw new Error(`The active profile is ${previous.credentialState} and must be reviewed or reauthenticated before switching.`);
        }
        return [];
      },
      validateTarget: () => {
        const current = this.store.get(target.id);
        if (!current) throw new Error("Target account disappeared during switch preparation.");
        if (current.credentialState !== "ready") {
          throw new Error(`Target profile is ${current.credentialState} and must be reviewed or reauthenticated before switching.`);
        }
        if (current.platform === "codex") {
          const authJson = this.readAccountAuthJson(current);
          const metadata = inspectCodexAuthJson(authJson);
          if (current.authFingerprint && metadata.authFingerprint !== current.authFingerprint) {
            throw new Error("Target vault fingerprint does not match account metadata.");
          }
        } else {
          this.readAntigravityVaultRecord(current);
        }
        return previous?.id === current.id ? ["The selected profile is already active."] : [];
      }
    });
  }

  cancelSwitch(transactionId: string): SwitchTransaction {
    return this.switchTransactions.cancel(transactionId);
  }

  listSwitchTransactions(limit = 30): SwitchTransaction[] {
    return this.switchTransactions.list(limit);
  }

  reconcileInterruptedSwitches(): SwitchTransaction[] {
    return this.switchTransactions.reconcileInterrupted();
  }

  async recoverInterruptedSwitches(): Promise<SwitchTransaction[]> {
    const recovered: SwitchTransaction[] = [];
    const interrupted = this.switchTransactions.list(100).filter((transaction) =>
      transaction.status === "pending"
      || transaction.status === "running"
      || transaction.status === "rolling_back"
    );
    for (const transaction of interrupted) {
      const preWrite = [
        "preparing",
        "validating_previous",
        "validating_target",
        "ready",
        "quiescing"
      ].includes(transaction.phase);
      if (preWrite) {
        recovered.push(this.switchTransactions.cancel(transaction.id));
        continue;
      }
      if (transaction.platform !== "codex") {
        recovered.push(this.switchTransactions.advanceById(transaction.id, "recovery_required", {
          errorCode: "INTERRUPTED_PROVIDER_RECOVERY",
          errorMessage: "Interrupted provider activation requires explicit recovery."
        }));
        continue;
      }

      const activeAuthPath = getAuthJsonPath(this.getGlobalCodexHome());
      let activeFingerprint: string | null = null;
      try {
        if (fs.existsSync(activeAuthPath)) {
          activeFingerprint = inspectCodexAuthJson(readStableAuthJson(activeAuthPath)).authFingerprint;
        }
      } catch {
        activeFingerprint = null;
      }
      try {
        const backupPath = path.join(
          this.getGlobalCodexHome(),
          ".codex-account-manager",
          "transactions",
          transaction.id
        );
        const manifestExists = fs.existsSync(path.join(backupPath, "manifest.json"));
        if (
          transaction.previousFingerprint
          && activeFingerprint === transaction.previousFingerprint
        ) {
          const previous = transaction.previousAccountId
            ? this.store.get(transaction.previousAccountId)
            : null;
          if (previous) await this.verifyActiveCodexAccount(previous);
          if (manifestExists) this.createDurableAuthBundleService().cleanupTransientFiles(backupPath);
          recovered.push(this.finishRecoveredRollback(transaction, previous?.id ?? null));
          continue;
        }

        if (
          transaction.status !== "rolling_back"
          && transaction.targetFingerprint
          && activeFingerprint === transaction.targetFingerprint
          && manifestExists
          && this.createDurableAuthBundleService().verifyTargetFiles(backupPath)
        ) {
          let current = this.switchTransactions.get(transaction.id) ?? transaction;
          if (current.phase === "activating") {
            current = this.switchTransactions.advanceById(current.id, "launching", { backupPath });
          }
          const diagnostics = await this.desktopLifecycle?.getDiagnostics?.();
          if (this.desktopLifecycle && diagnostics?.selected) {
            await this.desktopLifecycle.launchAndWaitReady(diagnostics.selected);
          }
          current = this.switchTransactions.get(transaction.id) ?? current;
          if (current.phase === "launching") {
            current = this.switchTransactions.advanceById(current.id, "verifying", { backupPath });
          }
          const target = this.store.get(transaction.targetAccountId);
          if (!target) throw new Error("Interrupted switch target account no longer exists");
          await this.verifyActiveCodexAccount(target);
          const finalized = this.switchTransactions.finalizeWithActiveAccount(
            current.id,
            "committed",
            target.id,
            { backupPath }
          );
          this.createDurableAuthBundleService().cleanupTransientFiles(backupPath);
          recovered.push(finalized.transaction);
          continue;
        }

        if (manifestExists) {
          const switchService = this.createCodexSwitchService();
          let current = this.switchTransactions.get(transaction.id) ?? transaction;
          if (current.phase !== "rolling_back") {
            current = this.switchTransactions.advanceById(current.id, "rolling_back", {
              backupPath,
              errorCode: "STARTUP_ROLLBACK",
              errorMessage: "Startup recovery selected the previous verified auth bundle."
            });
          }
          const previous = transaction.previousAccountId
            ? this.store.get(transaction.previousAccountId)
            : null;
          const diagnostics = await this.desktopLifecycle?.getDiagnostics?.();
          let desktopIdentity = diagnostics?.selected ?? null;
          if (this.desktopLifecycle) {
            const quiesced = await this.desktopLifecycle.quiesce("exact-tree-fallback");
            if (!["not-running", "quiesced"].includes(quiesced.status)) {
              throw new Error(`Startup recovery could not quiesce the target desktop: ${quiesced.message}`);
            }
            desktopIdentity = quiesced.identity ?? desktopIdentity;
          }
          await switchService.rollback(backupPath);
          if (this.desktopLifecycle && desktopIdentity) {
            await this.desktopLifecycle.launchAndWaitReady(desktopIdentity);
          }
          if (previous) await this.verifyActiveCodexAccount(previous);
          recovered.push(previous
            ? this.switchTransactions.finalizeWithActiveAccount(
              current.id,
              "rolled_back",
              previous.id,
              {
                backupPath,
                errorCode: "STARTUP_ROLLBACK",
                errorMessage: "Startup recovery restored and verified the previous auth bundle."
              }
            ).transaction
            : this.switchTransactions.advanceById(current.id, "rolled_back", {
              backupPath,
              errorCode: "STARTUP_ROLLBACK",
              errorMessage: "Startup recovery restored and verified the previous auth bundle."
            }));
          continue;
        }

        recovered.push(this.switchTransactions.advanceById(transaction.id, "recovery_required", {
          errorCode: "INTERRUPTED_STATE_AMBIGUOUS",
          errorMessage: "Active auth does not match the recorded previous or target fingerprint."
        }));
      } catch (error) {
        const current = this.switchTransactions.get(transaction.id) ?? transaction;
        if (["committed", "rolled_back", "recovery_required"].includes(current.status)) {
          recovered.push(current);
          continue;
        }
        recovered.push(this.switchTransactions.advanceById(current.id, "recovery_required", {
          errorCode: "STARTUP_RECOVERY_FAILED",
          errorMessage: error instanceof Error ? error.message : String(error)
        }));
      }
    }
    return recovered;
  }

  private finishRecoveredRollback(
    transaction: SwitchTransaction,
    previousAccountId: string | null
  ): SwitchTransaction {
    let current = this.switchTransactions.get(transaction.id) ?? transaction;
    if (current.phase !== "rolling_back") {
      current = this.switchTransactions.advanceById(current.id, "rolling_back", {
        errorCode: "INTERRUPTED_PREVIOUS_VERIFIED",
        errorMessage: "Startup recovery verified that the previous auth bundle is still active."
      });
    }
    const details = {
      errorCode: "INTERRUPTED_PREVIOUS_VERIFIED",
      errorMessage: "Startup recovery verified that the previous auth bundle is still active."
    };
    return previousAccountId
      ? this.switchTransactions.finalizeWithActiveAccount(
        current.id,
        "rolled_back",
        previousAccountId,
        details
      ).transaction
      : this.switchTransactions.advanceById(current.id, "rolled_back", details);
  }

  private createCodexSwitchService(): SwitchService {
    return new SwitchService({
      codexHome: this.getGlobalCodexHome(),
      sealBackup: (contents) => this.vault.encryptUtf8(contents),
      unsealBackup: (ciphertext) => this.vault.decryptUtf8(ciphertext),
      durableAdapter: this.dependencies.durableAuthBundleAdapter,
      renameRetryDelaysMs: this.dependencies.durableAuthRenameRetryDelaysMs,
      stableCheckCount: this.dependencies.durableAuthStableCheckCount,
      stableCheckIntervalMs: this.dependencies.durableAuthStableCheckIntervalMs,
      sleep: this.dependencies.durableAuthSleep,
      afterWrite: async () => undefined,
      recordEvent: async (event) => this.store.recordSwitchEvent(event)
    });
  }

  private createDurableAuthBundleService(): DurableAuthBundleService {
    return new DurableAuthBundleService({
      codexHome: this.getGlobalCodexHome(),
      sealBackup: (contents) => this.vault.encryptUtf8(contents),
      unsealBackup: (ciphertext) => this.vault.decryptUtf8(ciphertext),
      adapter: this.dependencies.durableAuthBundleAdapter,
      renameRetryDelaysMs: this.dependencies.durableAuthRenameRetryDelaysMs,
      stableCheckCount: this.dependencies.durableAuthStableCheckCount,
      stableCheckIntervalMs: this.dependencies.durableAuthStableCheckIntervalMs,
      sleep: this.dependencies.durableAuthSleep
    });
  }

  async switchAccount(accountId: string, transactionId?: string): Promise<ManagedAccount> {
    const account = this.store.get(accountId);
    if (!account) throw new Error("Account not found");
    const current = this.switchInFlight.get(account.platform);
    if (current) {
      if (current.accountId === accountId) return current.promise;
      if (transactionId) {
        this.failSwitchTransactionIfActive(
          transactionId,
          "SWITCH_CONFLICT",
          `Another ${account.platform} account switch is already running for ${current.accountId}`
        );
      }
      throw new Error(`Another ${account.platform} account switch is already running for ${current.accountId}`);
    }
    let activeTransactionId = transactionId;
    const execute = async () => {
      const prepared = transactionId
        ? this.switchTransactions.get(transactionId)
        : (await this.prepareSwitchAccount(accountId)).transaction;
      if (!prepared) throw new Error("Prepared switch transaction not found");
      activeTransactionId = prepared.id;
      if (account.platform === "codex" && this.hasPendingReauthentication(account.id)) {
        throw new Error("The target Codex profile is still being reauthenticated. Finish the current sign-in before switching.");
      }
      this.switchTransactions.begin(prepared.id, accountId);
      return this.performSwitchAccount(accountId, prepared.id);
    };
    const promise = this.operationLock.runExclusive(`provider:${account.platform}`, () =>
      account.platform === "codex"
        ? this.crossProcessSwitchLock.runExclusive(`switch:${accountId}`, execute)
        : execute()
    ).catch((error) => {
      if (activeTransactionId) {
        this.failSwitchTransactionIfActive(
          activeTransactionId,
          "SWITCH_FAILED",
          error instanceof Error ? error.message : String(error)
        );
      }
      throw error;
    }).finally(() => {
      if (this.switchInFlight.get(account.platform)?.promise === promise) this.switchInFlight.delete(account.platform);
    });
    this.switchInFlight.set(account.platform, { accountId, promise });
    return promise;
  }

  private async performSwitchAccount(accountId: string, transactionId: string): Promise<ManagedAccount> {
    const account = this.store.get(accountId);
    if (!account) throw new Error("Account not found");
    if (account.platform === "antigravity") {
      const eventId = crypto.randomUUID();
      const startedAt = Math.floor(Date.now() / 1000);
      const previousAccountId = this.store.list().find((item) => item.platform === "antigravity" && item.isActive)?.id ?? null;
      this.store.recordSwitchEvent({
        id: eventId,
        accountId,
        previousAccountId,
        startedAt,
        completedAt: null,
        status: "running",
        error: null,
        backupPath: null
      });
      try {
        this.switchTransactions.advanceById(transactionId, "activating");
        const record = this.readAntigravityVaultRecord(account);
        const pathInput = this.getAntigravityPathInputForAccount(account);
        const profileStatus = getAntigravityProfileStatus(pathInput);
        const applyResult = record.credentials
          ? profileStatus.readyForWriteActions
            ? applyAntigravityAccountWritePlan({
              ...pathInput,
              backupRoot: path.join(this.appDataDir, "antigravity-backups"),
              credentials: record.credentials
            })
            : null
          : record.googleOAuth
            ? this.writeAntigravityGoogleIdeProfile(record.googleOAuth, account)
            : null;
        const credentialStoreResult = record.googleOAuth
          ? this.writeAntigravityGoogleCredentialStore(record.googleOAuth, account)
          : record.credentials
            ? this.writeAntigravityCredentialPackageStore(record.credentials, account)
          : null;
        const restartResult = credentialStoreResult?.applied
          ? this.restartAntigravityRuntime(account)
          : null;
        this.switchTransactions.advanceById(transactionId, "launching", {
          backupPath: applyResult?.backupDir ?? null
        });
        this.switchTransactions.advanceById(transactionId, "verifying");
        const saved = this.switchTransactions.finalizeWithActiveAccount(
          transactionId,
          "committed",
          accountId,
          { backupPath: applyResult?.backupDir ?? null }
        ).account;
        this.store.recordSwitchEvent({
          id: eventId,
          accountId,
          previousAccountId,
          startedAt,
          completedAt: Math.floor(Date.now() / 1000),
          status: "completed",
          error: null,
          backupPath: applyResult?.backupDir ?? null
        });
        if (applyResult) {
          this.emitLog(
            `Antigravity profile switched: ${applyResult.summary.email}. StateKeys=${applyResult.summary.stateKeys.length} StorageKeys=${applyResult.summary.storageKeys.length} Backup=${applyResult.backupId}`
          );
        } else if (record.googleOAuth) {
          this.emitLog(
            credentialStoreResult?.applied
              ? `Antigravity Google OAuth account selected: ${record.googleOAuth.email}. OS credential store updated for Antigravity. Restart=${restartResult?.restarted ? "ok" : "skipped"}`
              : `Antigravity Google OAuth account selected: ${record.googleOAuth.email}. OS credential store was not updated.`
          );
          if (restartResult && !restartResult.restarted) {
            this.emitLog(`Antigravity restart after switch was not completed: ${restartResult.reason}`);
          }
        } else {
          this.emitLog(`Antigravity local profile selected: ${record.localProfile?.email ?? record.localProfile?.label ?? account.label}. Official session remains managed by Antigravity.`);
        }
        return saved;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.recordSwitchEvent({
          id: eventId,
          accountId,
          previousAccountId,
          startedAt,
          completedAt: Math.floor(Date.now() / 1000),
          status: "failed",
          error: message,
          backupPath: null
        });
        throw error;
      }
    }
    this.assertCompatibleCodexCredentialStore();
    const previousManagedAccount = await this.reconcileActiveCodexAuth();
    const targetAccount = this.store.get(accountId);
    if (!targetAccount) throw new Error("Account not found after active session reconciliation");
    if (targetAccount.credentialState !== "ready") {
      throw new Error(`Target Codex profile is ${targetAccount.credentialState}. Review or reauthenticate it before switching.`);
    }
    const authJson = this.readAccountAuthJson(targetAccount);
    const activeAuthPath = getAuthJsonPath(this.getGlobalCodexHome());
    const previousAuthJson = fs.existsSync(activeAuthPath) ? readStableAuthJson(activeAuthPath) : null;
    const quiesceResult = this.desktopLifecycle
      ? await this.desktopLifecycle.quiesce(
        this.dependencies.getDesktopClosePolicy?.() ?? "graceful-only"
      )
      : null;
    if (quiesceResult && (quiesceResult.status === "blocked" || quiesceResult.status === "ambiguous")) {
      throw new Error(`Codex desktop could not be safely closed before activation: ${quiesceResult.message}`);
    }
    if (quiesceResult) {
      this.emitLog(
        `Codex desktop quiesce: status=${quiesceResult.status}, captured=${quiesceResult.capturedProcessCount}, remaining=${quiesceResult.remainingProcessCount}.`
      );
    }
    const switchService = new SwitchService({
      codexHome: this.getGlobalCodexHome(),
      sealBackup: (contents) => this.vault.encryptUtf8(contents),
      unsealBackup: (ciphertext) => this.vault.decryptUtf8(ciphertext),
      durableAdapter: this.dependencies.durableAuthBundleAdapter,
      renameRetryDelaysMs: this.dependencies.durableAuthRenameRetryDelaysMs,
      stableCheckCount: this.dependencies.durableAuthStableCheckCount,
      stableCheckIntervalMs: this.dependencies.durableAuthStableCheckIntervalMs,
      sleep: this.dependencies.durableAuthSleep,
      afterWrite: async () => {
        this.emitLog(`Codex auth bundle updated and verified: ${activeAuthPath}.`);
      },
      recordEvent: async (event) => {
        this.store.recordSwitchEvent(event);
      }
    });

    this.switchTransactions.advanceById(transactionId, "activating");
    let switchResult;
    try {
      switchResult = await switchService.switchTo({
        transactionId,
        accountId,
        previousAccountId: previousManagedAccount?.id ?? null,
        expectedAuthAccountId: getAuthAccountId(authJson),
        authJson,
        compatibilityFiles: buildCodexCompatibilityFiles(
          this.getGlobalCodexHome(),
          authJson,
          previousAuthJson
        )
      });
    } catch (error) {
      if (error instanceof DurableAuthActivationError && error.rollbackVerified) {
        this.switchTransactions.advanceById(transactionId, "rolling_back", {
          backupPath: error.backupPath,
          errorCode: "ACTIVATION_ROLLED_BACK",
          errorMessage: error.message
        });
        this.switchTransactions.advanceById(transactionId, "rolled_back", {
          backupPath: error.backupPath,
          errorCode: "ACTIVATION_ROLLED_BACK",
          errorMessage: error.message
        });
      } else if (error instanceof DurableAuthActivationError) {
        this.switchTransactions.advanceById(transactionId, "recovery_required", {
          backupPath: error.backupPath,
          errorCode: "ACTIVATION_RECOVERY_REQUIRED",
          errorMessage: error.message
        });
      }
      throw error;
    }

    this.switchTransactions.advanceById(transactionId, "launching", {
      backupPath: switchResult.backupPath
    });
    try {
      if (this.desktopLifecycle && quiesceResult?.identity) {
        const readiness = await this.desktopLifecycle.launchAndWaitReady(quiesceResult.identity);
        this.emitLog(
          `Launched exact desktop package ${readiness.identity.packageFullName}; visible root PID=${readiness.rootPid}.`
        );
      } else if (this.desktopLifecycle && process.platform === "win32") {
        throw new Error("The exact installed Codex desktop package could not be identified for relaunch.");
      } else if (process.platform !== "win32") {
        this.emitLog("Codex auth bundle activated. Desktop lifecycle verification is Windows-only.");
      }
      this.switchTransactions.advanceById(transactionId, "verifying");
      await this.verifyActiveCodexAccount(targetAccount);
      const saved = this.switchTransactions.finalizeWithActiveAccount(
        transactionId,
        "committed",
        accountId,
        { backupPath: switchResult.backupPath }
      ).account;
      this.emitLog(`Codex switch committed after desktop readiness and official identity verification: ${accountId}.`);
      return saved;
    } catch (error) {
      await this.rollbackFailedCodexRelaunch({
        transactionId,
        switchService,
        switchResult,
        desktopIdentity: quiesceResult?.identity ?? null,
        previousManagedAccount,
        error
      });
      throw error;
    }
  }

  private async rollbackFailedCodexRelaunch(input: {
    transactionId: string;
    switchService: SwitchService;
    switchResult: Awaited<ReturnType<SwitchService["switchTo"]>>;
    desktopIdentity: NonNullable<Awaited<ReturnType<WindowsDesktopLifecycleService["quiesce"]>>["identity"]> | null;
    previousManagedAccount: ManagedAccount | null;
    error: unknown;
  }): Promise<void> {
    const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
    this.switchTransactions.advanceById(input.transactionId, "rolling_back", {
      backupPath: input.switchResult.backupPath,
      errorCode: "POST_ACTIVATION_VERIFICATION_FAILED",
      errorMessage
    });
    try {
      if (this.desktopLifecycle && input.desktopIdentity) {
        const quiesced = await this.desktopLifecycle.quiesce("exact-tree-fallback");
        if (quiesced.status === "blocked" || quiesced.status === "ambiguous") {
          throw new Error(`Could not quiesce the failed target desktop during rollback: ${quiesced.message}`);
        }
      }
      await input.switchService.rollback(input.switchResult.backupPath);
      if (this.desktopLifecycle && input.desktopIdentity) {
        await this.desktopLifecycle.launchAndWaitReady(input.desktopIdentity);
      }
      if (input.previousManagedAccount) {
        await this.verifyActiveCodexAccount(input.previousManagedAccount);
      }
      const event = this.store.getSwitchEvent(input.switchResult.eventId);
      if (event) {
        this.store.recordSwitchEvent({
          ...event,
          completedAt: Math.floor(Date.now() / 1000),
          status: "rolled_back",
          error: errorMessage,
          backupPath: input.switchResult.backupPath
        });
      }
      if (input.previousManagedAccount) {
        this.switchTransactions.finalizeWithActiveAccount(
          input.transactionId,
          "rolled_back",
          input.previousManagedAccount.id,
          {
            backupPath: input.switchResult.backupPath,
            errorCode: "POST_ACTIVATION_VERIFICATION_FAILED",
            errorMessage
          }
        );
      } else {
        this.switchTransactions.advanceById(input.transactionId, "rolled_back", {
          backupPath: input.switchResult.backupPath,
          errorCode: "POST_ACTIVATION_VERIFICATION_FAILED",
          errorMessage
        });
      }
      this.emitLog(`Codex switch rolled back and the previous account was verified: ${input.previousManagedAccount?.id ?? "unmanaged"}.`);
    } catch (rollbackError) {
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      this.switchTransactions.advanceById(input.transactionId, "recovery_required", {
        backupPath: input.switchResult.backupPath,
        errorCode: "ROLLBACK_VERIFICATION_FAILED",
        errorMessage: `${errorMessage}; rollback: ${rollbackMessage}`
      });
      throw new Error(`Codex switch failed and automatic rollback requires recovery: ${rollbackMessage}`, {
        cause: rollbackError
      });
    }
  }

  private async verifyActiveCodexAccount(account: ManagedAccount): Promise<void> {
    const activeAuthPath = getAuthJsonPath(this.getGlobalCodexHome());
    if (!fs.existsSync(activeAuthPath)) throw new Error("Codex identity verification found no active auth.json");
    const activeAuthJson = readStableAuthJson(activeAuthPath);
    const metadata = inspectCodexAuthJson(activeAuthJson);
    if (account.authMode === "apiKey" && account.authFingerprint && metadata.authFingerprint !== account.authFingerprint) {
      throw new Error("Codex identity verification found a different API-key fingerprint");
    }
    // A fingerprint change is expected when Codex rotates a token. Strong
    // provider/workspace identity plus the official app-server identity below
    // decide whether the session still belongs to this account.
    if (
      account.providerAccountId
      && account.providerAccountId !== metadata.providerAccountId
    ) {
      throw new Error("Codex identity verification found a different provider account");
    }
    if (
      account.workspaceAccountId
      && account.workspaceAccountId !== metadata.workspaceAccountId
    ) {
      throw new Error("Codex identity verification found a different workspace account");
    }

    const client = new CodexRpcClient(this.getGlobalCodexHome(), this.requireCodexPath());
    try {
      const response = await client.readAccount(false);
      const identity = getAccountIdentity(response.account, account.authMode ?? "chatgpt");
      if (!matchesCodexAccountIdentity(identity, account)) {
        throw new Error("Codex app-server reported a different authenticated account");
      }
      this.syncActiveGlobalAuthToVault(account);
      if (account.authMode === "chatgpt") {
        try {
          const snapshot = withCodexPlan(selectBestRateLimit(await client.readRateLimits()), identity.planType);
          const classified = classifyRateLimit(snapshot);
          this.store.insertRateLimitSnapshot({
            id: crypto.randomUUID(),
            accountId: account.id,
            capturedAt: Math.floor(Date.now() / 1000),
            status: classified.status,
            statusReason: classified.reason,
            limits: snapshot
          });
          this.store.setRateLimits(account.id, snapshot, classified.status, classified.reason);
        } catch (error) {
          const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
          this.store.insertRateLimitSnapshot({
            id: crypto.randomUUID(),
            accountId: account.id,
            capturedAt: Math.floor(Date.now() / 1000),
            status: "error",
            statusReason: `Identity verified; quota probe failed: ${message}`,
            limits: {
              limitId: null,
              limitName: null,
              primary: null,
              secondary: null,
              credits: null,
              planType: account.planType,
              rateLimitReachedType: null
            }
          });
          this.emitLog(`Codex identity verified, but the non-fatal quota probe failed for ${account.id}: ${message}`);
        }
      }
    } finally {
      await client.stop();
    }
  }

  private async reconcileActiveCodexAuth(): Promise<ManagedAccount | null> {
    const recordedActive = this.store.list().find(
      (account) => account.platform === "codex" && account.isActive
    ) ?? null;
    const globalCodexHome = this.getGlobalCodexHome();
    const globalAuthPath = getAuthJsonPath(globalCodexHome);
    if (!fs.existsSync(globalAuthPath)) {
      if (recordedActive) {
        this.store.clearActive("codex");
        this.emitLog(`Cleared stale active Codex marker ${recordedActive.id}: the global session is signed out.`);
      }
      return null;
    }

    const currentAuthJson = readStableAuthJson(globalAuthPath);
    const metadata = inspectCodexAuthJson(currentAuthJson);
    const accounts = this.store.list().filter((account) => account.platform === "codex");
    const exactFingerprintMatches = accounts.filter(
      (account) => account.authFingerprint === metadata.authFingerprint
    );
    const providerMatches = metadata.providerAccountId
      ? accounts.filter((account) =>
        account.providerAccountId === metadata.providerAccountId
        && account.workspaceAccountId === metadata.workspaceAccountId
      )
      : [];

    let accountResponse: Awaited<ReturnType<CodexRpcClient["readAccount"]>> | null = null;
    const client = new CodexRpcClient(globalCodexHome, this.requireCodexPath());
    try {
      accountResponse = await client.readAccount(false);
    } catch (error) {
      this.emitLog(`Official current-session identity probe was unavailable during reconciliation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await client.stop();
    }

    let matched = exactFingerprintMatches.length === 1
      ? exactFingerprintMatches[0]
      : providerMatches.length === 1
        ? providerMatches[0]
        : null;
    if (!matched && accountResponse?.account) {
      const current = accountResponse.account as { type?: string; email?: string } | null;
      if (current?.type === "chatgpt" && current.email) {
        const emailMatches = accounts.filter(
          (account) =>
            account.authMode !== "apiKey"
            && account.email.trim().toLowerCase() === current.email!.trim().toLowerCase()
        );
        if (emailMatches.length === 1) matched = emailMatches[0];
      } else if (current?.type === "apiKey" && recordedActive?.authMode === "apiKey") {
        matched = recordedActive;
      }
    }

    if (!matched) {
      if (recordedActive) this.store.clearActive("codex");
      this.emitLog("The current Codex authorization is not a managed profile; it will be preserved only as the switch rollback bundle.");
      return null;
    }

    if (accountResponse?.account) {
      const identity = getAccountIdentity(accountResponse.account, matched.authMode ?? "chatgpt");
      const stableProviderMatch = Boolean(
        metadata.providerAccountId
        && matched.providerAccountId === metadata.providerAccountId
        && matched.workspaceAccountId === metadata.workspaceAccountId
      );
      if (!stableProviderMatch && !matchesCodexAccountIdentity(identity, matched)) {
        throw new Error("The current Codex identity does not match the managed profile metadata");
      }
    }

    if (recordedActive && recordedActive.id !== matched.id) {
      const misplacedCandidate = this.store.getAuthDriftCandidate(recordedActive.id);
      if (misplacedCandidate?.fingerprint === metadata.authFingerprint) {
        this.store.clearAuthDriftCandidate(recordedActive.id);
      }
    }

    const saved = this.store.updateCodexAuthMaterial(matched.id, {
      encryptedAuthJson: this.vault.encryptUtf8(currentAuthJson),
      authFingerprint: metadata.authFingerprint,
      providerAccountId: metadata.providerAccountId,
      workspaceAccountId: metadata.workspaceAccountId,
      workspaceLabel: metadata.workspaceLabel,
      expiresAt: metadata.expiresAt,
      credentialState: "ready",
      lastAuthenticatedAt: Math.floor(Date.now() / 1000),
      authMode: matched.authMode ?? metadata.inferredAuthMode
    });
    const active = this.store.setActive(saved.id);
    if (recordedActive?.id !== active.id) {
      this.emitLog(`Reconciled the active Codex marker from ${recordedActive?.id ?? "none"} to ${active.id}.`);
    } else if (metadata.authFingerprint !== matched.authFingerprint) {
      this.emitLog(`Backfilled rotated credentials for the active Codex profile ${active.id} before switching.`);
    }
    return active;
  }

  getWorkspacePath(): string {
    return this.store.getSetting("workspacePath") ?? getDefaultWorkspacePath();
  }

  setWorkspacePath(workspacePath: string): void {
    this.store.setSetting("workspacePath", workspacePath);
  }

  getWorkspaceBinding(): WorkspaceBinding {
    const workspacePath = this.getWorkspacePath();
    const raw = this.store.getSetting("workspaceBindings");
    const bindings = raw ? (JSON.parse(raw) as Record<string, string | null>) : {};
    const accountId = bindings[workspacePath] ?? null;
    const account = accountId ? this.store.get(accountId) : null;
    return {
      workspacePath,
      accountId: account?.id ?? null,
      accountLabel: account?.label ?? null,
      accountEmail: account?.email ?? null
    };
  }

  bindWorkspaceAccount(accountId: string | null): WorkspaceBinding {
    const workspacePath = this.getWorkspacePath();
    if (accountId && !this.store.get(accountId)) throw new Error("Account not found");
    const raw = this.store.getSetting("workspaceBindings");
    const bindings = raw ? (JSON.parse(raw) as Record<string, string | null>) : {};
    if (accountId) bindings[workspacePath] = accountId;
    else delete bindings[workspacePath];
    this.store.setSetting("workspaceBindings", JSON.stringify(bindings));
    return this.getWorkspaceBinding();
  }

  getSwitchHistory(limit = 8): SwitchHistoryItem[] {
    return this.store.listSwitchEvents(limit);
  }

  getLimitHistory(accountId: string): LimitHistoryPoint[] {
    if (!this.store.get(accountId)) throw new Error("Account not found");
    return this.store.listRateLimitHistory(accountId);
  }

  getProfileIntegrity(): ProfileIntegrityReport {
    const items = this.store.listForExport().map((account) => {
      const profileExists = fs.existsSync(account.profileDir);
      const authPath = getAuthFilePath(account.profileDir);
      const authExists = fs.existsSync(authPath);
      let cacheOk = true;
      try {
        this.vault.decryptUtf8(account.encryptedAuthJson);
      } catch {
        cacheOk = false;
      }

      if (account.platform === "codex") {
        if (!cacheOk) {
          return {
            accountId: account.id,
            label: account.label,
            email: account.email,
            status: "error" as const,
            message: "Шифрованное хранилище профиля недоступно."
          };
        }
        if (account.credentialState === "drifted") {
          return {
            accountId: account.id,
            label: account.label,
            email: account.email,
            status: "error" as const,
            message: "Обнаружено внешнее изменение авторизации; требуется проверка или повторный вход."
          };
        }
        if (authExists) {
          return {
            accountId: account.id,
            label: account.label,
            email: account.email,
            status: "warning" as const,
            message: "В managed-профиле остался plaintext auth.json; он будет запечатан при следующей проверке."
          };
        }
        return {
          accountId: account.id,
          label: account.label,
          email: account.email,
          status: profileExists ? "ok" as const : "warning" as const,
          message: profileExists
            ? "Профиль запечатан: авторизация хранится только в зашифрованном vault."
            : "Зашифрованный vault доступен; папка профиля будет создана по требованию."
        };
      }

      if (profileExists && authExists && cacheOk) {
        return {
          accountId: account.id,
          label: account.label,
          email: account.email,
          authMode: account.authMode,
          providerAccountId: account.providerAccountId,
          workspaceAccountId: account.workspaceAccountId,
          workspaceLabel: account.workspaceLabel,
          authFingerprint: account.authFingerprint,
          credentialState: account.credentialState,
          lastAuthenticatedAt: account.lastAuthenticatedAt,
          expiresAt: account.expiresAt,
          accountVersion: account.version,
          status: "ok" as const,
          message: "Профиль, auth.json и шифрованный кэш доступны."
        };
      }

      if (profileExists && cacheOk) {
        return {
          accountId: account.id,
          label: account.label,
          email: account.email,
          status: "warning" as const,
          message: "Шифрованный кэш доступен, но локальный auth.json профиля отсутствует."
        };
      }

      return {
        accountId: account.id,
        label: account.label,
        email: account.email,
        status: "error" as const,
        message: !profileExists ? "Папка профиля отсутствует." : "Шифрованный кэш недоступен."
      };
    });

    return {
      generatedAt: Math.floor(Date.now() / 1000),
      total: items.length,
      ok: items.filter((item) => item.status === "ok").length,
      warnings: items.filter((item) => item.status === "warning").length,
      errors: items.filter((item) => item.status === "error").length,
      items
    };
  }

  async rollbackSwitch(eventId: string): Promise<SwitchHistoryItem[]> {
    const event = this.store.getSwitchEvent(eventId);
    if (!event) throw new Error("Switch event not found");
    if (!event.backupPath) throw new Error("Switch event does not have a backup file");
    if (!fs.existsSync(event.backupPath)) throw new Error("Switch backup file is missing");
    if (fs.statSync(event.backupPath).isDirectory()) {
      const durableManifestPath = path.join(event.backupPath, "manifest.json");
      let isDurableCodexManifest = false;
      try {
        const candidate = JSON.parse(fs.readFileSync(durableManifestPath, "utf8")) as { format?: unknown };
        isDurableCodexManifest = candidate.format === "one.egoist.codex-account-manager.auth-activation";
      } catch {
        isDurableCodexManifest = false;
      }
      if (isDurableCodexManifest) {
        const switchService = new SwitchService({
          codexHome: this.getGlobalCodexHome(),
          sealBackup: (contents) => this.vault.encryptUtf8(contents),
          unsealBackup: (ciphertext) => this.vault.decryptUtf8(ciphertext),
          afterWrite: async () => undefined,
          recordEvent: async () => undefined
        });
        await switchService.rollback(event.backupPath);
        const restoredAccountId = event.previousAccountId;
        if (restoredAccountId && this.store.get(restoredAccountId)?.platform === "codex") {
          this.store.setActive(restoredAccountId);
        }
        this.store.recordSwitchEvent({
          id: crypto.randomUUID(),
          accountId: restoredAccountId ?? event.accountId,
          previousAccountId: event.accountId,
          startedAt: Math.floor(Date.now() / 1000),
          completedAt: Math.floor(Date.now() / 1000),
          status: "rolled_back",
          error: null,
          backupPath: event.backupPath
        });
        this.emitLog(`Rolled back the durable Codex auth bundle from ${event.backupPath}.`);
        return this.getSwitchHistory();
      }
      restoreAntigravityBackupDir(event.backupPath);
      if (event.previousAccountId && this.store.get(event.previousAccountId)?.platform === "antigravity") {
        this.store.setActive(event.previousAccountId);
      }
      this.store.recordSwitchEvent({
        id: crypto.randomUUID(),
        accountId: event.previousAccountId ?? event.accountId,
        previousAccountId: event.accountId,
        startedAt: Math.floor(Date.now() / 1000),
        completedAt: Math.floor(Date.now() / 1000),
        status: "rolled_back",
        error: null,
        backupPath: event.backupPath
      });
      this.emitLog(`Rolled back Antigravity profile from ${event.backupPath}.`);
      return this.getSwitchHistory();
    }

    const authPath = getAuthJsonPath(this.getGlobalCodexHome());
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    const currentAuthJson = fs.existsSync(authPath) ? readStableAuthJson(authPath) : null;
    backupFile(authPath);
    fs.copyFileSync(event.backupPath, authPath);
    const restoredAuthJson = readStableAuthJson(authPath);
    const syncedFiles = syncCodexGlobalState(this.getGlobalCodexHome(), restoredAuthJson, currentAuthJson);
    const restoredAccountId = getAuthAccountId(restoredAuthJson) ?? event.previousAccountId;
    if (restoredAccountId && this.store.get(restoredAccountId)?.platform === "codex") {
      this.store.setActive(restoredAccountId);
    }
    this.store.recordSwitchEvent({
      id: crypto.randomUUID(),
      accountId: restoredAccountId ?? event.previousAccountId ?? event.accountId,
      previousAccountId: event.accountId,
      startedAt: Math.floor(Date.now() / 1000),
      completedAt: Math.floor(Date.now() / 1000),
      status: "rolled_back",
      error: null,
      backupPath: event.backupPath
    });
    this.emitLog(`Rolled back Codex auth from ${event.backupPath}. Synced ${syncedFiles} global state file(s).`);
    return this.getSwitchHistory();
  }

  getSchemaVersion(): number {
    return this.store.getSchemaVersion();
  }

  async updateAccount(input: {
    id: string;
    label?: string;
    notes?: string | null;
    subscriptionEndsAt?: number | null;
    tags?: string[];
    favorite?: boolean;
    archived?: boolean;
  }): Promise<ManagedAccount> {
    return this.store.updateMeta(input.id, input);
  }

  async deleteAccount(accountId: string): Promise<void> {
    const account = this.store.get(accountId);
    if (account?.isActive) throw new Error("Active account must be switched before deletion");
    if (account?.profileDir && account.profileDir.startsWith(this.appDataDir) && fs.existsSync(account.profileDir)) {
      fs.rmSync(account.profileDir, { recursive: true, force: true });
    }
    this.store.delete(accountId);
  }

  async exportAccounts(filePath: string, passphrase: string): Promise<{ exportedCount: number; filePath: string }> {
    const records = this.store.listForExport();
    if (records.length === 0) throw new Error("There are no accounts to export");
    const payload: PortablePayload = {
      format: portableExportFormat,
      version: portableExportVersion,
      exportedAt: Math.floor(Date.now() / 1000),
      accounts: records.map((account) => {
        const base = {
          id: account.id,
          platform: account.platform,
          label: account.label,
          email: account.email,
          planType: account.planType,
          exportedWasActive: account.isActive,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          lastUsedAt: account.lastUsedAt,
          lastRefreshAt: account.lastRefreshAt,
          subscriptionEndsAt: account.subscriptionEndsAt,
          status: account.status,
          statusReason: account.statusReason,
          rateLimitJson: account.rateLimitJson,
          notes: account.notes
        };
        if (account.platform === "antigravity") {
          return {
            ...base,
            antigravityVaultJson: this.vault.decryptUtf8(account.encryptedAuthJson),
            antigravity: account.antigravity ? {
              googleProjectId: account.antigravity.googleProjectId,
              fingerprintId: account.antigravity.fingerprintId,
              ideStateDetected: account.antigravity.ideStateDetected
            } : null
          };
        }
        return {
          ...base,
          authJson: this.readAccountAuthJson(account)
        };
      })
    };
    const envelope = encryptPortablePayload(payload, passphrase);
    atomicWrite(filePath, `${JSON.stringify(envelope, null, 2)}\n`);
    return { exportedCount: records.length, filePath };
  }

  async importAccounts(filePath: string, passphrase: string): Promise<AccountImportResult> {
    const payload = decryptPortablePayload(fs.readFileSync(filePath, "utf8"), passphrase);
    const imported: ManagedAccount[] = [];
    for (const account of payload.accounts) {
      if (!account.id || !account.email) {
        throw new Error("Account export contains an invalid account entry");
      }
      if ((account.platform ?? "codex") === "antigravity") {
        if (!account.antigravityVaultJson) throw new Error("Antigravity export entry is missing credential payload");
        const vaultRecord = JSON.parse(account.antigravityVaultJson) as AntigravityVaultRecord;
        if (vaultRecord.format !== antigravityVaultFormat || vaultRecord.version !== antigravityVaultVersion) {
          throw new Error("Unsupported Antigravity credential payload");
        }
        const status = getAntigravityProfileStatus();
        const localProfile = vaultRecord.localProfile;
        const credentials = vaultRecord.credentials;
        imported.push(
          this.store.importPortable({
            id: account.id,
            platform: "antigravity",
            label: account.label || getDisplayLabel(account.email),
            email: account.email,
            planType: account.planType ?? "unknown",
            encryptedAuthJson: this.vault.encryptUtf8(account.antigravityVaultJson),
            isActive: false,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
            lastUsedAt: account.lastUsedAt,
            lastRefreshAt: account.lastRefreshAt,
            subscriptionEndsAt: account.subscriptionEndsAt,
            status: account.status ?? "unknown",
            statusReason: account.statusReason,
            rateLimitJson: account.rateLimitJson,
            notes: account.notes,
            authMode: null,
            providerAccountId: account.providerAccountId,
            workspaceAccountId: account.workspaceAccountId,
            workspaceLabel: account.workspaceLabel,
            authFingerprint: account.authFingerprint,
            credentialState: account.credentialState,
            lastAuthenticatedAt: account.lastAuthenticatedAt,
            expiresAt: account.expiresAt,
            version: account.accountVersion,
            profileDir: status.diagnostics.userDataDir,
            antigravity: {
              googleProjectId: account.antigravity?.googleProjectId ?? credentials?.googleProjectId ?? localProfile?.googleProjectId ?? null,
              fingerprintId: account.antigravity?.fingerprintId ?? vaultRecord.fingerprintId,
              lastQuotaRefreshAt: null,
              forbidden: false,
              ideStateDetected: status.detected
            }
          })
        );
        continue;
      }

      if (!account.authJson) throw new Error("Codex export entry is missing auth.json");
      JSON.parse(account.authJson);
      const profileDir = getProfileDir(this.appDataDir, account.id);
      const authPath = getAuthFilePath(profileDir);
      atomicWrite(authPath, account.authJson);
      imported.push(
        this.store.importPortable({
          id: account.id,
          label: account.label || getDisplayLabel(account.email),
          email: account.email,
          planType: account.planType ?? "unknown",
          encryptedAuthJson: this.vault.encryptUtf8(account.authJson),
          isActive: false,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          lastUsedAt: account.lastUsedAt,
          lastRefreshAt: account.lastRefreshAt,
          subscriptionEndsAt: account.subscriptionEndsAt,
          status: account.status ?? "unknown",
          statusReason: account.statusReason,
          rateLimitJson: account.rateLimitJson,
          notes: account.notes,
          authMode: account.authMode ?? "chatgpt",
          providerAccountId: account.providerAccountId,
          workspaceAccountId: account.workspaceAccountId,
          workspaceLabel: account.workspaceLabel,
          authFingerprint: account.authFingerprint ?? inspectCodexAuthJson(account.authJson).authFingerprint,
          credentialState: account.credentialState,
          lastAuthenticatedAt: account.lastAuthenticatedAt,
          expiresAt: account.expiresAt,
          version: account.accountVersion,
          profileDir
        })
      );
      this.codexProfileVault.removePlaintext(profileDir);
    }
    return { importedCount: imported.length, accounts: this.list() };
  }

  async importAntigravityFromIde(pathInput: AntigravityPathInput = {}): Promise<AntigravityImportResult> {
    const status = getAntigravityProfileStatus(pathInput);
    if (!status.detected) {
      return {
        imported: false,
        account: null,
        reason: "Локальный профиль Antigravity не найден. Сначала войди в официальном Antigravity IDE или CLI.",
        status,
        identity: null
      };
    }

    const officialAuth = readAntigravityOfficialAuthState(pathInput);
    if (officialAuth.oauth?.refreshToken) {
      try {
        const client = resolveAntigravityOAuthClient({});
        const refreshed = await refreshAntigravityGoogleAccessToken({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          refreshToken: officialAuth.oauth.refreshToken,
          requestTimeoutMs: 10_000
        });
        const user = await fetchAntigravityGoogleUserInfo({
          accessToken: refreshed.accessToken,
          requestTimeoutMs: 10_000
        });
        return this.importAntigravityGoogleOAuth({
          clientId: client.clientId,
          redirectUri: "local-antigravity-profile",
          accountContext: {
            googleProjectId: officialAuth.googleProjectId,
            tier: "unknown",
            tierId: null,
            source: officialAuth.googleProjectId ? "code_assist" : "unavailable",
            errorReason: officialAuth.googleProjectId ? null : "Imported from local Antigravity IDE state; Code Assist quota refresh is pending."
          },
          user,
          tokens: {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? officialAuth.oauth.refreshToken,
            expiresAt: refreshed.expiresAt,
            scope: refreshed.scope,
            tokenType: refreshed.tokenType ?? "Bearer"
          }
        }, pathInput);
      } catch (error) {
        this.emitLog(`Antigravity official local auth import failed; falling back to metadata-only import: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const credentialStoreReader = this.dependencies.readAntigravityCredentialStorePayload ?? readAntigravityCredentialStorePayload;
    const credentialStorePayload = canReadCurrentWindowsCredentialStore(pathInput)
      ? credentialStoreReader(pathInput.platform ?? process.platform)
      : null;
    if (credentialStorePayload) {
      const parsed = parseAntigravityCredentialPayload({
        payload: credentialStorePayload.payload,
        source: credentialStorePayload.strategy
      });
      if (parsed.length > 0) {
        const batch = await this.importParsedAntigravityCredentials(parsed, pathInput);
        const imported = batch.imported[0] ?? null;
        const account = imported ? this.store.get(imported.accountId) : null;
        if (account) {
          const nextStatus = getAntigravityProfileStatus(pathInput);
          return {
            imported: true,
            account,
            reason: "Antigravity account imported from the local OS Credential Manager. Limits are refreshed through Code Assist in the background.",
            status: nextStatus,
            identity: {
              email: account.email,
              accountId: account.id,
              label: account.label,
              fingerprintId: account.antigravity?.fingerprintId ?? account.id.slice(0, 12),
              googleProjectId: account.antigravity?.googleProjectId ?? null,
              source: "state_db",
              confidence: "confirmed"
            }
          };
        }
        this.emitLog(`Antigravity OS Credential Manager import did not attach an account: ${batch.failedCount} failure(s).`);
      }
    }

    const identity = extractAntigravityLocalIdentity(pathInput);
    const email = identity.email ?? `${identity.accountId}@local.antigravity`;
    const existing = this.store.getByPlatformEmail("antigravity", email);
    const now = Math.floor(Date.now() / 1000);
    const vaultRecord: AntigravityVaultRecord = {
      format: antigravityVaultFormat,
      version: antigravityVaultVersion,
      authMode: "local_profile",
      localProfile: {
        accountId: identity.accountId,
        email: identity.email,
        label: identity.label,
        profileDir: status.diagnostics.userDataDir,
        fingerprintId: identity.fingerprintId,
        googleProjectId: identity.googleProjectId,
        importedAt: now,
        source: identity.source,
        confidence: identity.confidence
      },
      fingerprintId: identity.fingerprintId,
      importedAt: now
    };

    const account = this.store.upsert({
      id: existing?.id ?? identity.accountId,
      platform: "antigravity",
      label: existing?.label ?? identity.label,
      email,
      planType: "unknown",
      profileDir: status.diagnostics.userDataDir,
      encryptedAuthJson: this.vault.encryptUtf8(JSON.stringify(vaultRecord)),
      rateLimits: null,
      antigravity: {
        googleProjectId: identity.googleProjectId,
        fingerprintId: identity.fingerprintId,
        lastQuotaRefreshAt: null,
        forbidden: false,
        ideStateDetected: status.detected
      },
      status: "unknown",
      statusReason: "Локальный профиль импортирован как metadata-only; Google OAuth/Code Assist не проверены."
    });

    this.emitLog(`Imported Antigravity local profile metadata: ${identity.email ?? identity.accountId}.`);
    return {
      imported: true,
      account,
      reason: identity.email
        ? "Локальный профиль Antigravity импортирован как metadata-only аккаунт. Секреты OS keyring не копировались."
        : "Локальный профиль Antigravity импортирован без email: секреты OS keyring не копировались, может потребоваться повторный вход.",
      status,
      identity
    };
  }

  async importAntigravityGoogleOAuth(
    input: AntigravityGoogleOAuthResult,
    pathInput: AntigravityPathInput = {}
  ): Promise<AntigravityImportResult> {
    const status = getAntigravityProfileStatus(pathInput);
    const now = Math.floor(Date.now() / 1000);
    const accountId = input.user.id ?? crypto.createHash("sha256").update(input.user.email).digest("hex").slice(0, 24);
    const dbId = antigravityAccountDbId(`google-oauth:${accountId}`);
    const existing = this.store.getByPlatformEmail("antigravity", input.user.email);
    const label = existing?.label ?? input.user.name ?? getDisplayLabel(input.user.email);
    const googleProjectId = input.accountContext.googleProjectId;
    const planType = antigravityPlanTypeFromContext(input.accountContext);
    const vaultRecord: AntigravityVaultRecord = {
      format: antigravityVaultFormat,
      version: antigravityVaultVersion,
      authMode: "google_oauth",
      googleOAuth: {
        accountId,
        email: input.user.email,
        label,
        accessToken: input.tokens.accessToken,
        refreshToken: input.tokens.refreshToken,
        expiresAt: input.tokens.expiresAt,
        scope: input.tokens.scope,
        tokenType: input.tokens.tokenType,
        oauthClientId: input.clientId,
        redirectUri: input.redirectUri,
        googleProjectId,
        tier: input.accountContext.tier,
        tierId: input.accountContext.tierId,
        importedAt: now,
        source: "google_oauth_browser"
      },
      fingerprintId: status.inspection.machineId.hashPrefix,
      importedAt: now
    };

    const account = this.store.upsert({
      id: existing?.id ?? dbId,
      platform: "antigravity",
      label,
      email: input.user.email,
      planType,
      profileDir: status.diagnostics.userDataDir,
      encryptedAuthJson: this.vault.encryptUtf8(JSON.stringify(vaultRecord)),
      rateLimits: null,
      antigravity: {
        googleProjectId,
        fingerprintId: status.inspection.machineId.hashPrefix,
        lastQuotaRefreshAt: null,
        forbidden: false,
        ideStateDetected: status.detected
      },
      status: "unknown",
      statusReason: "Google OAuth сохранён; лимиты Code Assist ещё проверяются."
    });

    let accountWithQuota = account;
    this.scheduleAntigravityGoogleCredentialStoreWrite(account.id, vaultRecord.googleOAuth!);
    try {
      const ideWrite = this.writeAntigravityGoogleIdeProfile(vaultRecord.googleOAuth!, account);
      if (ideWrite?.applied) {
        this.emitLog(`Antigravity IDE unified auth state updated for ${account.email}. Backup=${ideWrite.backupId}`);
      }
    } catch (error) {
      const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
      this.emitLog(`Antigravity IDE unified auth state update failed: ${message}`);
      accountWithQuota = this.store.setStatus(account.id, "error", message);
    }
    this.scheduleAntigravityGoogleQuotaRefresh(account.id, vaultRecord);

    this.emitLog(`Imported Antigravity Google OAuth account: ${input.user.email}.`);
    return {
      imported: true,
      account: accountWithQuota,
      reason: "Antigravity Google вход завершён. Профиль сохранён в зашифрованном хранилище; лимиты и OS Credential Manager обновляются фоном.",
      status,
      identity: {
        email: input.user.email,
        accountId: dbId,
        label,
        fingerprintId: status.inspection.machineId.hashPrefix ?? dbId.slice(0, 12),
        googleProjectId,
        source: input.accountContext.source === "code_assist" ? "state_db" : "profile_path",
        confidence: input.accountContext.source === "code_assist" && input.user.verifiedEmail !== false ? "confirmed" : "inferred"
      }
    };
  }

  async importAntigravityCredentials(
    input: AntigravityManualImportInput,
    pathInput: AntigravityPathInput = {}
  ): Promise<AntigravityManualImportResult> {
    const credentials: AntigravityCredentialPackage = {
      accountId: input.accountId.trim(),
      email: input.email.trim(),
      refreshToken: input.refreshToken.trim(),
      accessToken: normalizeNullableString(input.accessToken),
      expiresAt: input.expiresAt ?? null,
      googleProjectId: normalizeNullableString(input.googleProjectId),
      machineId: normalizeNullableString(input.machineId)
    };
    let status = getAntigravityProfileStatus(pathInput);
    const applyResult = status.readyForWriteActions
      ? applyAntigravityAccountWritePlan({
        ...pathInput,
        backupRoot: path.join(this.appDataDir, "antigravity-backups"),
        credentials
      })
      : null;
    let account: ManagedAccount;
    try {
      const existing = this.store.getByPlatformEmail("antigravity", credentials.email);
      const accountId = existing?.id ?? antigravityAccountDbId(credentials.accountId);
      const label = normalizeNullableString(input.label) ?? existing?.label ?? getDisplayLabel(credentials.email);
      const vaultRecord: AntigravityVaultRecord = {
        format: antigravityVaultFormat,
        version: antigravityVaultVersion,
        authMode: "manual_credentials",
        credentials,
        fingerprintId: normalizeNullableString(input.fingerprintId),
        importedAt: Math.floor(Date.now() / 1000)
      };
      account = this.store.upsert({
        id: accountId,
        platform: "antigravity",
        label,
        email: credentials.email,
        planType: "unknown",
        profileDir: status.diagnostics.userDataDir,
        encryptedAuthJson: this.vault.encryptUtf8(JSON.stringify(vaultRecord)),
        rateLimits: null,
        antigravity: {
          googleProjectId: credentials.googleProjectId ?? null,
          fingerprintId: normalizeNullableString(input.fingerprintId),
          lastQuotaRefreshAt: null,
          forbidden: false,
          ideStateDetected: status.detected
        },
        status: "unknown",
        statusReason: "Antigravity credentials imported; validation has not completed."
      });
      if (!applyResult) {
        try {
          this.writeAntigravityCredentialPackageStore(credentials, account);
        } catch (error) {
          const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
          this.emitLog(`Antigravity manual credential store update failed: ${message}`);
        }
      }
    } catch (error) {
      if (applyResult) restoreAntigravityBackupDir(applyResult.backupDir);
      status = getAntigravityProfileStatus(pathInput);
      throw error;
    }

    const tokenFields: Array<"refreshToken" | "accessToken"> = ["refreshToken"];
    if (credentials.accessToken) tokenFields.push("accessToken");
    return {
      imported: true,
      account,
      status,
      summary: applyResult?.summary ?? {
        accountId: credentials.accountId,
        email: credentials.email,
        stateKeys: [],
        storageKeys: [],
        writesMachineId: false,
        tokenFields
      },
      backupId: applyResult?.backupId ?? "credential-manager-only",
      backupDir: applyResult?.backupDir ?? ""
    };
  }

  async importAntigravityCredentialPayload(
    input: { payload: string; source?: string },
    pathInput: AntigravityPathInput = {}
  ): Promise<AntigravityCredentialBatchImportResult> {
    const parsed = parseAntigravityCredentialPayload({
      payload: input.payload,
      source: input.source ?? "token_json"
    });
    return this.importParsedAntigravityCredentials(parsed, pathInput);
  }

  async importAntigravityExternalSource(
    source: "cockpit" | "antigravity_tools" | "plugin" | "local_db",
    pathInput: AntigravityPathInput & { localAppData?: string } = {}
  ): Promise<AntigravityCredentialBatchImportResult> {
    const payloads = readAntigravityExternalCredentialPayloads({
      source,
      platform: pathInput.platform,
      appData: pathInput.appData,
      home: pathInput.home,
      localAppData: pathInput.localAppData
    });
    const parsed = payloads.flatMap((payload) =>
      parseAntigravityCredentialPayload({
        payload: payload.payload,
        source: payload.source
      })
    );
    return this.importParsedAntigravityCredentials(parsed, pathInput);
  }

  async importAntigravityCredentialPayloads(
    payloads: Array<{ payload: string; source: string; fileName?: string | null }>,
    pathInput: AntigravityPathInput = {}
  ): Promise<AntigravityCredentialBatchImportResult> {
    const parsed = payloads.flatMap((payload) =>
      parseAntigravityCredentialPayload({
        payload: payload.payload,
        source: payload.source,
        fileName: payload.fileName
      })
    );
    return this.importParsedAntigravityCredentials(parsed, pathInput);
  }

  getProfileFolder(accountId: string): string {
    const account = this.store.get(accountId);
    if (!account) throw new Error("Account not found");
    return account.profileDir;
  }

  private async finalizeLogin(profileId: string, params: { loginId: string | null; success: boolean; error: string | null }): Promise<void> {
    if (!params.loginId) return;
    if (!params.success) {
      await this.failPendingLogin(params.loginId, profileId, params.error ?? "Codex login failed");
      return;
    }
    await this.completePendingLogin(params.loginId, profileId);
  }

  private async completePendingLogin(loginId: string, profileId: string): Promise<void> {
    const pending = this.pendingLogins.get(loginId);
    if (!pending || pending.profileId !== profileId) return;
    this.pendingLogins.delete(loginId);
    if (pending.pollTimer) clearTimeout(pending.pollTimer);

    try {
      const account = await this.operationLock.runExclusive("provider:codex", () =>
        this.persistCodexProfile({
          profileId,
          profileDir: pending.profileDir,
          client: pending.client,
          authMode: pending.authMode,
          replaceAccountId: pending.replaceAccountId,
          previousProfileDir: pending.previousProfileDir
        })
      );

      const event: AuthEvent = { loginId, profileId: account.id, success: true, error: null, account };
      this.emit("auth-event", event);
    } catch (error) {
      const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
      const event: AuthEvent = { loginId, profileId, success: false, error: message };
      this.emit("auth-event", event);
    } finally {
      await pending.client.stop();
      const current = this.store.get(pending.replaceAccountId ?? profileId);
      if (current) this.syncProfileAuthToVault(current);
    }
  }

  private async persistCodexProfile(input: {
    profileId: string;
    profileDir: string;
    client: CodexRpcClient;
    authMode: CodexAuthMode;
    replaceAccountId?: string;
    previousProfileDir?: string;
  }): Promise<ManagedAccount> {
    const accountResponse = await input.client.readAccount(true);
    const identity = getAccountIdentity(accountResponse.account, input.authMode);
    let rateLimits = null;
    if (input.authMode !== "apiKey") {
      try {
        rateLimits = withCodexPlan(selectBestRateLimit(await input.client.readRateLimits()), identity.planType);
      } catch {
        rateLimits = null;
      }
    }

    const authPath = getAuthFilePath(input.profileDir);
    if (!fs.existsSync(authPath)) throw new Error("Codex did not create auth.json for this profile");
    const authJson = readStableAuthJson(authPath);
    const metadata = inspectCodexAuthJson(authJson);
    const encryptedAuthJson = this.vault.encryptUtf8(authJson);
    const replaceAccount = input.replaceAccountId ? this.store.get(input.replaceAccountId) : null;
    const saveId = input.replaceAccountId ?? input.profileId;
    const identitySuffix = metadata.providerAccountId ?? metadata.authFingerprint.slice(0, 12);
    const email = identity.email
      ?? replaceAccount?.email
      ?? `codex:${input.authMode}:${identitySuffix}`;
    const defaultLabel = input.authMode === "apiKey"
      ? `OpenAI API key · ${metadata.authFingerprint.slice(0, 8)}`
      : input.authMode === "enterpriseAccessToken"
        ? identity.email ? getDisplayLabel(identity.email) : `Enterprise · ${identitySuffix.slice(0, 8)}`
        : identity.email ? getDisplayLabel(identity.email) : `ChatGPT · ${identitySuffix.slice(0, 8)}`;

    const account = this.store.upsert({
      id: saveId,
      label: replaceAccount?.label ?? defaultLabel,
      email,
      planType: identity.planType,
      profileDir: input.profileDir,
      encryptedAuthJson,
      rateLimits,
      authMode: input.authMode,
      providerAccountId: metadata.providerAccountId,
      workspaceAccountId: metadata.workspaceAccountId,
      workspaceLabel: metadata.workspaceLabel,
      authFingerprint: metadata.authFingerprint,
      credentialState: "ready",
      // A successful provider identity read proves the new authentication is
      // valid even when the immediate quota probe is temporarily unavailable.
      clearRefreshError: true,
      lastAuthenticatedAt: Math.floor(Date.now() / 1000),
      expiresAt: metadata.expiresAt,
      version: (replaceAccount?.version ?? 0) + 1,
      status: "active",
      statusReason: input.authMode === "apiKey"
        ? "API key authenticated. Codex does not expose ChatGPT quota windows for this mode."
        : null
    });

    if (replaceAccount?.isActive) {
      const activeAuthPath = getAuthJsonPath(this.getGlobalCodexHome());
      const previousAuthJson = fs.existsSync(activeAuthPath) ? readStableAuthJson(activeAuthPath) : null;
      backupFile(activeAuthPath);
      atomicWrite(activeAuthPath, authJson);
      const syncedFiles = syncCodexGlobalState(this.getGlobalCodexHome(), authJson, previousAuthJson);
      this.store.setActive(account.id);
      this.emitLog(`Reauthenticated active Codex account and synced ${syncedFiles} global state file(s)`);
    }

    if (
      input.replaceAccountId
      && input.previousProfileDir
      && input.previousProfileDir !== input.profileDir
      && input.previousProfileDir.startsWith(this.appDataDir)
    ) {
      fs.rmSync(input.previousProfileDir, { recursive: true, force: true });
    }
    const savedWithSecrets = this.store.get(account.id);
    return savedWithSecrets ? this.codexProfileVault.sealVerified(savedWithSecrets) : account;
  }

  private async failPendingLogin(loginId: string, profileId: string, message: string): Promise<void> {
    const pending = this.pendingLogins.get(loginId);
    if (!pending || pending.profileId !== profileId) return;
    this.pendingLogins.delete(loginId);
    if (pending.pollTimer) clearTimeout(pending.pollTimer);
    const event: AuthEvent = { loginId, profileId, success: false, error: redactSensitiveText(message) };
    this.emit("auth-event", event);
    await pending.client.stop();
  }

  private hasPendingReauthentication(accountId: string): boolean {
    return [...this.pendingLogins.values()].some((login) => login.replaceAccountId === accountId);
  }

  private async discardPendingReauthentication(accountId: string): Promise<void> {
    const stale = [...this.pendingLogins.entries()].filter(([, login]) => login.replaceAccountId === accountId);
    for (const [loginId, login] of stale) {
      this.pendingLogins.delete(loginId);
      if (login.pollTimer) clearTimeout(login.pollTimer);
      await login.client.stop();
      if (this.codexProfileVault.isManagedProfile(login.profileDir)) {
        fs.rmSync(login.profileDir, { recursive: true, force: true });
      }
      this.emitLog(`Superseded an unfinished Codex reauthentication for managed profile ${accountId}.`);
    }
  }

  private failSwitchTransactionIfActive(transactionId: string, errorCode: string, errorMessage: string): void {
    const transaction = this.switchTransactions.get(transactionId);
    if (!transaction || ["committed", "rolled_back", "aborted", "failed", "recovery_required"].includes(transaction.status)) return;
    this.switchTransactions.fail(transaction.id, errorCode, errorMessage);
  }

  private scheduleLoginPoll(loginId: string, profileId: string): void {
    const pending = this.pendingLogins.get(loginId);
    if (!pending || pending.profileId !== profileId) return;
    pending.pollTimer = setTimeout(() => {
      void this.pollLoginCompletion(loginId, profileId);
    }, 2500);
  }

  private async pollLoginCompletion(loginId: string, profileId: string): Promise<void> {
    const pending = this.pendingLogins.get(loginId);
    if (!pending || pending.profileId !== profileId) return;

    if (Date.now() - pending.startedAt > 15 * 60 * 1000) {
      await this.failPendingLogin(loginId, profileId, "Login timed out. Try adding this account again.");
      return;
    }

    try {
      const authPath = getAuthFilePath(pending.profileDir);
      const accountResponse = await pending.client.readAccount(true);
      const account = accountResponse.account as { type?: string; email?: string } | null;
      if (fs.existsSync(authPath) && account?.type === "chatgpt" && account.email) {
        await this.completePendingLogin(loginId, profileId);
        return;
      }
    } catch (error) {
      this.emitLog(`Login polling is still waiting: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.scheduleLoginPoll(loginId, profileId);
  }

  private ensureProfileAuth(account: ManagedAccount & { encryptedAuthJson: string }): void {
    this.codexProfileVault.hydrate(account);
  }

  private syncProfileAuthToVault(account: ManagedAccount): void {
    try {
      const current = this.store.get(account.id);
      if (!current) return;
      this.codexProfileVault.sealVerified(current);
    } catch (error) {
      this.emitLog(`Profile auth cache sync skipped for ${account.email}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private syncActiveGlobalAuthToVault(account: ManagedAccount): ManagedAccount {
    const authPath = getAuthJsonPath(this.getGlobalCodexHome());
    if (!fs.existsSync(authPath)) throw new Error("The active Codex session has no auth.json");
    const authJson = readStableAuthJson(authPath);
    const metadata = inspectCodexAuthJson(authJson);
    if (account.providerAccountId && account.providerAccountId !== metadata.providerAccountId) {
      this.store.storeAuthDriftCandidate({
        accountId: account.id,
        encryptedAuthJson: this.vault.encryptUtf8(authJson),
        fingerprint: metadata.authFingerprint
      });
      throw new Error("The active Codex session changed to a different provider account");
    }
    if (account.workspaceAccountId && account.workspaceAccountId !== metadata.workspaceAccountId) {
      this.store.storeAuthDriftCandidate({
        accountId: account.id,
        encryptedAuthJson: this.vault.encryptUtf8(authJson),
        fingerprint: metadata.authFingerprint
      });
      throw new Error("The active Codex session changed to a different workspace");
    }
    if (metadata.authFingerprint === account.authFingerprint) return account;
    const saved = this.store.updateCodexAuthMaterial(account.id, {
      encryptedAuthJson: this.vault.encryptUtf8(authJson),
      authFingerprint: metadata.authFingerprint,
      providerAccountId: metadata.providerAccountId,
      workspaceAccountId: metadata.workspaceAccountId,
      workspaceLabel: metadata.workspaceLabel,
      expiresAt: metadata.expiresAt,
      credentialState: "ready",
      lastAuthenticatedAt: Math.floor(Date.now() / 1000),
      authMode: account.authMode ?? metadata.inferredAuthMode
    });
    this.emitLog(`Persisted an official token rotation from the active global Codex session for ${account.id}.`);
    return saved;
  }

  private async restoreProfileAuthFromCurrentGlobalSession(account: ManagedAccount): Promise<boolean> {
    const globalCodexHome = this.getGlobalCodexHome();
    if (path.resolve(globalCodexHome).toLowerCase() === path.resolve(account.profileDir).toLowerCase()) return false;

    const globalAuthPath = getAuthJsonPath(globalCodexHome);
    if (!fs.existsSync(globalAuthPath)) return false;

    const globalClient = new CodexRpcClient(globalCodexHome, this.requireCodexPath());
    try {
      const globalIdentity = getAccountIdentity(
        (await globalClient.readAccount(true)).account,
        account.authMode ?? "chatgpt"
      );
      if (!matchesCodexAccountIdentity(globalIdentity, account)) return false;

      const authJson = readStableAuthJson(globalAuthPath);
      const profileAuthPath = getAuthFilePath(account.profileDir);
      const existingAuthJson = fs.existsSync(profileAuthPath) ? readStableAuthJson(profileAuthPath) : null;
      if (existingAuthJson !== authJson) backupFile(profileAuthPath);
      atomicWrite(profileAuthPath, authJson);
      this.store.updateEncryptedAuthJson(account.id, this.vault.encryptUtf8(authJson));
      this.emitLog(`Restored expired profile auth from the matching active Codex session for ${account.email}.`);
      return true;
    } catch (error) {
      this.emitLog(`Could not restore profile auth from the active Codex session: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      await globalClient.stop();
    }
  }

  private readAntigravityVaultRecord(account: ManagedAccount & { encryptedAuthJson: string }): AntigravityVaultRecord {
    const record = JSON.parse(this.vault.decryptUtf8(account.encryptedAuthJson)) as AntigravityVaultRecord;
    if (record.format !== antigravityVaultFormat || record.version !== antigravityVaultVersion) {
      throw new Error("Unsupported Antigravity credential payload");
    }
    if (!record.credentials && !record.localProfile && !record.googleOAuth) {
      throw new Error("Antigravity account is missing local profile metadata");
    }
    return record;
  }

  private async refreshAntigravityGoogleQuota(
    account: ManagedAccount & { encryptedAuthJson: string },
    existingRecord?: AntigravityVaultRecord
  ): Promise<ManagedAccount> {
    const record = existingRecord ?? this.readAntigravityVaultRecord(account);
    const googleOAuth = record.googleOAuth;
    if (!googleOAuth) {
      throw new Error("Antigravity quota refresh requires a Google OAuth account. Reauthorize through Google Sign-In.");
    }

    const now = Math.floor(Date.now() / 1000);
    if (!googleOAuth.expiresAt || googleOAuth.expiresAt <= now + antigravityRefreshSkewSeconds) {
      if (!googleOAuth.refreshToken) {
        throw new Error("Antigravity Google access token expired and no refresh token is available. Reauthorize through Google Sign-In.");
      }
      const refreshed = await refreshAntigravityGoogleAccessToken({
        clientId: googleOAuth.oauthClientId,
        clientSecret: null,
        refreshToken: googleOAuth.refreshToken
      });
      googleOAuth.accessToken = refreshed.accessToken;
      googleOAuth.refreshToken = refreshed.refreshToken ?? googleOAuth.refreshToken;
      googleOAuth.expiresAt = refreshed.expiresAt ?? googleOAuth.expiresAt;
      googleOAuth.scope = refreshed.scope.length ? refreshed.scope : googleOAuth.scope;
      googleOAuth.tokenType = refreshed.tokenType ?? googleOAuth.tokenType;
      this.store.updateEncryptedAuthJson(account.id, this.vault.encryptUtf8(JSON.stringify(record)));
      this.scheduleAntigravityGoogleCredentialStoreWrite(account.id, googleOAuth);
      try {
        const ideWrite = this.writeAntigravityGoogleIdeProfile(googleOAuth, account);
        if (ideWrite?.applied) {
          this.emitLog(`Antigravity IDE unified auth state refreshed after Google token refresh for ${account.email}. Backup=${ideWrite.backupId}`);
        }
      } catch (error) {
        this.emitLog(`Antigravity IDE unified auth state refresh after token update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const quotaFetcher = this.dependencies.fetchAntigravityQuota ?? fetchAntigravityQuota;
    const quota = await quotaFetcher({
      accessToken: googleOAuth.accessToken,
      googleProjectId: googleOAuth.googleProjectId ?? account.antigravity?.googleProjectId,
      requestTimeoutMs: 10_000
    });
    let vaultChanged = false;
    if (quota.accountContext.googleProjectId && quota.accountContext.googleProjectId !== googleOAuth.googleProjectId) {
      googleOAuth.googleProjectId = quota.accountContext.googleProjectId;
      vaultChanged = true;
    }
    if (quota.accountContext.tier !== "unknown" && quota.accountContext.tier !== googleOAuth.tier) {
      googleOAuth.tier = quota.accountContext.tier;
      vaultChanged = true;
    }
    if (quota.accountContext.tierId && quota.accountContext.tierId !== googleOAuth.tierId) {
      googleOAuth.tierId = quota.accountContext.tierId;
      vaultChanged = true;
    }
    if (vaultChanged) {
      this.store.updateEncryptedAuthJson(account.id, this.vault.encryptUtf8(JSON.stringify(record)));
      try {
        const ideWrite = this.writeAntigravityGoogleIdeProfile(googleOAuth, account);
        if (ideWrite?.applied) {
          this.emitLog(`Antigravity IDE unified auth state refreshed after Code Assist context update for ${account.email}. Backup=${ideWrite.backupId}`);
        }
      } catch (error) {
        this.emitLog(`Antigravity IDE unified auth state refresh after quota update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const safeLimits = sanitizeAntigravityLimits(quota.limits);
    this.store.insertRateLimitSnapshot({
      id: crypto.randomUUID(),
      accountId: account.id,
      capturedAt: Math.floor(Date.now() / 1000),
      status: quota.status,
      statusReason: quota.statusReason,
      limits: safeLimits
    });
    this.store.updateAntigravityDetails(account.id, {
      googleProjectId: quota.accountContext.googleProjectId ?? googleOAuth.googleProjectId ?? account.antigravity?.googleProjectId ?? null,
      lastQuotaRefreshAt: Math.floor(Date.now() / 1000),
      forbidden: quota.forbidden,
      ideStateDetected: account.antigravity?.ideStateDetected ?? false
    });
    return this.store.setRateLimits(account.id, safeLimits, quota.status, quota.statusReason);
  }

  private async importParsedAntigravityCredentials(
    parsed: ParsedAntigravityCredential[],
    pathInput: AntigravityPathInput = {}
  ): Promise<AntigravityCredentialBatchImportResult> {
    const failures: AntigravityCredentialBatchImportResult["failures"] = [];
    const imported: AntigravityCredentialBatchImportResult["imported"] = [];
    const client = resolveAntigravityOAuthClient({});
    const fetchUserInfo = this.dependencies.fetchAntigravityGoogleUserInfo ?? fetchAntigravityGoogleUserInfo;

    for (const credential of parsed) {
      try {
        const refreshed = await refreshAntigravityGoogleAccessToken({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          refreshToken: credential.refreshToken,
          requestTimeoutMs: 15_000
        });
        const user = await fetchUserInfo({
          accessToken: refreshed.accessToken,
          requestTimeoutMs: 15_000
        });
        const accountContext = {
          googleProjectId: credential.googleProjectId ?? null,
          tier: "unknown" as const,
          tierId: null,
          source: credential.googleProjectId ? "code_assist" as const : "unavailable" as const,
          errorReason: credential.googleProjectId ? null : "Imported from token/JSON; Code Assist quota refresh is pending."
        };
        const result = await this.importAntigravityGoogleOAuth({
          clientId: client.clientId,
          redirectUri: credential.source,
          accountContext,
          user: {
            ...user,
            email: user.email || credential.email || "unknown@local.antigravity",
            name: user.name ?? credential.label ?? null
          },
          tokens: {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? credential.refreshToken,
            expiresAt: refreshed.expiresAt ?? credential.expiresAt ?? null,
            scope: refreshed.scope,
            tokenType: refreshed.tokenType ?? "Bearer"
          }
        }, pathInput);
        if (result.account) {
          imported.push({
            accountId: result.account.id,
            email: result.account.email,
            label: result.account.label,
            source: credential.source
          });
        }
      } catch (error) {
        failures.push({
          source: credential.source,
          email: credential.email ?? null,
          reason: redactSensitiveText(error instanceof Error ? error.message : String(error))
        });
      }
    }

    if (parsed.length === 0) {
      failures.push({
        source: "input",
        email: null,
        reason: "No Antigravity refresh token was found in the selected input."
      });
    }

    if (imported.length > 0) {
      this.emit("accounts-updated");
    }

    return {
      importedCount: imported.length,
      failedCount: failures.length,
      imported,
      failures,
      accounts: this.list()
    };
  }

  private scheduleAntigravityGoogleQuotaRefresh(accountId: string, record: AntigravityVaultRecord): void {
    void (async () => {
      try {
        const account = this.store.get(accountId);
        if (!account || account.platform !== "antigravity") return;
        await this.refreshAntigravityGoogleQuota(account, record);
        this.emit("accounts-updated");
      } catch (error) {
        const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
        this.emitLog(`Antigravity quota refresh after Google OAuth failed: ${message}`);
        const account = this.store.get(accountId);
        if (account) {
          this.store.setStatus(accountId, "error", message);
          this.emit("accounts-updated");
        }
      }
    })();
  }

  private scheduleAntigravityGoogleCredentialStoreWrite(
    accountId: string,
    token: NonNullable<AntigravityVaultRecord["googleOAuth"]>
  ): void {
    if (!this.dependencies.writeAntigravityCredentialStoreToken) return;
    setTimeout(() => {
      try {
        const account = this.store.get(accountId);
        if (!account || account.platform !== "antigravity") return;
        const result = this.writeAntigravityGoogleCredentialStore(token, account);
        if (result?.applied) {
          this.emitLog(`Antigravity OS credential store updated for ${account.email}.`);
        }
      } catch (error) {
        const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
        this.emitLog(`Antigravity OS credential store update failed: ${message}`);
      }
    }, 0);
  }

  private writeAntigravityGoogleCredentialStore(
    token: NonNullable<AntigravityVaultRecord["googleOAuth"]>,
    account: ManagedAccount
  ): AntigravityCredentialStoreWriteResult | null {
    if (!token.refreshToken) return null;
    const writer = this.dependencies.writeAntigravityCredentialStoreToken;
    if (!writer) return null;
    return writer({
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt
    }, this.getAntigravityPathInputForAccount(account).platform);
  }

  private writeAntigravityCredentialPackageStore(
    credentials: AntigravityCredentialPackage,
    account: ManagedAccount
  ): AntigravityCredentialStoreWriteResult | null {
    if (!credentials.accessToken?.trim() || !credentials.refreshToken.trim()) return null;
    const writer = this.dependencies.writeAntigravityCredentialStoreToken;
    if (!writer) return null;
    return writer({
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: credentials.expiresAt ?? null
    }, this.getAntigravityPathInputForAccount(account).platform);
  }

  private restartAntigravityRuntime(account: ManagedAccount): AntigravityRestartResult {
    const restart = this.dependencies.restartAntigravityIntegration ?? restartAntigravityIntegration;
    const pathInput = this.getAntigravityPathInputForAccount(account);
    return restart({
      platform: pathInput.platform,
      env: process.env
    });
  }

  private writeAntigravityGoogleIdeProfile(
    token: NonNullable<AntigravityVaultRecord["googleOAuth"]>,
    account: ManagedAccount
  ): AntigravityAccountApplyResult | null {
    if (!token.refreshToken) return null;
    const pathInput = this.getAntigravityPathInputForAccount(account);
    if (!getAntigravityProfileStatus(pathInput).readyForWriteActions) return null;
    return applyAntigravityAccountWritePlan({
      ...pathInput,
      backupRoot: path.join(this.appDataDir, "antigravity-backups"),
      credentials: {
        accountId: token.accountId,
        email: token.email,
        refreshToken: token.refreshToken,
        accessToken: token.accessToken,
        expiresAt: token.expiresAt,
        googleProjectId: token.googleProjectId ?? account.antigravity?.googleProjectId ?? null
      }
    });
  }

  private getAntigravityPathInputForAccount(account: ManagedAccount): AntigravityPathInput {
    const appData = path.dirname(account.profileDir);
    return {
      platform: process.platform,
      appData,
      home: inferHomeFromAppData(appData) ?? process.env.USERPROFILE ?? process.env.HOME
    };
  }

  private readAccountAuthJson(account: AccountExportRecord | (ManagedAccount & { encryptedAuthJson: string })): string {
    try {
      return this.vault.decryptUtf8(account.encryptedAuthJson);
    } catch (error) {
      throw new Error(
        `Saved auth encryption is unavailable for ${account.email}. Reauthenticate or import this account. ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private requireCodexPath(): string {
    if (!this.codexPath) {
      throw new Error("Codex CLI was not found. Install or launch Codex Desktop, then try again.");
    }
    return this.codexPath;
  }

  private assertCompatibleCodexCredentialStore(): void {
    const diagnostics = inspectCodexCredentialStore(this.getGlobalCodexHome());
    if (!diagnostics.managerCompatible) {
      throw new Error(
        `${diagnostics.message} Set cli_auth_credentials_store = "file" yourself and sign in again before using profile switching.`
      );
    }
  }

  private getGlobalCodexHome(): string {
    return this.dependencies.codexHome ?? getDefaultCodexHome();
  }
}

export function getDiagnostics(appDataDir: string): {
  codexPath: string | null;
  codexDesktopPath: string | null;
  codexAppUserModelId: string | null;
  activeCodexHome: string;
  appDataDir: string;
  workspacePath: string;
  credentialStore: ReturnType<typeof inspectCodexCredentialStore>;
} {
  const activeCodexHome = getDefaultCodexHome();
  return {
    codexPath: resolveCodexPath(),
    codexDesktopPath: resolveCodexDesktopPath(),
    codexAppUserModelId: getCodexAppUserModelId(),
    activeCodexHome,
    appDataDir,
    workspacePath: getDefaultWorkspacePath(),
    credentialStore: inspectCodexCredentialStore(activeCodexHome)
  };
}
