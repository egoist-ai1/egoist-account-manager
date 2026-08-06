import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Activity,
  Archive,
  CheckCircle2,
  ChevronRight,
  Command,
  Copy,
  Database,
  ExternalLink,
  FileDown,
  FileUp,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Layers3,
  List,
  Loader2,
  LogIn,
  Maximize2,
  Minus,
  MoreHorizontal,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  RefreshCcw,
  Star,
  ArrowUpDown,
  Tag,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
  Zap,
  type LucideIcon
} from "lucide-react";
import type {
  AppDiagnostics,
  AppApi,
  AppNotificationPayload,
  AntigravityDiagnostics,
  AntigravityCredentialBatchImportResult,
  AntigravityCredentialImportSource,
  AntigravityProfileInspection,
  AntigravityProfileStatus,
  AntigravityOAuthStartResult,
  AppSettings,
  AuthEvent,
  AuthValidationState,
  CodexLoginRequest,
  CodexLoginMethodId,
  HealthReport,
  LoginStartResult,
  ManagedAccount,
  ProviderQuotaState,
  SwitchHistoryItem,
  SwitchTransaction,
  UpdateCheckResult,
  WorkspaceBinding
} from "../shared/types";
import type { AppViewKey, CommandPaletteCommand } from "../shared/commandPalette";
import { buildCommandPalette, filterCommandPalette } from "../shared/commandPalette";
import { selectAccountListQuota, sortAccountList, type AccountListSort } from "../shared/accountListPresentation";
import { maskEmailForPrivacy, maskPathForPrivacy, maskSensitiveDisplayText } from "../shared/privacyDisplay";
import { buildProviderQuotaState } from "../shared/providerAdapter";
import { buildQuotaFreshness, hasCurrentQuotaRefreshFailure } from "../shared/quotaFreshness";
import { buildQuotaRefreshErrorMessage } from "../shared/quotaRefreshError";
import { buildQuotaRefreshAccountMessage, buildQuotaRefreshMessage } from "../shared/quotaRefreshMessage";
import { selectSmartAccount } from "../shared/smartSelection";
import { appVersion, releaseNotes } from "../shared/releaseNotes";
import appAvatarUrl from "./assets/app-avatar-mark.png";
import codexLogoUrl from "./assets/codex-color.svg";
import antigravityLogoUrl from "./assets/antigravity-icon.png";
import { getUiText } from "./i18n";
import { SettingsPage } from "./pages/SettingsPage";
import { ActivityPage } from "./components/v3/ActivityPage";
import { OverviewPage } from "./components/v3/OverviewPage";
import { TrayPopover } from "./components/TrayPopover";
import { TrayHoverPopover } from "./components/TrayHoverPopover";
import "@fontsource-variable/montserrat";
import "./styles.css";
import "./v3.css";
import "./v306.css";
import "./v307.css";
import "./v308.css";
import "./v309.css";
import "./v310.css";

const nowSeconds = () => Math.floor(Date.now() / 1000);

function codexLoginMethodLabel(id: CodexLoginMethodId, isEnglish: boolean): string {
  const labels: Record<CodexLoginMethodId, [string, string]> = {
    chatgpt: ["ChatGPT browser", "ChatGPT в браузере"],
    chatgptDeviceCode: ["Device code", "Код устройства"],
    apiKey: ["API key", "API key"],
    enterpriseAccessToken: ["Enterprise token", "Enterprise-токен"],
    chatgptAuthTokens: ["Access token", "Access token"]
  };
  return labels[id][isEnglish ? 0 : 1];
}

const demoSettings: AppSettings = {
  language: "ru",
  autoRefreshIntervalMs: 180_000,
  trayRefreshIntervalMs: 60_000,
  privacyMode: false,
  confirmSwitch: true,
  desktopClosePolicy: "graceful-only",
  smartSwitchMode: "suggest",
  smartSwitchThresholdPercent: 10,
  notificationSoundEnabled: true,
  trayEnabled: false,
  autostartEnabled: false
};

const demoHealth: HealthReport = {
  generatedAt: nowSeconds(),
  schemaVersion: 3,
  appDataDir: "browser-preview",
  codexHome: "browser-preview",
  logPath: null,
  items: [
    {
      id: "codexCli",
      label: "Codex CLI",
      status: "ok",
      message: "Демонстрационный режим готов."
    },
    {
      id: "database",
      label: "База данных",
      status: "ok",
      message: "Схема доступна."
    }
  ]
};

const demoAntigravityDiagnostics: AntigravityDiagnostics = {
  profileKind: "unknown",
  userDataDir: "browser-preview/Antigravity IDE",
  globalStorageDir: "browser-preview/Antigravity IDE/User/globalStorage",
  stateDbPath: "browser-preview/Antigravity IDE/User/globalStorage/state.vscdb",
  storageJsonPath: "browser-preview/Antigravity IDE/User/globalStorage/storage.json",
  machineIdPath: "browser-preview/Antigravity IDE/machineid",
  appStoragePath: "browser-preview/Antigravity/app_storage.json",
  geminiDataDir: "browser-preview/.gemini/antigravity",
  installationIdPath: "browser-preview/.gemini/antigravity/installation_id",
  userDataDirExists: false,
  stateDbExists: false,
  storageJsonExists: false,
  machineIdExists: false,
  appStorageExists: false,
  geminiDataDirExists: false,
  installationIdExists: false
};

const demoAntigravityInspection: AntigravityProfileInspection = {
  inspectedAt: nowSeconds(),
  stateDb: { exists: false, readable: false, itemTableFound: false, itemCount: null, authRelatedItemCount: null, error: null },
  storageJson: { exists: false, readable: false, validJson: false, topLevelKeyCount: null, authRelatedKeyCount: null, error: null },
  machineId: { exists: false, readable: false, hashPrefix: null, error: null }
};

const demoAntigravityProfileStatus: AntigravityProfileStatus = {
  detected: false,
  readyForWriteActions: false,
  message: "Профиль Antigravity IDE пока не найден на этой машине.",
  diagnostics: demoAntigravityDiagnostics,
  inspection: demoAntigravityInspection,
  capabilities: {
    diagnostics: { supported: true, reason: null },
    importFromIde: { supported: false, reason: "read-only foundation: безопасный коннектор записи Antigravity ещё не включён" },
    switchAccount: { supported: false, reason: "read-only foundation: безопасный коннектор записи Antigravity ещё не включён" },
    refreshQuota: { supported: false, reason: "read-only foundation: Antigravity quota adapter ещё не включён" }
  }
};

const demoAccounts: ManagedAccount[] = [
  {
    id: "demo-pro",
    platform: "codex",
    label: "основной",
    email: "primary@example.com",
    authMode: "chatgpt",
    providerAccountId: "demo-primary",
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: "demo-primary-fingerprint",
    credentialState: "ready",
    lastAuthenticatedAt: nowSeconds(),
    expiresAt: null,
    version: 1,
    planType: "pro",
    profileDir: "demo",
    isActive: true,
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: nowSeconds(),
    lastRefreshAt: nowSeconds(),
    subscriptionEndsAt: null,
    status: "active",
    statusReason: null,
    primaryUsedPercent: 34,
    primaryResetsAt: nowSeconds() + 3600,
    primaryWindowDurationMins: 300,
    secondaryUsedPercent: 12,
    secondaryResetsAt: nowSeconds() + 6 * 86400,
    secondaryWindowDurationMins: 10080,
    fiveHourUsedPercent: 34,
    fiveHourResetsAt: nowSeconds() + 3600,
    weeklyUsedPercent: 12,
    weeklyResetsAt: nowSeconds() + 6 * 86400,
    notes: null
  },
  {
    id: "demo-plus",
    platform: "codex",
    label: "резерв",
    email: "backup@example.com",
    authMode: "chatgpt",
    providerAccountId: "demo-backup",
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: "demo-backup-fingerprint",
    credentialState: "ready",
    lastAuthenticatedAt: nowSeconds(),
    expiresAt: null,
    version: 1,
    planType: "plus",
    profileDir: "demo",
    isActive: false,
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: null,
    lastRefreshAt: nowSeconds() - 2400,
    lastRefreshErrorAt: nowSeconds() - 180,
    lastRefreshError: "Codex profile is not authenticated",
    subscriptionEndsAt: null,
    status: "near_limit",
    statusReason: "Использование выше 90%",
    primaryUsedPercent: 91,
    primaryResetsAt: nowSeconds() + 900,
    primaryWindowDurationMins: 300,
    secondaryUsedPercent: 40,
    secondaryResetsAt: nowSeconds() + 5 * 86400,
    secondaryWindowDurationMins: 10080,
    fiveHourUsedPercent: 91,
    fiveHourResetsAt: nowSeconds() + 900,
    weeklyUsedPercent: 40,
    weeklyResetsAt: nowSeconds() + 5 * 86400,
    notes: null
  }
];

const demoTimelineNow = nowSeconds();
const demoSwitchTransactions: SwitchTransaction[] = [
  {
    id: "demo-verified-84d3c1a0",
    platform: "codex",
    targetAccountId: "demo-pro",
    previousAccountId: "demo-plus",
    status: "committed",
    phase: "committed",
    targetFingerprint: "demo-primary-fingerprint",
    previousFingerprint: "demo-backup-fingerprint",
    backupPath: "browser-preview-backup",
    errorCode: null,
    errorMessage: null,
    createdAt: demoTimelineNow - 426,
    updatedAt: demoTimelineNow - 421,
    completedAt: demoTimelineNow - 421,
    version: 9
  },
  {
    id: "demo-rollback-690e72bf",
    platform: "codex",
    targetAccountId: "demo-plus",
    previousAccountId: "demo-pro",
    status: "rolled_back",
    phase: "rolled_back",
    targetFingerprint: "demo-backup-fingerprint",
    previousFingerprint: "demo-primary-fingerprint",
    backupPath: "browser-preview-backup",
    errorCode: "IDENTITY_MISMATCH",
    errorMessage: "Проверка личности не подтвердила целевой профиль; предыдущий вход безопасно восстановлен.",
    createdAt: demoTimelineNow - 7_260,
    updatedAt: demoTimelineNow - 7_252,
    completedAt: demoTimelineNow - 7_252,
    version: 12
  },
  {
    id: "demo-verified-31fa46c8",
    platform: "codex",
    targetAccountId: "demo-plus",
    previousAccountId: "demo-pro",
    status: "committed",
    phase: "committed",
    targetFingerprint: "demo-backup-fingerprint",
    previousFingerprint: "demo-primary-fingerprint",
    backupPath: "browser-preview-backup",
    errorCode: null,
    errorMessage: null,
    createdAt: demoTimelineNow - 91_804,
    updatedAt: demoTimelineNow - 91_798,
    completedAt: demoTimelineNow - 91_798,
    version: 9
  }
];

const demoSwitchHistory: SwitchHistoryItem[] = demoSwitchTransactions.map((transaction) => {
  const account = demoAccounts.find((item) => item.id === transaction.targetAccountId);
  return {
    id: transaction.id,
    accountId: transaction.targetAccountId,
    accountLabel: account?.label ?? null,
    accountEmail: account?.email ?? null,
    previousAccountId: transaction.previousAccountId,
    startedAt: transaction.createdAt,
    completedAt: transaction.completedAt,
    status: transaction.status === "committed" ? "completed" : transaction.status,
    error: transaction.errorMessage,
    backupPath: transaction.backupPath
  };
});

const cam: AppApi = window.cam ?? {
  listAccounts: async () => demoAccounts,
  getAppInfo: async () => ({ name: "Egoist Account Manager", publisher: "Egoist AI", version: appVersion, vaultDegraded: false }),
  startLogin: async (input: CodexLoginRequest) => ({
    loginId: "demo-login",
    profileId: "demo-profile",
    type: input.type,
    authUrl: "https://chatgpt.com",
    verificationUrl: "https://auth.openai.com/codex/device",
    userCode: "DEMO-1234"
  }),
  reauthenticateAccount: async (accountId: string, input: CodexLoginRequest) => ({
    loginId: "demo-reauth",
    profileId: accountId,
    type: input.type,
    authUrl: "https://chatgpt.com",
    verificationUrl: "https://auth.openai.com/codex/device",
    userCode: "DEMO-5678"
  }),
  copyDeviceCode: async () => ({ copied: true }),
  openDeviceLogin: async () => ({ copied: true, opened: true }),
  openExternal: async () => undefined,
  minimizeWindow: async () => undefined,
  toggleMaximizeWindow: async () => undefined,
  closeWindow: async () => undefined,
  showMainWindow: async () => undefined,
  hideTrayPopover: async () => undefined,
  selectWorkspace: async () => ({
    codexPath: "browser-preview",
    activeCodexHome: "browser-preview",
    appDataDir: "browser-preview",
    workspacePath: "browser-preview",
    rateLimitRefreshIntervalMs: 180_000,
    startupError: null,
    logPath: null
  }),
  refreshAccount: async (accountId: string) => demoAccounts.find((account) => account.id === accountId) ?? demoAccounts[0],
  validateAuth: async () => ({ state: "authorized", lastValidatedAt: nowSeconds(), errorReason: null }),
  getProviderQuotaState: async (accountId: string) => {
    const account = demoAccounts.find((item) => item.id === accountId) ?? demoAccounts[0];
    return {
      provider: account.platform,
      accountId: account.id,
      planType: account.planType,
      remaining: account.primaryUsedPercent === null ? null : 100 - account.primaryUsedPercent,
      used: account.primaryUsedPercent,
      resetAt: account.primaryResetsAt,
      windowType: account.primaryWindowDurationMins === 300 ? "5h" : "unknown",
      confidence: account.primaryUsedPercent === null ? "unknown" : "confirmed",
      source: account.primaryUsedPercent === null ? "unknown" : "official_api",
      lastCheckedAt: account.lastRefreshAt,
      errorReason: null,
      windows: account.primaryUsedPercent === null ? [] : [{
        id: "primary",
        used: account.primaryUsedPercent,
        remaining: 100 - account.primaryUsedPercent,
        resetAt: account.primaryResetsAt,
        windowType: account.primaryWindowDurationMins === 300 ? "5h" : "unknown",
        confidence: "confirmed",
        source: "official_api"
      }]
    } satisfies ProviderQuotaState;
  },
  refreshAllAccounts: async () => demoAccounts,
  exportAccounts: async () => ({ exportedCount: demoAccounts.length, filePath: "browser-preview.cam-export" }),
  importAccounts: async () => ({ importedCount: demoAccounts.length, accounts: demoAccounts }),
  openProfileFolder: async () => undefined,
  prepareSwitch: async (accountId: string) => ({
    transaction: {
      id: "demo-switch-transaction",
      platform: "codex",
      targetAccountId: accountId,
      previousAccountId: demoAccounts.find((account) => account.isActive)?.id ?? null,
      status: "pending",
      phase: "ready",
      targetFingerprint: null,
      previousFingerprint: null,
      backupPath: null,
      errorCode: null,
      errorMessage: null,
      createdAt: nowSeconds(),
      updatedAt: nowSeconds(),
      completedAt: null,
      version: 4
    },
    canCommit: true,
    warnings: []
  }),
  cancelSwitch: async (transactionId: string) => ({
    id: transactionId,
    platform: "codex",
    targetAccountId: demoAccounts[0].id,
    previousAccountId: null,
    status: "aborted",
    phase: "aborted",
    targetFingerprint: null,
    previousFingerprint: null,
    backupPath: null,
    errorCode: "CANCELLED",
    errorMessage: "Cancelled before auth activation.",
    createdAt: nowSeconds(),
    updatedAt: nowSeconds(),
    completedAt: nowSeconds(),
    version: 5
  }),
  listSwitchTransactions: async () => demoSwitchTransactions,
  switchAccount: async (accountId: string) => demoAccounts.find((account) => account.id === accountId) ?? demoAccounts[0],
  deleteAccount: async () => undefined,
  updateAccount: async () => demoAccounts[0],
  bindWorkspaceAccount: async (accountId: string | null) => {
    const account = demoAccounts.find((item) => item.id === accountId) ?? null;
    return { workspacePath: "browser-preview", accountId: account?.id ?? null, accountLabel: account?.label ?? null, accountEmail: account?.email ?? null };
  },
  getWorkspaceBinding: async () => ({ workspacePath: "browser-preview", accountId: null, accountLabel: null, accountEmail: null }),
  getSwitchHistory: async () => demoSwitchHistory,
  getLimitHistory: async (accountId: string) => [
    { accountId, capturedAt: nowSeconds() - 1200, status: "active", statusReason: null, fiveHourUsedPercent: 62, weeklyUsedPercent: 18, primaryUsedPercent: 62, secondaryUsedPercent: 18 },
    { accountId, capturedAt: nowSeconds() - 600, status: "active", statusReason: null, fiveHourUsedPercent: 54, weeklyUsedPercent: 21, primaryUsedPercent: 54, secondaryUsedPercent: 21 },
    { accountId, capturedAt: nowSeconds(), status: "active", statusReason: null, fiveHourUsedPercent: 38, weeklyUsedPercent: 22, primaryUsedPercent: 38, secondaryUsedPercent: 22 }
  ],
  rollbackSwitch: async () => [],
  readLogTail: async () => ["Журнал доступен в собранном приложении."],
  openLogsFolder: async () => undefined,
  getDiagnostics: async () => ({
    codexPath: "browser-preview",
    desktopLifecycle: {
      status: "running",
      selected: {
        product: "codex",
        packageName: "OpenAI.Codex",
        packageFullName: "OpenAI.Codex_26.721.4979.0_x64__2p2nqsd0c76g0",
        packageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
        version: "26.721.4979.0",
        installLocation: "C:\\Program Files\\WindowsApps\\OpenAI.Codex",
        executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\ChatGPT.exe",
        appUserModelId: "OpenAI.Codex_2p2nqsd0c76g0!App"
      },
      candidates: [],
      selectionReason: "Explicit package policy selected OpenAI.Codex.",
      runningRootCount: 1,
      capturedProcessCount: 7,
      message: "Exact desktop process tree captured."
    },
    codexCapabilities: {
      generatedAt: nowSeconds(),
      cliVersion: "codex-cli 0.144.0",
      protocol: {
        compatible: true,
        userAgent: "codex_cli_rs/0.144.0",
        codexHome: "browser-preview",
        platformFamily: "windows",
        platformOs: "windows",
        schemaVersionKey: "browser-preview",
        error: null
      },
      loginMethods: [
        { id: "chatgpt", available: true, stability: "stable", reason: null },
        { id: "chatgptDeviceCode", available: true, stability: "stable", reason: null },
        { id: "apiKey", available: true, stability: "stable", reason: null },
        { id: "enterpriseAccessToken", available: true, stability: "experimental", reason: "Official CLI stdin flow." },
        { id: "chatgptAuthTokens", available: true, stability: "internal", reason: "Installed Codex marks this method for internal use only." }
      ],
      identity: {
        signedIn: true,
        authMode: "chatgpt",
        email: "primary@example.com",
        planType: "pro",
        requiresOpenaiAuth: true,
        error: null
      }
    },
    credentialStore: {
      configuredMode: "unspecified",
      effectiveStore: "file",
      authJsonPresent: true,
      managerCompatible: true,
      message: "Codex uses the documented default file credential store."
    },
    activeCodexHome: "browser-preview",
    appDataDir: "browser-preview",
    workspacePath: "browser-preview",
    rateLimitRefreshIntervalMs: 180_000,
    startupError: null,
    logPath: null
  }),
  getHealth: async () => demoHealth,
  getProfileIntegrity: async () => ({ generatedAt: nowSeconds(), total: demoAccounts.length, ok: demoAccounts.length, warnings: 0, errors: 0, items: [] }),
  exportDiagnosticReport: async () => ({ filePath: "browser-preview-diagnostics.json" }),
  getReleaseReadiness: async () => ({
    version: appVersion,
    generatedAt: nowSeconds(),
    releaseDir: "browser-preview/release",
    updateFeedConfigured: false,
    signingEnabled: false,
    codeSignatureVerification: false,
    ready: false,
    summary: "Релиз собран локально, но публичный канал обновлений не настроен.",
    artifacts: []
  }),
  checkForUpdates: async () => ({
    status: "not_configured",
    message: "Канал обновлений пока не настроен.",
    feedUrl: null,
    checkedAt: nowSeconds(),
    version: null
  }),
  openUpdateRelease: async () => ({
    status: "available",
    message: "Официальный релиз открыт на GitHub.",
    feedUrl: "https://github.com/egoist-ai1/egoist-account-manager/releases/tag/v3.1.0",
    checkedAt: nowSeconds(),
    version: "3.1.0"
  }),
  openReleaseFolder: async () => undefined,
  openCrashReportsFolder: async () => undefined,
  getSettings: async () => demoSettings,
  updateSettings: async (input: Partial<AppSettings>) => ({ ...demoSettings, ...input }),
  getAntigravityDiagnostics: async () => demoAntigravityDiagnostics,
  getAntigravityProfileStatus: async () => demoAntigravityProfileStatus,
  inspectAntigravityProfile: async () => demoAntigravityInspection,
  openAntigravityLogin: async () => undefined,
  startAntigravityGoogleLogin: async () => ({
    imported: false,
    account: null,
    reason: "Google OAuth доступен только в desktop-приложении.",
    status: demoAntigravityProfileStatus,
    identity: null
  }),
  startAntigravityGoogleOAuth: async () => ({
    sessionId: "demo-antigravity-oauth",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    redirectUri: "http://localhost:36742/oauth-callback",
    expiresAt: nowSeconds() + 600
  }),
  finishAntigravityGoogleOAuth: async () => ({
    imported: false,
    account: null,
    reason: "Google OAuth доступен только в desktop-приложении.",
    status: demoAntigravityProfileStatus,
    identity: null
  }),
  cancelAntigravityGoogleOAuth: async () => undefined,
  onAntigravityOAuthResult: () => () => undefined,
  onAntigravityOAuthError: () => () => undefined,
  importAntigravityCredentialPayload: async () => ({
    importedCount: 0,
    failedCount: 1,
    imported: [],
    failures: [{ source: "demo", email: null, reason: "Импорт доступен только в desktop-приложении." }],
    accounts: demoAccounts
  }),
  importAntigravityFromLocalFiles: async () => ({
    importedCount: 0,
    failedCount: 0,
    imported: [],
    failures: [],
    accounts: demoAccounts
  }),
  importAntigravityFromExternalSource: async () => ({
    importedCount: 0,
    failedCount: 1,
    imported: [],
    failures: [{ source: "demo", email: null, reason: "Источник доступен только в desktop-приложении." }],
    accounts: demoAccounts
  }),
  importAntigravityFromIde: async () => ({
    imported: false,
    account: null,
    reason: "Локальный профиль Antigravity не найден. Сначала войди в официальном Antigravity IDE или CLI.",
    status: demoAntigravityProfileStatus,
    identity: null
  }),
  onAuthEvent: () => () => undefined,
  onAccountsUpdated: () => () => undefined,
  onSwitchTransaction: () => () => undefined,
  onAntigravityOAuthStep: () => () => undefined,
  onUpdateStatus: () => () => undefined
  ,onAppNotification: () => () => undefined
};

