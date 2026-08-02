import type { AuthValidationState } from "./authState.js";
import type { CodexCapabilityReport } from "./codexCapabilities.js";
import type { ProviderQuotaState } from "./providerAdapter.js";

export type PlanType =
  | "free"
  | "go"
  | "standard"
  | "plus"
  | "pro"
  | "prolite"
  | "team"
  | "business"
  | "enterprise"
  | "edu"
  | "unknown"
  | string;

export type AccountPlatform = "codex" | "antigravity";
export type CodexAuthMode = "chatgpt" | "apiKey" | "enterpriseAccessToken";
export type CodexLoginMethod = "chatgpt" | "chatgptDeviceCode" | "apiKey" | "enterpriseAccessToken";
export type CredentialState = "ready" | "drifted" | "needs_reauth" | "needs_review";

export type CodexLoginRequest =
  | { type: "chatgpt" | "chatgptDeviceCode" }
  | { type: "apiKey" | "enterpriseAccessToken"; credential: string };

export type { AuthState, AuthValidationState } from "./authState.js";
export type {
  CodexCapabilityReport,
  CodexCapabilityStability,
  CodexLoginCapability,
  CodexLoginMethodId,
  CodexProtocolRuntime,
  CodexRuntimeIdentity
} from "./codexCapabilities.js";
export type {
  ProviderAdapterMetadata,
  ProviderCapability,
  ProviderCapabilityConfidence,
  ProviderCapabilitySource,
  ProviderLimitWindowMetadata,
  ProviderLimitWindowType,
  ProviderQuotaSource,
  ProviderQuotaState
} from "./providerAdapter.js";

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface RateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  planType: PlanType | null;
  rateLimitReachedType: string | null;
}

export interface AntigravityAccountDetails {
  googleProjectId: string | null;
  fingerprintId: string | null;
  lastQuotaRefreshAt: number | null;
  forbidden: boolean;
  ideStateDetected: boolean;
}

export interface AntigravityDiagnostics {
  profileKind: "hub" | "vscode_ide" | "legacy_vscode_ide" | "unknown";
  userDataDir: string;
  globalStorageDir: string;
  stateDbPath: string;
  storageJsonPath: string;
  machineIdPath: string;
  appStoragePath: string;
  geminiDataDir: string;
  installationIdPath: string;
  userDataDirExists: boolean;
  stateDbExists: boolean;
  storageJsonExists: boolean;
  machineIdExists: boolean;
  appStorageExists: boolean;
  geminiDataDirExists: boolean;
  installationIdExists: boolean;
}

export interface AntigravityStateDbInspection {
  exists: boolean;
  readable: boolean;
  itemTableFound: boolean;
  itemCount: number | null;
  authRelatedItemCount: number | null;
  error: string | null;
}

export interface AntigravityStorageJsonInspection {
  exists: boolean;
  readable: boolean;
  validJson: boolean;
  topLevelKeyCount: number | null;
  authRelatedKeyCount: number | null;
  error: string | null;
}

export interface AntigravityMachineIdInspection {
  exists: boolean;
  readable: boolean;
  hashPrefix: string | null;
  error: string | null;
}

export interface AntigravityProfileInspection {
  inspectedAt: number;
  stateDb: AntigravityStateDbInspection;
  storageJson: AntigravityStorageJsonInspection;
  machineId: AntigravityMachineIdInspection;
}

export interface AntigravityLocalIdentity {
  email: string | null;
  accountId: string;
  label: string;
  fingerprintId: string;
  googleProjectId: string | null;
  source: "state_db" | "storage_json" | "machine_id" | "profile_path";
  confidence: "confirmed" | "inferred" | "unknown";
}

export interface AntigravityCapability {
  supported: boolean;
  reason: string | null;
}

export interface AntigravityProfileStatus {
  detected: boolean;
  readyForWriteActions: boolean;
  message: string;
  diagnostics: AntigravityDiagnostics;
  inspection: AntigravityProfileInspection;
  capabilities: {
    diagnostics: AntigravityCapability;
    importFromIde: AntigravityCapability;
    switchAccount: AntigravityCapability;
    refreshQuota: AntigravityCapability;
  };
}

