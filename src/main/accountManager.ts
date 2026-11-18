import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type {
  AccountImportResult,
  AccountImportPreview,
  SwitchVerificationEvidence,
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
  WorkspaceBinding,
  QuotaWarmupAccountResult,
  QuotaWarmupFleetResult
} from "../shared/types.js";
import type { AccountExportRecord } from "./db.js";
import { AccountStore } from "./db.js";
import { Vault } from "./security.js";
import { getAuthJsonPath, getDefaultCodexHome, getDefaultWorkspacePath, getProfileDir, getProfilesDir, assertManagedPath } from "./paths.js";
import {
  CodexRpcClient,
  classifyRateLimit,
  getAuthFilePath,
  normalizeCodexPlanType,
  runCodexCommand,
  selectBestRateLimit
} from "./codexRpc.js";
import {
  ensureExecutableCodexPath,
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
import { resolveAntigravityPaths, type AntigravityPathInput } from "./services/antigravityPaths.js";
import { getAntigravityProfileStatus } from "./services/antigravityProfileService.js";
import {
  detectAntigravityLiveSession,
  verifyAntigravityRuntimeIdentity,
  extractAntigravityLocalIdentity,
  fetchAntigravityLiveQuota,
  readAntigravityOfficialAuthState
} from "./services/antigravityProfileReader.js";
import {
  applyAntigravityAccountWritePlan,
  type AntigravityCredentialPackage
} from "./services/antigravityAccountAdapter.js";
import { QuotaWarmupService } from "./services/quotaWarmupService.js";
import {
  createAntigravityProfileBackup,
  restoreAntigravityProfileBackup,
  type AntigravityCredentialSnapshot,
  type AntigravityBackupProtection,
  type AntigravityProfileBackupManifest,
  verifySealedAntigravityBackupManifest
} from "./services/antigravityProfileBackup.js";
import {
  fetchAntigravityGoogleAccountContext,
  fetchAntigravityGoogleUserInfo,
  refreshAntigravityGoogleAccessToken,
  resolveAntigravityOAuthClient,
  resolveAntigravityOAuthClientForAccount,
  type AntigravityGoogleAccountContext,
  type AntigravityGoogleOAuthResult
} from "./services/antigravityGoogleAuthService.js";
import type {
  AntigravityCredentialStoreReadResult,
  AntigravityCredentialStoreTokenInput,
  AntigravityCredentialStoreWriteResult
} from "./services/antigravityCredentialStore.js";
import { readAntigravityCredentialStorePayload } from "./services/antigravityCredentialStore.js";
import type {
  AntigravityQuiesceResult,
  AntigravityAsyncProcessInput,
  AntigravityRestartResult
} from "./services/antigravityProcessService.js";
import {
  cleanAntigravitySessionCache,
  launchAntigravityAsync,
  quiesceAntigravityAsync,
  type resolveAntigravitySwitchTarget,
  restartAntigravityIntegration
} from "./services/antigravityProcessService.js";
import { fetchAntigravityQuota, parseSummaryGroups, quotaResultFromModels, type AntigravityQuotaResult } from "./services/antigravityQuotaService.js";
import {
  parseAntigravityCredentialPayload,
  readAntigravityExternalCredentialPayloads,
  type ParsedAntigravityCredential
} from "./services/antigravityCredentialImportService.js";
import { validateAntigravityAuthState, validateCodexAuthState } from "./services/authValidationService.js";
import { classifyAuthValidationError } from "../shared/authState.js";
import { ProviderRequestError } from "../shared/quotaRefreshError.js";
import { RefreshSchedulerService, RefreshPriority } from "./services/refreshSchedulerService.js";
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
  ) => AntigravityCredentialStoreReadResult | null | Promise<AntigravityCredentialStoreReadResult | null>;
  writeAntigravityCredentialStoreToken?: (
    input: AntigravityCredentialStoreTokenInput,
    platform?: NodeJS.Platform
  ) => AntigravityCredentialStoreWriteResult | Promise<AntigravityCredentialStoreWriteResult>;
  restoreAntigravityCredentialStorePayload?: (snapshot: AntigravityCredentialSnapshot) => void | Promise<void>;
  antigravityPathInput?: AntigravityPathInput;
  detectAntigravityLiveSession?: typeof detectAntigravityLiveSession;
  readAntigravityOfficialAuthState?: typeof readAntigravityOfficialAuthState;
  fetchAntigravityQuota?: typeof fetchAntigravityQuota;
  fetchAntigravityLiveQuota?: typeof fetchAntigravityLiveQuota;
  verifyAntigravityRuntimeIdentity?: typeof verifyAntigravityRuntimeIdentity;
  fetchAntigravityGoogleUserInfo?: typeof fetchAntigravityGoogleUserInfo;
  refreshAntigravityGoogleAccessToken?: typeof refreshAntigravityGoogleAccessToken;
  fetchAntigravityGoogleAccountContext?: typeof fetchAntigravityGoogleAccountContext;
  restartAntigravityIntegration?: typeof restartAntigravityIntegration;
  quiesceAntigravity?: (input?: AntigravityAsyncProcessInput) => AntigravityQuiesceResult | Promise<AntigravityQuiesceResult>;
  launchAntigravity?: (input?: AntigravityAsyncProcessInput) => AntigravityRestartResult | Promise<AntigravityRestartResult>;
  resolveAntigravitySwitchTarget?: typeof resolveAntigravitySwitchTarget;
  desktopLifecycle?: Pick<WindowsDesktopLifecycleService, "quiesce" | "launchAndWaitReady">
    & Partial<Pick<WindowsDesktopLifecycleService, "getDiagnostics">>;
  getDesktopClosePolicy?: () => DesktopClosePolicy;
  getCodexQuotaReadOptions?: () => { excludeResetCreditDetails?: boolean } | undefined;
  durableAuthBundleAdapter?: DurableAuthBundleAdapter;
  durableAuthRenameRetryDelaysMs?: number[];
  durableAuthStableCheckCount?: number;
  durableAuthStableCheckIntervalMs?: number;
  durableAuthSleep?: (ms: number) => Promise<void>;
  operationLock?: AsyncKeyedLock;
  crossProcessSwitchLock?: Pick<CrossProcessLockService, "runExclusive">;
}

export interface ActiveCodexSessionSyncResult {
  status: "updated" | "unchanged" | "signed_out" | "unmanaged" | "invalid" | "busy" | "unsupported_store" | "ambiguous";
  accountId: string | null;
}