function formatTime(value: number | null): string {
  if (!value) return "нет данных";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value * 1000));
}

function authValidationLabel(state: AuthValidationState["state"]): string {
  const labels: Record<AuthValidationState["state"], string> = {
    unknown: "неизвестно",
    authorized: "авторизован",
    expired: "истёк срок",
    revoked: "отозван",
    needs_reauth: "нужен вход",
    validation_failed: "проверка не удалась"
  };
  return labels[state];
}

function QuotaFreshnessChip({ account }: { account: ManagedAccount }) {
  const freshness = buildQuotaFreshness(account, { now: nowSeconds(), staleAfterSeconds: 15 * 60 });
  const refreshFailed = hasCurrentQuotaRefreshFailure(account);
  return (
    <span
      className={`quota-freshness-chip ${refreshFailed ? "refresh-error" : freshness.state}`}
      title={refreshFailed ? `Последний запрос завершился ошибкой. ${freshness.title}. Корректный снимок сохранён.` : freshness.title}
    >
      {refreshFailed ? "сбой обновления" : freshness.label}
    </span>
  );
}

function CredentialStateChip({ account }: { account: ManagedAccount }) {
  const meta = account.credentialState === "ready"
    ? { label: "вход сохранён", tone: "ready", title: "Авторизация зашифрована и сохранена локально" }
    : account.credentialState === "needs_reauth"
      ? { label: "нужен вход", tone: "warning", title: "Профиль сохранён, но Codex требует повторный вход" }
      : account.credentialState === "drifted"
        ? { label: "проверить вход", tone: "warning", title: "Обнаружено изменение авторизации вне менеджера" }
        : { label: "проверить профиль", tone: "neutral", title: "Нужно подтвердить принадлежность сохранённого профиля" };
  return <span className={`credential-chip ${meta.tone}`} title={meta.title}><ShieldCheck />{meta.label}</span>;
}

function statusClass(account: ManagedAccount): string {
  if (account.status === "limited") return "limited";
  if (account.status === "near_limit") return "risk";
  if (account.status === "active") return "active";
  if (account.status === "error" && /not logged into a chatgpt account|belongs to a different chatgpt account|login required|reauth|required.*auth|sign.?in/i.test(account.statusReason ?? "")) return "risk";
  return "";
}

function used(account: ManagedAccount): number {
  return Math.max(account.fiveHourUsedPercent ?? 0, account.weeklyUsedPercent ?? 0);
}

function isUsable(account: ManagedAccount): boolean {
  return account.status !== "limited" && account.status !== "error";
}

function uiErrorMessage(action: string): string {
  return `${action}. Подробности доступны в журнале диагностики.`;
}