export interface AntigravityImportResult {
  imported: boolean;
  account: ManagedAccount | null;
  reason: string;
  status: AntigravityProfileStatus;
  identity?: AntigravityLocalIdentity | null;
}

export interface AntigravityManualImportInput {
  label?: string;
  email: string;
  accountId: string;
  refreshToken: string;
  accessToken?: string | null;
  expiresAt?: number | null;
  googleProjectId?: string | null;
  fingerprintId?: string | null;
  machineId?: string | null;
}

export interface AntigravityManualImportResult {
  imported: boolean;
  account: ManagedAccount;
  status: AntigravityProfileStatus;
  summary: {
    accountId: string;
    email: string;
    stateKeys: string[];
    storageKeys: string[];
    writesMachineId: boolean;
    tokenFields: Array<"refreshToken" | "accessToken">;
  };
  backupId: string;
  backupDir: string;
}

export interface AntigravityOAuthStartResult {
  sessionId: string;
  authUrl: string;
  redirectUri: string;
  expiresAt: number;
}

export interface AntigravityOAuthFinishInput {
  sessionId: string;
  callbackUrl?: string | null;
}

export type AntigravityCredentialImportSource =
  | "token_json"
  | "local_files"
  | "cockpit"
  | "antigravity_tools"
  | "plugin"
  | "local_db";

export interface AntigravityCredentialPayloadImportInput {
  payload: string;
  source?: AntigravityCredentialImportSource;
}

export interface AntigravityCredentialImportFailure {
  source: string;
  email: string | null;
  reason: string;
}

export interface AntigravityCredentialImportSummary {
  accountId: string;
  email: string;
  label: string;
  source: string;
}

export interface AntigravityCredentialBatchImportResult {
  importedCount: number;
  failedCount: number;
  imported: AntigravityCredentialImportSummary[];
  failures: AntigravityCredentialImportFailure[];
  accounts: ManagedAccount[];
}

export interface ManagedAccount {
  id: string;
  platform: AccountPlatform;
  label: string;
  email: string;
  authMode: CodexAuthMode | null;
  providerAccountId: string | null;
  workspaceAccountId: string | null;
  workspaceLabel: string | null;
  authFingerprint: string | null;
  credentialState: CredentialState;
  lastAuthenticatedAt: number | null;
  expiresAt: number | null;
  version: number;
  planType: PlanType;
  profileDir: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  lastRefreshAt: number | null;
  /** Last failed quota probe. Kept separate from authorization and the last good snapshot. */
  lastRefreshErrorAt?: number | null;
  lastRefreshError?: string | null;
  subscriptionEndsAt: number | null;
  status: "unknown" | "active" | "near_limit" | "limited" | "error";
  statusReason: string | null;
  primaryUsedPercent: number | null;
  primaryResetsAt: number | null;
  primaryWindowDurationMins: number | null;
  secondaryUsedPercent: number | null;
  secondaryResetsAt: number | null;
  secondaryWindowDurationMins: number | null;
  fiveHourUsedPercent: number | null;
  fiveHourResetsAt: number | null;
  weeklyUsedPercent: number | null;
  weeklyResetsAt: number | null;
  notes: string | null;
  tags?: string[];
  favorite?: boolean;
  archived?: boolean;
  antigravity?: AntigravityAccountDetails | null;
}

export interface LoginStartResult {
  loginId: string;
  profileId: string;
  type: CodexLoginMethod;
  completed?: boolean;
  account?: ManagedAccount;
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
  deviceCodeCopied?: boolean;
  loginPageOpened?: boolean;
}

export interface DeviceCodeHandoffResult {
  copied: boolean;
  opened?: boolean;
}

export interface AuthEvent {
  loginId: string;
  profileId: string;
  success: boolean;
  error: string | null;
  account?: ManagedAccount;
}