export interface ActiveAntigravitySessionSyncResult {
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


function readAntigravityBackupManifest(backupDir: string): AntigravityProfileBackupManifest {
  return JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8")) as AntigravityProfileBackupManifest;
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
  if (Buffer.byteLength(input, "utf8") > 64 * 1024 * 1024) throw new Error("Account export exceeds the 64 MiB safety limit");
  const envelope = JSON.parse(input) as PortableEnvelope;
  if (envelope.format !== portableExportFormat || !supportedPortableExportVersions.has(envelope.version)) {
    throw new Error("Unsupported account export file");
  }
  if ((envelope.kdf?.name !== "pbkdf2-sha256" && envelope.kdf?.name !== "scrypt") || envelope.cipher?.name !== "aes-256-gcm") {
    throw new Error("Unsupported account export encryption");
  }
  if (typeof envelope.kdf.salt !== "string" || typeof envelope.cipher.iv !== "string"
    || typeof envelope.cipher.tag !== "string" || typeof envelope.cipher.ciphertext !== "string") {
    throw new Error("Invalid account export encryption fields");
  }
  if (envelope.kdf.name === "pbkdf2-sha256"
    && (!Number.isSafeInteger(envelope.kdf.iterations) || envelope.kdf.iterations < 100_000 || envelope.kdf.iterations > 2_000_000)) {
    throw new Error("Unsupported export key derivation cost");
  }
  const salt = Buffer.from(envelope.kdf.salt, "base64");
  const iv = Buffer.from(envelope.cipher.iv, "base64");
  const tag = Buffer.from(envelope.cipher.tag, "base64");
  const ciphertext = Buffer.from(envelope.cipher.ciphertext, "base64");
  if (salt.length < 16 || salt.length > 64 || iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Invalid account export encryption lengths");
  }
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
  return /codex profile is not authenticated|codex profile is not logged into a chatgpt(?:-compatible)? account|codex profile belongs to a different (?:chatgpt )?account|login required|reauth(?:entication)? required|sign.?in required/i.test(message);
}

function matchesCodexAccountIdentity(identity: CodexAccountIdentity, account: ManagedAccount): boolean {
  if (account.authMode === "apiKey") return identity.authMode === "apiKey";
  if (identity.authMode === "apiKey") return false;
  if (!identity.email || account.email.startsWith("codex:")) return true;
  return identity.email.trim().toLowerCase() === account.email.trim().toLowerCase();
}

function matchesCodexAuthMaterial(metadata: ReturnType<typeof inspectCodexAuthJson>, account: ManagedAccount): boolean {
  if (!metadata.inferredAuthMode) return false;
  if (!compatibleCodexEmail(metadata.email, account.email)) return false;
  if ((account.authMode === "apiKey") !== (metadata.inferredAuthMode === "apiKey") && account.authMode !== null) return false;
  if (metadata.authFingerprint === account.authFingerprint) return true;
  if (metadata.inferredAuthMode === "apiKey") return false;
  if (account.workspaceAccountId !== metadata.workspaceAccountId) return false;
  if (account.providerAccountId) return account.providerAccountId === metadata.providerAccountId;
  return Boolean(metadata.email && metadata.email.trim().toLowerCase() === account.email.trim().toLowerCase());
}

function compatibleCodexEmail(observed: string | null, saved: string): boolean {
  return !observed || saved.startsWith("codex:") || saved.trim().toLowerCase() === observed.trim().toLowerCase();
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

function sanitizeAntigravityLimits(limits: RateLimitSnapshot): RateLimitSnapshot {
  return limits;
}

function canReadCurrentWindowsCredentialStore(pathInput: AntigravityPathInput): boolean {
  const platform = pathInput.platform ?? process.platform;
  if (platform !== "win32") return false;
  const home = pathInput.home ?? process.env.USERPROFILE ?? "";
  return home ? path.resolve(home).toLowerCase() === path.resolve(os.userInfo().homedir).toLowerCase() : true;
}

export class AccountManager extends EventEmitter {
  private readonly pendingLogins = new Map<string, PendingLogin>();
  private codexPath: string | null;
  private readonly importPreviews = new Map<string, { preview: AccountImportPreview; records: AccountExportRecord[]; revision: string }>();
  private readonly refreshScheduler = new RefreshSchedulerService(2);
  private readonly refreshEpochs = new Map<string, number>();
  private readonly refreshContexts = new Map<string, { version: number; epoch: number; signal: AbortSignal }>();
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
    return this.store.list();
  }

  secureManagedProfileHomes(): { sealed: number; drifted: number } {
    if (this.store.getRecoveryRequired("codex")) return { sealed: 0, drifted: 0 };
    return this.codexProfileVault.secureExistingProfiles();
  }

  repairLegacyQuotaRefreshState(): number {
    let repaired = 0;
    for (const account of this.store.list()) {
      if (this.store.getRecoveryRequired(account.platform)) continue;
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
    if (this.store.getRecoveryRequired("codex") || this.operationLock.isLocked("provider:codex")) {
      return { status: "busy", accountId: null };
    }
    const globalHome = this.getGlobalCodexHome();
    if (!inspectCodexCredentialStore(globalHome).managerCompatible) return { status: "unsupported_store", accountId: null };
    const authPath = getAuthJsonPath(globalHome);
    if (!fs.existsSync(authPath)) {
      const activeAccount = this.store.list().find((account) => account.platform === "codex" && account.isActive);
      if (activeAccount) {
        this.store.clearActive("codex");
        this.emitLog(`Codex session is signed out; cleared active state on ${activeAccount.email}.`);
        this.emit("accounts-updated");
      }
      return { status: "signed_out", accountId: null };
    }

    let authJson: string;
    let metadata: ReturnType<typeof inspectCodexAuthJson>;
    try {
      authJson = readStableAuthJson(authPath);
      metadata = inspectCodexAuthJson(authJson);
      if (!metadata.inferredAuthMode) throw new Error("Codex auth.json has no usable credentials");
    } catch (error) {
      this.emitLog(`Active Codex session snapshot is invalid; encrypted profiles were left unchanged: ${error instanceof Error ? error.message : String(error)}`);
      return { status: "invalid", accountId: null };
    }

    return this.matchAndSyncCodexSession(authJson, metadata, true);
  }

  private matchAndSyncCodexSession(
    authJson: string, metadata: ReturnType<typeof inspectCodexAuthJson>, clearUnmatched: boolean
  ): ActiveCodexSessionSyncResult {
    const accounts = this.store.list().filter((account) => account.platform === "codex");
    const compatible = accounts.filter((account) =>
      (account.authMode === null || (account.authMode === "apiKey") === (metadata.inferredAuthMode === "apiKey"))
      && compatibleCodexEmail(metadata.email, account.email)
      && (!metadata.providerAccountId || !account.providerAccountId || account.providerAccountId === metadata.providerAccountId)
      && account.workspaceAccountId === metadata.workspaceAccountId
    );
    const exact = compatible.filter((account) => account.authFingerprint === metadata.authFingerprint);
    const provider = metadata.inferredAuthMode !== "apiKey" && metadata.providerAccountId
      ? compatible.filter((account) => account.providerAccountId === metadata.providerAccountId)
      : [];
    const emailMatches = metadata.inferredAuthMode !== "apiKey" && metadata.email
      ? compatible.filter((account) => account.email.trim().toLowerCase() === metadata.email!.trim().toLowerCase())
      : [];
    const activeAccount = accounts.find((account) => account.isActive);
    const matched = exact.length === 1 ? exact[0]
      : provider.length === 1 ? provider[0]
        : emailMatches.length === 1 ? emailMatches[0] : null;
    if (!matched) {
      if (clearUnmatched && activeAccount) {
        this.store.clearActive("codex");
        this.emitLog(`Codex active session is unmanaged; cleared active state on ${activeAccount.email}.`);
        this.emit("accounts-updated");
      }
      const ambiguous = [exact, provider, emailMatches].some((candidates) => candidates.length > 1);
      return { status: ambiguous ? "ambiguous" : "unmanaged", accountId: null };
    }

    const inferredAuthMode = matched.authMode ?? metadata.inferredAuthMode;
    const needsVaultUpdate = matched.authFingerprint !== metadata.authFingerprint
      || matched.providerAccountId !== metadata.providerAccountId
      || matched.workspaceAccountId !== metadata.workspaceAccountId
      || matched.workspaceLabel !== metadata.workspaceLabel
      || matched.expiresAt !== metadata.expiresAt
      || (matched.authMode === null && inferredAuthMode !== null);
    let saved = matched;
    let changed = false;
    if (needsVaultUpdate) {
      saved = this.store.updateCodexAuthMaterial(matched.id, {
        encryptedAuthJson: this.vault.encryptUtf8(authJson),
        authFingerprint: metadata.authFingerprint,
        providerAccountId: metadata.providerAccountId,
        workspaceAccountId: metadata.workspaceAccountId,
        workspaceLabel: metadata.workspaceLabel,
        expiresAt: metadata.expiresAt,
        credentialState: "needs_review",
        lastAuthenticatedAt: null,
        authMode: inferredAuthMode
      });
      changed = true;
      this.emitLog(`Persisted a rotated active Codex session for managed profile ${saved.id}.`);
    }
    if (!saved.isActive) {
      saved = this.store.setActive(saved.id);
      changed = true;
      this.emitLog(`Codex active profile synchronized to ${saved.email} (${saved.id}).`);
    }
    if (changed) {
      this.emit("accounts-updated");
      return { status: "updated", accountId: saved.id };
    }
    return { status: "unchanged", accountId: saved.id };
  }

  async syncActiveAntigravitySession(): Promise<ActiveAntigravitySessionSyncResult> {
    if (this.store.getRecoveryRequired("antigravity") || this.operationLock.isLocked("provider:antigravity")) {
      return { status: "busy", accountId: null };
    }

    return this.operationLock.runExclusive("provider:antigravity", () => this.syncActiveAntigravitySessionUnlocked());
  }

  private async syncActiveAntigravitySessionUnlocked(): Promise<ActiveAntigravitySessionSyncResult> {
    if (this.store.getRecoveryRequired("antigravity")) return { status: "busy", accountId: null };
    const accounts = this.store.list().filter((account) => account.platform === "antigravity");
    if (accounts.length === 0) return { status: "unmanaged", accountId: null };
    const activeAccount = accounts.find((account) => account.isActive);
    const lastSwitch = activeAccount && this.switchTransactions.list(100).find((item) =>
      item.platform === "antigravity" && item.status === "committed" && item.backupPath);
    let selectedHub = false;
    if (lastSwitch?.backupPath && lastSwitch.targetAccountId === activeAccount?.id) {
      try {
        selectedHub = this.readAntigravityRollbackManifest(lastSwitch.backupPath).runtime?.target === "hub";
      } catch (error) {
        this.emitLog(error);
      }
    }

    let activeEmail: string | null = null;
    let detectionSource = "none";
    let officialState: ReturnType<typeof readAntigravityOfficialAuthState> | null = null;
    let credentialLookupFailed = false;
    let storedToken: { refresh_token?: string; access_token?: string; expiry?: string } | undefined;

    // 1. Live session detection via Language Server RPC (highest authority when IDE is running)
    try {
      const liveDetector = this.dependencies.detectAntigravityLiveSession ?? detectAntigravityLiveSession;
      const liveSession = selectedHub ? null : await liveDetector();
      if (liveSession?.email) {
        activeEmail = liveSession.email.trim().toLowerCase();
        detectionSource = "live_language_server";
      }
    } catch (error) {
      this.emitLog(`Antigravity live session detection skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.switchTransactions.requireRecovered("antigravity");

    // 2. Windows Credential Manager fallback (gemini:antigravity)
    try {
      const credReader = this.dependencies.readAntigravityCredentialStorePayload ?? readAntigravityCredentialStorePayload;
      const credResult = await credReader(process.platform);
      if (credResult?.payload) {
        storedToken = (JSON.parse(credResult.payload) as { token?: typeof storedToken })?.token;
        const secretRefreshToken = storedToken?.refresh_token?.trim();
        if (!activeEmail && secretRefreshToken) {
          for (const acc of accounts) {
            const fullAccount = this.store.get(acc.id);
            if (!fullAccount) continue;
            try {
              const record = this.readAntigravityVaultRecord(fullAccount);
              if ((record.googleOAuth?.refreshToken ?? record.credentials?.refreshToken) === secretRefreshToken) {
                activeEmail = acc.email.trim().toLowerCase();
                detectionSource = "windows_credential_manager";
                break;
              }
            } catch {
              // Недоступный профиль не участвует в сопоставлении.
            }
          }
        }
      }
    } catch (error) {
      credentialLookupFailed = true;
      this.emitLog(`Antigravity credential store inspection skipped: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. Fallback: official auth state from state.vscdb
    if (!activeEmail && !selectedHub && !(activeAccount?.runtimeVerification?.profileApplied && credentialLookupFailed)) {
      try {
        const stateReader = this.dependencies.readAntigravityOfficialAuthState ?? readAntigravityOfficialAuthState;
        officialState = stateReader();
        if (officialState?.email) {
          activeEmail = officialState.email.trim().toLowerCase();
          detectionSource = "state_vscdb";
        }
      } catch (error) {
        this.emitLog(`Antigravity official auth state inspection failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    this.switchTransactions.requireRecovered("antigravity");
    if (!activeEmail) {
      if (activeAccount?.runtimeVerification?.profileApplied && (credentialLookupFailed || (selectedHub && storedToken))) {
        return { status: "unchanged", accountId: activeAccount.id };
      }
      if (activeAccount) {
        this.store.clearActive("antigravity");
        this.emitLog(`Antigravity session signed out: cleared active status on ${activeAccount.email}.`);
        this.emit("accounts-updated");
      }
      return { status: "signed_out", accountId: null };
    }

    const matched = accounts.find((account) => account.email.trim().toLowerCase() === activeEmail) ?? null;
    if (!matched) {
      if (activeAccount) {
        this.store.clearActive("antigravity");
        this.emitLog(`Antigravity active session is unmanaged (${activeEmail}): cleared active status on managed profile ${activeAccount.email}.`);
        this.emit("accounts-updated");
      }
      return { status: "unmanaged", accountId: null };
    }

    let saved = matched;
    let changed = false;

    if (!matched.isActive) {
      saved = this.store.setActive(matched.id);
      this.emitLog(`Synchronized active Antigravity session to ${saved.email} (${saved.id}) via ${detectionSource}.`);
      changed = true;
    }

    // 1. Sync live tokens from Windows Credential Manager (gemini:antigravity)
    try {
      if (storedToken) {
        const credAccessToken = storedToken.access_token?.trim();
        const credRefreshToken = storedToken.refresh_token?.trim();
        if (credAccessToken || credRefreshToken) {
          const fullAccount = this.store.get(saved.id);
          if (fullAccount) {
            let vaultRecord = this.readAntigravityVaultRecord(fullAccount);
            const currentAccessToken = vaultRecord.googleOAuth?.accessToken;
            const currentRefreshToken = vaultRecord.googleOAuth?.refreshToken;
            const needsTokenUpdate = (credAccessToken && credAccessToken !== currentAccessToken)
              || (credRefreshToken && credRefreshToken !== currentRefreshToken);

            if (needsTokenUpdate && vaultRecord.googleOAuth
              && credRefreshToken === vaultRecord.googleOAuth.refreshToken) {
              let expiresAt: number | null = null;
              if (storedToken.expiry) {
                const parsedMs = Date.parse(storedToken.expiry);
                if (Number.isFinite(parsedMs)) expiresAt = Math.floor(parsedMs / 1000);
              }
              const updatedGoogleOAuth = {
                ...vaultRecord.googleOAuth,
                refreshToken: credRefreshToken ?? currentRefreshToken ?? vaultRecord.googleOAuth.refreshToken,
                accessToken: credAccessToken ?? currentAccessToken ?? vaultRecord.googleOAuth.accessToken,
                expiresAt: expiresAt ?? vaultRecord.googleOAuth.expiresAt ?? (Math.floor(Date.now() / 1000) + 3600)
              };
              vaultRecord = {
                ...vaultRecord,
                googleOAuth: updatedGoogleOAuth
              };
              this.switchTransactions.requireRecovered("antigravity");
              this.persistLocallyObservedAntigravityAuth(fullAccount, vaultRecord);
              this.emitLog(`Synchronized live Antigravity tokens from Windows Credential Manager to ${saved.email}.`);
              changed = true;
            }
          }
        }
      }
    } catch (_error) {
      // Credential manager token sync failure should not break active session sync
    }

    if (officialState) {
      const ideAccessToken = officialState.oauth?.accessToken ?? officialState.apiKey ?? null;
      const ideRefreshToken = officialState.oauth?.refreshToken ?? null;
      if (ideAccessToken || ideRefreshToken) {
        try {
          const fullAccount = this.store.get(saved.id);
          if (fullAccount) {
            let vaultRecord = this.readAntigravityVaultRecord(fullAccount);
            const currentAccessToken = vaultRecord.googleOAuth?.accessToken;
            const currentRefreshToken = vaultRecord.googleOAuth?.refreshToken;
            const needsTokenUpdate = (ideAccessToken && ideAccessToken !== currentAccessToken)
              || (ideRefreshToken && ideRefreshToken !== currentRefreshToken);

            if (needsTokenUpdate && vaultRecord.googleOAuth
              && ideRefreshToken === vaultRecord.googleOAuth.refreshToken) {
              const updatedGoogleOAuth = {
                ...vaultRecord.googleOAuth,
                refreshToken: ideRefreshToken ?? currentRefreshToken ?? vaultRecord.googleOAuth.refreshToken,
                accessToken: ideAccessToken ?? currentAccessToken ?? vaultRecord.googleOAuth.accessToken,
                expiresAt: officialState.oauth?.expiresAt ?? (Math.floor(Date.now() / 1000) + 3600),
                googleProjectId: officialState.googleProjectId ?? vaultRecord.googleOAuth.googleProjectId ?? saved.antigravity?.googleProjectId ?? null
              };
              vaultRecord = {
                ...vaultRecord,
                googleOAuth: updatedGoogleOAuth
              };
              this.switchTransactions.requireRecovered("antigravity");
              this.persistLocallyObservedAntigravityAuth(fullAccount, vaultRecord);
              this.emitLog(`Persisted rotated Antigravity credentials for ${saved.email}.`);
              changed = true;
            }
          }
        } catch (_error) {
          // Vault token sync failure should not break active session sync
        }
      }
    }

    if (changed) {
      this.emit("accounts-updated");
      return { status: "updated", accountId: saved.id };
    }

    return { status: "unchanged", accountId: saved.id };
  }

  async shutdown(): Promise<void> {
    this.refreshScheduler.dispose();
    this.importPreviews.clear();
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
    this.switchTransactions.requireRecovered("codex");
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
    this.switchTransactions.requireRecovered(account.platform);
    const epoch = this.refreshEpochs.get(account.id) ?? 0;
    return this.refreshScheduler.schedule(account.id, (signal) => this.operationLock.runExclusive(`provider:${account.platform}`, async () => {
      this.refreshContexts.set(account.id, { version: this.store.get(account.id)?.version ?? account.version, epoch, signal });
      try {
        this.ensureRefreshCurrent(account.id);
        const refreshed = await this.refreshAccountUnlocked(accountId);
        this.ensureRefreshCurrent(account.id);
        this.emit("accounts-updated");
        return refreshed;
      } finally { this.refreshContexts.delete(account.id); }
    }), { generation: account.version + ":" + epoch, priority: account.isActive ? RefreshPriority.active : RefreshPriority.manual });
  }

  private ensureRefreshCurrent(accountId: string): void {
    const context = this.refreshContexts.get(accountId);
    if (!context) return;
    const current = this.store.get(accountId);
    if (context.signal.aborted || !current || current.version !== context.version
      || (this.refreshEpochs.get(accountId) ?? 0) !== context.epoch) {
      const error = new Error("Stale quota response discarded");
      error.name = "AbortError";
      throw error;
    }
    this.switchTransactions.requireRecovered(current.platform);
  }

  private acceptOwnCredentialUpdate(accountId: string): void {
    const context = this.refreshContexts.get(accountId);
    const current = this.store.get(accountId);
    if (context && current) context.version = current.version;
  }

  private cancelAccountRefresh(accountId: string): void {
    this.refreshEpochs.set(accountId, (this.refreshEpochs.get(accountId) ?? 0) + 1);
    this.refreshScheduler.cancel(accountId);
  }

  private async refreshAccountUnlocked(accountId: string): Promise<ManagedAccount> {
    const account = this.store.get(accountId);
    if (!account) throw new Error("Account not found");
    this.switchTransactions.requireRecovered(account.platform);
    if (account.platform === "antigravity") {
      const blocked = this.refreshBackoff.getBlockedReason(account.id);
      if (blocked) {
        throw new Error(blocked.message);
      }
      try {
        const refreshed = await this.refreshAntigravityGoogleQuota(account);
        this.ensureRefreshCurrent(account.id);
        this.refreshBackoff.recordSuccess(account.id);
        return refreshed;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        this.ensureRefreshCurrent(account.id);
        const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
        this.refreshBackoff.recordFailure(account.id, message, { retryAfterSeconds: error instanceof ProviderRequestError ? error.retryAfterSeconds : null });
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
        if (error instanceof ProviderRequestError && error.requiresReauth) this.store.setCredentialState(account.id, "needs_reauth", message);
        return this.store.recordRateLimitFailure(account.id, message);
      }
    }
    const blocked = this.refreshBackoff.getBlockedReason(account.id);
    if (blocked) {
      throw new Error(blocked.message);
    }
    const globalStore = account.isActive ? inspectCodexCredentialStore(this.getGlobalCodexHome()) : null;
    const usesActiveGlobalSession = Boolean(globalStore?.managerCompatible && globalStore.authJsonPresent);
    const codexHome = usesActiveGlobalSession ? this.getGlobalCodexHome() : account.profileDir;
    let ownsHydratedProfile = !usesActiveGlobalSession;
    if (!usesActiveGlobalSession) {
      // A desktop sign-out must not destroy or downgrade the manager-owned
      // last-known-good profile. Poll its isolated CODEX_HOME instead; an
      // official provider rejection will still transition to needs_reauth.
      this.ensureProfileAuth(account);
    }

    let client = new CodexRpcClient(codexHome, this.requireCodexPath());
    const signal = this.refreshContexts.get(account.id)?.signal;
    const cancelProbe = () => { void client.stop(); };
    signal?.addEventListener("abort", cancelProbe, { once: true });
    let identityVerified = false;
    try {
      // Quota polling must not rotate credentials. Explicit validation/repair
      // owns the refresh-token path; the three-minute background poll only
      // verifies the hydrated identity and reads limits.
      let accountResponse: Awaited<ReturnType<typeof client.readAccount>>;
      let identity: CodexAccountIdentity;
      let effectiveUsesActiveGlobalSession = usesActiveGlobalSession;
      try {
        this.ensureRefreshCurrent(account.id);
        accountResponse = await client.readAccount(false);
        this.ensureRefreshCurrent(account.id);
        identity = getAccountIdentity(accountResponse.account, account.authMode ?? "chatgpt");
        if (!matchesCodexAccountIdentity(identity, account)
          || !matchesCodexAuthMaterial(inspectCodexAuthJson(readStableAuthJson(getAuthFilePath(codexHome))), account)) {
          throw new Error("Codex profile belongs to a different account");
        }
      } catch (error) {
        this.ensureRefreshCurrent(account.id);
        if (effectiveUsesActiveGlobalSession) {
          // The active global session drifted or threw. Fall back to isolated profileDir hydrated from vault.
          await client.stop();
          this.ensureProfileAuth(account);
          ownsHydratedProfile = true;
          client = new CodexRpcClient(account.profileDir, this.requireCodexPath());
          accountResponse = await client.readAccount(false);
        this.ensureRefreshCurrent(account.id);
          identity = getAccountIdentity(accountResponse.account, account.authMode ?? "chatgpt");
          if (!matchesCodexAccountIdentity(identity, account)
            || !matchesCodexAuthMaterial(inspectCodexAuthJson(readStableAuthJson(getAuthFilePath(account.profileDir))), account)) {
            throw new Error("Codex profile belongs to a different account");
          }
          effectiveUsesActiveGlobalSession = false;
        } else {
          const restored = isCodexProfileLoginError(error)
            && await this.restoreProfileAuthFromCurrentGlobalSession(account);
          if (!restored) throw error;

          await client.stop();
          client = new CodexRpcClient(account.profileDir, this.requireCodexPath());
          accountResponse = await client.readAccount(false);
        this.ensureRefreshCurrent(account.id);
          identity = getAccountIdentity(accountResponse.account, account.authMode ?? "chatgpt");
          if (!matchesCodexAccountIdentity(identity, account)
            || !matchesCodexAuthMaterial(inspectCodexAuthJson(readStableAuthJson(getAuthFilePath(account.profileDir))), account)) {
            throw new Error("Codex profile belongs to a different account");
          }
        }
      }
      identityVerified = true;
      if (effectiveUsesActiveGlobalSession) this.syncActiveGlobalAuthToVault(account);
      else this.syncProfileAuthToVault(account, true);
      this.acceptOwnCredentialUpdate(account.id);
      if (account.authMode === "apiKey") {
        this.refreshBackoff.recordSuccess(account.id);
        return this.store.setStatus(
          account.id,
          "active",
          "API key authenticated. Codex does not expose ChatGPT quota windows for this mode."
        );
      }
      const response = await client.readRateLimits(this.dependencies.getCodexQuotaReadOptions?.());
      this.ensureRefreshCurrent(account.id);
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
      if (error instanceof Error && error.name === "AbortError") throw error;
      this.ensureRefreshCurrent(account.id);
      const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
      const authenticationFailed = (error instanceof ProviderRequestError && error.requiresReauth)
        || (!identityVerified && isCodexProfileLoginError(error));
      if (authenticationFailed) this.refreshBackoff.recordSuccess(account.id);
      else this.refreshBackoff.recordFailure(account.id, message, { retryAfterSeconds: error instanceof ProviderRequestError ? error.retryAfterSeconds : null });
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
      if (authenticationFailed) {
        this.store.recordRateLimitFailure(account.id, message);
        return this.store.setCredentialState(account.id, "needs_reauth", message);
      }
      return this.store.recordRateLimitFailure(account.id, message);
    } finally {
      signal?.removeEventListener("abort", cancelProbe);
      await client.stop();
      // Never seal an auth.json that failed identity verification. A failed
      // app-server refresh can rewrite the file; persisting it would destroy
      // the last-known-good encrypted profile.
      if (ownsHydratedProfile) this.codexProfileVault.removePlaintext(account.profileDir);
    }
  }

  async validateAuth(accountId: string): Promise<AuthValidationState> {
    const account = this.store.get(accountId);
    if (!account) throw new Error("Account not found");
    this.switchTransactions.requireRecovered(account.platform);
    return this.operationLock.runExclusive("provider:" + account.platform, async () => {
      this.switchTransactions.requireRecovered(account.platform);
      const result = await this.validateAuthUnlocked(accountId);
      this.switchTransactions.requireRecovered(account.platform);
      if (["expired", "revoked", "needs_reauth"].includes(result.state)) this.store.setCredentialState(accountId, "needs_reauth", result.errorReason);
      this.emit("accounts-updated");
      return result;
    });
  }

  private async validateAuthUnlocked(accountId: string): Promise<AuthValidationState> {
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
            const client = resolveAntigravityOAuthClientForAccount(googleOAuth.oauthClientId);
            const refreshed = await refreshAntigravityGoogleAccessToken({
              clientId: client.clientId,
              clientSecret: client.clientSecret,
              refreshToken: googleOAuth.refreshToken,
              requestTimeoutMs: 10_000
            });
            googleOAuth.accessToken = refreshed.accessToken;
            googleOAuth.refreshToken = refreshed.refreshToken ?? googleOAuth.refreshToken;
            googleOAuth.expiresAt = refreshed.expiresAt ?? googleOAuth.expiresAt;
            googleOAuth.scope = refreshed.scope.length ? refreshed.scope : googleOAuth.scope;
            googleOAuth.tokenType = refreshed.tokenType ?? googleOAuth.tokenType;
            this.switchTransactions.requireRecovered(account.platform);
            this.persistLocallyObservedAntigravityAuth(account, record);
          } catch (error) {
            return {
              state: classifyAuthValidationError(error),
              lastValidatedAt: now,
              errorReason: redactSensitiveText(error instanceof Error ? error.message : String(error))
            };
          }
        }
        try {
          const userInfoFetcher = this.dependencies.fetchAntigravityGoogleUserInfo ?? fetchAntigravityGoogleUserInfo;
          const user = await userInfoFetcher({ accessToken: googleOAuth.accessToken, requestTimeoutMs: 10_000 });
          this.switchTransactions.requireRecovered(account.platform);
          if ((user.id && account.providerAccountId && user.id !== account.providerAccountId) || user.email.trim().toLowerCase() !== account.email.trim().toLowerCase()) {
            this.store.setCredentialState(account.id, "needs_review", "Antigravity credential identity mismatch");
            throw new Error("Antigravity credential identity mismatch");
          }
          this.store.markCredentialVerified(account.id);
          return {
            state: "authorized",
            lastValidatedAt: now,
            errorReason: null
          };
        } catch (error) {
          return {
            state: classifyAuthValidationError(error),
            lastValidatedAt: now,
            errorReason: redactSensitiveText(error instanceof Error ? error.message : String(error))
          };
        }
      }
      if (record?.credentials?.accessToken) {
        const now = Math.floor(Date.now() / 1000);
        try {
          const user = await (this.dependencies.fetchAntigravityGoogleUserInfo ?? fetchAntigravityGoogleUserInfo)({
            accessToken: record.credentials.accessToken, requestTimeoutMs: 10_000
          });
          this.switchTransactions.requireRecovered(account.platform);
          if (user.email.trim().toLowerCase() !== account.email.trim().toLowerCase()
            || (account.providerAccountId && user.id && user.id !== account.providerAccountId)) {
            this.store.setCredentialState(account.id, "needs_review", "Credential identity mismatch");
            throw new Error("Antigravity credential identity mismatch");
          }
          this.store.markCredentialVerified(account.id);
          return { state: "authorized", lastValidatedAt: now, errorReason: null };
        } catch (error) {
          return { state: classifyAuthValidationError(error), lastValidatedAt: now,
            errorReason: redactSensitiveText(error instanceof Error ? error.message : String(error)) };
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
          // Копия активного профиля не должна ротировать токен работающего Desktop.
          const response = await client.readAccount(refreshToken && !account.isActive);
          this.switchTransactions.requireRecovered(account.platform);
          const identity = getAccountIdentity(response.account, account.authMode ?? "chatgpt");
          if (!matchesCodexAccountIdentity(identity, account)
            || !matchesCodexAuthMaterial(inspectCodexAuthJson(readStableAuthJson(getAuthFilePath(account.profileDir))), account)) {
            throw new Error("Codex profile belongs to a different account");
          }
          return response;
        },
        expectedAuthMode: account.authMode ?? "chatgpt"
      });
      this.switchTransactions.requireRecovered(account.platform);
      if (result.state === "authorized") {
        this.store.markCredentialVerified(account.id);
        this.syncProfileAuthToVault(account, true);
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
    this.syncActiveCodexSession();
    await this.syncActiveAntigravitySession();

    const accounts = this.store.list();
    await Promise.all(accounts.filter((account) => !options.excludeAccountIds?.has(account.id)
      && !this.refreshBackoff.getBlockedReason(account.id)).map(async (account) => {
      try { await this.refreshAccount(account.id); }
      catch (error) { if (!(error instanceof Error && error.name === "AbortError")) this.emitLog(error); }
    }));
    return this.store.list();
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
    const account = this.store.get(accountId);
    if (!account) throw new Error("Account not found");
    return this.operationLock.runExclusive("provider:" + account.platform, () => this.prepareSwitchAccountUnlocked(accountId));
  }

  private async prepareSwitchAccountUnlocked(accountId: string): Promise<SwitchPreparationResult> {
    let target = this.store.get(accountId);
    if (!target) throw new Error("Account not found");
    this.switchTransactions.requireRecovered(target.platform);
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
    const tx = this.switchTransactions.get(transactionId);
    if (tx && ["failed", "aborted", "committed", "rolled_back", "recovery_required"].includes(tx.phase)) {
      return tx;
    }
    return this.switchTransactions.cancel(transactionId);
  }

  listSwitchTransactions(limit = 30): SwitchTransaction[] {
    return this.switchTransactions.list(limit);
  }

  reconcileInterruptedSwitches(): SwitchTransaction[] {
    return this.switchTransactions.reconcileInterrupted();
  }

  async recoverInterruptedSwitches(): Promise<SwitchTransaction[]> {
    return this.operationLock.runExclusive(["provider:codex", "provider:antigravity"], () =>
      this.crossProcessSwitchLock.runExclusive("startup-recovery", async () => {
        try { return await this.recoverInterruptedSwitchesUnlocked(); }
        finally { this.createDurableAuthBundleService().cleanupOrphanedTransientFiles(); }
      }));
  }

  private async recoverInterruptedSwitchesUnlocked(): Promise<SwitchTransaction[]> {
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
        const cancelled = this.switchTransactions.cancel(transaction.id);
        this.finishInterruptedAntigravityEvent(cancelled);
        recovered.push(cancelled);
        continue;
      }
      if (transaction.platform !== "codex") {
        if (transaction.backupPath) {
          try { await this.rollbackTransaction(transaction); }
          catch (error) { this.emitLog(error); }
          const result = this.switchTransactions.get(transaction.id)!;
          this.finishInterruptedAntigravityEvent(result);
          recovered.push(result);
        } else {
          const result = this.switchTransactions.advanceById(transaction.id, "recovery_required", {
            errorCode: "INTERRUPTED_PROVIDER_RECOVERY", errorMessage: "Interrupted provider activation has no verified snapshot."
          });
          this.finishInterruptedAntigravityEvent(result);
          recovered.push(result);
        }
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
          && manifestExists
          && this.createDurableAuthBundleService().verifyPreviousFiles(backupPath)
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
            await this.desktopLifecycle.launchAndWaitReady(diagnostics.selected, { allowExistingRoot: true });
          }
          current = this.switchTransactions.get(transaction.id) ?? current;
          if (current.phase === "launching") {
            current = this.switchTransactions.advanceById(current.id, "verifying", { backupPath });
          }
          const target = this.store.get(transaction.targetAccountId);
          if (!target) throw new Error("Interrupted switch target account no longer exists");
          await this.verifyActiveCodexAccount(target);
          this.switchTransactions.setVerification(current.id, {
            profileApplied: true, credentials: "probe_observed", credentialMethod: "codex.app_server.independent_probe",
            launch: "not_requested", runtime: "unsupported", runtimeSource: null, observedEmail: null,
            observedAt: null, runtimePid: null, message: "Аккаунт работающей IDE не подтверждён"
          });
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

  private finishInterruptedAntigravityEvent(transaction: SwitchTransaction): void {
    if (transaction.platform !== "antigravity") return;
    const event = this.store.getSwitchEvent(transaction.id);
    if (!event || event.status !== "running") return;
    this.store.recordSwitchEvent({
      id: event.id,
      accountId: event.accountId,
      previousAccountId: event.previousAccountId,
      startedAt: event.startedAt,
      completedAt: Math.floor(Date.now() / 1000),
      status: transaction.status === "rolled_back" ? "rolled_back" : "failed",
      error: transaction.errorMessage,
      backupPath: transaction.backupPath
    });
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
    this.switchTransactions.requireRecovered(account.platform);
    this.cancelAccountRefresh(account.id);
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
        : (await this.prepareSwitchAccountUnlocked(accountId)).transaction;
      if (!prepared) throw new Error("Prepared switch transaction not found");
      activeTransactionId = prepared.id;
      if (account.platform === "codex" && this.hasPendingReauthentication(account.id)) {
        throw new Error("The target Codex profile is still being reauthenticated. Finish the current sign-in before switching.");
      }
      if (prepared.targetAccountId !== accountId || prepared.platform !== account.platform) {
        throw new Error("Prepared switch does not match the requested account");
      }
      if (account.platform === "antigravity") {
        const previous = this.store.list().find((item) => item.platform === account.platform && item.isActive);
        if (prepared.previousAccountId !== (previous?.id ?? null)) {
          throw new Error("The active Antigravity profile changed. Confirm the switch again.");
        }
        if (this.store.get(accountId)?.credentialState !== "ready") {
          throw new Error("The Antigravity profile must be verified before switching.");
        }
      }
      this.switchTransactions.begin(prepared.id, accountId);
      return this.performSwitchAccount(accountId, prepared.id);
    };
    const promise = this.operationLock.runExclusive(`provider:${account.platform}`, () =>
      this.crossProcessSwitchLock.runExclusive(`switch:${accountId}`, execute)
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
      const eventId = transactionId;
      const startedAt = Math.floor(Date.now() / 1000);
      const previousAccountId = this.store.list().find((item) => item.platform === "antigravity" && item.isActive)?.id ?? null;
      let backup: AntigravityProfileBackupManifest | null = null;
      let stopped: AntigravityAsyncProcessInput | null = null;
      this.store.recordSwitchEvent({ id: eventId, accountId, previousAccountId, startedAt,
        completedAt: null, status: "running", error: null, backupPath: null });
      try {
        const record = this.readAntigravityVaultRecord(account);
        const pathInput = this.getAntigravityPathInputForAccount(account);
        const hub = resolveAntigravityPaths({ ...pathInput, target: "hub" });
        const preferredTarget = pathInput.target ?? (record.googleOAuth && fs.existsSync(hub.appStoragePath) ? "hub" : "ide");
        const selected = await this.dependencies.resolveAntigravitySwitchTarget?.({ ...pathInput, target: preferredTarget });
        const target = selected?.target ?? preferredTarget;
        const runtimeInput = { ...pathInput, target, exePath: selected?.exePath };
        if (target === "ide" && !getAntigravityProfileStatus(runtimeInput).readyForWriteActions) {
          throw new Error("Antigravity IDE profile is not ready for safe writes");
        }
        const { credentials, refreshed } = await this.getAntigravitySwitchCredentials(record);
        const { accessToken, refreshToken } = credentials;
        const needsCredentialStore = target === "hub" || canReadCurrentWindowsCredentialStore(pathInput)
          || Boolean(this.dependencies.writeAntigravityCredentialStoreToken);
        if (needsCredentialStore && (!this.dependencies.readAntigravityCredentialStorePayload
          || !this.dependencies.writeAntigravityCredentialStoreToken || !this.dependencies.restoreAntigravityCredentialStorePayload)) {
          throw new Error("Antigravity Credential Manager adapters are unavailable");
        }
        const verifyCredentials = this.dependencies.fetchAntigravityGoogleUserInfo ?? fetchAntigravityGoogleUserInfo;
        const user = await verifyCredentials({ accessToken, requestTimeoutMs: 10_000 });
        this.switchTransactions.requireRecovered(account.platform);
        if (user.verifiedEmail === false || (account.providerAccountId && user.id && account.providerAccountId !== user.id)
          || user.email.trim().toLowerCase() !== account.email.trim().toLowerCase()) {
          this.store.setCredentialState(account.id, "needs_review", "Antigravity credential identity mismatch");
          throw new Error("Antigravity credential identity mismatch");
        }
        if (refreshed) this.store.updateObservedAuthMaterial(account.id, this.vault.encryptUtf8(JSON.stringify(record)), true);
        else this.store.markCredentialVerified(account.id);
        if (this.switchTransactions.get(transactionId)?.phase !== "quiescing") throw new Error("Antigravity switch was cancelled");
        const quiesced = await this.quiesceAntigravityRuntime(runtimeInput);
        if (!quiesced.quiesced) throw new Error(`Antigravity could not be stopped: ${quiesced.reason}`);
        const launchInput = { ...runtimeInput, exePath: quiesced.exePath ?? runtimeInput.exePath ?? null };
        if (quiesced.wasRunning) stopped = launchInput;
        const credentialSnapshot = needsCredentialStore
          ? await this.captureAntigravityCredentialSnapshot(runtimeInput) : undefined;
        this.switchTransactions.requireRecovered(account.platform);
        const snapshot = createAntigravityProfileBackup({ ...runtimeInput,
          backupRoot: path.join(this.appDataDir, "antigravity-backups"),
          sealBackup: (contents) => this.vault.encryptUtf8(contents), credentialSnapshot,
          runtime: { target, exePath: launchInput.exePath, wasRunning: quiesced.wasRunning } });
        this.switchTransactions.advanceById(transactionId, "activating", { backupPath: snapshot.backupDir });
        backup = snapshot;
        this.store.recordSwitchEvent({ id: eventId, accountId, previousAccountId, startedAt,
          completedAt: null, status: "running", error: null, backupPath: backup.backupDir });
        if (target === "ide") {
          const cleaned = cleanAntigravitySessionCache(runtimeInput);
          if (cleaned.errors.length) throw new Error("Antigravity session cache could not be safely prepared");
          const protection: AntigravityBackupProtection = {
            existingBackup: backup, sealBackup: (contents) => this.vault.encryptUtf8(contents),
            unsealBackup: (contents) => this.vault.decryptUtf8(contents), credentialSnapshot
          };
          const applied = applyAntigravityAccountWritePlan({ ...runtimeInput, ...protection,
            backupRoot: path.join(this.appDataDir, "antigravity-backups"), credentials: {
              ...credentials, googleProjectId: credentials.googleProjectId ?? account.antigravity?.googleProjectId ?? null
            } });
          if (!applied.applied) throw new Error("Antigravity profile was not applied");
        }
        if (needsCredentialStore) {
          const storeResult = await this.dependencies.writeAntigravityCredentialStoreToken!(
            { accessToken, refreshToken, expiresAt: credentials.expiresAt ?? null }, pathInput.platform);
          if (!storeResult.applied) throw new Error("Antigravity Credential Manager write failed");
          const readback = await this.dependencies.readAntigravityCredentialStorePayload!(pathInput.platform);
          let material: { token?: { access_token?: string; refresh_token?: string } } | null;
          try {
            material = JSON.parse(readback?.payload ?? "null");
          } catch {
            throw new Error("Antigravity Credential Manager readback is invalid");
          }
          if (material?.token?.access_token !== accessToken || material.token?.refresh_token !== refreshToken) {
            throw new Error("Antigravity Credential Manager readback mismatch");
          }
        }
        this.switchTransactions.setVerification(transactionId, {
          profileApplied: true, credentials: "online_verified", credentialMethod: "google.userinfo",
          launch: "not_requested", runtime: "pending", runtimeSource: null, observedEmail: null,
          observedAt: null, runtimePid: null, message: "Профиль записан и проверен"
        });
        this.switchTransactions.advanceById(transactionId, "launching", { backupPath: backup.backupDir });
        const launched = await this.launchAntigravityRuntime(launchInput);
        if (!launched.restarted) throw new Error("Antigravity launch failed: " + launched.reason);
        this.switchTransactions.advanceById(transactionId, "verifying");
        const runtime = await this.collectRuntimeEvidence(account, launchInput, launched);
        const evidence: SwitchVerificationEvidence = { ...runtime, profileApplied: true,
          credentials: "online_verified", credentialMethod: "google.userinfo",
          launch: launched.windowObserved ? "window_observed" : "process_started" };
        this.switchTransactions.setVerification(transactionId, evidence);
        if (evidence.runtime === "mismatch") throw new Error(evidence.message);
        const saved = this.switchTransactions.finalizeWithActiveAccount(transactionId, "committed", accountId,
          { backupPath: backup.backupDir }).account;
        this.store.recordSwitchEvent({ id: eventId, accountId, previousAccountId, startedAt,
          completedAt: Math.floor(Date.now() / 1000), status: "completed", error: null, backupPath: backup.backupDir });
        this.emitLog(evidence.message);
        return saved;
      } catch (error) {
        const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
        if (this.switchTransactions.get(transactionId)?.status === "committed") {
          this.emitLog(error);
          return this.store.get(accountId)!;
        }
        if (
          (error instanceof ProviderRequestError && error.requiresReauth)
          || /invalid_grant|token expired|reauth|sign.?in required/i.test(message)
        ) {
          this.store.setCredentialState(accountId, "needs_reauth", message);
          this.emit("accounts-updated");
        }
        if (backup) {
          await this.rollbackTransaction(this.switchTransactions.get(transactionId)!, message).catch((rollbackError) => this.emitLog(rollbackError));
        } else if (!backup && stopped) {
          try {
            const reopened = await this.launchAntigravityRuntime(stopped, false);
            if (!reopened.restarted) throw new Error(reopened.reason);
          } catch (launchError) {
            this.emitLog(launchError);
          }
        }
        this.store.recordSwitchEvent({ id: eventId, accountId, previousAccountId, startedAt,
          completedAt: Math.floor(Date.now() / 1000), status: "failed", error: message, backupPath: backup?.backupDir ?? null });
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
    let quiesceResult;
    try {
      quiesceResult = this.desktopLifecycle
        ? await this.desktopLifecycle.quiesce(
          this.dependencies.getDesktopClosePolicy?.() ?? "exact-tree-fallback"
        )
        : null;
      if (quiesceResult && (quiesceResult.status === "blocked" || quiesceResult.status === "ambiguous")) {
        throw new Error(`Codex desktop could not be safely closed before activation: ${quiesceResult.message}`);
      }
    } catch (quiesceError) {
      const quiesceMessage = quiesceError instanceof Error ? quiesceError.message : String(quiesceError);
      this.switchTransactions.advanceById(transactionId, "failed", {
        errorCode: "PRE_ACTIVATION_QUIESCE_FAILED",
        errorMessage: quiesceMessage
      });
      throw quiesceError;
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
      let launchedPid: number | null = null;
      if (this.desktopLifecycle && quiesceResult?.identity) {
        const readiness = await this.desktopLifecycle.launchAndWaitReady(quiesceResult.identity);
        launchedPid = readiness.rootPid;
        this.emitLog(
          `Launched exact desktop package ${readiness.identity.packageFullName}; visible root PID=${readiness.rootPid}.`
        );
      } else if (this.desktopLifecycle && process.platform === "win32") {
        this.emitLog("Codex auth bundle activated. Desktop package was not identified for relaunch.");
      } else if (process.platform !== "win32") {
        this.emitLog("Codex auth bundle activated. Desktop lifecycle verification is Windows-only.");
      }
      this.switchTransactions.advanceById(transactionId, "verifying");
      await this.verifyActiveCodexAccount(targetAccount);
      this.switchTransactions.setVerification(transactionId, {
        profileApplied: true, credentials: "probe_observed", credentialMethod: "codex.app_server.independent_probe",
        launch: launchedPid ? "window_observed" : "not_requested", runtime: "unsupported", runtimeSource: null,
        observedEmail: null, observedAt: null, runtimePid: launchedPid,
        message: "Аккаунт работающей IDE не подтверждён"
      });
      const saved = this.switchTransactions.finalizeWithActiveAccount(
        transactionId,
        "committed",
        accountId,
        { backupPath: switchResult.backupPath }
      ).account;
      this.emitLog(`Codex profile committed; independent credentials probe checked, Desktop account unconfirmed: ${accountId}.`);
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

  private async collectRuntimeEvidence(
    account: ManagedAccount,
    input: AntigravityAsyncProcessInput = this.getAntigravityPathInputForAccount(account),
    launched?: AntigravityRestartResult
  ): Promise<SwitchVerificationEvidence> {
    const base: SwitchVerificationEvidence = {
      profileApplied: account.runtimeVerification?.profileApplied ?? false,
      credentials: account.runtimeVerification?.credentials ?? "not_checked",
      credentialMethod: account.runtimeVerification?.credentialMethod ?? null,
      launch: account.runtimeVerification?.launch ?? "not_requested",
      runtime: "unsupported", runtimeSource: null, observedEmail: null, observedAt: null, runtimePid: null,
      message: "Аккаунт работающей IDE не подтверждён"
    };
    if (account.platform === "codex") return base;
    const verify = this.dependencies.verifyAntigravityRuntimeIdentity ?? verifyAntigravityRuntimeIdentity;
    const expectedIde = launched?.pid && launched.creationTime ? { pid: launched.pid, creationTime: launched.creationTime } : undefined;
    const runtimeInput = { ...input, exePath: launched?.exePath ?? input.exePath, expectedIde };
    let evidence = await verify(account.email, runtimeInput);
    if (expectedIde) {
      for (const wait of [350, 800]) {
        if (evidence.runtime === "verified") break;
        await delay(wait);
        const next = await verify(account.email, runtimeInput);
        if (evidence.runtime !== "mismatch" || next.runtime !== "unsupported") evidence = next;
      }
    }
    return { ...base, ...evidence,
      message: input.target === "hub" && evidence.runtime === "unsupported" && !this.dependencies.verifyAntigravityRuntimeIdentity
        ? "Аккаунт записан в Windows. Подтвердить активный сеанс Antigravity пока не удалось"
        : evidence.message };
  }

  async verifyRuntimeAccount(accountId: string): Promise<SwitchVerificationEvidence> {
    const requested = this.store.get(accountId);
    if (!requested) throw new Error("Account not found");
    return this.operationLock.runExclusive("provider:" + requested.platform, async () => {
      this.switchTransactions.requireRecovered(requested.platform);
      const account = this.store.get(accountId);
      if (!account?.isActive) throw new Error("Runtime verification requires the currently selected profile");
      const latest = this.switchTransactions.list(100).find((item) => item.platform === account.platform && item.backupPath);
      const transaction = latest?.targetAccountId === account.id && latest.status === "committed" ? latest : null;
      const runtime = account.platform === "antigravity" && transaction?.backupPath
        ? this.readAntigravityRollbackManifest(transaction.backupPath).runtime : undefined;
      const evidence = await this.collectRuntimeEvidence(account, {
        ...this.getAntigravityPathInputForAccount(account), target: runtime?.target, exePath: runtime?.exePath
      });
      const current = this.store.get(accountId);
      this.switchTransactions.requireRecovered(account.platform);
      if (!current?.isActive || current.version !== account.version) {
        throw new Error("Profile changed during runtime verification; retry for the selected profile");
      }
      if (transaction) this.switchTransactions.setVerification(transaction.id, evidence);
      else this.store.setRuntimeVerification(account.id, evidence);
      if (evidence.runtime === "mismatch" && transaction?.backupPath) {
        await this.crossProcessSwitchLock.runExclusive("runtime-rollback:" + transaction.id, () => this.rollbackTransaction(transaction));
      }
      this.emit("accounts-updated");
      return evidence;
    });
  }

  private async captureAntigravityCredentialSnapshot(input: AntigravityPathInput): Promise<AntigravityCredentialSnapshot> {
    const result = await this.dependencies.readAntigravityCredentialStorePayload!(input.platform);
    return { existed: result !== null, value: result?.payload ?? null };
  }

  private readAntigravityRollbackManifest(backupDir: string): AntigravityProfileBackupManifest {
    const root = path.join(this.appDataDir, "antigravity-backups");
    const manifest = readAntigravityBackupManifest(assertManagedPath(root, backupDir));
    if (manifest.version !== 2 || !manifest.sealedManifest) {
      throw new Error("Legacy Antigravity backup has no authenticated full snapshot; recovery inspection is required");
    }
    verifySealedAntigravityBackupManifest(manifest, (sealed) => this.vault.decryptUtf8(sealed));
    if (manifest.backupDir !== backupDir) throw new Error("Antigravity rollback snapshot location does not match the transaction");
    return manifest;
  }

  private async restoreAntigravityBackup(manifest: AntigravityProfileBackupManifest, input: AntigravityPathInput): Promise<void> {
    if ((input.target === "hub" || canReadCurrentWindowsCredentialStore(input)) && !manifest.credentialSnapshot) {
      throw new Error("Antigravity rollback snapshot has no Credential Manager state");
    }
    if (manifest.credentialSnapshot && !this.dependencies.restoreAntigravityCredentialStorePayload) {
      throw new Error("Credential Manager rollback adapter is unavailable");
    }
    const restored = restoreAntigravityProfileBackup(manifest, {
      unsealBackup: (sealed) => this.vault.decryptUtf8(sealed), pathInput: input,
      backupRoot: path.join(this.appDataDir, "antigravity-backups")
    });
    if (restored.credentialSnapshot) {
      await this.dependencies.restoreAntigravityCredentialStorePayload!(restored.credentialSnapshot);
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

    if (matched && !matchesCodexAuthMaterial(metadata, matched)) matched = null;
    if (!matched) {
      if (recordedActive) this.store.clearActive("codex");
      this.emitLog("The current Codex authorization is not a managed profile; it will be preserved only as the switch rollback bundle.");
      return null;
    }

    if (accountResponse?.account) {
      const identity = getAccountIdentity(accountResponse.account, matched.authMode ?? "chatgpt");
      if (!matchesCodexAccountIdentity(identity, matched)) {
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
    if (!event?.backupPath || !fs.existsSync(event.backupPath)) throw new Error("Switch backup is unavailable");
    const target = this.store.get(event.accountId);
    if (!target) throw new Error("Switch target profile is unavailable");
    return this.operationLock.runExclusive("provider:" + target.platform, () =>
      this.crossProcessSwitchLock.runExclusive("rollback:" + eventId, async () => {
        const transaction = this.switchTransactions.list(100).find((item) => item.platform === target.platform && item.backupPath);
        if (!transaction || transaction.backupPath !== event.backupPath || transaction.targetAccountId !== event.accountId
          || !["committed", "recovery_required"].includes(transaction.status)) {
          throw new Error("Only the latest applied provider snapshot can be restored. Historical or incomplete backups require inspection.");
        }
        const selected = this.store.get(transaction.targetAccountId);
        if (transaction.status !== "recovery_required" && !selected?.isActive) {
          throw new Error("The selected provider profile changed after this snapshot. Inspect recovery before restoring it.");
        }
        await this.rollbackTransaction(transaction);
        this.store.recordSwitchEvent({ id: crypto.randomUUID(), accountId: event.previousAccountId ?? event.accountId,
          previousAccountId: event.accountId, startedAt: Math.floor(Date.now() / 1000),
          completedAt: Math.floor(Date.now() / 1000), status: "rolled_back", error: null, backupPath: event.backupPath });
        this.emit("accounts-updated");
        return this.getSwitchHistory();
      })
    );
  }

  private async rollbackTransaction(transaction: SwitchTransaction, activationError?: string): Promise<void> {
    if (!transaction.backupPath) throw new Error("Rollback snapshot is unavailable");
    const target = this.store.get(transaction.targetAccountId);
    const previous = transaction.previousAccountId ? this.store.get(transaction.previousAccountId) : null;
    if (!target) throw new Error("Rollback target metadata is unavailable");
    const current = ["committed", "recovery_required"].includes(transaction.status)
      ? this.switchTransactions.beginRollback(transaction.id)
      : transaction.phase === "rolling_back" ? transaction : this.switchTransactions.advanceById(transaction.id, "rolling_back",
        activationError ? { errorCode: "ANTIGRAVITY_ACTIVATION_FAILED", errorMessage: activationError } : {});
    let previousEvidence: SwitchVerificationEvidence | null = null;
    try {
      if (current.platform === "antigravity") {
        const manifest = this.readAntigravityRollbackManifest(current.backupPath!);
        const runtimeInput = { ...this.getAntigravityPathInputForAccount(target),
          target: manifest.runtime?.target, exePath: manifest.runtime?.exePath };
        const stopped = await this.quiesceAntigravityRuntime(runtimeInput);
        if (!stopped.quiesced) throw new Error(`Antigravity rollback could not stop the application: ${stopped.reason}`);
        await this.restoreAntigravityBackup(manifest, runtimeInput);
        const shouldReopen = manifest.runtime
          ? manifest.runtime.wasRunning || (!activationError && stopped.wasRunning)
          : Boolean(previous) || stopped.wasRunning;
        if (shouldReopen) {
          const launchInput = { ...runtimeInput, target: runtimeInput.target ?? stopped.target,
            exePath: stopped.exePath ?? runtimeInput.exePath };
          const launched = await this.launchAntigravityRuntime(launchInput);
          if (!launched.restarted) throw new Error(`Antigravity rollback launch failed: ${launched.reason}`);
          if (previous) {
            const evidence = await this.collectRuntimeEvidence(previous, launchInput, launched);
            if (evidence.runtime === "mismatch") throw new Error("Antigravity rollback identity mismatch");
            previousEvidence = { ...evidence, profileApplied: true, launch: launched.windowObserved ? "window_observed" : "process_started" };
          }
        }
      } else {
        const stopped = await this.desktopLifecycle?.quiesce("exact-tree-fallback");
        if (stopped && !["not-running", "quiesced"].includes(stopped.status)) throw new Error("Codex rollback could not stop Desktop");
        const service = this.createCodexSwitchService();
        if (fs.statSync(current.backupPath!).isDirectory()) await service.rollback(current.backupPath!);
        else {
          const authJson = readStableAuthJson(current.backupPath!);
          const activePath = getAuthJsonPath(this.getGlobalCodexHome());
          const active = fs.existsSync(activePath) ? readStableAuthJson(activePath) : null;
          await service.switchTo({ transactionId: crypto.randomUUID(), accountId: previous?.id ?? target.id,
            previousAccountId: target.id, expectedAuthAccountId: getAuthAccountId(authJson), authJson,
            compatibilityFiles: buildCodexCompatibilityFiles(this.getGlobalCodexHome(), authJson, active) });
        }
        let pid: number | null = null;
        if (this.desktopLifecycle && stopped?.identity) pid = (await this.desktopLifecycle.launchAndWaitReady(stopped.identity)).rootPid;
        if (previous) {
          await this.verifyActiveCodexAccount(previous);
          previousEvidence = { profileApplied: true, credentials: "probe_observed",
            credentialMethod: "codex.app_server.independent_probe", launch: pid ? "window_observed" : "not_requested",
            runtime: "unsupported", runtimeSource: null, observedEmail: null, observedAt: null, runtimePid: pid,
            message: "Аккаунт работающей IDE не подтверждён" };
        }
      }
      const details = { backupPath: current.backupPath,
        ...(activationError ? { errorCode: "ANTIGRAVITY_ROLLED_BACK", errorMessage: activationError } : {}) };
      this.store.setRuntimeVerification(target.id, null);
      if (previous) this.switchTransactions.finalizeWithActiveAccount(current.id, "rolled_back", previous.id,
        details);
      else {
        this.store.clearActive(current.platform);
        this.switchTransactions.advanceById(current.id, "rolled_back", details);
      }
      if (previous) this.store.setRuntimeVerification(previous.id, previousEvidence);
    } catch (error) {
      this.switchTransactions.advanceById(current.id, "recovery_required", { backupPath: current.backupPath,
        errorCode: activationError ? "ANTIGRAVITY_RECOVERY_REQUIRED" : "MANUAL_ROLLBACK_FAILED",
        errorMessage: redactSensitiveText(error instanceof Error ? error.message : String(error)) });
      throw error;
    }
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
    const selected = this.store.get(accountId);
    if (!selected) return;
    return this.operationLock.runExclusive("provider:" + selected.platform, () => this.deleteAccountUnlocked(accountId));
  }

  private async deleteAccountUnlocked(accountId: string): Promise<void> {
    this.cancelAccountRefresh(accountId);
    const account = this.store.get(accountId);
    if (account) this.switchTransactions.requireRecovered(account.platform);
    if (account?.isActive) throw new Error("Selected account must be switched before deletion");
    if (account?.platform === "codex" && fs.existsSync(account.profileDir)) {
      const owned = assertManagedPath(getProfilesDir(this.appDataDir), account.profileDir);
      fs.rmSync(owned, { recursive: true, force: true });
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

  previewImport(filePath: string, passphrase: string): AccountImportPreview {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error("Import requires a regular account export file up to 64 MiB");
    const payload = decryptPortablePayload(fs.readFileSync(filePath, "utf8"), passphrase);
    const finiteTime = z.number().finite().nonnegative().nullable().optional();
    const schema = z.object({
      id: z.string().min(1).max(1024), platform: z.enum(["codex", "antigravity"]).optional(),
      email: z.string().trim().min(1).max(320), label: z.string().max(512).optional(),
      planType: z.string().max(128).nullable().optional(),
      authJson: z.string().max(maximumAuthJsonBytes).optional(),
      antigravityVaultJson: z.string().max(maximumAuthJsonBytes).optional(),
      notes: z.string().max(65536).nullable().optional(),
      createdAt: finiteTime, updatedAt: finiteTime, lastUsedAt: finiteTime,
      lastRefreshAt: finiteTime, subscriptionEndsAt: finiteTime,
      rateLimitJson: z.string().max(maximumAuthJsonBytes).nullable().optional()
    }).passthrough();
    const accounts = z.array(schema).max(2000).parse(payload.accounts);
    const records: AccountExportRecord[] = [];
    const entries: AccountImportPreview["entries"] = [];
    const identities = new Set(this.store.list().flatMap((account) => this.importIdentities(account)));
    const now = Math.floor(Date.now() / 1000);
    for (const item of accounts) {
      const platform = item.platform ?? "codex";
      let metadata: ReturnType<typeof inspectCodexAuthJson> | null = null;
      let vaultRecord: AntigravityVaultRecord | null = null;
      if (platform === "codex") {
        if (!item.authJson) throw new Error("Codex export entry is missing credentials");
        const parsed: unknown = JSON.parse(item.authJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Codex credentials must be a JSON object");
        metadata = inspectCodexAuthJson(item.authJson);
        if (!metadata.inferredAuthMode) throw new Error("Codex export entry has no usable credential material");
        if (metadata.email && metadata.email.toLowerCase() !== item.email.toLowerCase()) throw new Error("Export email does not match Codex credential material");
      } else {
        if (!item.antigravityVaultJson) throw new Error("Antigravity export entry is missing credentials");
        const parsed: unknown = JSON.parse(item.antigravityVaultJson);
        const recordSchema = z.object({
          format: z.literal(antigravityVaultFormat), version: z.literal(antigravityVaultVersion),
          authMode: z.enum(["manual_credentials", "local_profile", "google_oauth"]).optional(),
          credentials: z.object({
            accountId: z.string().min(1), email: z.string().min(1), refreshToken: z.string().min(1),
            accessToken: z.string().nullable().optional(), expiresAt: finiteTime
          }).passthrough().optional(),
          googleOAuth: z.object({
            accountId: z.string().min(1), email: z.string().min(1), accessToken: z.string().min(1),
            refreshToken: z.string().nullable(), oauthClientId: z.string().min(1),
            redirectUri: z.string(), scope: z.array(z.string()), expiresAt: finiteTime
          }).passthrough().optional(),
          localProfile: z.object({ accountId: z.string().min(1), email: z.string().nullable(), profileDir: z.string() }).passthrough().optional()
        }).passthrough().refine((record) => Boolean(record.credentials || record.googleOAuth || record.localProfile), "Missing Antigravity credential material");
        vaultRecord = recordSchema.parse(parsed) as unknown as AntigravityVaultRecord;
        const materialEmail = vaultRecord.googleOAuth?.email ?? vaultRecord.credentials?.email ?? vaultRecord.localProfile?.email;
        if (materialEmail && materialEmail.toLowerCase() !== item.email.toLowerCase()) throw new Error("Export email does not match Antigravity credential material");
        if (vaultRecord.credentials) delete vaultRecord.credentials.persona;
      }
      if (item.rateLimitJson) {
        const limits: unknown = JSON.parse(item.rateLimitJson);
        if (!limits || typeof limits !== "object" || Array.isArray(limits)) throw new Error("Export quota snapshot is invalid");
      }
      const id = crypto.randomUUID();
      const record: AccountExportRecord = {
        id, platform, label: item.label || getDisplayLabel(item.email), email: item.email,
        planType: item.planType ?? "unknown", profileDir: getProfileDir(this.appDataDir, id),
        encryptedAuthJson: this.vault.encryptUtf8(platform === "codex" ? item.authJson! : JSON.stringify(vaultRecord)),
        isActive: false, createdAt: item.createdAt ?? now, updatedAt: now,
        lastUsedAt: item.lastUsedAt ?? null, lastRefreshAt: null,
        subscriptionEndsAt: item.subscriptionEndsAt ?? null, status: "unknown",
        statusReason: "Imported credential material requires verification.", rateLimitJson: item.rateLimitJson ?? null,
        notes: item.notes ?? null, authMode: metadata?.inferredAuthMode ?? null,
        providerAccountId: metadata?.providerAccountId ?? vaultRecord?.googleOAuth?.accountId ?? vaultRecord?.credentials?.accountId ?? null,
        workspaceAccountId: metadata?.workspaceAccountId ?? null, workspaceLabel: metadata?.workspaceLabel ?? null,
        authFingerprint: metadata?.authFingerprint ?? null, credentialState: "needs_review",
        lastAuthenticatedAt: null, expiresAt: metadata?.expiresAt ?? vaultRecord?.googleOAuth?.expiresAt ?? null, version: 1,
        antigravity: platform === "antigravity" ? {
          googleProjectId: vaultRecord?.googleOAuth?.googleProjectId ?? vaultRecord?.credentials?.googleProjectId ?? null,
          fingerprintId: null, lastQuotaRefreshAt: null, forbidden: false, ideStateDetected: false
        } : null
      };
      const keys = this.importIdentities(record);
      const conflict = keys.some((key) => identities.has(key));
      entries.push({ email: record.email, label: record.label, platform, action: conflict ? "skip" : "import",
        reason: conflict ? "An existing profile or earlier entry has the same identity." : null });
      if (!conflict) { for (const key of keys) identities.add(key); records.push(record); }
    }
    for (const [id, saved] of this.importPreviews) if (saved.preview.expiresAt <= now) this.importPreviews.delete(id);
    if (this.importPreviews.size >= 4) this.importPreviews.delete(this.importPreviews.keys().next().value!);
    const preview: AccountImportPreview = { previewId: crypto.randomUUID(), total: accounts.length,
      importableCount: records.length, skippedCount: accounts.length - records.length, expiresAt: now + 600, entries };
    this.importPreviews.set(preview.previewId, { preview, records, revision: this.importRevision() });
    return preview;
  }

  async applyImport(previewId: string): Promise<AccountImportResult> {
    return this.operationLock.runExclusive(["import", "provider:codex", "provider:antigravity"], async () => {
      const saved = this.importPreviews.get(previewId);
      if (!saved || saved.preview.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("Import preview has expired. Preview the file again.");
      if (saved.revision !== this.importRevision()) throw new Error("Profiles changed after preview. Preview the file again.");
      for (const record of saved.records) this.switchTransactions.requireRecovered(record.platform ?? "codex");
      const imported = this.store.importPortableBatch(saved.records);
      this.importPreviews.delete(previewId);
      this.emit("accounts-updated");
      return { importedCount: imported.length, skippedCount: saved.preview.skippedCount, accounts: this.list() };
    });
  }

  async importAccounts(filePath: string, passphrase: string): Promise<AccountImportResult> {
    return this.applyImport(this.previewImport(filePath, passphrase).previewId);
  }

  private importIdentities(account: Pick<AccountExportRecord, "platform" | "email" | "authMode" | "authFingerprint" | "providerAccountId" | "workspaceAccountId">): string[] {
    const provider = account.platform ?? "codex";
    if (account.authMode === "apiKey") return [provider + ":key:" + account.authFingerprint];
    const scope = ":" + (account.workspaceAccountId ?? "");
    return [provider + ":email:" + account.email.trim().toLowerCase() + scope,
      ...(account.providerAccountId ? [provider + ":subject:" + account.providerAccountId + scope] : [])];
  }

  private importRevision(): string {
    return crypto.createHash("sha256").update(JSON.stringify(this.store.list().map((account) =>
      [account.id, account.version, account.authFingerprint, account.email, account.workspaceAccountId]))).digest("hex");
  }

  detectLocalSessions(): { codex: boolean; codexEmail: string | null; antigravity: boolean } {
    let codex = false;
    let codexEmail: string | null = null;
    try {
      const globalHome = this.getGlobalCodexHome();
      const store = inspectCodexCredentialStore(globalHome);
      if (store.managerCompatible && store.authJsonPresent) {
        const metadata = inspectCodexAuthJson(readStableAuthJson(getAuthJsonPath(globalHome)));
        codex = metadata.inferredAuthMode !== null;
        codexEmail = codex ? metadata.email : null;
      }
    } catch {
      // ignore read error
    }

    let antigravity = false;
    try {
      const payload = readAntigravityCredentialStorePayload(process.platform);
      if (payload?.payload) antigravity = true;
    } catch {
      // ignore cred store error
    }

    return { codex, codexEmail, antigravity };
  }

  async importCurrentCodexSession(): Promise<{ imported: boolean; account: ManagedAccount | null; reason: string }> {
    return this.operationLock.runExclusive("provider:codex", () => this.importCurrentCodexSessionUnlocked());
  }

  private async importCurrentCodexSessionUnlocked(): Promise<{ imported: boolean; account: ManagedAccount | null; reason: string }> {
    this.switchTransactions.requireRecovered("codex");
    const globalHome = this.getGlobalCodexHome();
    const store = inspectCodexCredentialStore(globalHome);
    if (!store.managerCompatible) {
      return { imported: false, account: null, reason: store.message };
    }
    const authPath = getAuthJsonPath(globalHome);
    if (!fs.existsSync(authPath)) {
      return { imported: false, account: null, reason: "Файл auth.json не найден в ~/.codex" };
    }
    const authJson = readStableAuthJson(authPath);
    const metadata = inspectCodexAuthJson(authJson);
    if (!metadata.inferredAuthMode) {
      return { imported: false, account: null, reason: "Файл auth.json не содержит действительной авторизации" };
    }

    const synced = this.matchAndSyncCodexSession(authJson, metadata, false);
    if (synced.accountId) {
      return { imported: true, account: this.store.get(synced.accountId), reason: "Выбран существующий профиль Codex." };
    }
    if (synced.status === "ambiguous") {
      return { imported: false, account: null, reason: "Сеансу соответствуют несколько профилей. Выберите профиль и подтвердите вход." };
    }

    const profileId = crypto.randomUUID();
    const profileDir = getProfileDir(this.appDataDir, profileId);
    fs.mkdirSync(profileDir, { recursive: true });

    const globalConfig = path.join(globalHome, "config.toml");
    if (fs.existsSync(globalConfig)) {
      try {
        fs.copyFileSync(globalConfig, path.join(profileDir, "config.toml"));
      } catch {
        // ignore copy error
      }
    }

    const encryptedAuthJson = this.vault.encryptUtf8(authJson);
    let email: string | null = null;
    let planType: PlanType = "unknown";
    let parsedJson: Record<string, unknown> | null = null;

    try {
      parsedJson = JSON.parse(authJson) as Record<string, unknown>;
      const tokens = parsedJson.tokens as { id_token?: string; access_token?: string } | undefined;
      const token = tokens?.id_token || tokens?.access_token;
      if (token && typeof token === "string") {
        const parts = token.split(".");
        if (parts.length >= 2) {
          const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
          const jwtPayload = JSON.parse(payloadJson);
          if (jwtPayload.email) email = jwtPayload.email;
          if (jwtPayload["https://api.openai.com/auth"]?.plan_type) {
            planType = jwtPayload["https://api.openai.com/auth"].plan_type;
          }
          if (jwtPayload["https://api.openai.com/profile"]?.email) {
            email = jwtPayload["https://api.openai.com/profile"].email;
          }
        }
      }
    } catch {
      // ignore parse error
    }

    const identitySuffix = metadata.providerAccountId ?? metadata.authFingerprint.slice(0, 8);
    const resolvedEmail = email ?? `codex:${identitySuffix}`;
    const label = email ? getDisplayLabel(email) : `Codex · ${identitySuffix}`;

    const account = this.store.upsert({
      id: profileId,
      label,
      email: resolvedEmail,
      planType,
      profileDir,
      encryptedAuthJson,
      rateLimits: null,
      authMode: (parsedJson?.auth_mode === "apiKey" || parsedJson?.auth_mode === "enterpriseAccessToken")
        ? parsedJson.auth_mode
        : parsedJson?.OPENAI_API_KEY ? "apiKey" : "chatgpt",
      providerAccountId: metadata.providerAccountId,
      workspaceAccountId: metadata.workspaceAccountId,
      workspaceLabel: metadata.workspaceLabel,
      authFingerprint: metadata.authFingerprint,
      credentialState: "needs_review",
      clearRefreshError: true,
      lastAuthenticatedAt: null,
      expiresAt: metadata.expiresAt,
      version: 1,
      status: "unknown",
      statusReason: null
    });

    this.store.setActive(account.id);
    const saved = this.store.get(account.id);
    if (saved) {
      this.syncProfileAuthToVault(saved);
      void this.refreshAccount(account.id).catch(() => {});
    }
    this.emit("accounts-updated");
    return { imported: true, account: saved ?? account, reason: "Активный профиль Codex успешно импортирован." };
  }

  async importCurrentAntigravitySession(): Promise<{ imported: boolean; account: ManagedAccount | null; reason: string }> {
    const credentialStoreReader = this.dependencies.readAntigravityCredentialStorePayload ?? readAntigravityCredentialStorePayload;
    const credentialStorePayload = await credentialStoreReader(process.platform);
    if (!credentialStorePayload || !credentialStorePayload.payload) {
      return {
        imported: false,
        account: null,
        reason: "Сессия Antigravity не обнаружена в Windows Credential Manager (цель gemini:antigravity). Войдите в Antigravity IDE или используйте Google OAuth."
      };
    }

    const parsed = parseAntigravityCredentialPayload({
      payload: credentialStorePayload.payload,
      source: credentialStorePayload.strategy
    });

    if (parsed.length === 0) {
      return {
        imported: false,
        account: null,
        reason: "Не удалось прочитать действительный токен Antigravity из диспетчера учётных данных."
      };
    }

    const batch = await this.importParsedAntigravityCredentials(parsed);
    const firstImported = batch.imported[0];
    if (firstImported) {
      return this.operationLock.runExclusive("provider:antigravity", async () => {
        this.switchTransactions.requireRecovered("antigravity");
        const account = this.store.get(firstImported.accountId);
        if (!account) throw new Error("Imported Antigravity profile is unavailable");
        const selected = this.store.setActive(account.id);
        this.emit("accounts-updated");
        return { imported: true, account: selected,
          reason: `Сессия Antigravity (${account.email}) сохранена. Аккаунт работающей IDE не подтверждён.` };
      });
    }

    const failureReason = batch.failures[0]?.reason ?? "Неизвестная ошибка импорта сессии Antigravity";
    return {
      imported: false,
      account: null,
      reason: `Не удалось авторизовать сессию Antigravity: ${failureReason}`
    };
  }

  async importAntigravityFromIde(pathInput: AntigravityPathInput = {}): Promise<AntigravityImportResult> {
    this.switchTransactions.requireRecovered("antigravity");
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
        const client = resolveAntigravityOAuthClient();
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
      ? await credentialStoreReader(pathInput.platform ?? process.platform)
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

    return this.operationLock.runExclusive("provider:antigravity", async () => {
      this.switchTransactions.requireRecovered("antigravity");
      const identity = extractAntigravityLocalIdentity(pathInput);
      const email = identity.email ?? `${identity.accountId}@local.antigravity`;
      const existing = this.store.getByPlatformEmail("antigravity", email);
      if (existing) return { imported: true, account: existing,
        reason: "Профиль уже сохранён. Локальные данные не заменяют его credentials.", status, identity };
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
        id: identity.accountId,
        platform: "antigravity",
        label: identity.label,
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
        credentialState: "needs_review",
        lastAuthenticatedAt: null,
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
    });
  }

  async importAntigravityGoogleOAuth(input: AntigravityGoogleOAuthResult, pathInput: AntigravityPathInput = {}): Promise<AntigravityImportResult> {
    return this.operationLock.runExclusive("provider:antigravity", () => this.importAntigravityGoogleOAuthUnlocked(input, pathInput));
  }

  private async importAntigravityGoogleOAuthUnlocked(
    input: AntigravityGoogleOAuthResult,
    pathInput: AntigravityPathInput = {}
  ): Promise<AntigravityImportResult> {
    this.switchTransactions.requireRecovered("antigravity");
    const status = getAntigravityProfileStatus(pathInput);
    const now = Math.floor(Date.now() / 1000);
    const accountId = input.user.id ?? crypto.createHash("sha256").update(input.user.email).digest("hex").slice(0, 24);
    const dbId = antigravityAccountDbId(`google-oauth:${accountId}`);
    const existing = this.store.getByPlatformEmail("antigravity", input.user.email);
    const label = existing?.label ?? input.user.name ?? getDisplayLabel(input.user.email);
    const googleProjectId = input.accountContext.googleProjectId;
    const planType: PlanType = "unknown";
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

    const isNew = !existing;
    const account = this.store.upsert({
      id: existing?.id ?? dbId,
      platform: "antigravity",
      providerAccountId: input.user.id,
      credentialState: "ready",
      lastAuthenticatedAt: now,
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

    const shouldActivate = false;
    const accountWithQuota = account;
    this.scheduleAntigravityGoogleQuotaRefresh(account.id, vaultRecord);

    this.emitLog(
      isNew
        ? `Добавлен новый Antigravity Google аккаунт: ${input.user.email}.`
        : `Обновлена авторизация существующего Antigravity Google аккаунта: ${input.user.email}.`
    );
    return {
      imported: true,
      account: accountWithQuota,
      reason: isNew
        ? shouldActivate
          ? `Новый аккаунт Google (${input.user.email}) успешно добавлен и активирован.`
          : `Новый аккаунт Google (${input.user.email}) успешно добавлен.`
        : shouldActivate
          ? `Авторизация активного аккаунта Google (${input.user.email}) успешно обновлена.`
          : `Авторизация существующего аккаунта Google (${input.user.email}) успешно обновлена.`,
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

  async importAntigravityCredentials(input: AntigravityManualImportInput, pathInput: AntigravityPathInput = {}): Promise<AntigravityManualImportResult> {
    return this.operationLock.runExclusive("provider:antigravity", () => this.importAntigravityCredentialsUnlocked(input, pathInput));
  }

  private async importAntigravityCredentialsUnlocked(
    input: AntigravityManualImportInput,
    pathInput: AntigravityPathInput = {}
  ): Promise<AntigravityManualImportResult> {
    this.switchTransactions.requireRecovered("antigravity");
    const credentials: AntigravityCredentialPackage = {
      accountId: input.accountId.trim(),
      email: input.email.trim(),
      refreshToken: input.refreshToken.trim(),
      accessToken: normalizeNullableString(input.accessToken),
      expiresAt: input.expiresAt ?? null,
      googleProjectId: normalizeNullableString(input.googleProjectId)
    };
    const status = getAntigravityProfileStatus(pathInput);
    const existing = this.store.getByPlatformEmail("antigravity", credentials.email);
      const accountId = existing?.id ?? antigravityAccountDbId(credentials.accountId);
      const label = normalizeNullableString(input.label) ?? existing?.label ?? getDisplayLabel(credentials.email);
      const vaultRecord: AntigravityVaultRecord = {
        format: antigravityVaultFormat,
        version: antigravityVaultVersion,
        authMode: "manual_credentials",
        credentials,
        fingerprintId: null,
        importedAt: Math.floor(Date.now() / 1000)
      };
    const account = this.store.upsert({
        id: accountId,
        platform: "antigravity",
        providerAccountId: credentials.accountId,
        label,
        email: credentials.email,
        planType: "unknown",
        profileDir: status.diagnostics.userDataDir,
        encryptedAuthJson: this.vault.encryptUtf8(JSON.stringify(vaultRecord)),
        rateLimits: null,
        antigravity: {
          googleProjectId: credentials.googleProjectId ?? null,
          fingerprintId: null,
          lastQuotaRefreshAt: null,
          forbidden: false,
          ideStateDetected: status.detected
        },
        credentialState: "needs_review",
        lastAuthenticatedAt: null,
        status: "unknown",
        statusReason: "Antigravity credentials imported; validation has not completed."
      });

    const tokenFields: Array<"refreshToken" | "accessToken"> = ["refreshToken"];
    if (credentials.accessToken) tokenFields.push("accessToken");
    return {
      imported: true,
      account,
      status,
      summary: {
        accountId: credentials.accountId,
        email: credentials.email,
        stateKeys: [],
        storageKeys: [],
        writesMachineId: false,
        tokenFields
      },
      backupId: "vault-only",
      backupDir: ""
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
      this.discardUncommittedLoginProfile(pending.profileDir);
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
    this.switchTransactions.requireRecovered("codex");
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

    this.switchTransactions.requireRecovered("codex");
    const authPath = getAuthFilePath(input.profileDir);
    if (!fs.existsSync(authPath)) throw new Error("Codex did not create auth.json for this profile");
    const authJson = readStableAuthJson(authPath);
    const metadata = inspectCodexAuthJson(authJson);
    const replaceAccount = input.replaceAccountId ? this.store.get(input.replaceAccountId) : null;
    if (input.replaceAccountId && !replaceAccount) throw new Error("The profile being reauthenticated no longer exists");
    if (replaceAccount && input.authMode !== "apiKey" && replaceAccount.authMode !== "apiKey" && (
      !compatibleCodexEmail(identity.email, replaceAccount.email)
      || !compatibleCodexEmail(metadata.email, replaceAccount.email)
      || (replaceAccount.providerAccountId && metadata.providerAccountId !== replaceAccount.providerAccountId)
      || (replaceAccount.workspaceAccountId && metadata.workspaceAccountId !== replaceAccount.workspaceAccountId)
    )) {
      throw new Error("Sign-in returned a different account or workspace. Add it as a separate profile.");
    }
    const encryptedAuthJson = this.vault.encryptUtf8(authJson);
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

    if (replaceAccount?.isActive && replaceAccount.authFingerprint !== metadata.authFingerprint) {
      this.store.clearActive("codex");
      this.emitLog("Credentials were verified and saved. Apply the profile explicitly to update Desktop.");
    }

    if (
      input.replaceAccountId
      && input.previousProfileDir
      && input.previousProfileDir !== input.profileDir
      && this.codexProfileVault.isManagedProfile(input.previousProfileDir)
    ) {
      fs.rmSync(assertManagedPath(getProfilesDir(this.appDataDir), input.previousProfileDir), { recursive: true, force: true });
    }
    const savedWithSecrets = this.store.get(account.id);
    return savedWithSecrets ? this.codexProfileVault.sealVerified(savedWithSecrets, { identityVerified: true }) : account;
  }

  private async failPendingLogin(loginId: string, profileId: string, message: string): Promise<void> {
    const pending = this.pendingLogins.get(loginId);
    if (!pending || pending.profileId !== profileId) return;
    this.pendingLogins.delete(loginId);
    if (pending.pollTimer) clearTimeout(pending.pollTimer);
    const event: AuthEvent = { loginId, profileId, success: false, error: redactSensitiveText(message) };
    this.emit("auth-event", event);
    await pending.client.stop();
    this.discardUncommittedLoginProfile(pending.profileDir);
  }

  private discardUncommittedLoginProfile(profileDir: string): void {
    if (!this.codexProfileVault.isManagedProfile(profileDir)) return;
    if (this.store.list().some((account) => path.resolve(account.profileDir) === path.resolve(profileDir))) return;
    fs.rmSync(assertManagedPath(getProfilesDir(this.appDataDir), profileDir), { recursive: true, force: true });
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

  private syncProfileAuthToVault(account: ManagedAccount, identityVerified = false): void {
    try {
      this.switchTransactions.requireRecovered(account.platform);
      const current = this.store.get(account.id);
      if (!current) return;
      this.codexProfileVault.sealVerified(current, { identityVerified });
    } catch (error) {
      this.emitLog(`Profile auth cache sync skipped for ${account.email}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persistLocallyObservedAntigravityAuth(account: ManagedAccount, record: AntigravityVaultRecord): void {
    this.store.updateObservedAuthMaterial(account.id, this.vault.encryptUtf8(JSON.stringify(record)));
  }

  private syncActiveGlobalAuthToVault(account: ManagedAccount): ManagedAccount {
    const authPath = getAuthJsonPath(this.getGlobalCodexHome());
    if (!fs.existsSync(authPath)) throw new Error("The active Codex session has no auth.json");
    const authJson = readStableAuthJson(authPath);
    const metadata = inspectCodexAuthJson(authJson);
    if (!matchesCodexAuthMaterial(metadata, account)) throw new Error("Codex profile belongs to a different account");
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
    if (!inspectCodexCredentialStore(globalCodexHome).managerCompatible) return false;
    if (path.resolve(globalCodexHome).toLowerCase() === path.resolve(account.profileDir).toLowerCase()) return false;

    const globalAuthPath = getAuthJsonPath(globalCodexHome);
    if (!fs.existsSync(globalAuthPath)) return false;

    const globalClient = new CodexRpcClient(globalCodexHome, this.requireCodexPath());
    try {
      const globalIdentity = getAccountIdentity(
        (await globalClient.readAccount(false)).account,
        account.authMode ?? "chatgpt"
      );
      if (!matchesCodexAccountIdentity(globalIdentity, account)) return false;

      const authJson = readStableAuthJson(globalAuthPath);
      if (!matchesCodexAuthMaterial(inspectCodexAuthJson(authJson), account)) return false;
      const profileAuthPath = getAuthFilePath(account.profileDir);
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

    const signal = this.refreshContexts.get(account.id)?.signal;
    const now = Math.floor(Date.now() / 1000);
    const client = resolveAntigravityOAuthClientForAccount(googleOAuth.oauthClientId);
    const clientId = client.clientId;
    const clientSecret = client.clientSecret;
    const isCurrentlyActive = this.store.list().some((item) => item.platform === "antigravity" && item.isActive && item.id === account.id);

    // If account is currently active, synchronize live tokens from Windows Credential Manager
    if (isCurrentlyActive) {
      try {
        const credReader = this.dependencies.readAntigravityCredentialStorePayload ?? readAntigravityCredentialStorePayload;
        const credResult = await credReader(process.platform);
        if (credResult?.payload) {
          const parsedCred = JSON.parse(credResult.payload) as {
            token?: { refresh_token?: string; access_token?: string; expiry?: string };
          };
          const credAccessToken = parsedCred?.token?.access_token?.trim();
          const credRefreshToken = parsedCred?.token?.refresh_token?.trim();
          if (credAccessToken && credRefreshToken === googleOAuth.refreshToken) {
            let credExpiresAt: number | null = null;
            if (parsedCred?.token?.expiry) {
              const ms = Date.parse(parsedCred.token.expiry);
              if (Number.isFinite(ms)) credExpiresAt = Math.floor(ms / 1000);
            }
            if (credAccessToken !== googleOAuth.accessToken || (credRefreshToken && credRefreshToken !== googleOAuth.refreshToken)) {
              googleOAuth.accessToken = credAccessToken;
              if (credRefreshToken) googleOAuth.refreshToken = credRefreshToken;
              if (credExpiresAt) googleOAuth.expiresAt = credExpiresAt;
              this.ensureRefreshCurrent(account.id);
              this.persistLocallyObservedAntigravityAuth(account, record);
              this.acceptOwnCredentialUpdate(account.id);
              this.emitLog(`Refreshed live credentials from Windows Credential Manager for active account ${account.email}.`);
            }
          }
        }
      } catch (_credErr) {
        // Fall back to stored tokens
      }
    }

    if (!googleOAuth.expiresAt || !googleOAuth.accessToken || googleOAuth.expiresAt <= now + antigravityRefreshSkewSeconds) {
      if (!googleOAuth.refreshToken) {
        throw new Error("Antigravity Google access token expired and no refresh token is available. Reauthorize through Google Sign-In.");
      }
      const refreshed = await refreshAntigravityGoogleAccessToken({
        clientId,
        clientSecret,
        refreshToken: googleOAuth.refreshToken, signal
      });
      googleOAuth.accessToken = refreshed.accessToken;
      googleOAuth.refreshToken = refreshed.refreshToken ?? googleOAuth.refreshToken;
      googleOAuth.expiresAt = refreshed.expiresAt ?? googleOAuth.expiresAt;
      googleOAuth.scope = refreshed.scope.length ? refreshed.scope : googleOAuth.scope;
      googleOAuth.tokenType = refreshed.tokenType ?? googleOAuth.tokenType;
      this.ensureRefreshCurrent(account.id);
      this.persistLocallyObservedAntigravityAuth(account, record);
      this.acceptOwnCredentialUpdate(account.id);
    }

    this.ensureRefreshCurrent(account.id);
    const user = await (this.dependencies.fetchAntigravityGoogleUserInfo ?? fetchAntigravityGoogleUserInfo)({ accessToken: googleOAuth.accessToken, requestTimeoutMs: 10_000, signal });
    this.ensureRefreshCurrent(account.id);
    if (user.email.trim().toLowerCase() !== account.email.trim().toLowerCase()
      || (user.id && account.providerAccountId && user.id !== account.providerAccountId)) {
      this.store.setCredentialState(account.id, "needs_review", "Antigravity credential identity mismatch");
      throw new Error("Antigravity credential identity mismatch");
    }
    this.store.markCredentialVerified(account.id);
    const quotaFetcher = this.dependencies.fetchAntigravityQuota ?? fetchAntigravityQuota;
    const targetProject = googleOAuth.googleProjectId ?? account.antigravity?.googleProjectId ?? "aicode-consumers";
    const cachedContext =
      googleOAuth.tier && googleOAuth.tier !== "unknown"
        ? {
            googleProjectId: googleOAuth.googleProjectId ?? targetProject,
            tier: googleOAuth.tier,
            tierId: googleOAuth.tierId ?? null,
            source: "code_assist" as const,
            errorReason: null
          }
        : undefined;
    let quota: AntigravityQuotaResult | null = null;

    // For the active account, query live telemetry from local Language Server first if running (only in real runtime or if specifically injected)
    const liveQuotaFetcher = this.dependencies.fetchAntigravityLiveQuota ?? fetchAntigravityLiveQuota;
    const shouldFetchLiveQuota =
      Boolean(this.dependencies.fetchAntigravityLiveQuota) ||
      (process.env.NODE_ENV !== "test" && !this.dependencies.fetchAntigravityQuota);
    if (isCurrentlyActive && shouldFetchLiveQuota) {
      try {
        const liveQuota = await liveQuotaFetcher(this.getAntigravityPathInputForAccount(account));
        if (liveQuota?.groups && liveQuota.groups.length > 0 && liveQuota.identityEmail?.trim().toLowerCase() === account.email.trim().toLowerCase()) {
          const nowSeconds = Math.floor(Date.now() / 1000);
          const models = parseSummaryGroups(liveQuota, nowSeconds);
          if (models.length > 0) {
            quota = quotaResultFromModels(models, cachedContext ?? {
              googleProjectId: targetProject,
              tier: googleOAuth.tier ?? "unknown",
              tierId: googleOAuth.tierId ?? null,
              source: "code_assist",
              errorReason: null
            }, false);
            this.emitLog(`Fetched live quota telemetry from Antigravity Language Server for ${account.email}.`);
          }
        }
      } catch (_liveErr) {
        // Fall back to Google API
      }
    }

    if (!quota) {
      try {
        quota = await quotaFetcher({
          accessToken: googleOAuth.accessToken,
          googleProjectId: targetProject,
          accountContext: cachedContext,
          requestTimeoutMs: 15_000, signal
        });
      } catch (firstError) {
        const errStr = String(firstError);
        if (errStr.includes("401") && googleOAuth.refreshToken) {
          const refreshed = await refreshAntigravityGoogleAccessToken({
            clientId,
            clientSecret,
            refreshToken: googleOAuth.refreshToken, signal
          });
          googleOAuth.accessToken = refreshed.accessToken;
          googleOAuth.refreshToken = refreshed.refreshToken ?? googleOAuth.refreshToken;
          googleOAuth.expiresAt = refreshed.expiresAt ?? googleOAuth.expiresAt;
          this.ensureRefreshCurrent(account.id);
      this.store.updateEncryptedAuthJson(account.id, this.vault.encryptUtf8(JSON.stringify(record)));
      this.acceptOwnCredentialUpdate(account.id);
          quota = await quotaFetcher({
            accessToken: googleOAuth.accessToken,
            googleProjectId: targetProject,
            accountContext: cachedContext,
            requestTimeoutMs: 15_000, signal
          });
        } else {
          throw firstError;
        }
      }
    }

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
      this.ensureRefreshCurrent(account.id);
      this.store.updateEncryptedAuthJson(account.id, this.vault.encryptUtf8(JSON.stringify(record)));
      this.acceptOwnCredentialUpdate(account.id);
    }

    this.ensureRefreshCurrent(account.id);
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
    const fetchUserInfo = this.dependencies.fetchAntigravityGoogleUserInfo ?? fetchAntigravityGoogleUserInfo;

    for (const credential of parsed) {
      try {
        const client = resolveAntigravityOAuthClient();
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
        const ctxFetcher = this.dependencies.fetchAntigravityGoogleAccountContext ?? fetchAntigravityGoogleAccountContext;
        let accountContext: AntigravityGoogleAccountContext;
        try {
          accountContext = await ctxFetcher({
            accessToken: refreshed.accessToken,
            requestTimeoutMs: 15_000
          });
        } catch {
          accountContext = {
            googleProjectId: credential.googleProjectId ?? "aicode-consumers",
            tier: "free",
            tierId: "free-tier",
            source: "code_assist",
            errorReason: null
          };
        }
        if (!accountContext.googleProjectId) {
          accountContext.googleProjectId = "aicode-consumers";
        }
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

  private scheduleAntigravityGoogleQuotaRefresh(accountId: string, _record: AntigravityVaultRecord): void {
    void this.refreshAccount(accountId).catch((error) => {
      if (!(error instanceof Error && error.name === "AbortError")) this.emitLog(error);
    });
  }

  private async quiesceAntigravityRuntime(input: AntigravityAsyncProcessInput): Promise<AntigravityQuiesceResult> {
    return (this.dependencies.quiesceAntigravity ?? quiesceAntigravityAsync)(input);
  }

  private async launchAntigravityRuntime(
    input: AntigravityAsyncProcessInput,
    requireQuiescent = true
  ): Promise<AntigravityRestartResult> {
    const launch = this.dependencies.launchAntigravity ?? this.dependencies.restartAntigravityIntegration ?? launchAntigravityAsync;
    return launch({ ...input, requireQuiescent });
  }

  private async getAntigravitySwitchCredentials(record: AntigravityVaultRecord): Promise<{
    credentials: AntigravityCredentialPackage & { accessToken: string };
    refreshed: boolean;
  }> {
    const token = record.googleOAuth ?? record.credentials;
    if (!token?.refreshToken?.trim()) {
      throw new Error("Antigravity profile has no refresh token. Reauthorize through Google Sign-In.");
    }
    const expiresSoon = token.expiresAt
      ? token.expiresAt <= Math.floor(Date.now() / 1000) + antigravityRefreshSkewSeconds
      : Boolean(record.googleOAuth);
    const refreshed = !token.accessToken || expiresSoon;
    if (refreshed) {
      const client = resolveAntigravityOAuthClientForAccount(record.googleOAuth?.oauthClientId);
      const refresh = this.dependencies.refreshAntigravityGoogleAccessToken ?? refreshAntigravityGoogleAccessToken;
      const result = await refresh({ clientId: client.clientId, clientSecret: client.clientSecret, refreshToken: token.refreshToken });
      token.accessToken = result.accessToken;
      token.refreshToken = result.refreshToken ?? token.refreshToken;
      token.expiresAt = result.expiresAt;
      if (record.googleOAuth) {
        if (result.scope.length) record.googleOAuth.scope = result.scope;
        record.googleOAuth.tokenType = result.tokenType ?? record.googleOAuth.tokenType;
      }
    }
    if (!token.accessToken?.trim()) throw new Error("Antigravity profile has no attachable access token. Sign in first.");
    return {
      credentials: { accountId: token.accountId, email: token.email, accessToken: token.accessToken,
        refreshToken: token.refreshToken, expiresAt: token.expiresAt, googleProjectId: token.googleProjectId },
      refreshed
    };
  }

  regenerateAntigravityFingerprint(_accountId: string): ManagedAccount {
    throw new Error("Fingerprint manipulation is unavailable in Egoist");
  }

  getStore(): AccountStore {
    return this.store;
  }

  setCodexPath(codexPath: string | null): void { this.codexPath = codexPath; }

  getCodexPath(): string | null {
    if (this.codexPath && fs.existsSync(this.codexPath)) {
      return this.codexPath;
    }
    const fresh = resolveCodexPath();
    if (fresh && fs.existsSync(fresh)) {
      this.codexPath = fresh;
    }
    return this.codexPath ?? fresh;
  }

  async warmupAccountQuotaTimer(accountId: string): Promise<QuotaWarmupAccountResult> {
    const service = new QuotaWarmupService(this);
    return service.warmupAccount(accountId);
  }

  async warmupAllQuotaTimers(): Promise<QuotaWarmupFleetResult> {
    const service = new QuotaWarmupService(this);
    return service.warmupAll();
  }

  private getAntigravityPathInputForAccount(account: ManagedAccount): AntigravityPathInput {
    if (this.dependencies.antigravityPathInput) return this.dependencies.antigravityPathInput;
    if (process.platform === "win32") {
      return { platform: "win32", appData: process.env.APPDATA, home: process.env.USERPROFILE ?? os.userInfo().homedir };
    }
    const managedProfile = path.relative(getProfilesDir(this.appDataDir), account.profileDir);
    const appData = managedProfile && !managedProfile.startsWith("..") && !path.isAbsolute(managedProfile)
      ? process.env.APPDATA
      : path.dirname(account.profileDir);
    return {
      platform: process.platform,
      appData,
      home: (appData ? inferHomeFromAppData(appData) : null) ?? process.env.USERPROFILE ?? process.env.HOME
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
    let candidate = this.codexPath;
    if (!candidate || !fs.existsSync(candidate)) {
      candidate = resolveCodexPath();
      if (candidate && fs.existsSync(candidate)) {
        this.codexPath = candidate;
      }
    }
    const executable = ensureExecutableCodexPath(candidate);
    if (!executable || !fs.existsSync(executable)) {
      throw new Error("Codex CLI was not found. Install or launch Codex Desktop, then try again.");
    }
    this.codexPath = executable;
    return executable;
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