function readableIpcError(error: unknown): string | null {
  if (!(error instanceof Error) || !error.message.trim()) return null;
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

function switchErrorMessage(error: unknown): string {
  const detail = readableIpcError(error);
  if (!detail) return uiErrorMessage("Не удалось переключить аккаунт");
  if (/no auth\.json/i.test(detail)) {
    return "В Codex сейчас нет активной авторизации. Менеджер сохранил профили и попробует активировать выбранный аккаунт повторно.";
  }
  if (/different account|different provider account/i.test(detail)) {
    return "Текущая сессия Codex не совпала с отметкой в менеджере. Обнови список и повтори переключение — сессия будет согласована автоматически.";
  }
  if (/hosted inside the active Codex process tree/i.test(detail)) {
    return "Manager был открыт из процесса Codex, поэтому безопасное переключение остановлено до закрытия сессии. Закрой только Manager и открой его из меню «Пуск» или с ярлыка, затем повтори.";
  }
  if (/could not be safely closed|did not exit|still running/i.test(detail)) {
    return "Codex не удалось полностью закрыть. Включи «Автоматическое закрытие» в настройках и повтори.";
  }
  if (/still being reauthenticated|reauthentication is still in progress/i.test(detail)) {
    return "Для выбранного профиля ещё открыт вход. Заверши его или запусти авторизацию заново — предыдущая незавершённая попытка будет безопасно заменена.";
  }
  if (/another switch transaction is already active/i.test(detail)) {
    return "Предыдущая попытка переключения ещё не завершена. Менеджер отменит её до изменения авторизации; затем повтори переключение.";
  }
  return `Не удалось переключить аккаунт: ${detail}`;
}

function autoRefreshLabel(ms?: number, language: AppSettings["language"] = "ru"): string {
  if (!ms) return language === "en" ? "auto" : "авто";
  const minutes = Math.max(1, Math.round(ms / 60000));
  return language === "en" ? `${minutes} min` : `${minutes} мин`;
}

function relativeRefresh(account: ManagedAccount): string {
  if (!account.lastRefreshAt) return "нет снимка";
  const minutes = Math.max(0, Math.floor((nowSeconds() - account.lastRefreshAt) / 60));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.floor(minutes / 60)} ч назад`;
}

function meterTone(usedPercent: number | null): string {
  const usedValue = usedPercent ?? 0;
  if (usedValue >= 90) return "danger";
  if (usedValue >= 72) return "warn";
  return "good";
}

function remainingPercent(usedPercent: number | null): number | null {
  return usedPercent == null ? null : Math.max(0, Math.min(100, 100 - usedPercent));
}

function LimitMeter({
  label,
  usedPercent,
  resetsAt,
  unavailableReason
}: {
  label: string;
  usedPercent: number | null;
  resetsAt: number | null;
  unavailableReason?: string;
}) {
  const remaining = remainingPercent(usedPercent);
  const pct = remaining ?? 0;
  const emptyReason = unavailableReason ?? "Нет свежих данных лимита";
  return (
    <div
      className={`limit-meter ${meterTone(usedPercent)}`}
      title={usedPercent == null ? emptyReason : `Осталось ${remaining?.toFixed(0)}%, использовано ${usedPercent.toFixed(0)}%`}
      aria-label={usedPercent == null ? `${label}: ${emptyReason}` : `${label}: осталось ${remaining?.toFixed(0)} процентов`}
    >
      <div className="limit-line">
        <span>{label}</span>
        <strong>{remaining == null ? "—" : `${remaining.toFixed(0)}%`}</strong>
      </div>
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <small>{resetsAt ? `сброс ${formatTime(resetsAt)}` : emptyReason}</small>
    </div>
  );
}

function accountLimitDisplay(account: ManagedAccount): {
  primaryLabel: string;
  primaryUsedPercent: number | null;
  primaryResetsAt: number | null;
  primaryUnavailableReason?: string;
  secondaryLabel: string;
  secondaryUsedPercent: number | null;
  secondaryResetsAt: number | null;
  secondaryUnavailableReason?: string;
} {
  if (accountPlatform(account) === "antigravity") {
    return {
      primaryLabel: windowLabel(account.primaryWindowDurationMins, "модель"),
      primaryUsedPercent: account.primaryUsedPercent,
      primaryResetsAt: account.primaryResetsAt,
      primaryUnavailableReason: account.primaryUsedPercent == null
        ? "Code Assist не вернул quota-enabled модели для этого Antigravity аккаунта."
        : undefined,
      secondaryLabel: windowLabel(account.secondaryWindowDurationMins, "резерв"),
      secondaryUsedPercent: account.secondaryUsedPercent,
      secondaryResetsAt: account.secondaryResetsAt,
      secondaryUnavailableReason: account.secondaryUsedPercent == null
        ? "Code Assist не вернул второй quota bucket в последнем ответе. Это не считается нулём и не подменяется оценкой."
        : undefined
    };
  }
  return {
    primaryLabel: "5 часов",
    primaryUsedPercent: account.fiveHourUsedPercent,
    primaryResetsAt: account.fiveHourResetsAt,
    secondaryLabel: "неделя",
    secondaryUsedPercent: account.weeklyUsedPercent,
    secondaryResetsAt: account.weeklyResetsAt
  };
}

function windowLabel(durationMins: number | null, fallback: string): string {
  if (durationMins === 300) return "5 часов";
  if (durationMins === 10_080) return "неделя";
  return fallback;
}

function antigravityAccessLabel(account: ManagedAccount, language: AppSettings["language"] = "ru"): string {
  const en = language === "en";
  if (account.antigravity?.forbidden) return en ? "restricted" : "ограничен";
  if (account.status === "error") return en ? "error" : "ошибка";
  if (account.status === "limited") return en ? "limited" : "лимит";
  if (account.antigravity?.lastQuotaRefreshAt || account.primaryUsedPercent != null || account.secondaryUsedPercent != null) return en ? "ready" : "готов";
  if (account.isActive || account.status === "active" || account.status === "near_limit") return en ? "ready" : "готов";
  return en ? "preparing" : "готовится";
}

function accountPlatform(account: ManagedAccount): "codex" | "antigravity" {
  return account.platform === "antigravity" ? "antigravity" : "codex";
}

function platformLabel(account: ManagedAccount): string {
  return accountPlatform(account) === "antigravity" ? "Antigravity" : "Codex";
}

function platformLogoUrl(platform: "codex" | "antigravity"): string {
  return platform === "antigravity" ? antigravityLogoUrl : codexLogoUrl;
}

function PlatformMark({
  platform,
  size = "small",
  label
}: {
  platform: "codex" | "antigravity";
  size?: "small" | "large" | "tile" | "micro";
  label?: string;
}) {
  return (
    <span className={`platform-mark ${platform} ${size}`} aria-hidden="true" title={label ?? (platform === "antigravity" ? "Antigravity" : "Codex")}>
      <img src={platformLogoUrl(platform)} alt="" />
    </span>
  );
}

function AccountPlatformMark({ account, size = "small" }: { account: ManagedAccount; size?: "small" | "large" }) {
  const platform = accountPlatform(account);
  return <PlatformMark platform={platform} size={size} label={platformLabel(account)} />;
}

type PlanBadgeTone = "free" | "go" | "standard" | "plus" | "team" | "pro" | "pro5" | "pro10" | "pro20" | "enterprise" | "unknown";

function planBadgeMeta(planType: ManagedAccount["planType"]): { tone: PlanBadgeTone; label: string; title: string } {
  const raw = String(planType ?? "unknown").trim();
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "standard" || key === "standardtier" || key === "antigravitystandard") {
    return { tone: "standard", label: "Code Assist", title: "Внутренний tier Code Assist. Это не подтверждённое название платной подписки Google." };
  }
  if (!raw || key === "unknown") return { tone: "unknown", label: "Не определён", title: "Тариф не определён" };
  if (key === "free") return { tone: "free", label: "Free", title: "Code Assist сообщил free-tier как текущий доступ." };
  if (key === "googleaipro") return { tone: "plus", label: "AI Pro", title: "Google AI Pro: подтверждено текущим tier Code Assist" };
  if (key === "googleaiultra") return { tone: "pro10", label: "Ultra", title: "Google AI Ultra: подтверждено текущим tier Code Assist" };
  if (key === "googleaiultrax20") return { tone: "pro20", label: "Ultra x20", title: "Google AI Ultra X20: подтверждено текущим tier Code Assist" };
  if (key === "go") return { tone: "go", label: "Go", title: "Go: начальный платный уровень" };
  if (key === "plus") return { tone: "plus", label: "Plus", title: "Plus: повышенный персональный уровень" };
  if (key === "team" || key === "business") return { tone: "team", label: key === "business" ? "Business" : "Team", title: "Командный тариф" };
  if (key === "enterprise" || key === "edu") return { tone: "enterprise", label: raw, title: "Enterprise/Edu: организационный уровень" };
  if (key.includes("20")) return { tone: "pro20", label: "Pro X20", title: "Pro X20: подтверждённый максимальный уровень" };
  if (key.includes("10") || key === "prolite") return { tone: "pro10", label: key === "prolite" ? "Pro Lite" : "Pro X10", title: "Профессиональный уровень" };
  if (key.includes("5")) return { tone: "pro5", label: "Pro X5", title: "Pro X5: подтверждённый профессиональный уровень" };
  if (key === "pro") return { tone: "pro", label: "Pro", title: "Codex Pro: профессиональный тариф" };
  return { tone: "unknown", label: raw, title: `Тариф: ${raw}` };
}

function PlanBadge({ planType }: { planType: ManagedAccount["planType"] }) {
  const meta = planBadgeMeta(planType);
  return (
    <span className={`plan plan-badge plan-${meta.tone}`} title={meta.title}>
      <span className="plan-glyph" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

function AccountCompactRow({
  account,
  selected,
  privacyMode,
  busy,
  isEnglish,
  onSelect,
  onSwitch
}: {
  account: ManagedAccount;
  selected: boolean;
  privacyMode: boolean;
  busy: string | null;
  isEnglish: boolean;
  onSelect: (id: string) => void;
  onSwitch: (id: string) => void;
}) {
  const quota = selectAccountListQuota(account, nowSeconds());
  const remaining = quota.remainingPercent;
  const windowName = quota.windowType === "5h"
    ? (isEnglish ? "5-hour window" : "5-часовой лимит")
    : quota.windowType === "weekly"
      ? (isEnglish ? "Weekly limit" : "Недельный лимит")
      : quota.windowType === "daily"
        ? (isEnglish ? "Daily limit" : "Дневной лимит")
        : (isEnglish ? "Current limit" : "Текущий лимит");
  const resetLabel = quota.resetAt
    ? quota.resetAt <= nowSeconds()
      ? (isEnglish ? "Reset time reached · refresh data" : "Время сброса наступило · обновите данные")
      : `${isEnglish ? "Reset" : "Сброс"} ${formatTime(quota.resetAt)}`
    : (isEnglish ? "Reset time unavailable" : "Время сброса неизвестно");
  const tone = remaining === null ? "unknown" : remaining <= 10 ? "danger" : remaining <= 25 ? "warn" : "good";
  return (
    <article className={`account-compact-row ${selected ? "is-selected" : ""} ${account.isActive ? "is-active" : ""}`} role="listitem" onClick={() => onSelect(account.id)}>
      <div className="account-compact-identity">
        <AccountPlatformMark account={account} />
        <div className="account-copy">
          <div className="name">
            <span className="account-label" title={account.label}>{account.label}</span>
            <PlanBadge planType={account.planType} />
          </div>
          <div className="email" title={privacyMode ? undefined : account.email}>{privacyMode ? maskEmailForPrivacy(account.email) : account.email}</div>
        </div>
      </div>
      <div className={`account-compact-quota ${tone}`} title={remaining === null ? (isEnglish ? "No fresh quota data" : "Нет свежих данных лимита") : `${windowName}: ${remaining.toFixed(0)}%`}>
        <div>
          <span>{windowName}</span>
          <strong>{remaining === null ? "—" : `${remaining.toFixed(0)}%`}</strong>
        </div>
        <div className="bar"><span style={{ width: `${remaining ?? 0}%` }} /></div>
        <small>{resetLabel}</small>
      </div>
      <div className="account-compact-state">
        <CredentialStateChip account={account} />
        <QuotaFreshnessChip account={account} />
      </div>
      <button
        className="profile-switch-action account-compact-switch"
        disabled={busy !== null || account.isActive || account.credentialState !== "ready"}
        onClick={(event) => {
          event.stopPropagation();
          onSwitch(account.id);
        }}
        title={account.credentialState !== "ready" ? (isEnglish ? "Sign-in required before switching" : "Перед переключением требуется вход") : (isEnglish ? "Make active" : "Сделать активным")}
      >
        {busy === `switch:${account.id}` ? <Loader2 className="spin" /> : account.isActive ? <CheckCircle2 /> : <Zap />}
        <span>{account.isActive ? (isEnglish ? "Active" : "Активен") : (isEnglish ? "Switch" : "Переключить")}</span>
      </button>
    </article>
  );
}

function AccountCard({
  account,
  selected,
  privacyMode,
  busy,
  onRefresh,
  onSwitch,
  onReauth,
  onRepair,
  onSelect,
  onInspect
}: {
  account: ManagedAccount;
  selected: boolean;
  privacyMode: boolean;
  busy: string | null;
  onRefresh: (id: string) => void;
  onSwitch: (id: string) => void;
  onReauth: (id: string) => void;
  onRepair: (id: string) => void;
  onSelect: (id: string) => void;
  onInspect: (id: string, trigger: HTMLButtonElement) => void;
}) {
  const isAntigravity = accountPlatform(account) === "antigravity";
  const needsRepair = hasCurrentQuotaRefreshFailure(account) || account.credentialState !== "ready";
  const limits = accountLimitDisplay(account);
  return (
    <article
      className={`profile-card ${selected ? "is-selected" : ""} ${account.isActive ? "is-active" : ""}`}
      tabIndex={0}
      aria-label={`${account.label}, ${account.planType ?? "ChatGPT"}${account.isActive ? ", активный профиль" : ""}`}
      onClick={() => onSelect(account.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onSelect(account.id);
      }}
    >
      <div className="profile-card-head">
        <div className="account-cell">
          <AccountPlatformMark account={account} />
          <div className="account-copy">
            <div className="name">
              <span className="account-label" title={account.label}>{account.label}</span>
              {account.favorite ? <Star className="inline-mark" /> : null}
              {account.archived ? <span className="badge compact">архив</span> : null}
              {account.isActive ? <span className="badge active compact">активен</span> : null}
            </div>
            <div className="email" title={privacyMode ? undefined : account.email}>{privacyMode ? maskEmailForPrivacy(account.email) : account.email}</div>
          </div>
        </div>
        <div className="profile-card-status">
          <PlanBadge planType={account.planType} />
          <CredentialStateChip account={account} />
        </div>
      </div>
      <div className="profile-card-body">
        <LimitMeter label={limits.primaryLabel} usedPercent={limits.primaryUsedPercent} resetsAt={limits.primaryResetsAt} unavailableReason={limits.primaryUnavailableReason} />
        <LimitMeter label={limits.secondaryLabel} usedPercent={limits.secondaryUsedPercent} resetsAt={limits.secondaryResetsAt} unavailableReason={limits.secondaryUnavailableReason} />
      </div>
      <div className="profile-card-foot">
        <QuotaFreshnessChip account={account} />
        <span className="profile-refresh-age">{relativeRefresh(account)}</span>
      </div>
      <div className={`row-actions card-actions ${needsRepair ? "needs-repair" : ""}`} onClick={(event) => event.stopPropagation()}>
        <button className="icon-btn" aria-label={isAntigravity ? "Обновить лимиты Antigravity" : "Обновить лимиты"} disabled={busy !== null} onClick={() => onRefresh(account.id)} title={isAntigravity ? "Обновить лимиты Antigravity" : "Обновить лимиты"}>
          {busy === `refresh:${account.id}` ? <Loader2 className="spin" /> : <RefreshCcw />}
        </button>
        <button
          className={`icon-btn ${needsRepair ? "repair-action" : ""}`}
          aria-label={needsRepair ? "Диагностировать и восстановить аккаунт" : isAntigravity ? "Открыть авторизацию Antigravity" : "Повторно авторизовать профиль"}
          disabled={busy !== null}
          onClick={() => needsRepair ? onRepair(account.id) : onReauth(account.id)}
          title={needsRepair ? "Проверить вход, обновить лимиты и при необходимости восстановить авторизацию" : isAntigravity ? "Открыть авторизацию Antigravity" : "Повторно авторизовать профиль"}
        >
          {busy === `repair:${account.id}` || busy === `reauth:${account.id}` ? <Loader2 className="spin" /> : <KeyRound />}
        </button>
        <button className="icon-btn" aria-label="Подробнее о профиле" disabled={busy !== null} onClick={(event) => onInspect(account.id, event.currentTarget)} title="Подробнее о профиле">
          <MoreHorizontal />
        </button>
        <button className="profile-switch-action" disabled={busy !== null || account.isActive} onClick={() => onSwitch(account.id)} title="Сделать активным">
          {busy === `switch:${account.id}` ? <Loader2 className="spin" /> : account.isActive ? <CheckCircle2 /> : <Zap />}
          <span>{account.isActive ? "Активен" : "Переключить"}</span>
        </button>
      </div>
    </article>
  );
}

function AccountInspector({
  account,
  privacyMode,
  language,
  busy,
  onRefresh,
  onValidateAuth,
  onRepair,
  onSwitch,
  onReauth,
  onOpenFolder,
  onMetadata,
  onDelete
}: {
  account: ManagedAccount | null;
  privacyMode: boolean;
  language: AppSettings["language"];
  busy: string | null;
  onRefresh: (id: string) => void;
  onValidateAuth: (id: string) => void;
  onRepair: (id: string) => void;
  onSwitch: (id: string) => void;
  onReauth: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onMetadata: (id: string, input: { tags?: string[]; favorite?: boolean; archived?: boolean }) => void;
  onDelete: (id: string) => void;
}) {
  const isEnglish = language === "en";
  const text = getUiText(language);
  if (!account) {
    return (
      <aside className="inspector empty-inspector">
        <TerminalSquare />
        <strong>{text.inspector.noProfileSelected}</strong>
        <span>{text.inspector.noProfileHelp}</span>
      </aside>
    );
  }
  const isAntigravity = accountPlatform(account) === "antigravity";
  const limits = accountLimitDisplay(account);
  const switchDisabled = busy !== null || account.isActive;
  const tags = account.tags ?? [];
  const visibleTags = tags.slice(0, 2);
  const hiddenTagCount = Math.max(0, tags.length - visibleTags.length);
  const antigravityProject = account.antigravity?.googleProjectId ?? (isEnglish ? "no project" : "нет проекта");
  const antigravityFingerprint = account.antigravity?.fingerprintId ?? (isEnglish ? "not linked" : "не привязан");
  const currentQuotaFailure = hasCurrentQuotaRefreshFailure(account);

  return (
    <aside className={`inspector ${statusClass(account)}`}>
      <div className="inspector-profile-row">
        <div className="inspector-identity">
          <AccountPlatformMark account={account} size="large" />
          <div>
            <strong>{account.label}</strong>
            <span>{privacyMode ? maskEmailForPrivacy(account.email) : account.email}</span>
          </div>
        </div>
        <div className="inspector-meta-chips inspector-meta-line">
          <PlanBadge planType={account.planType} />
          <CredentialStateChip account={account} />
          <QuotaFreshnessChip account={account} />
          <span className="inspector-refresh-age">{relativeRefresh(account)}</span>
        </div>
      </div>
      <div className="inspector-tag-section">
        <div className="metadata-strip">
          <button className={`meta-toggle ${account.favorite ? "is-on" : ""}`} disabled={busy !== null} onClick={() => onMetadata(account.id, { favorite: !account.favorite })}>
            <Star />
            {isEnglish ? "Favorite" : "Избранное"}
          </button>
          <button className={`meta-toggle ${account.archived ? "is-on" : ""}`} disabled={busy !== null} onClick={() => onMetadata(account.id, { archived: !account.archived })}>
            <Archive />
            {isEnglish ? "Archive" : "Архив"}
          </button>
          {visibleTags.length > 0 ? (
            <div className="tag-row compact-tag-row">
              {visibleTags.map((tag) => <span key={tag}><Tag />{tag}</span>)}
              {hiddenTagCount > 0 ? <span className="tag-more">+{hiddenTagCount}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="inspector-limit-grid">
        <LimitMeter label={limits.primaryLabel} usedPercent={limits.primaryUsedPercent} resetsAt={limits.primaryResetsAt} unavailableReason={limits.primaryUnavailableReason} />
        <LimitMeter label={limits.secondaryLabel} usedPercent={limits.secondaryUsedPercent} resetsAt={limits.secondaryResetsAt} unavailableReason={limits.secondaryUnavailableReason} />
      </div>
      {currentQuotaFailure ? (
        <div className="quota-refresh-warning" title={account.lastRefreshError ?? undefined}>
          <AlertTriangle />
          <span><strong>{isEnglish ? "Latest refresh failed" : "Последнее обновление не удалось"}</strong>{isEnglish ? "The last correct quota snapshot is preserved." : "Последний корректный снимок лимитов сохранён."}</span>
          <button className="repair-inline" disabled={busy !== null} onClick={() => onRepair(account.id)}>
            {busy === `repair:${account.id}` ? <Loader2 className="spin" /> : <Wrench />}
            {isEnglish ? "Repair" : "Починить"}
          </button>
        </div>
      ) : null}
      {accountPlatform(account) === "antigravity" ? (
        <div className="antigravity-compact-details" aria-label={isEnglish ? "Antigravity diagnostics" : "Диагностика Antigravity"}>
          <span title={antigravityProject}><strong>Project</strong>{antigravityProject}</span>
          <span title={antigravityFingerprint}><strong>FP</strong>{antigravityFingerprint}</span>
          <span><strong>IDE</strong>{account.antigravity?.ideStateDetected ? (isEnglish ? "found" : "найден") : (isEnglish ? "missing" : "не найден")}</span>
          <span><strong>{isEnglish ? "Access" : "Доступ"}</strong>{antigravityAccessLabel(account, language)}</span>
        </div>
      ) : null}
      <div className="inspector-path" title={privacyMode ? (isEnglish ? "Path hidden" : "Путь скрыт") : account.profileDir}>
        <Database />
        <span>{privacyMode ? maskPathForPrivacy(account.profileDir) : account.profileDir}</span>
      </div>
      <section className="inspector-management" aria-label={isEnglish ? "Profile management" : "Управление профилем"}>
        <div className="inspector-management-head">
          <strong>{isEnglish ? "Profile management" : "Управление профилем"}</strong>
          <span>{isEnglish ? "All actions are available here" : "Все действия доступны сразу"}</span>
        </div>
        <div className="inspector-action-grid">
        <button
          className="button"
          aria-label={isEnglish ? "Activate account" : "Активировать аккаунт"}
          disabled={switchDisabled}
          onClick={() => onSwitch(account.id)}
          title={isAntigravity ? (isEnglish ? "Apply through Antigravity Credential Manager and restart Antigravity" : "Применить аккаунт через Antigravity Credential Manager и перезапустить Antigravity") : (isEnglish ? "Activate account" : "Активировать аккаунт")}
        >
          <Zap />
          <span className="action-label">{isEnglish ? "Activate" : "Активировать"}</span>
        </button>
        <button className="button secondary" aria-label={isEnglish ? "Refresh limits" : "Обновить лимиты"} disabled={busy !== null} onClick={() => onRefresh(account.id)} title={isAntigravity ? (isEnglish ? "Refresh Antigravity limits" : "Обновить лимиты Antigravity") : (isEnglish ? "Refresh limits" : "Обновить лимиты")}>
          <RefreshCcw />
          <span className="action-label">{isEnglish ? "Refresh" : "Обновить"}</span>
        </button>
        <button className="button secondary" aria-label={isEnglish ? "Check sign-in" : "Проверить вход"} disabled={busy !== null} onClick={() => onValidateAuth(account.id)}>
          {busy === `auth:${account.id}` ? <Loader2 className="spin" /> : <ShieldCheck />}
          <span className="action-label">{isEnglish ? "Check" : "Проверить вход"}</span>
        </button>
        <button className="button secondary" aria-label={isEnglish ? "Authorize" : "Авторизация"} disabled={busy !== null} onClick={() => onReauth(account.id)}><KeyRound />{isEnglish ? "Authorize again" : "Авторизовать заново"}</button>
        <button className="button secondary" aria-label={isEnglish ? "Open folder" : "Открыть папку"} disabled={busy !== null} onClick={() => onOpenFolder(account.id)}><FolderOpen />{isEnglish ? "Open profile folder" : "Открыть папку профиля"}</button>
        <button className="button danger-action" aria-label={isEnglish ? "Delete profile" : "Удалить профиль"} disabled={busy !== null || account.isActive} onClick={() => onDelete(account.id)} title={account.isActive ? (isEnglish ? "Activate another profile first" : "Сначала переключись на другой аккаунт") : undefined}><Trash2 />{isEnglish ? "Delete profile" : "Удалить профиль"}</button>
        </div>
      </section>
    </aside>
  );
}

type TransferMode = "export" | "import";
type ViewKey = AppViewKey;
type NavItem = { key: ViewKey; label: string; description: string; icon: LucideIcon };
type PlatformFilter = "all" | "codex" | "antigravity";
type AntigravityExternalImportSource = Exclude<AntigravityCredentialImportSource, "token_json" | "local_files">;
type LoginWizardState = {
  open: boolean;
  phase: "method" | "starting" | "waiting" | "done" | "error";
  type: CodexLoginRequest["type"] | null;
  result: LoginStartResult | null;
  error: string | null;
};

const ANTIGRAVITY_CLI_DOCS_URL = "https://www.antigravity.google/docs/cli-getting-started";

const antigravityOAuthStepMessage: Record<string, string> = {
  callback_server_ready: "Готовлю локальный callback для Google входа Antigravity",
  browser_opened: "Открыл Google вход для Antigravity в браузере",
  callback_received: "Код Google получен, обмениваю его на токен",
  token_exchange_started: "Обмениваю Google код на токен Antigravity",
  token_exchange_completed: "Токен получен, проверяю Google профиль",
  userinfo_started: "Проверяю Google профиль",
  userinfo_completed: "Google профиль подтверждён, сохраняю Antigravity аккаунт",
  project_context_started: "Проверяю Code Assist контекст",
  project_context_completed: "Code Assist контекст получен",
  project_context_unavailable: "Code Assist контекст недоступен, лимиты обновятся позже",
  callback_failed: "Google callback не получен, попробуй начать вход заново",
  failed: "Antigravity Google вход не завершился"
};
type ConfirmState = {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  details?: string[];
};

function passwordStrength(value: string): { label: string; className: string } {
  const score = Number(value.length >= 8) + Number(value.length >= 14) + Number(/\p{Lu}/u.test(value)) + Number(/\d/.test(value)) + Number(/[^\p{L}\d]/u.test(value));
  if (!value) return { label: "Введите пароль", className: "idle" };
  if (score <= 2) return { label: "Слабый пароль", className: "weak" };
  if (score <= 4) return { label: "Нормальный пароль", className: "medium" };
  return { label: "Сильный пароль", className: "strong" };
}

function AddAccountWizard({
  state,
  busy,
  capabilities,
  onStart,
  onOpen,
  onCopyDeviceCode,
  onOpenDeviceLogin,
  onClose
}: {
  state: LoginWizardState;
  busy: string | null;
  capabilities: AppDiagnostics["codexCapabilities"] | null | undefined;
  onStart: (input: CodexLoginRequest) => void;
  onOpen: (url: string) => void;
  onCopyDeviceCode: (userCode: string) => Promise<unknown>;
  onOpenDeviceLogin: (url: string, userCode: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [credentialType, setCredentialType] = useState<"apiKey" | "enterpriseAccessToken" | null>(null);
  const [credential, setCredential] = useState("");
  const [showCredential, setShowCredential] = useState(false);
  const [deviceCodeAction, setDeviceCodeAction] = useState<"idle" | "copying" | "copied" | "opening" | "opened" | "error">("idle");
  useEffect(() => {
    if (state.open) return;
    setCredential("");
    setCredentialType(null);
    setShowCredential(false);
    setDeviceCodeAction("idle");
  }, [state.open]);
  useEffect(() => {
    if (state.phase !== "waiting" || !state.result?.userCode) return;
    setDeviceCodeAction(
      state.result.loginPageOpened && state.result.deviceCodeCopied
        ? "opened"
        : state.result.deviceCodeCopied
          ? "copied"
          : state.result.loginPageOpened
            ? "error"
            : "idle"
    );
  }, [state.phase, state.result?.userCode, state.result?.deviceCodeCopied, state.result?.loginPageOpened]);
  if (!state.open) return null;
  const url = state.result?.authUrl ?? state.result?.verificationUrl ?? "";
  const methodAvailable = (id: CodexLoginMethodId) =>
    capabilities?.loginMethods.find((method) => method.id === id)?.available !== false;
  const submitCredential = () => {
    if (!credentialType || !credential.trim()) return;
    onStart({ type: credentialType, credential: credential.trim() });
    setCredential("");
    setShowCredential(false);
  };
  const copyDeviceCode = async () => {
    const userCode = state.result?.userCode;
    if (!userCode) return;
    setDeviceCodeAction("copying");
    try {
      await onCopyDeviceCode(userCode);
      setDeviceCodeAction("copied");
    } catch {
      setDeviceCodeAction("error");
    }
  };
  const openLoginPage = async () => {
    if (!url) return;
    const userCode = state.result?.userCode;
    if (!userCode) {
      onOpen(url);
      return;
    }
    setDeviceCodeAction("opening");
    try {
      await onOpenDeviceLogin(url, userCode);
      setDeviceCodeAction("opened");
    } catch {
      setDeviceCodeAction("error");
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Добавление аккаунта">
      <div className="workflow-modal">
        <div className="modal-head">
          <div>
            <div className="panel-title">Добавление аккаунта</div>
            <p className="muted">Авторизация проходит через локальный Codex app-server. Токены остаются на этом ПК.</p>
          </div>
          <button className="window-btn" onClick={onClose} title="Закрыть">
            <X />
          </button>
        </div>

        {state.phase === "method" ? (
          <div className="codex-onboarding-layout">
            <section className="codex-official-login-intro" aria-label="Официальная авторизация Codex">
              <div className="codex-section-heading">
                <span>ОФИЦИАЛЬНАЯ АВТОРИЗАЦИЯ</span>
                <strong>Выберите подходящий способ входа</strong>
              </div>
              <p>Каждый профиль создаётся в отдельном локальном <code>CODEX_HOME</code>, проверяется официальным app-server и сохраняется в зашифрованном Windows vault.</p>
            </section>
            <div className="choice-grid codex-login-choice-grid">
            <button className="choice-card" disabled={busy !== null || !methodAvailable("chatgptDeviceCode")} onClick={() => onStart({ type: "chatgptDeviceCode" })}>
              <KeyRound />
              <strong>Код устройства</strong>
              <span>Надёжный вариант, если браузерный callback недоступен.</span>
            </button>
            <button className="choice-card" disabled={busy !== null || !methodAvailable("chatgpt")} onClick={() => onStart({ type: "chatgpt" })}>
              <LogIn />
              <strong>Браузерный вход</strong>
              <span>Откроет ChatGPT и вернёт профиль после подтверждения.</span>
            </button>
            <button className="choice-card" disabled={busy !== null || !methodAvailable("apiKey")} onClick={() => setCredentialType("apiKey")}>
              <KeyRound />
              <strong>OpenAI API key</strong>
              <span>Ключ передаётся локальному Codex app-server и сразу удаляется из формы.</span>
            </button>
            <button className="choice-card" disabled={busy !== null || !methodAvailable("enterpriseAccessToken")} onClick={() => setCredentialType("enterpriseAccessToken")}>
              <ShieldCheck />
              <strong>Enterprise access token</strong>
              <span>Официальный CLI-вход через stdin, без токена в аргументах процесса и логах.</span>
            </button>
            {credentialType ? (
              <div className="credential-login-form">
                <label htmlFor="codex-credential">
                  {credentialType === "apiKey" ? "OpenAI API key" : "Enterprise access token"}
                </label>
                <div className="credential-input-row">
                  <input
                    id="codex-credential"
                    type={showCredential ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    value={credential}
                    onChange={(event) => setCredential(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitCredential();
                    }}
                    placeholder={credentialType === "apiKey" ? "sk-…" : "eyJ…"}
                  />
                  <button className="button secondary" type="button" onClick={() => setShowCredential((value) => !value)}>
                    {showCredential ? "Скрыть" : "Показать"}
                  </button>
                  <button className="button" type="button" disabled={!credential.trim() || busy !== null} onClick={submitCredential}>
                    Войти
                  </button>
                </div>
                <small>Секрет существует только в памяти формы до отправки в локальный main process.</small>
              </div>
            ) : null}
            </div>
          </div>
        ) : null}

        {state.phase === "starting" ? (
          <div className="workflow-state">
            <Loader2 className="spin" />
            <strong>Запускаю авторизацию</strong>
            <span>Поднимаю Codex RPC и готовлю отдельный локальный профиль.</span>
          </div>
        ) : null}

        {state.phase === "waiting" && state.result ? (
          <div className="workflow-state">
            <CheckCircle2 />
            <strong>{state.type === "chatgptDeviceCode" ? "Введите код устройства" : "Завершите вход в браузере"}</strong>
            {state.result.userCode ? (
              <div className="device-code-panel">
                <div className="device-code-caption"><span>Одноразовый код</span><small>действует 15 минут</small></div>
                <code>{state.result.userCode}</code>
                <button className="device-code-copy" type="button" disabled={deviceCodeAction === "copying"} onClick={() => void copyDeviceCode()} title="Скопировать код устройства">
                  {deviceCodeAction === "copying" ? <Loader2 className="spin" /> : deviceCodeAction === "copied" || deviceCodeAction === "opened" ? <CheckCircle2 /> : <Copy />}
                  <span>{deviceCodeAction === "copied" || deviceCodeAction === "opened" ? "Скопировано" : "Копировать"}</span>
                </button>
              </div>
            ) : null}
            <span className={`device-code-guidance ${deviceCodeAction === "error" ? "is-error" : ""}`} role="status">
              {state.result.userCode
                ? deviceCodeAction === "error"
                  ? "Не удалось передать код. Нажмите «Копировать» и откройте страницу ещё раз."
                  : "Код уже в буфере. После выбора аккаунта вставьте его в поле сочетанием Ctrl+V."
                : "После подтверждения приложение само сохранит профиль и обновит список."}
            </span>
            {url ? (
              <button className="button device-login-open" disabled={deviceCodeAction === "opening"} onClick={() => void openLoginPage()}>
                {deviceCodeAction === "opening" ? <Loader2 className="spin" /> : <ExternalLink />}
                {state.result.userCode ? "Открыть и подготовить код" : "Открыть страницу входа"}
              </button>
            ) : null}
          </div>
        ) : null}

        {state.phase === "done" ? (
          <div className="workflow-state success">
            <CheckCircle2 />
            <strong>Аккаунт добавлен</strong>
            <span>Профиль сохранён локально. Можно обновить лимиты или переключиться на него.</span>
            <button className="button" onClick={onClose}>Готово</button>
          </div>
        ) : null}

        {state.phase === "error" ? (
          <div className="workflow-state danger">
            <AlertTriangle />
            <strong>Не удалось добавить аккаунт</strong>
            <span>{state.error ?? "Подробности доступны в журнале диагностики."}</span>
            <button className="button secondary" onClick={() => onStart({ type: "chatgptDeviceCode" })}>Повторить через код</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConfirmDialog({
  state,
  onClose
}: {
  state: ConfirmState | null;
  onClose: (confirmed: boolean) => void;
}) {
  if (!state) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={state.title}>
      <div className={`confirm-modal ${state.tone === "danger" ? "danger" : ""}`}>
        <div className="modal-head">
          <div>
            <div className="panel-title">{state.title}</div>
            <p className="muted">{state.body}</p>
          </div>
          <button className="window-btn" onClick={() => onClose(false)} title="Закрыть">
            <X />
          </button>
        </div>
        {state.details?.length ? (
          <div className="confirm-details">
            {state.details.map((detail) => <span key={detail}>{detail}</span>)}
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="button secondary" onClick={() => onClose(false)}>Отмена</button>
          <button className={`button ${state.tone === "danger" ? "danger-action" : ""}`} onClick={() => onClose(true)}>{state.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function CommandPalette({
  open,
  query,
  commands,
  busy,
  onQuery,
  onClose,
  onRun
}: {
  open: boolean;
  query: string;
  commands: CommandPaletteCommand[];
  busy: string | null;
  onQuery: (value: string) => void;
  onClose: () => void;
  onRun: (command: CommandPaletteCommand) => void;
}) {
  if (!open) return null;
  const visible = filterCommandPalette(commands, query).slice(0, 18);
  const groups = Array.from(new Set(visible.map((command) => command.group)));

  return (
    <div className="modal-backdrop command-backdrop" role="dialog" aria-modal="true" aria-label="Командный центр">
      <div className="command-palette">
        <div className="command-search">
          <Command />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter") {
                const first = visible.find((command) => !command.disabled);
                if (first) onRun(first);
              }
            }}
            placeholder="Найти команду, аккаунт или действие"
            aria-label="Поиск команды"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-list">
          {visible.length === 0 ? <div className="empty compact-empty">Команд не найдено.</div> : null}
          {groups.map((group) => (
            <section key={group} className="command-group">
              <span>{group}</span>
              {visible.filter((command) => command.group === group).map((command) => (
                <button
                  key={command.id}
                  className="command-row"
                  disabled={busy !== null || command.disabled}
                  onClick={() => onRun(command)}
                >
                  <strong>{command.title}</strong>
                  <small>{command.subtitle}</small>
                </button>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function AntigravityImportModal({
  busy,
  profileStatus,
  oauthSession,
  callbackUrl,
  onCallbackUrl,
  tokenPayload,
  onTokenPayload,
  result,
  displayEmail,
  onClose,
  onStartOAuth,
  onFinishOAuth,
  onImportToken,
  onImportFiles,
  onImportSource,
  onImportLocalProfile,
  onInspect,
  onOpenDocs
}: {
  busy: string | null;
  profileStatus: AntigravityProfileStatus | null;
  oauthSession: AntigravityOAuthStartResult | null;
  callbackUrl: string;
  onCallbackUrl: (value: string) => void;
  tokenPayload: string;
  onTokenPayload: (value: string) => void;
  result: AntigravityCredentialBatchImportResult | null;
  displayEmail: (email: string) => string;
  onClose: () => void;
  onStartOAuth: () => void;
  onFinishOAuth: (manualCallback: boolean) => void;
  onImportToken: () => void;
  onImportFiles: () => void;
  onImportSource: (source: AntigravityExternalImportSource) => void;
  onImportLocalProfile: () => void;
  onInspect: () => void;
  onOpenDocs: () => void;
}) {
  const sources: Array<[AntigravityExternalImportSource, string, LucideIcon]> = [
    ["plugin", "Плагин", KeyRound],
    ["local_db", "Локальная БД", Database],
    ["antigravity_tools", "Antigravity Tools", Zap],
    ["cockpit", "Cockpit", Layers3]
  ];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Добавить Antigravity">
      <div className="transfer-modal antigravity-import-modal">
        <div className="modal-head">
          <div>
            <div className="panel-title">Добавить Antigravity</div>
            <p className="muted">Выберите обычный Google-вход, уже настроенную IDE или локальный JSON. Секреты остаются в защищённом main process.</p>
          </div>
          <button className="icon-btn" onClick={onClose} title="Закрыть">
            <X />
          </button>
        </div>

        <section className="antigravity-primary-flow">
          <div className="antigravity-status-strip">
            <span className={`status-dot ${profileStatus?.detected ? "is-ready" : ""}`} />
            <div><strong>{profileStatus?.detected ? "Локальный профиль найден" : "Локальный профиль не найден"}</strong><small>{profileStatus?.detected ? "Можно импортировать вход из установленной Antigravity IDE." : "Google-вход создаст новый защищённый профиль."}</small></div>
            <button className="button secondary compact-button" disabled={busy !== null} onClick={onInspect}><ShieldCheck />Проверить</button>
          </div>
          <div className="antigravity-primary-grid">
            <button className="antigravity-method-card is-recommended" disabled={busy !== null} onClick={onStartOAuth}>
              <span className="method-card-icon">{busy === "antigravity-oauth-start" ? <Loader2 className="spin" /> : <ExternalLink />}</span>
              <span><strong>Войти через Google</strong><small>Рекомендуется · автоматический callback и проверка профиля</small></span>
              <em>Основной</em>
            </button>
            <button className="antigravity-method-card" disabled={busy !== null || !profileStatus?.detected} onClick={onImportLocalProfile}>
              <span className="method-card-icon">{busy === "antigravity-import-local" ? <Loader2 className="spin" /> : <Database />}</span>
              <span><strong>Из локальной IDE</strong><small>Считать уже сохранённый вход и контекст Code Assist</small></span>
              <em>{profileStatus?.detected ? "Найден" : "Нет данных"}</em>
            </button>
            <button className="antigravity-method-card" disabled={busy !== null} onClick={onImportFiles}>
              <span className="method-card-icon">{busy === "antigravity-file-import" ? <Loader2 className="spin" /> : <FileDown />}</span>
              <span><strong>Выбрать JSON</strong><small>Проверить локальные credential-файлы перед импортом</small></span>
              <em>Файл</em>
            </button>
          </div>
          {oauthSession ? (
            <div className="antigravity-session-line">
              <span>Ожидаю callback</span>
              <strong>{oauthSession.redirectUri}</strong>
              <em>до {formatTime(oauthSession.expiresAt)}</em>
            </div>
          ) : null}
        </section>

        <details className="antigravity-advanced">
          <summary>Перенос и восстановление</summary>
          <div className="antigravity-import-source-row">
            {sources.map(([source, title, Icon]) => {
              const busyKey = "antigravity-source:" + source;
              return (
                <button
                  key={source}
                  className="button secondary compact-button"
                  disabled={busy !== null}
                  onClick={() => onImportSource(source)}
                >
                  {busy === busyKey ? <Loader2 className="spin" /> : <Icon />}
                  {title}
                </button>
              );
            })}
          </div>

          <label className="field compact-field">
            <span>Токен или JSON</span>
            <textarea
              className="token-json-input"
              value={tokenPayload}
              onChange={(event) => onTokenPayload(event.target.value)}
              placeholder={'[{"email":"user@example.com","refresh_token":"1//..."}] или raw refresh_token'}
              spellCheck={false}
            />
          </label>
          <div className="antigravity-inline-actions">
            <button className="button secondary" disabled={busy !== null} onClick={() => onTokenPayload("")}>Очистить</button>
            <button className="button" disabled={busy !== null || tokenPayload.trim().length < 20} onClick={onImportToken}>
              {busy === "antigravity-token-import" ? <Loader2 className="spin" /> : <KeyRound />}
              Импортировать токен
            </button>
          </div>

          <div className="antigravity-local-flow">
            <button className="button secondary" disabled={busy !== null} onClick={onOpenDocs}>
              <ExternalLink />
              Документация CLI
            </button>
          </div>

          <label className="field compact-field">
            <span>Ручной callback URL</span>
            <div className="inline-copy-field">
              <input value={callbackUrl} onChange={(event) => onCallbackUrl(event.target.value)} placeholder="http://localhost:36742/oauth-callback?code=...&state=..." />
              <button className="button secondary inline-action" disabled={busy !== null || !oauthSession || !callbackUrl.trim()} onClick={() => onFinishOAuth(true)}>
                Завершить
              </button>
            </div>
          </label>
        </details>

        {result ? (
          <div className="antigravity-import-result">
            <strong>{result.importedCount > 0 ? "Импортировано: " + result.importedCount : "Новые аккаунты не найдены"}</strong>
            {result.failures.slice(0, 3).map((failure) => (
              <span key={failure.source + "-" + (failure.email ?? "unknown")}>{failure.email ? displayEmail(failure.email) : failure.source}: {failure.reason}</span>
            ))}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

let notificationAudioContext: AudioContext | null = null;
let lastNotificationSoundAt = 0;

async function playNotificationSound(tone: AppNotificationPayload["tone"]): Promise<void> {
  if (tone === "progress" || document.visibilityState !== "visible") return;
  const now = performance.now();
  if (now - lastNotificationSoundAt < 420) return;
  lastNotificationSoundAt = now;
  try {
    notificationAudioContext ??= new AudioContext();
    if (notificationAudioContext.state === "suspended") await notificationAudioContext.resume();
    const context = notificationAudioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequencies = tone === "success" ? [660, 880] : tone === "warning" ? [520, 660] : [390, 310];
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequencies[0], context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequencies[1], context.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.34);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.36);
  } catch {
    // Sound is optional feedback; text and status remain authoritative.
  }
}

function App() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [switchTransactions, setSwitchTransactions] = useState<SwitchTransaction[]>([]);
  const [switchHistory, setSwitchHistory] = useState<SwitchHistoryItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("Готов к работе");
  const [appNotifications, setAppNotifications] = useState<AppNotificationPayload[]>([]);
  const [visibilityEpoch, setVisibilityEpoch] = useState(0);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "degraded" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const [settingsData, setSettingsData] = useState<AppSettings | null>(null);
  const [antigravityProfileStatus, setAntigravityProfileStatus] = useState<AntigravityProfileStatus | null>(null);
  const [workspaceBinding, setWorkspaceBinding] = useState<WorkspaceBinding | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckResult | null>(null);
  const [transferMode, setTransferMode] = useState<TransferMode | null>(null);
  const [transferPassword, setTransferPassword] = useState("");
  const [transferConfirm, setTransferConfirm] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [antigravityImportOpen, setAntigravityImportOpen] = useState(false);
  const [antigravityOAuthSession, setAntigravityOAuthSession] = useState<AntigravityOAuthStartResult | null>(null);
  const [antigravityCallbackUrl, setAntigravityCallbackUrl] = useState("");
  const [antigravityTokenPayload, setAntigravityTokenPayload] = useState("");
  const [antigravityImportResult, setAntigravityImportResult] = useState<AntigravityCredentialBatchImportResult | null>(null);
  const [search, setSearch] = useState("");
  const [accountSort, setAccountSort] = useState<AccountListSort>(() => {
    const saved = window.localStorage.getItem("cam.accountSort");
    return saved === "subscription" || saved === "remaining" || saved === "reset" || saved === "freshness" || saved === "added" || saved === "name" ? saved : "smart";
  });
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("codex");
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => window.localStorage.getItem("cam.accountView") === "table" ? "table" : "cards");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const inspectorCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [loginWizard, setLoginWizard] = useState<LoginWizardState>({ open: false, phase: "method", type: null, result: null, error: null });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const transferResolveRef = useRef<((value: string | null) => void) | null>(null);
  const confirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const reloadSequenceRef = useRef(0);
  const language = settingsData?.language ?? "ru";
  const languageRef = useRef(language);
  const settingsRef = useRef(settingsData);
  const uiText = getUiText(language);
  const isEnglish = language === "en";
  const shellText = {
    platformFilter: isEnglish ? "Platform filter" : "Фильтр платформы",
    platform: isEnglish ? "Platform" : "Платформа",
    actionCenter: isEnglish ? "Action center" : "Центр действий",
    actions: isEnglish ? "Actions" : "Действия",
    addCodex: isEnglish ? "Add Codex" : "Добавить Codex",
    addAntigravity: isEnglish ? "Add Antigravity" : "Добавить Antigravity",
    commands: isEnglish ? "Commands" : "Команды",
    deviceCode: isEnglish ? "Device code" : "Код устройства",
    consoleSections: isEnglish ? "Console sections" : "Разделы консоли",
    windowControls: isEnglish ? "Window controls" : "Управление окном",
    minimize: isEnglish ? "Minimize" : "Свернуть",
    maximize: isEnglish ? "Maximize" : "Развернуть",
    close: isEnglish ? "Close" : "Закрыть",
    noRefreshableAccounts: isEnglish ? "No accounts to refresh" : "Нет аккаунтов для обновления",
    refreshLimits: isEnglish ? "Refresh limits" : "Обновить лимиты"
  };
  const accountsText = {
    title: platformFilter === "antigravity" ? (isEnglish ? "Antigravity accounts" : "Аккаунты Antigravity") : (isEnglish ? "Codex accounts" : "Аккаунты Codex"),
    searchProfile: isEnglish ? "Search profile" : "Поиск профиля",
    accountFilter: isEnglish ? "Account filter" : "Фильтр аккаунтов",
    viewMode: isEnglish ? "Account view" : "Вид аккаунтов",
    all: isEnglish ? "All" : "Все",
    table: isEnglish ? "List" : "Список",
    cards: isEnglish ? "Cards" : "Карточки",
    sort: isEnglish ? "Sort accounts" : "Сортировка аккаунтов",
    smartSort: isEnglish ? "Smart order" : "Умная сортировка",
    subscriptionSort: isEnglish ? "Best plan" : "По подписке",
    remainingSort: isEnglish ? "Most limit left" : "Больше остаток",
    resetSort: isEnglish ? "Nearest reset" : "Ближайший сброс",
    freshnessSort: isEnglish ? "Freshest data" : "Свежие данные",
    addedSort: isEnglish ? "Recently added" : "Сначала новые",
    nameSort: isEnglish ? "By name" : "По названию",
    export: isEnglish ? "Export" : "Экспорт",
    import: isEnglish ? "Import" : "Импорт",
    account: isEnglish ? "Account" : "Аккаунт",
    plan: isEnglish ? "Plan" : "План",
    fiveHours: isEnglish ? "5 hours" : "5 часов",
    week: isEnglish ? "Week" : "Неделя",
    status: isEnglish ? "Status" : "Статус",
    emptyFiltered: isEnglish ? "No accounts match this filter." : "Под этот фильтр аккаунтов нет."
  };
  const privacyMode = settingsData?.privacyMode === true;
  const displayEmail = (email: string): string => privacyMode ? maskEmailForPrivacy(email) : email;
  const displayPath = (value: string | null | undefined, fallback = "не выбран"): string => {
    return privacyMode ? maskPathForPrivacy(value, fallback) : (value ?? fallback);
  };

  const stats = useMemo(() => {
    const active = accounts.find((account) => account.isActive);
    const low = accounts.filter((account) => account.status === "near_limit" || account.status === "limited").length;
    const avg = accounts.length ? accounts.reduce((sum, account) => sum + used(account), 0) / accounts.length : 0;
    const usable = accounts.filter(isUsable).length;
    const stale = accounts.filter((account) => !account.lastRefreshAt || nowSeconds() - account.lastRefreshAt > 15 * 60).length;
    const codex = accounts.filter((account) => accountPlatform(account) === "codex").length;
    const antigravity = accounts.filter((account) => accountPlatform(account) === "antigravity").length;
    return { active, low, avg, usable, stale, codex, antigravity };
  }, [accounts]);
  const overviewAccounts = useMemo(
    () => accounts.filter((account) => accountPlatform(account) === "codex"),
    [accounts]
  );

  const smartRecommendation = useMemo(() => selectSmartAccount(accounts, workspaceBinding), [accounts, workspaceBinding]);
  const bestAccount = useMemo(() => {
    return smartRecommendation ? accounts.find((account) => account.id === smartRecommendation.accountId) ?? null : null;
  }, [accounts, smartRecommendation]);
  const commandPalette = useMemo(() => buildCommandPalette({
    accounts,
    activeView,
    smartRecommendation,
    privacyMode
  }), [accounts, activeView, privacyMode, smartRecommendation]);
  const showUpdateBanner = updateStatus?.status === "available";
  const updateButtonDisabled = busy !== null;
  const updateButtonLabel = isEnglish ? "Open GitHub" : "Открыть GitHub";

  const scopedAccounts = useMemo(() => {
    return platformFilter === "all" ? accounts : accounts.filter((account) => accountPlatform(account) === platformFilter);
  }, [accounts, platformFilter]);

  const selectedAccount = useMemo(() => {
    return scopedAccounts.find((account) => account.id === selectedAccountId) ??
      scopedAccounts.find((account) => account.isActive) ??
      (bestAccount && scopedAccounts.some((account) => account.id === bestAccount.id) ? bestAccount : null) ??
      scopedAccounts[0] ??
      null;
  }, [bestAccount, scopedAccounts, selectedAccountId]);

  const visibleAccounts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = scopedAccounts
      .filter((account) => {
        if (!needle) return true;
        return `${account.label} ${account.email} ${account.planType}`.toLowerCase().includes(needle);
      });
    return sortAccountList(filtered, accountSort, nowSeconds());
  }, [accountSort, scopedAccounts, search]);
  const scopedProtectedCount = scopedAccounts.filter((account) => account.credentialState === "ready").length;
  const scopedAttentionCount = scopedAccounts.filter((account) => account.credentialState !== "ready" || hasCurrentQuotaRefreshFailure(account)).length;
  const refreshableAccountCount = accounts.length;
  const tableScrollable = false;
  const navItems: NavItem[] = [
    { key: "overview", label: isEnglish ? "Overview" : "Обзор", description: isEnglish ? "Session and readiness" : "Сессия и готовность", icon: LayoutDashboard },
    { key: "accounts", label: uiText.nav.accounts, description: platformFilter === "antigravity" ? "Antigravity" : "Codex", icon: Layers3 },
    { key: "activity", label: isEnglish ? "Activity" : "Активность", description: isEnglish ? "Switch journal" : "Журнал переключений", icon: Activity },
    { key: "settings", label: uiText.nav.settings, description: isEnglish ? "App behavior" : "Поведение приложения", icon: SlidersHorizontal }
  ];
  const activeNav = navItems.find((item) => item.key === activeView) ?? navItems[0];
  const platformSummaries = [
    {
      id: "codex",
      label: "Codex",
      count: stats.codex,
      state: platformFilter === "codex" ? "выбран" : diagnostics?.codexPath ? "готов" : "нужен CLI",
      tone: diagnostics?.codexPath ? "ready" : "warn",
      available: true
    },
    {
      id: "antigravity",
      label: "Antigravity",
      count: stats.antigravity,
      state: isEnglish ? "in development" : "в разработке",
      tone: "muted",
      available: false
    }
  ];

  useEffect(() => {
    if (selectedAccountId && scopedAccounts.some((account) => account.id === selectedAccountId)) return;
    const bestScopedAccountId = bestAccount && scopedAccounts.some((account) => account.id === bestAccount.id) ? bestAccount.id : null;
    setSelectedAccountId(scopedAccounts.find((account) => account.isActive)?.id ?? bestScopedAccountId ?? scopedAccounts[0]?.id ?? null);
  }, [bestAccount, scopedAccounts, selectedAccountId]);

  useEffect(() => {
    document.documentElement.lang = language;
    languageRef.current = language;
    settingsRef.current = settingsData;
  }, [language, settingsData]);

  useEffect(() => {
    window.localStorage.setItem("cam.accountSort", accountSort);
  }, [accountSort]);

  useEffect(() => {
    window.localStorage.setItem("cam.accountView", viewMode);
  }, [viewMode]);

  useEffect(() => {
    const onVisibilityChange = () => setVisibilityEpoch((value) => value + 1);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (document.visibilityState !== "visible") return;
    const dismissible = appNotifications.filter((notice) => notice.timeoutType === "default" && notice.tone !== "error");
    if (dismissible.length === 0) return;
    const timers = dismissible.map((notice) => window.setTimeout(() => {
      setAppNotifications((current) => current.filter((item) => item.key !== notice.key));
    }, notice.tone === "progress" ? 8_500 : 7_000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [appNotifications, visibilityEpoch]);

  useEffect(() => {
    if (!inspectorOpen) return;
    const trigger = inspectorTriggerRef.current;
    const focusCloseButton = window.requestAnimationFrame(() => inspectorCloseButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setInspectorOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = inspectorCloseButtonRef.current?.closest<HTMLElement>("[role='dialog']");
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusCloseButton);
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
      });
    };
  }, [inspectorOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        setCommandSearch("");
        return;
      }
      if (event.key === "Escape" && commandOpen && !isTextInput) {
        setCommandOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandOpen]);

  async function reload() {
    const requestId = ++reloadSequenceRef.current;
    try {
      const [
        nextAccounts,
        nextDiagnostics,
        nextSettings,
        nextAntigravityProfileStatus,
        nextBinding,
        nextSwitchTransactions,
        nextSwitchHistory
      ] = await Promise.all([
        cam.listAccounts(),
        cam.getDiagnostics(),
        cam.getSettings().catch(() => null),
        cam.getAntigravityProfileStatus().catch(() => null),
        cam.getWorkspaceBinding().catch(() => null),
        cam.listSwitchTransactions().catch(() => []),
        cam.getSwitchHistory().catch(() => [])
      ]);
      if (requestId !== reloadSequenceRef.current) return;
      setAccounts(nextAccounts);
      setDiagnostics(nextDiagnostics);
      setSettingsData(nextSettings);
      setAntigravityProfileStatus(nextAntigravityProfileStatus);
      setWorkspaceBinding(nextBinding);
      setSwitchTransactions(nextSwitchTransactions);
      setSwitchHistory(nextSwitchHistory);
      setLoadError(nextDiagnostics.startupError ?? null);
      setLoadState(nextDiagnostics.startupError ? "degraded" : "ready");
      if (nextDiagnostics.startupError) setMessage(uiErrorMessage("Сервисы приложения требуют внимания"));
    } catch (error) {
      if (requestId !== reloadSequenceRef.current) return;
      setLoadError(error instanceof Error ? error.message : "Desktop bridge did not return data");
      setLoadState("error");
      setMessage(uiErrorMessage("Не удалось загрузить список аккаунтов"));
      try {
        setDiagnostics(await cam.getDiagnostics());
      } catch {
        // Keep UI alive if diagnostics are unavailable.
      }
    }
  }

  useEffect(() => {
    void reload();
    if (window.localStorage.getItem("cam.releaseNotesSeen") !== appVersion) {
      setShowReleaseNotes(true);
    }
    const offAuth = cam.onAuthEvent((event: AuthEvent) => {
      setMessage(event.success ? "Аккаунт добавлен" : uiErrorMessage("Не удалось завершить вход"));
      setLoginWizard((current) => ({
        ...current,
        open: true,
        phase: event.success ? "done" : "error",
        error: event.success ? null : (event.error ?? "Codex не вернул успешное завершение входа")
      }));
      void reload();
    });
    const offAccountsUpdated = cam.onAccountsUpdated(() => {
      setMessage("Данные аккаунтов обновлены");
      void reload();
    });
    const offSwitchTransaction = cam.onSwitchTransaction(({ transaction }) => {
      setSwitchTransactions((current) => [
        transaction,
        ...current.filter((item) => item.id !== transaction.id)
      ].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 30));
      const phaseMessage: Record<string, string> = {
        preparing: "Готовлю безопасное переключение",
        validating_previous: "Проверяю текущий профиль",
        validating_target: "Проверяю целевой профиль",
        ready: "Проверка завершена — можно переключать",
        quiescing: "Закрываю активный Codex",
        activating: "Активирую выбранную авторизацию",
        launching: "Запускаю Codex с новым профилем",
        verifying: "Проверяю запущенный аккаунт",
        committed: "Переключение подтверждено",
        rolling_back: "Возвращаю предыдущий профиль",
        rolled_back: "Предыдущий профиль восстановлен",
        aborted: "Переключение отменено до изменения авторизации",
        failed: "Переключение завершилось ошибкой",
        recovery_required: "Требуется восстановление переключения"
      };
      setMessage(phaseMessage[transaction.phase] ?? `Переключение: ${transaction.phase}`);
      if (["committed", "rolled_back", "failed", "recovery_required"].includes(transaction.status)) {
        void reload();
      }
    });
    const offAntigravityOAuthStep = cam.onAntigravityOAuthStep((step) => {
      setMessage(antigravityOAuthStepMessage[step] ?? `Antigravity OAuth: ${step}`);
    });
    const offAntigravityOAuthResult = cam.onAntigravityOAuthResult((result) => {
      setAntigravityProfileStatus(result.status);
      setAntigravityOAuthSession(null);
      setAntigravityCallbackUrl("");
      if (result.imported && result.account) {
        setAccounts((current) => {
          const rest = current.filter((account) => account.id !== result.account!.id);
          return [result.account!, ...rest];
        });
        setSelectedAccountId(result.account.id);
        setPlatformFilter("antigravity");
        setMessage(result.reason);
        setAntigravityImportOpen(false);
        void reload();
        return;
      }
      setMessage(uiErrorMessage(result.reason));
    });
    const offAntigravityOAuthError = cam.onAntigravityOAuthError((reason) => {
      setBusy(null);
      setMessage(uiErrorMessage(reason));
    });
    const offUpdateStatus = cam.onUpdateStatus((result) => {
      setUpdateStatus(result);
      setMessage(result.message);
    });
    const offAppNotification = cam.onAppNotification((notification) => {
      setAppNotifications((current) => [
        notification,
        ...current.filter((item) => item.key !== notification.key)
      ].slice(0, 3));
      if (!notification.silent && settingsRef.current?.notificationSoundEnabled !== false) {
        void playNotificationSound(notification.tone);
      }
    });
    return () => {
      offAuth();
      offAccountsUpdated();
      offSwitchTransaction();
      offAntigravityOAuthStep();
      offAntigravityOAuthResult();
      offAntigravityOAuthError();
      offUpdateStatus();
      offAppNotification();
    };
  }, []);

  async function startLogin(input: CodexLoginRequest) {
    const type = input.type;
    setLoginWizard({ open: true, phase: "starting", type, result: null, error: null });
    setBusy(`login:${type}`);
    setMessage(
      type === "chatgpt"
        ? "Открываю браузер для входа в ChatGPT"
        : type === "chatgptDeviceCode"
          ? "Открываю device-code вход"
          : "Проверяю локальные учётные данные через установленный Codex"
    );
    try {
      const result = await cam.startLogin(input);
      if (result.completed) {
        setLoginWizard({ open: true, phase: "done", type, result, error: null });
        if (result.account) setSelectedAccountId(result.account.id);
        await reload();
        setMessage("Аккаунт проверен и сохранён в локальном защищённом профиле");
      } else {
        setLoginWizard({ open: true, phase: "waiting", type, result, error: null });
        setMessage(
          result.userCode && result.deviceCodeCopied
            ? "Страница входа открыта, одноразовый код скопирован в буфер"
            : result.loginPageOpened
              ? "Браузер открыт. Заверши вход, затем вернись в приложение"
              : "Авторизация запущена. Открой страницу входа из окна добавления аккаунта"
        );
      }
    } catch (error) {
      setLoginWizard({
        open: true,
        phase: "error",
        type,
        result: null,
        error: uiErrorMessage(error instanceof Error ? error.message : "Не удалось начать вход. Проверь диагностику Codex CLI.")
      });
      setMessage(uiErrorMessage("Не удалось начать вход"));
    } finally {
      setBusy(null);
    }
  }

  function openLoginWizard(): void {
    setLoginWizard({ open: true, phase: "method", type: null, result: null, error: null });
  }

  function closeLoginWizard(): void {
    setLoginWizard({ open: false, phase: "method", type: null, result: null, error: null });
  }

  function requestConfirm(state: ConfirmState): Promise<boolean> {
    setConfirmState(state);
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
    });
  }

  function closeConfirm(confirmed: boolean): void {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmState(null);
    resolve?.(confirmed);
  }

  async function refreshAccount(id: string) {
    setBusy(`refresh:${id}`);
    try {
      const refreshed = await cam.refreshAccount(id);
      const quotaState = buildProviderQuotaState(refreshed);
      setMessage(buildQuotaRefreshAccountMessage({
        platform: accountPlatform(refreshed),
        status: refreshed.status,
        statusReason: refreshed.statusReason,
        lastRefreshError: refreshed.lastRefreshError,
        source: quotaState.source,
        confidence: quotaState.confidence
      }));
      await reload();
    } catch (error) {
      setMessage(buildQuotaRefreshErrorMessage("Не удалось обновить лимиты", error));
    } finally {
      setBusy(null);
    }
  }

  async function validateAccountAuth(id: string) {
    setBusy(`auth:${id}`);
    try {
      const result = await cam.validateAuth(id);
      setMessage(`Статус входа: ${authValidationLabel(result.state)}`);
    } catch {
      setMessage(uiErrorMessage("Не удалось проверить вход"));
    } finally {
      setBusy(null);
    }
  }

  async function repairAccount(id: string) {
    const account = accounts.find((item) => item.id === id);
    if (!account) return;
    if (accountPlatform(account) === "antigravity") {
      openAntigravityImport(account);
      return;
    }

    setBusy(`repair:${id}`);
    try {
      const auth = await cam.validateAuth(id);
      if (auth.state === "authorized") {
        const refreshed = await cam.refreshAccount(id);
        await reload();
        if (refreshed.lastRefreshError) {
          setMessage(buildQuotaRefreshErrorMessage("Вход исправен, но лимиты пока не обновились", refreshed.lastRefreshError));
        } else {
          setMessage(`Аккаунт ${displayEmail(refreshed.email)} проверен: вход и обновление лимитов работают`);
        }
        return;
      }

      const result = await cam.reauthenticateAccount(id, { type: "chatgptDeviceCode" });
      setLoginWizard({ open: true, phase: "waiting", type: "chatgptDeviceCode", result, error: null });
      setMessage("Сохранённый профиль не удалён. Заверши вход по коду устройства — аккаунт будет починен на месте");
    } catch (error) {
      setMessage(buildQuotaRefreshErrorMessage("Не удалось автоматически починить аккаунт", error));
    } finally {
      setBusy(null);
    }
  }

  async function refreshAllAccounts() {
    if (refreshableAccountCount === 0) {
      setMessage("Нет аккаунтов для обновления лимитов");
      return;
    }
    setBusy("refresh:all");
    try {
      const beforeRefresh = new Map(accounts.map((account) => [account.id, {
        success: account.lastRefreshAt ?? null,
        error: account.lastRefreshErrorAt ?? null
      }]));
      const refreshed = await cam.refreshAllAccounts();
      const failedCount = refreshed.filter((account) => account.lastRefreshErrorAt != null && account.lastRefreshErrorAt !== beforeRefresh.get(account.id)?.error).length;
      const updatedCount = refreshed.filter((account) => account.lastRefreshAt != null && account.lastRefreshAt !== beforeRefresh.get(account.id)?.success).length;
      const skippedCount = Math.max(0, refreshed.length - failedCount - updatedCount);
      if (failedCount > 0 || skippedCount > 0) {
        setMessage(
          `Обновление завершено: свежих ${updatedCount}, ошибок ${failedCount}, отложено ${skippedCount}. Последние корректные данные сохранены.`
        );
        await reload();
        return;
      }
      const confirmed = refreshed.some((account) => {
        const quotaState = buildProviderQuotaState(account);
        return quotaState.source === "official_api" && quotaState.confidence === "confirmed";
      });
      const local = refreshed.some((account) => {
        const quotaState = buildProviderQuotaState(account);
        return quotaState.source !== "unknown" && quotaState.confidence !== "unknown";
      });
      setMessage(buildQuotaRefreshMessage({
        platform: platformFilter === "all" ? "codex" : platformFilter,
        scope: "all",
        refreshedCount: refreshed.length,
        source: confirmed ? "official_api" : local ? "local_status" : "unknown",
        confidence: confirmed ? "confirmed" : local ? "inferred" : "unknown"
      }));
      await reload();
    } catch (error) {
      setMessage(buildQuotaRefreshErrorMessage("Не удалось обновить все аккаунты", error));
    } finally {
      setBusy(null);
    }
  }

  function requestTransferPassword(mode: TransferMode): Promise<string | null> {
    setTransferMode(mode);
    setTransferPassword("");
    setTransferConfirm("");
    setTransferError(null);
    return new Promise((resolve) => {
      transferResolveRef.current = resolve;
    });
  }

  function closeTransferPrompt(value: string | null): void {
    const resolve = transferResolveRef.current;
    transferResolveRef.current = null;
    setTransferMode(null);
    setTransferPassword("");
    setTransferConfirm("");
    setTransferError(null);
    resolve?.(value);
  }

  function submitTransferPrompt(): void {
    if (!transferMode) return;
    if (transferPassword.trim().length < 8) {
      setTransferError("Пароль должен быть не короче 8 символов");
      return;
    }
    if (transferMode === "export" && transferPassword !== transferConfirm) {
      setTransferError("Пароли не совпадают");
      return;
    }
    closeTransferPrompt(transferPassword);
  }

  async function exportAccounts() {
    if (accounts.length === 0) {
      setMessage("Нечего экспортировать: список аккаунтов пуст");
      return;
    }
    const confirmed = await requestConfirm({
      title: "Экспорт аккаунтов",
      body: "Файл будет зашифрован паролем, но после расшифровки он содержит auth-материал. Храни его как секрет.",
      confirmLabel: "Продолжить экспорт",
      details: [`Аккаунтов: ${accounts.length}`, "Формат: .cam-export", "Передача только доверенным ПК"]
    });
    if (!confirmed) return;
    const passphrase = await requestTransferPassword("export");
    if (!passphrase) return;
    setBusy("export");
    try {
      const result = await cam.exportAccounts(passphrase);
      setMessage(result.exportedCount > 0 ? `Экспортировано аккаунтов: ${result.exportedCount}` : "Экспорт отменён");
    } catch {
      setMessage(uiErrorMessage("Не удалось экспортировать аккаунты"));
    } finally {
      setBusy(null);
    }
  }

  async function importAccounts() {
    const passphrase = await requestTransferPassword("import");
    if (!passphrase) return;
    setBusy("import");
    try {
      const result = await cam.importAccounts(passphrase);
      setAccounts(result.accounts);
      setMessage(result.importedCount > 0 ? `Импортировано аккаунтов: ${result.importedCount}` : "Импорт отменён");
      await reload();
    } catch {
      setMessage(uiErrorMessage("Не удалось импортировать аккаунты"));
    } finally {
      setBusy(null);
    }
  }

  async function inspectAntigravityProfile() {
    setBusy("antigravity-diagnostics");
    try {
      const inspection = await cam.inspectAntigravityProfile();
      const status = await cam.getAntigravityProfileStatus();
      setAntigravityProfileStatus({ ...status, inspection });
      setMessage("Диагностика Antigravity обновлена");
    } catch {
      setMessage(uiErrorMessage("Не удалось выполнить диагностику Antigravity"));
    } finally {
      setBusy(null);
    }
  }

  async function importAntigravityLocalProfile() {
    setBusy("antigravity-import-local");
    try {
      const result = await cam.importAntigravityFromIde();
      setAntigravityProfileStatus(result.status);
      if (result.imported && result.account) {
        setAccounts((current) => {
          const rest = current.filter((account) => account.id !== result.account!.id);
          return [result.account!, ...rest];
        });
        setSelectedAccountId(result.account.id);
        setPlatformFilter("antigravity");
        setMessage(result.reason);
        await reload();
        closeAntigravityImport();
        return;
      }
      setMessage(uiErrorMessage(result.reason));
    } catch {
      setMessage(uiErrorMessage("Не удалось импортировать локальный профиль Antigravity"));
    } finally {
      setBusy(null);
    }
  }

  async function startAntigravityOAuthAuthorization() {
    setBusy("antigravity-oauth-start");
    setAntigravityImportResult(null);
    try {
      const session = await cam.startAntigravityGoogleOAuth();
      setAntigravityOAuthSession(session);
      setMessage("Открыт Google вход для Antigravity. После callback приложение само сохранит аккаунт; ручной URL нужен только как fallback.");
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      setMessage(uiErrorMessage(`Не удалось начать Google вход Antigravity: ${details}`));
    } finally {
      setBusy(null);
    }
  }

  async function finishAntigravityOAuthAuthorization(useManualCallback: boolean) {
    if (!antigravityOAuthSession) {
      setMessage("Сначала запусти OAuth авторизацию Antigravity.");
      return;
    }
    setBusy("antigravity-oauth-finish");
    try {
      const result = await cam.finishAntigravityGoogleOAuth({
        sessionId: antigravityOAuthSession.sessionId,
        callbackUrl: useManualCallback ? antigravityCallbackUrl : null
      });
      setAntigravityProfileStatus(result.status);
      if (result.imported && result.account) {
        setAccounts((current) => {
          const rest = current.filter((account) => account.id !== result.account!.id);
          return [result.account!, ...rest];
        });
        setSelectedAccountId(result.account.id);
        setPlatformFilter("antigravity");
        setMessage(result.reason);
        setAntigravityOAuthSession(null);
        setAntigravityCallbackUrl("");
        await reload();
        closeAntigravityImport();
        return;
      }
      setMessage(uiErrorMessage(result.reason));
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      setMessage(uiErrorMessage(`Не удалось завершить Google вход Antigravity: ${details}`));
    } finally {
      setBusy(null);
    }
  }

  async function cancelAntigravityOAuthAuthorization() {
    if (!antigravityOAuthSession) {
      closeAntigravityImport();
      return;
    }
    try {
      await cam.cancelAntigravityGoogleOAuth(antigravityOAuthSession.sessionId);
    } finally {
      setAntigravityOAuthSession(null);
      setAntigravityCallbackUrl("");
      closeAntigravityImport();
    }
  }

  function applyAntigravityBatchImportResult(result: AntigravityCredentialBatchImportResult): void {
    setAntigravityImportResult(result);
    setAccounts(result.accounts);
    const importedLabel = result.importedCount > 0 ? `импортировано ${result.importedCount}` : "ничего не импортировано";
    const failedLabel = result.failedCount > 0 ? `, ошибок ${result.failedCount}` : "";
    setMessage(`Antigravity import: ${importedLabel}${failedLabel}.`);
    if (result.importedCount > 0) {
      setPlatformFilter("antigravity");
      setSelectedAccountId(result.imported[0]?.accountId ?? null);
    }
  }

  async function importAntigravityTokenPayload() {
    if (antigravityTokenPayload.trim().length < 20) {
      setMessage("Вставь refresh_token или JSON с refresh_token.");
      return;
    }
    if (!window.confirm("Antigravity Beta: импорт содержит секрет авторизации. Продолжай только для аккаунта, которым ты вправе управлять. Секрет не будет показан в интерфейсе или логах.")) {
      return;
    }
    setBusy("antigravity-token-import");
    try {
      const result = await cam.importAntigravityCredentialPayload({
        payload: antigravityTokenPayload,
        source: "token_json"
      });
      applyAntigravityBatchImportResult(result);
      if (result.importedCount > 0) {
        setAntigravityTokenPayload("");
        await reload();
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      setMessage(uiErrorMessage(`Не удалось импортировать Antigravity token/JSON: ${details}`));
    } finally {
      setBusy(null);
    }
  }

  async function importAntigravityLocalFiles() {
    if (!window.confirm("Antigravity Beta: будут прочитаны локальные credential-файлы текущего Windows-пользователя. Продолжить?")) {
      return;
    }
    setBusy("antigravity-file-import");
    try {
      const result = await cam.importAntigravityFromLocalFiles();
      applyAntigravityBatchImportResult(result);
      if (result.importedCount > 0) await reload();
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      setMessage(uiErrorMessage(`Не удалось импортировать Antigravity файлы: ${details}`));
    } finally {
      setBusy(null);
    }
  }

  async function importAntigravityExternalSource(source: AntigravityExternalImportSource) {
    if (!window.confirm("Antigravity Beta: импорт из внешнего источника может содержать секреты. Подтверди, что имеешь право управлять этими аккаунтами.")) {
      return;
    }
    setBusy(`antigravity-source:${source}`);
    try {
      const result = await cam.importAntigravityFromExternalSource(source);
      applyAntigravityBatchImportResult(result);
      if (result.importedCount > 0) await reload();
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      setMessage(uiErrorMessage(`Не удалось импортировать источник Antigravity: ${details}`));
    } finally {
      setBusy(null);
    }
  }

  function openAntigravityImport(_account?: ManagedAccount): void {
    setAntigravityImportResult(null);
    setAntigravityImportOpen(true);
  }

  function closeAntigravityImport(): void {
    if (antigravityOAuthSession) {
      void cam.cancelAntigravityGoogleOAuth(antigravityOAuthSession.sessionId);
    }
    setAntigravityOAuthSession(null);
    setAntigravityCallbackUrl("");
    setAntigravityImportOpen(false);
  }

  async function reauthenticateAccount(id: string) {
    const account = accounts.find((item) => item.id === id);
    if (account && accountPlatform(account) === "antigravity") {
      openAntigravityImport(account);
      return;
    }
    setBusy(`reauth:${id}`);
    try {
      const result = await cam.reauthenticateAccount(id, { type: "chatgptDeviceCode" });
      setLoginWizard({ open: true, phase: "waiting", type: "chatgptDeviceCode", result, error: null });
      setMessage("Открыл reauth. Заверши вход, профиль обновится без пересоздания списка");
    } catch {
      setLoginWizard({ open: true, phase: "error", type: "chatgptDeviceCode", result: null, error: `Не удалось обновить авторизацию${account ? ` для ${displayEmail(account.email)}` : ""}.` });
      setMessage(uiErrorMessage("Не удалось обновить авторизацию"));
    } finally {
      setBusy(null);
    }
  }

  async function openProfileFolder(id: string) {
    setBusy(`folder:${id}`);
    try {
      await cam.openProfileFolder(id);
      setMessage("Папка профиля открыта");
    } catch {
      setMessage(uiErrorMessage("Не удалось открыть папку профиля"));
    } finally {
      setBusy(null);
    }
  }

  async function switchAccount(id: string) {
    const account = accounts.find((item) => item.id === id);
    setBusy(`prepare-switch:${id}`);
    let preparation;
    try {
      preparation = await cam.prepareSwitch(id);
    } catch (error) {
      setMessage(uiErrorMessage(error instanceof Error ? error.message : "Не удалось подготовить переключение"));
      setBusy(null);
      return;
    }
    setBusy(null);
    if (account && !account.isActive && settingsData?.confirmSwitch !== false) {
      const isAntigravity = accountPlatform(account) === "antigravity";
      const confirmed = await requestConfirm({
        title: "Переключить аккаунт",
        body: isAntigravity
          ? "Менеджер применит подготовленный профиль Antigravity и сохранит резервную копию перед записью. Полная совместимость IDE-коннектора ещё проверяется."
          : settingsData?.desktopClosePolicy === "graceful-only"
            ? "Менеджер заменит активный Codex auth.json только после мягкого закрытия приложения. Если Codex не завершится, переключение будет отменено."
            : "Менеджер сначала мягко закроет Codex, а затем при необходимости завершит только заранее проверенное дерево процессов установленного пакета. После активации он сразу запустит тот же Codex с выбранным профилем.",
        confirmLabel: "Переключить",
        details: [
          `Платформа: ${platformLabel(account)}`,
          `Профиль: ${account.label}`,
          `Email: ${displayEmail(account.email)}`,
          `Текущий: ${stats.active?.label ?? "не выбран"}`,
          `Проверка: ${preparation.transaction.phase}`,
          ...preparation.warnings
        ]
      });
      if (!confirmed) {
        await cam.cancelSwitch(preparation.transaction.id).catch(() => undefined);
        return;
      }
    }
    setBusy(`switch:${id}`);
    try {
      const switched = await cam.switchAccount(id, preparation.transaction.id);
      setAccounts((current) => current.map((item) => item.id === switched.id
        ? switched
        : accountPlatform(item) === accountPlatform(switched)
          ? { ...item, isActive: false }
          : item));
      setMessage(account && accountPlatform(account) === "antigravity"
        ? "Antigravity профиль переключён, резервная копия сохранена"
        : "Профиль Codex переключён. ChatGPT/Codex безопасно перезапускается с выбранным аккаунтом.");
      void reload();
    } catch (error) {
      await cam.cancelSwitch(preparation.transaction.id).catch(() => undefined);
      setMessage(switchErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount(id: string) {
    const account = accounts.find((item) => item.id === id);
    if (account) {
      const confirmed = await requestConfirm({
        title: "Удалить профиль",
        body: "Профиль будет удалён из менеджера вместе с локальной папкой профиля. Активный auth.json Codex не удаляется.",
        confirmLabel: "Удалить",
        tone: "danger",
        details: [`Профиль: ${account.label}`, `Email: ${displayEmail(account.email)}`]
      });
      if (!confirmed) return;
    }
    setBusy(`delete:${id}`);
    try {
      await cam.deleteAccount(id);
      setMessage("Профиль удалён из менеджера");
      await reload();
    } catch {
      setMessage(uiErrorMessage("Не удалось удалить профиль"));
    } finally {
      setBusy(null);
    }
  }

  async function selectWorkspace() {
    setBusy("workspace");
    try {
      const nextDiagnostics = await cam.selectWorkspace();
      setDiagnostics(nextDiagnostics);
      setMessage(`Рабочая папка Codex: ${displayPath(nextDiagnostics.workspacePath, "не выбрана")}`);
    } catch {
      setMessage(uiErrorMessage("Не удалось выбрать рабочую папку"));
    } finally {
      setBusy(null);
    }
  }

  async function updateSettings(input: Partial<AppSettings>) {
    setBusy("settings");
    try {
      const nextSettings = await cam.updateSettings(input);
      setSettingsData(nextSettings);
      setDiagnostics(await cam.getDiagnostics());
      setMessage(input.language
        ? (input.language === "en" ? "Interface language changed" : "Язык интерфейса изменён")
        : isEnglish ? "Settings updated" : "Настройки обновлены");
    } catch {
      setMessage(uiErrorMessage("Не удалось сохранить настройки"));
    } finally {
      setBusy(null);
    }
  }

  async function openLogViewer() {
    setBusy("logs");
    try {
      const lines = await cam.readLogTail();
      const visibleLines = lines.map(maskSensitiveDisplayText);
      setLogLines(visibleLines.length ? visibleLines : ["Журнал пока пуст."]);
      setShowLogViewer(true);
      setMessage("Журнал диагностики открыт");
    } catch {
      setMessage(uiErrorMessage("Не удалось открыть журнал диагностики"));
    } finally {
      setBusy(null);
    }
  }

  async function openLogsFolder() {
    setBusy("logs-folder");
    try {
      await cam.openLogsFolder();
      setMessage("Папка журналов открыта");
    } catch {
      setMessage(uiErrorMessage("Не удалось открыть папку журналов"));
    } finally {
      setBusy(null);
    }
  }

  async function exportDiagnosticReport() {
    setBusy("diagnostic-report");
    try {
      const result = await cam.exportDiagnosticReport();
      setMessage(result.filePath ? "Отчёт диагностики сохранён" : "Экспорт отчёта отменён");
    } catch {
      setMessage(uiErrorMessage("Не удалось сохранить отчёт диагностики"));
    } finally {
      setBusy(null);
    }
  }

  async function checkApplicationUpdates() {
    setBusy("updates");
    try {
      const result = await cam.checkForUpdates();
      setUpdateStatus(result);
      setMessage(result.message);
    } catch {
      setMessage(uiErrorMessage(isEnglish ? "Could not check app updates" : "Не удалось проверить обновления приложения"));
    } finally {
      setBusy(null);
    }
  }

  async function openApplicationUpdate() {
    setBusy("updates");
    try {
      const result = await cam.openUpdateRelease();
      setUpdateStatus(result);
      setMessage(result.message);
    } catch {
      setMessage(uiErrorMessage(isEnglish ? "Could not open the GitHub release" : "Не удалось открыть релиз GitHub"));
    } finally {
      setBusy(null);
    }
  }

  async function updateAccountMetadata(id: string, input: { tags?: string[]; favorite?: boolean; archived?: boolean }) {
    setBusy(`meta:${id}`);
    try {
      const updated = await cam.updateAccount({ id, ...input });
      setAccounts((current) => current.map((account) => account.id === id ? updated : account));
      setMessage("Метки профиля обновлены");
    } catch {
      setMessage(uiErrorMessage("Не удалось обновить метки профиля"));
    } finally {
      setBusy(null);
    }
  }

  function closeReleaseNotes(): void {
    window.localStorage.setItem("cam.releaseNotesSeen", appVersion);
    setShowReleaseNotes(false);
  }

  function runCommand(command: CommandPaletteCommand): void {
    if (command.disabled) return;
    setCommandOpen(false);
    setCommandSearch("");
    if (command.action === "filterPlatform" && command.platform) {
      setPlatformFilter(command.platform);
      setActiveView(command.view ?? "accounts");
      return;
    }
    if (command.view) {
      setActiveView(command.view);
      return;
    }
    if (command.action === "login") {
      openLoginWizard();
      return;
    }
    if (command.action === "refreshAll") {
      void refreshAllAccounts();
      return;
    }
    if (command.action === "switchBest" && command.accountId) {
      void switchAccount(command.accountId);
      return;
    }
    if (command.action === "switchAccount" && command.accountId) {
      void switchAccount(command.accountId);
      return;
    }
    if (command.action === "exportVault") {
      void exportAccounts();
      return;
    }
    if (command.action === "openLogs") {
      void openLogViewer();
      return;
    }
    if (command.action === "exportDiagnostics") {
      void exportDiagnosticReport();
    }
  }

  const pageContent = (() => {
    switch (activeView) {
      case "overview":
        return (
          <OverviewPage
            accounts={overviewAccounts}
            diagnostics={diagnostics}
            latestTransaction={switchTransactions[0] ?? null}
            busy={busy}
            autoRefreshIntervalMs={settingsData?.autoRefreshIntervalMs ?? 180_000}
            smartSwitchThresholdPercent={settingsData?.smartSwitchThresholdPercent ?? 10}
            isEnglish={isEnglish}
            displayEmail={displayEmail}
            onAdd={openLoginWizard}
            onRefresh={() => void refreshAllAccounts()}
            onSwitch={(accountId) => void switchAccount(accountId)}
            onOpenAccounts={() => setActiveView("accounts")}
            onOpenActivity={() => setActiveView("activity")}
          />
        );
      case "accounts":
        return (
          <>
            <section className="panel workbench-panel account-panel">
              <div className="panel-head">
                <div className="account-panel-intro">
                  <div className="panel-title-row">
                    <h3>{accountsText.title}</h3>
                    <span
                      className="badge compact"
                      title={search.trim() ? `${visibleAccounts.length} ${isEnglish ? "shown out of" : "показано из"} ${scopedAccounts.length}` : `${scopedAccounts.length} ${isEnglish ? "saved profiles" : "сохранённых профилей"}`}
                    >
                      {search.trim() ? `${visibleAccounts.length} ${isEnglish ? "of" : "из"} ${scopedAccounts.length}` : scopedAccounts.length}
                    </span>
                  </div>
                  <p>
                    {isEnglish
                      ? `${scopedProtectedCount} protected · ${scopedAttentionCount} need attention`
                      : `${scopedProtectedCount} с сохранённым входом · ${scopedAttentionCount} ${scopedAttentionCount === 1 ? "требует" : "требуют"} внимания`}
                  </p>
                </div>
                <div className="panel-actions">
                  <label className="search-wrap">
                    <Search />
                    <input
                      className="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={accountsText.searchProfile}
                      aria-label={accountsText.searchProfile}
                    />
                  </label>
                  <div className="segmented account-view-toggle" aria-label={accountsText.viewMode}>
                    <button className={viewMode === "cards" ? "is-selected" : ""} onClick={() => setViewMode("cards")} title={accountsText.cards} aria-label={accountsText.cards}><LayoutGrid /><span>{accountsText.cards}</span></button>
                    <button className={viewMode === "table" ? "is-selected" : ""} onClick={() => setViewMode("table")} title={accountsText.table} aria-label={accountsText.table}><List /><span>{accountsText.table}</span></button>
                  </div>
                  <label className="account-sort-control" title={accountsText.sort}>
                    <ArrowUpDown aria-hidden="true" />
                    <span className="sr-only">{accountsText.sort}</span>
                    <select value={accountSort} onChange={(event) => setAccountSort(event.target.value as AccountListSort)} aria-label={accountsText.sort}>
                      <option value="smart">{accountsText.smartSort}</option>
                      <option value="subscription">{accountsText.subscriptionSort}</option>
                      <option value="remaining">{accountsText.remainingSort}</option>
                      <option value="reset">{accountsText.resetSort}</option>
                      <option value="freshness">{accountsText.freshnessSort}</option>
                      <option value="added">{accountsText.addedSort}</option>
                      <option value="name">{accountsText.nameSort}</option>
                    </select>
                  </label>
                  <button className="button secondary" disabled={busy !== null || refreshableAccountCount === 0} onClick={refreshAllAccounts} title={refreshableAccountCount === 0 ? shellText.noRefreshableAccounts : shellText.refreshLimits}>
                    {busy === "refresh:all" ? <Loader2 className="spin" /> : <RefreshCcw />}
                    {uiText.actions.refresh}
                  </button>
                  <details className="account-tools-menu">
                    <summary className="icon-btn" title={isEnglish ? "Import and export" : "Импорт и экспорт"} aria-label={isEnglish ? "Import and export" : "Импорт и экспорт"}><MoreHorizontal /></summary>
                    <div>
                      <button disabled={busy !== null || accounts.length === 0} onClick={exportAccounts}>{busy === "export" ? <Loader2 className="spin" /> : <FileDown />}{accountsText.export}</button>
                      <button disabled={busy !== null} onClick={importAccounts}>{busy === "import" ? <Loader2 className="spin" /> : <FileUp />}{accountsText.import}</button>
                    </div>
                  </details>
                </div>
              </div>
              <div className="profile-workbench">
                <div className={`profile-main ${tableScrollable ? "is-scrollable" : ""}`}>
                  {viewMode === "table" ? (
                    <div className="account-compact-list" role="list" aria-label={isEnglish ? "Compact account list" : "Компактный список аккаунтов"}>
                      {visibleAccounts.map((account) => (
                        <AccountCompactRow
                          key={account.id}
                          account={account}
                          selected={selectedAccount?.id === account.id}
                          privacyMode={privacyMode}
                          busy={busy}
                          isEnglish={isEnglish}
                          onSelect={setSelectedAccountId}
                          onSwitch={switchAccount}
                        />
                      ))}
                      {scopedAccounts.length === 0 ? <div className="empty">{platformFilter === "antigravity" ? "Список Antigravity пуст" : "Список Codex пуст"}</div> : null}
                      {scopedAccounts.length > 0 && visibleAccounts.length === 0 ? <div className="empty">{accountsText.emptyFiltered}</div> : null}
                    </div>
                  ) : (
                    <div className="profile-grid">
                      {visibleAccounts.map((account) => (
                        <AccountCard
                          key={account.id}
                          account={account}
                          selected={selectedAccount?.id === account.id}
                          privacyMode={privacyMode}
                          busy={busy}
                          onRefresh={refreshAccount}
                          onSwitch={switchAccount}
                          onReauth={reauthenticateAccount}
                          onRepair={repairAccount}
                          onSelect={setSelectedAccountId}
                          onInspect={(id, trigger) => {
                            inspectorTriggerRef.current = trigger;
                            setSelectedAccountId(id);
                            setInspectorOpen(true);
                          }}
                        />
                      ))}
                      {scopedAccounts.length === 0 ? (
                        <div className="empty-onboarding">
                          <strong>{platformFilter === "antigravity" ? "Список Antigravity пуст" : "Список Codex пуст"}</strong>
                          <span>{platformFilter === "antigravity" ? "Добавь Antigravity через официальный вход и диагностику локального профиля IDE." : "Добавь Codex-профиль через один из официальных способов входа."}</span>
                          <div className="mini-actions">
                            {platformFilter === "antigravity" ? (
                              <button className="button" disabled={busy !== null} onClick={() => openAntigravityImport()}><KeyRound />Добавить Antigravity</button>
                            ) : (
                              <>
                                <button className="button" disabled={busy !== null} onClick={openLoginWizard}><LogIn />Добавить Codex</button>
                              </>
                            )}
                          </div>
                        </div>
                      ) : null}
                      {scopedAccounts.length > 0 && visibleAccounts.length === 0 ? <div className="empty">{accountsText.emptyFiltered}</div> : null}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </>
        );
      case "activity":
        return (
          <ActivityPage
            transactions={switchTransactions}
            history={switchHistory}
            accounts={accounts}
            isEnglish={isEnglish}
            onOpenSettings={() => setActiveView("settings")}
          />
        );
      case "settings":
        {
          const capabilities = diagnostics?.codexCapabilities;
          const desktopLifecycle = diagnostics?.desktopLifecycle;
        return (
          <>
            <SettingsPage settings={settingsData} busy={busy === "settings"} onUpdate={(input) => void updateSettings(input)} />
            <details className="settings-runtime-details">
              <summary><span><TerminalSquare />{isEnglish ? "Runtime and diagnostics" : "Среда и диагностика"}</span><ChevronRight /></summary>
              <div className="settings-runtime-body">
            <section className="codex-runtime-panel" aria-label={isEnglish ? "Codex runtime diagnostics" : "Диагностика среды Codex"}>
              <div className="runtime-heading">
                <div>
                  <span>{isEnglish ? "OFFICIAL RUNTIME" : "ОФИЦИАЛЬНАЯ СРЕДА"}</span>
                  <h3>{isEnglish ? "Codex compatibility" : "Совместимость Codex"}</h3>
                </div>
                <span className={`runtime-status ${capabilities?.protocol.compatible ? "is-ready" : "is-warning"}`}>
                  {capabilities?.protocol.compatible
                    ? (isEnglish ? "verified" : "проверено")
                    : (isEnglish ? "attention" : "требует внимания")}
                </span>
              </div>
              <div className="runtime-grid">
                <div>
                  <span>{isEnglish ? "Desktop package" : "Desktop-пакет"}</span>
                  <strong>{desktopLifecycle?.selected?.version ?? (isEnglish ? "not found" : "не найден")}</strong>
                </div>
                <div>
                  <span>AppUserModelId</span>
                  <strong title={desktopLifecycle?.selected?.appUserModelId ?? undefined}>
                    {desktopLifecycle?.selected?.appUserModelId ?? "—"}
                  </strong>
                </div>
                <div>
                  <span>{isEnglish ? "Process tree" : "Дерево процессов"}</span>
                  <strong>
                    {desktopLifecycle
                      ? `${desktopLifecycle.runningRootCount} / ${desktopLifecycle.capturedProcessCount}`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>{isEnglish ? "CLI" : "CLI"}</span>
                  <strong>{capabilities?.cliVersion ?? (diagnostics?.codexPath ? (isEnglish ? "probing…" : "проверяется…") : (isEnglish ? "not found" : "не найден"))}</strong>
                </div>
                <div>
                  <span>{isEnglish ? "Identity" : "Профиль"}</span>
                  <strong>{capabilities?.identity.email ?? capabilities?.identity.authMode ?? (isEnglish ? "not signed in" : "нет входа")}</strong>
                </div>
                <div>
                  <span>{isEnglish ? "Protocol" : "Протокол"}</span>
                  <strong>{capabilities?.protocol.userAgent ?? "—"}</strong>
                </div>
              </div>
              <div className="runtime-methods" aria-label={isEnglish ? "Supported login methods" : "Поддерживаемые способы входа"}>
                {(capabilities?.loginMethods ?? []).map((method) => (
                  <span
                    key={method.id}
                    className={`runtime-method ${method.available ? "is-available" : "is-unavailable"} ${method.stability === "internal" ? "is-internal" : ""}`}
                    title={method.reason ?? undefined}
                  >
                    {codexLoginMethodLabel(method.id, isEnglish)}
                    {method.stability === "internal" ? " · internal" : ""}
                  </span>
                ))}
              </div>
              {capabilities?.protocol.error ? <p className="runtime-error">{capabilities.protocol.error}</p> : null}
              {desktopLifecycle ? (
                <p className={desktopLifecycle.status === "ambiguous" || desktopLifecycle.status === "error" ? "runtime-error" : "settings-help"}>
                  {desktopLifecycle.message}
                </p>
              ) : null}
            </section>
            <section className="diagnostic-preview" aria-label={isEnglish ? "Diagnostic export contents" : "Состав диагностического отчёта"}>
              <div>
                <span>{isEnglish ? "REDACTED DIAGNOSTICS" : "ОБЕЗЛИЧЕННАЯ ДИАГНОСТИКА"}</span>
                <h3>{isEnglish ? "Preview before export" : "Предпросмотр состава отчёта"}</h3>
                <p>
                  {isEnglish
                    ? "Includes app/runtime versions, health, switch integrity, release readiness, safe settings and redacted account status."
                    : "Включает версии приложения и среды, health, целостность переключений, готовность релиза, безопасные настройки и обезличенные статусы аккаунтов."}
                </p>
                <p className="diagnostic-exclusion">
                  <ShieldCheck />
                  {isEnglish
                    ? "Never includes tokens, cookies, API keys, auth.json contents or unredacted personal paths."
                    : "Никогда не включает токены, cookies, API keys, содержимое auth.json и открытые персональные пути."}
                </p>
              </div>
              <div className="diagnostic-preview-actions">
                <button className="button secondary" disabled={busy !== null} onClick={openLogViewer}><TerminalSquare />{isEnglish ? "View log" : "Посмотреть журнал"}</button>
                <button className="button" disabled={busy !== null} onClick={exportDiagnosticReport}><FileDown />{isEnglish ? "Export report" : "Сохранить отчёт"}</button>
              </div>
            </section>
            <section className="settings-strip">
              <div className="workspace-card">
                <div className="workspace-meta">
                  <span>{isEnglish ? "Codex workspace" : "Рабочая папка Codex"}</span>
                  <strong>{displayPath(diagnostics?.workspacePath, isEnglish ? "not selected" : "не выбрана")}</strong>
                </div>
                <button className="button secondary" onClick={selectWorkspace}>
                  <FolderOpen />
                  {isEnglish ? "Choose" : "Выбрать"}
                </button>
              </div>
              <div className="health-card">
                <div>
                  <span>{isEnglish ? "Auto-refresh" : "Автообновление"}</span>
                  <strong>{autoRefreshLabel(diagnostics?.rateLimitRefreshIntervalMs, language)}</strong>
                </div>
                <div>
                  <span>{isEnglish ? "Accounts" : "Аккаунтов"}</span>
                  <strong>{accounts.length}</strong>
                </div>
                <div>
                  <span>{isEnglish ? "Active" : "Активный"}</span>
                  <strong>{stats.active?.label ?? (isEnglish ? "not selected" : "не выбран")}</strong>
                </div>
                <div>
                  <span>{isEnglish ? "Smart mode" : "Умный режим"}</span>
                  <strong>{settingsData?.smartSwitchMode === "auto" ? (isEnglish ? "auto" : "авто") : settingsData?.smartSwitchMode === "off" ? (isEnglish ? "off" : "выкл") : (isEnglish ? "suggest" : "предлагать")}</strong>
                </div>
                <div>
                  <span>{isEnglish ? "Threshold" : "Порог"}</span>
                  <strong>{settingsData?.smartSwitchThresholdPercent ?? 10}%</strong>
                </div>
              </div>
            </section>
              </div>
            </details>
          </>
        );
        }
    }
  })();

  return (
    <main className="shell ops-shell">
      <aside className="side-rail" aria-label={isEnglish ? "Main sections" : "Основные разделы"}>
        <div className="rail-brand">
          <div className="mark">
            <img src={appAvatarUrl} alt="" aria-hidden="true" />
          </div>
          <div className="rail-brand-meta">
            <div className="rail-brand-overline">
              <span className="eyebrow">{isEnglish ? "SESSION CONTROL" : "ЦЕНТР СЕССИЙ"}</span>
              <span className="version">v{appVersion}</span>
            </div>
            <h1>Egoist Account Manager</h1>
          </div>
        </div>
        <nav className="rail-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={activeView === item.key ? "is-active" : ""}
                onClick={() => setActiveView(item.key)}
                aria-label={item.label}
                aria-current={activeView === item.key ? "page" : undefined}
                title={`${item.label} · ${item.description}`}
              >
                <Icon />
                <span>{item.label}</span>
                <small>{item.description}</small>
              </button>
            );
          })}
        </nav>
        <section className="platform-stack" aria-label={shellText.platformFilter}>
          <div className="rail-section-title">{shellText.platform}</div>
          {platformSummaries.map((platform) => (
            <button
              key={platform.id}
              className={`platform-tile ${platform.id} ${platform.tone} ${platformFilter === platform.id ? "is-active" : ""} ${platform.available ? "" : "is-coming-soon"}`}
              aria-label={`${platform.label}: ${platform.count} · ${platform.state}`}
              aria-disabled={!platform.available}
              title={platform.available ? `${platform.label} · ${platform.state}` : undefined}
              data-tooltip={platform.available ? undefined : (isEnglish ? "Antigravity · In development" : "Antigravity · В разработке")}
              onClick={() => {
                if (!platform.available) return;
                setActiveView("accounts");
                setPlatformFilter(platform.id as PlatformFilter);
              }}
            >
              <span className="platform-tile-label">
                <PlatformMark platform={platform.id as "codex" | "antigravity"} size="tile" />
                <span>{platform.label}</span>
              </span>
              <strong>{platform.count}</strong>
              <small>{platform.state}</small>
            </button>
          ))}
        </section>
        <section className="rail-actions" aria-label={shellText.actionCenter}>
          <div className="rail-section-title">{shellText.actions}</div>
          <button disabled={busy !== null} onClick={platformFilter === "antigravity" ? () => openAntigravityImport() : openLoginWizard}>
            {platformFilter === "antigravity" ? <KeyRound /> : <LogIn />}
            <span>{platformFilter === "antigravity" ? shellText.addAntigravity : shellText.addCodex}</span>
          </button>
          <button disabled={busy !== null || refreshableAccountCount === 0} onClick={refreshAllAccounts} title={refreshableAccountCount === 0 ? shellText.noRefreshableAccounts : shellText.refreshLimits}>
            {busy === "refresh:all" ? <Loader2 className="spin" /> : <RefreshCcw />}
            <span>{uiText.actions.refresh}</span>
          </button>
          <button onClick={() => {
            setCommandOpen(true);
            setCommandSearch("");
          }} aria-label={shellText.commands} title={shellText.commands}>
            <Command />
            <span>{shellText.commands}</span>
            <kbd>Ctrl K</kbd>
          </button>
        </section>
        <div className="rail-footer" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      </aside>

      <section className="app-frame">
        <header className="topbar">
          <div className="topbar-context">
            <span>{activeNav.label}</span>
            <strong>{activeNav.description}</strong>
          </div>
          <nav className="top-nav compact-top-nav" aria-label={shellText.consoleSections}>
            {navItems.map((item) => (
              <button
                key={item.key}
                className={activeView === item.key ? "is-active" : ""}
                onClick={() => setActiveView(item.key)}
                aria-current={activeView === item.key ? "page" : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="actions top-actions">
            <button className="button secondary command-trigger" onClick={() => {
              setCommandOpen(true);
              setCommandSearch("");
            }}>
              <Command />
              {shellText.commands}
              <kbd>Ctrl K</kbd>
            </button>
            <button className="button secondary update-check-button" disabled={busy !== null} onClick={checkApplicationUpdates}>
              {busy === "updates" ? <Loader2 className="spin" /> : <RefreshCcw />}
              {isEnglish ? "Check app" : "Проверить приложение"}
            </button>
            {platformFilter === "codex" ? (
              <button className="button secondary" disabled={busy !== null} onClick={() => startLogin({ type: "chatgptDeviceCode" })}>
                <KeyRound />
                {shellText.deviceCode}
              </button>
            ) : null}
            <button className="button" disabled={busy !== null} onClick={platformFilter === "antigravity" ? () => openAntigravityImport() : openLoginWizard}>
              {platformFilter === "antigravity" ? <KeyRound /> : <LogIn />}
              {platformFilter === "antigravity" ? shellText.addAntigravity : shellText.addCodex}
            </button>
            <div className="window-controls" aria-label={shellText.windowControls}>
              <button className="window-btn" onClick={() => void cam.minimizeWindow()} title={shellText.minimize}>
                <Minus />
              </button>
              <button className="window-btn" onClick={() => void cam.toggleMaximizeWindow()} title={shellText.maximize}>
                <Maximize2 />
              </button>
              <button className="window-btn close" onClick={() => void cam.closeWindow()} title={shellText.close}>
                <X />
              </button>
            </div>
          </div>
        </header>

        {appNotifications.length > 0 ? (
          <section className="process-notice-stack" aria-label={isEnglish ? "Application notifications" : "Уведомления приложения"}>
            {appNotifications.map((notice) => (
              <aside className={`process-notice is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live={notice.tone === "error" ? "assertive" : "polite"} key={notice.key}>
                <span className="process-notice-icon">
                  {notice.tone === "success" ? <CheckCircle2 /> : notice.tone === "warning" || notice.tone === "error" ? <AlertTriangle /> : <Activity />}
                </span>
                <span className="process-notice-copy">
                  <span>{notice.progress?.label ?? (notice.tone === "warning" ? (isEnglish ? "ATTENTION" : "ВНИМАНИЕ") : notice.tone === "error" ? (isEnglish ? "ACTION REQUIRED" : "НУЖНО ДЕЙСТВИЕ") : (isEnglish ? "CODEX MANAGER" : "CODEX MANAGER"))}</span>
                  <strong>{notice.title}</strong>
                  <small>{notice.body}</small>
                </span>
                <button className="process-notice-close" onClick={() => setAppNotifications((current) => current.filter((item) => item.key !== notice.key))} aria-label={isEnglish ? "Dismiss notification" : "Закрыть уведомление"}><X /></button>
                {notice.progress ? (
                  <span className="process-notice-progress" aria-label={`${Math.round(notice.progress.value * 100)}%`}>
                    <span><small>{notice.progress.status}</small><b>{Math.round(notice.progress.value * 100)}%</b></span>
                    <i><em style={{ width: `${Math.max(0, Math.min(100, notice.progress.value * 100))}%` }} /></i>
                  </span>
                ) : null}
              </aside>
            ))}
          </section>
        ) : null}

        {showUpdateBanner ? (
          <div className={`update-banner update-${updateStatus?.status ?? "idle"}`} role="status">
            <div className="update-banner-copy">
              <strong>{isEnglish ? "App update" : "Обновление приложения"}{updateStatus?.version ? ` ${updateStatus.version}` : ""}</strong>
              <span>{updateStatus?.message}</span>
            </div>
            <button className="button update-banner-action" disabled={updateButtonDisabled} onClick={openApplicationUpdate}>
              {busy === "updates" ? <Loader2 className="spin" /> : <ExternalLink />}
              {updateButtonLabel}
            </button>
          </div>
        ) : null}

        {loadState === "error" || loadState === "degraded" ? (
          <div className={`runtime-state-banner ${loadState}`} role="alert">
            <AlertTriangle />
            <span>
              <strong>{loadState === "error" ? (isEnglish ? "Account data did not load" : "Данные аккаунтов не загрузились") : (isEnglish ? "Limited mode" : "Ограниченный режим")}</strong>
              {isEnglish ? "Saved profiles were not deleted. Retry the desktop connection." : "Сохранённые профили не удалены. Повтори подключение к desktop-сервису."}
            </span>
            <div className="runtime-state-actions">
              {loadError ? (
                <button className="button ghost" onClick={() => void openLogsFolder()}><TerminalSquare />{isEnglish ? "Log" : "Журнал"}</button>
              ) : null}
              <button className="button secondary" disabled={busy !== null} onClick={() => { setLoadState("loading"); void reload(); }}><RefreshCcw />{isEnglish ? "Retry" : "Повторить"}</button>
            </div>
          </div>
        ) : null}
        {loadState === "loading" ? (
          <div className="content boot-loading" role="status" aria-live="polite">
            <Loader2 className="spin" />
            <strong>{isEnglish ? "Connecting to the local vault…" : "Подключаю локальное хранилище…"}</strong>
            <span>{isEnglish ? "Accounts remain encrypted on this computer." : "Аккаунты остаются зашифрованными на этом компьютере."}</span>
          </div>
        ) : (
          <div className={`content content-${activeView}`}>{pageContent}</div>
        )}
      </section>
      <AddAccountWizard
        state={loginWizard}
        busy={busy}
        capabilities={diagnostics?.codexCapabilities}
        onStart={(input) => void startLogin(input)}
        onOpen={(url) => void cam.openExternal(url)}
        onCopyDeviceCode={(userCode) => cam.copyDeviceCode(userCode)}
        onOpenDeviceLogin={(url, userCode) => cam.openDeviceLogin(url, userCode)}
        onClose={closeLoginWizard}
      />
      <ConfirmDialog state={confirmState} onClose={closeConfirm} />
      <CommandPalette
        open={commandOpen}
        query={commandSearch}
        commands={commandPalette}
        busy={busy}
        onQuery={setCommandSearch}
        onClose={() => setCommandOpen(false)}
        onRun={runCommand}
      />
      {inspectorOpen ? (
        <div
          className="modal-backdrop profile-details-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={isEnglish ? "Profile details" : "Подробности профиля"}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setInspectorOpen(false);
          }}
        >
          <div className="profile-details-dialog">
            <div className="modal-head">
              <div>
                <div className="panel-title">{isEnglish ? "Profile details" : "Подробности профиля"}</div>
                <p className="muted">{isEnglish ? "Status, limits and every profile action in one place." : "Состояние, лимиты и все действия с профилем в одном окне."}</p>
              </div>
              <button ref={inspectorCloseButtonRef} className="icon-btn" onClick={() => setInspectorOpen(false)} title={isEnglish ? "Close" : "Закрыть"}>
                <X />
              </button>
            </div>
            <AccountInspector
              account={selectedAccount}
              privacyMode={privacyMode}
              language={language}
              busy={busy}
              onRefresh={refreshAccount}
              onValidateAuth={validateAccountAuth}
              onRepair={repairAccount}
              onSwitch={switchAccount}
              onReauth={reauthenticateAccount}
              onOpenFolder={openProfileFolder}
              onMetadata={(id, input) => void updateAccountMetadata(id, input)}
              onDelete={(id) => {
                setInspectorOpen(false);
                void deleteAccount(id);
              }}
            />
          </div>
        </div>
      ) : null}
      {antigravityImportOpen ? (
        <AntigravityImportModal
          busy={busy}
          profileStatus={antigravityProfileStatus}
          oauthSession={antigravityOAuthSession}
          callbackUrl={antigravityCallbackUrl}
          onCallbackUrl={setAntigravityCallbackUrl}
          tokenPayload={antigravityTokenPayload}
          onTokenPayload={setAntigravityTokenPayload}
          result={antigravityImportResult}
          displayEmail={displayEmail}
          onClose={() => void cancelAntigravityOAuthAuthorization()}
          onStartOAuth={() => void startAntigravityOAuthAuthorization()}
          onFinishOAuth={(manualCallback) => void finishAntigravityOAuthAuthorization(manualCallback)}
          onImportToken={() => void importAntigravityTokenPayload()}
          onImportFiles={() => void importAntigravityLocalFiles()}
          onImportSource={(source) => void importAntigravityExternalSource(source)}
          onImportLocalProfile={() => void importAntigravityLocalProfile()}
          onInspect={() => void inspectAntigravityProfile()}
          onOpenDocs={() => void cam.openExternal(ANTIGRAVITY_CLI_DOCS_URL)}
        />
      ) : null}
      {transferMode ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={transferMode === "export" ? "Экспорт аккаунтов" : "Импорт аккаунтов"}>
          <div className="transfer-modal">
            <div className="panel-title">{transferMode === "export" ? "Экспорт аккаунтов" : "Импорт аккаунтов"}</div>
            <p className="muted">
              {transferMode === "export"
                ? "Задай пароль для зашифрованного файла. Он понадобится для импорта на другом ПК."
                : "Введи пароль от экспортированного файла, чтобы перенести авторизации на этот ПК."}
            </p>
            <label className="field">
              <span>Пароль</span>
              <input autoFocus type="password" aria-label={transferMode === "export" ? "Пароль экспорта" : "Пароль импорта"} value={transferPassword} onChange={(event) => setTransferPassword(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter") submitTransferPrompt();
                if (event.key === "Escape") closeTransferPrompt(null);
              }} />
              <small className={`password-hint ${passwordStrength(transferPassword).className}`}>{passwordStrength(transferPassword).label}</small>
            </label>
            {transferMode === "export" ? (
              <label className="field">
                <span>Повтор пароля</span>
                <input type="password" aria-label="Повтор пароля экспорта" value={transferConfirm} onChange={(event) => setTransferConfirm(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter") submitTransferPrompt();
                  if (event.key === "Escape") closeTransferPrompt(null);
                }} />
              </label>
            ) : null}
            {transferError ? <div className="form-error">{transferError}</div> : null}
            <div className="modal-actions">
              <button className="button secondary" onClick={() => closeTransferPrompt(null)}>Отмена</button>
              <button className="button" onClick={submitTransferPrompt}>{transferMode === "export" ? "Экспорт" : "Импорт"}</button>
            </div>
          </div>
        </div>
      ) : null}
      {showLogViewer ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Журнал диагностики">
          <div className="transfer-modal log-viewer">
            <div className="modal-head">
              <div>
                <div className="panel-title">Журнал диагностики</div>
                <p className="muted">Последние записи без секретов и токенов.</p>
              </div>
              <button className="icon-btn" onClick={() => setShowLogViewer(false)} title="Закрыть">
                <X />
              </button>
            </div>
            <pre className="log-lines">{logLines.join("\n")}</pre>
            <div className="modal-actions">
              <button className="button secondary" onClick={openLogsFolder}>
                <FolderOpen />
                Папка логов
              </button>
              <button className="button" onClick={() => setShowLogViewer(false)}>Готово</button>
            </div>
          </div>
        </div>
      ) : null}
      {showReleaseNotes ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Что нового">
          <div className="transfer-modal release-notes-modal">
            <div className="modal-head">
              <div>
                <div className="panel-title">Что нового в {appVersion}</div>
                <p className="muted">Коротко о свежем релизе.</p>
              </div>
              <button className="icon-btn" onClick={closeReleaseNotes} title="Закрыть">
                <X />
              </button>
            </div>
            <div className="release-notes-list">
              {releaseNotes.map((note) => (
                <article key={note.title}>
                  <CheckCircle2 />
                  <div>
                    <strong>{note.title}</strong>
                    <span>{note.body}</span>
                  </div>
                </article>
              ))}
            </div>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => {
                closeReleaseNotes();
                setActiveView("accounts");
              }}>Аккаунты</button>
              <button className="button" onClick={closeReleaseNotes}>Понятно</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function BridgeUnavailable() {
  return (
    <main className="bridge-fatal" role="alert">
      <span><AlertTriangle /></span>
      <div>
        <p>DESKTOP BRIDGE</p>
        <h1>Интерфейс не подключён к приложению</h1>
        <p>Данные аккаунтов не загружены и не потеряны. Полностью закрой Egoist Account Manager и открой его снова. Если экран повторится — переустанови текущую версию поверх существующей.</p>
      </div>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
const surface = new URLSearchParams(window.location.search).get("surface");
root.render(
  <React.StrictMode>
    {window.cam || import.meta.env.DEV
      ? surface === "tray"
        ? <TrayPopover api={cam} />
        : surface === "tray-hover"
          ? <TrayHoverPopover api={cam} />
          : <App />
      : <BridgeUnavailable />}
  </React.StrictMode>
);