export interface AppDiagnostics {
  codexPath: string | null;
  codexDesktopPath?: string | null;
  codexAppUserModelId?: string | null;
  codexCapabilities?: CodexCapabilityReport | null;
  desktopLifecycle?: DesktopLifecycleDiagnostics | null;
  credentialStore?: CodexCredentialStoreDiagnostics | null;
  activeCodexHome: string;
  appDataDir: string;
  workspacePath?: string;
  rateLimitRefreshIntervalMs?: number;
  startupError?: string | null;
  logPath?: string | null;
}

export interface CodexCredentialStoreDiagnostics {
  configuredMode: "file" | "keyring" | "auto" | "ephemeral" | "unspecified" | "invalid";
  effectiveStore: "file" | "keyring" | "unknown";
  authJsonPresent: boolean;
  managerCompatible: boolean;
  message: string;
}

export type DesktopClosePolicy = "graceful-only" | "exact-tree-fallback";

export interface OpenAiDesktopIdentity {
  product: "codex" | "chatgpt";
  packageName: string;
  packageFullName: string;
  packageFamilyName: string;
  version: string;
  installLocation: string;
  executablePath: string | null;
  appUserModelId: string | null;
}

export interface DesktopLifecycleDiagnostics {
  status: "ready" | "running" | "not-installed" | "ambiguous" | "unsupported" | "error";
  selected: OpenAiDesktopIdentity | null;
  candidates: OpenAiDesktopIdentity[];
  selectionReason: string | null;
  runningRootCount: number;
  capturedProcessCount: number;
  message: string;
}

export interface DesktopQuiesceResult {
  status: "not-running" | "quiesced" | "blocked" | "ambiguous" | "unsupported";
  identity: OpenAiDesktopIdentity | null;
  capturedProcessCount: number;
  remainingProcessCount: number;
  gracefulCloseAccepted: boolean;
  usedExactTreeFallback: boolean;
  message: string;
}

export type HealthStatus = "ok" | "warning" | "error";

export interface HealthItem {
  id: "codexCli" | "codexDesktop" | "database" | "vault" | "schema" | "logs";
  label: string;
  status: HealthStatus;
  message: string;
  action?: "choosePath" | "openLogs" | "repair" | "retry";
}

export interface HealthReport {
  generatedAt: number;
  schemaVersion: number;
  appDataDir: string;
  codexHome: string;
  logPath: string | null;
  items: HealthItem[];
}

export interface ProfileIntegrityItem {
  accountId: string;
  label: string;
  email: string;
  status: HealthStatus;
  message: string;
}

export interface ProfileIntegrityReport {
  generatedAt: number;
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  items: ProfileIntegrityItem[];
}

export interface DiagnosticReportExportResult {
  filePath: string;
}

export type ReleaseArtifactKind = "installer" | "portable" | "latestYml" | "blockmap" | "checksums";

export interface ReleaseArtifactStatus {
  kind: ReleaseArtifactKind;
  label: string;
  fileName: string;
  path: string;
  exists: boolean;
  sizeBytes: number | null;
  sha256: string | null;
  checksumListed: boolean;
}

export interface ReleaseReadinessReport {
  version: string;
  generatedAt: number;
  releaseDir: string;
  updateFeedConfigured: boolean;
  signingEnabled: boolean;
  codeSignatureVerification: boolean;
  ready: boolean;
  summary: string;
  artifacts: ReleaseArtifactStatus[];
}

export interface UpdateCheckResult {
  status: "available" | "not_available" | "downloaded" | "checking" | "downloading" | "installing" | "not_configured" | "error";
  message: string;
  feedUrl: string | null;
  checkedAt: number;
  version: string | null;
  progressPercent?: number | null;
}

export type AppNotificationTone = "progress" | "success" | "warning" | "error";

export interface AppNotificationPayload {
  key: string;
  title: string;
  body: string;
  tone: AppNotificationTone;
  silent: boolean;
  timeoutType: "default" | "never";
  locale?: "ru" | "en";
  createdAt: number;
  progress?: {
    value: number;
    label: string;
    status: string;
  };
}

export interface AccountExportResult {
  exportedCount: number;
  filePath: string;
}

export interface AccountImportResult {
  importedCount: number;
  accounts: ManagedAccount[];
}

export interface WorkspaceBinding {
  workspacePath: string;
  accountId: string | null;
  accountLabel: string | null;
  accountEmail: string | null;
}

export type SmartSwitchMode = "off" | "suggest" | "auto";
export type TrayRefreshIntervalMs = 0 | 60_000 | 180_000 | 300_000 | 600_000 | 900_000;

export interface SmartRecommendation {
  accountId: string;
  accountLabel: string;
  accountEmail: string;
  score: number;
  reason: string;
  workspaceMatched: boolean;
}

export interface SwitchHistoryItem {
  id: string;
  accountId: string;
  accountLabel: string | null;
  accountEmail: string | null;
  previousAccountId: string | null;
  startedAt: number;
  completedAt: number | null;
  status: string;
  error: string | null;
  backupPath: string | null;
}

export type SwitchTransactionStatus =
  | "pending"
  | "running"
  | "rolling_back"
  | "committed"
  | "rolled_back"
  | "aborted"
  | "failed"
  | "recovery_required";

export type SwitchTransactionPhase =
  | "preparing"
  | "validating_previous"
  | "validating_target"
  | "ready"
  | "quiescing"
  | "activating"
  | "launching"
  | "verifying"
  | "committed"
  | "rolling_back"
  | "rolled_back"
  | "aborted"
  | "failed"
  | "recovery_required";

export interface SwitchTransaction {
  id: string;
  platform: AccountPlatform;
  targetAccountId: string;
  previousAccountId: string | null;
  status: SwitchTransactionStatus;
  phase: SwitchTransactionPhase;
  targetFingerprint: string | null;
  previousFingerprint: string | null;
  backupPath: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  version: number;
}

export interface SwitchPreparationResult {
  transaction: SwitchTransaction;
  canCommit: boolean;
  warnings: string[];
}

export interface SwitchTransactionEvent {
  transaction: SwitchTransaction;
}

export interface LimitHistoryPoint {
  accountId: string;
  capturedAt: number;
  status: ManagedAccount["status"];
  statusReason: string | null;
  fiveHourUsedPercent: number | null;
  weeklyUsedPercent: number | null;
  primaryUsedPercent: number | null;
  secondaryUsedPercent: number | null;
}

export type ImportConflictMode = "skip" | "replace" | "copy";

export interface ImportConflict {
  incomingId: string;
  existingId: string;
  email: string;
  reason: "email" | "account_id";
}

export interface ImportPreview {
  total: number;
  conflicts: ImportConflict[];
  safeToImport: Array<{ id: string; email: string; label: string }>;
}

export interface AppSettings {
  language: "ru" | "en";
  autoRefreshIntervalMs: 0 | 180_000 | 600_000 | 900_000;
  trayRefreshIntervalMs: TrayRefreshIntervalMs;
  privacyMode: boolean;
  confirmSwitch: boolean;
  desktopClosePolicy: DesktopClosePolicy;
  smartSwitchMode: SmartSwitchMode;
  smartSwitchThresholdPercent: number;
  notificationSoundEnabled: boolean;
  trayEnabled: boolean;
  autostartEnabled: boolean;
}

export interface AppInfo {
  name: string;
  publisher: string;
  version: string;
  vaultDegraded: boolean;
}

export interface IpcResult<T> {
  ok: true;
  data: T;
}

export interface IpcFailure {
  ok: false;
  error: import("./errors.js").SafeAppError;
}

export type IpcResponse<T> = IpcResult<T> | IpcFailure;

export interface AppApi {
  listAccounts(): Promise<ManagedAccount[]>;
  getAppInfo(): Promise<AppInfo>;
  startLogin(input: CodexLoginRequest): Promise<LoginStartResult>;
  reauthenticateAccount(accountId: string, input: CodexLoginRequest): Promise<LoginStartResult>;
  copyDeviceCode(userCode: string): Promise<DeviceCodeHandoffResult>;
  openDeviceLogin(url: string, userCode: string): Promise<DeviceCodeHandoffResult>;
  openExternal(url: string): Promise<void>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  showMainWindow(): Promise<void>;
  hideTrayPopover(): Promise<void>;
  selectWorkspace(): Promise<AppDiagnostics>;
  refreshAccount(accountId: string): Promise<ManagedAccount>;
  validateAuth(accountId: string): Promise<AuthValidationState>;
  getProviderQuotaState(accountId: string): Promise<ProviderQuotaState>;
  refreshAllAccounts(): Promise<ManagedAccount[]>;
  exportAccounts(passphrase: string): Promise<AccountExportResult>;
  importAccounts(passphrase: string): Promise<AccountImportResult>;
  openProfileFolder(accountId: string): Promise<void>;
  prepareSwitch(accountId: string): Promise<SwitchPreparationResult>;
  cancelSwitch(transactionId: string): Promise<SwitchTransaction>;
  listSwitchTransactions(): Promise<SwitchTransaction[]>;
  switchAccount(accountId: string, transactionId?: string): Promise<ManagedAccount>;
  deleteAccount(accountId: string): Promise<void>;
  bindWorkspaceAccount(accountId: string | null): Promise<WorkspaceBinding>;
  getWorkspaceBinding(): Promise<WorkspaceBinding>;
  getSwitchHistory(): Promise<SwitchHistoryItem[]>;
  rollbackSwitch(eventId: string): Promise<SwitchHistoryItem[]>;
  readLogTail(): Promise<string[]>;
  openLogsFolder(): Promise<void>;
  updateAccount(input: {
    id: string;
    label?: string;
    notes?: string | null;
    subscriptionEndsAt?: number | null;
    tags?: string[];
    favorite?: boolean;
    archived?: boolean;
  }): Promise<ManagedAccount>;
  getLimitHistory(accountId: string): Promise<LimitHistoryPoint[]>;
  getDiagnostics(): Promise<AppDiagnostics>;
  getHealth(): Promise<HealthReport>;
  getProfileIntegrity(): Promise<ProfileIntegrityReport>;
  exportDiagnosticReport(): Promise<DiagnosticReportExportResult>;
  getReleaseReadiness(): Promise<ReleaseReadinessReport>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  openUpdateRelease(): Promise<UpdateCheckResult>;
  openReleaseFolder(): Promise<void>;
  openCrashReportsFolder(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(input: Partial<AppSettings>): Promise<AppSettings>;
  getAntigravityDiagnostics(): Promise<AntigravityDiagnostics>;
  getAntigravityProfileStatus(): Promise<AntigravityProfileStatus>;
  inspectAntigravityProfile(): Promise<AntigravityProfileInspection>;
  importAntigravityFromIde(): Promise<AntigravityImportResult>;
  openAntigravityLogin(): Promise<void>;
  startAntigravityGoogleLogin(): Promise<AntigravityImportResult>;
  startAntigravityGoogleOAuth(): Promise<AntigravityOAuthStartResult>;
  finishAntigravityGoogleOAuth(input: AntigravityOAuthFinishInput): Promise<AntigravityImportResult>;
  cancelAntigravityGoogleOAuth(sessionId: string): Promise<void>;
  importAntigravityCredentialPayload(input: AntigravityCredentialPayloadImportInput): Promise<AntigravityCredentialBatchImportResult>;
  importAntigravityFromLocalFiles(): Promise<AntigravityCredentialBatchImportResult>;
  importAntigravityFromExternalSource(source: Exclude<AntigravityCredentialImportSource, "token_json" | "local_files">): Promise<AntigravityCredentialBatchImportResult>;
  onAuthEvent(callback: (event: AuthEvent) => void): () => void;
  onAccountsUpdated(callback: () => void): () => void;
  onSwitchTransaction(callback: (event: SwitchTransactionEvent) => void): () => void;
  onAntigravityOAuthStep(callback: (step: string) => void): () => void;
  onAntigravityOAuthResult(callback: (result: AntigravityImportResult) => void): () => void;
  onAntigravityOAuthError(callback: (message: string) => void): () => void;
  onUpdateStatus(callback: (result: UpdateCheckResult) => void): () => void;
  onAppNotification(callback: (notification: AppNotificationPayload) => void): () => void;
}
