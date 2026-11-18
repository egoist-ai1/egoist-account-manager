import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Activity,
  Archive,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Command,
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
  PackageCheck,
  Plus,
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
  AntigravityProfileInspection,
  AntigravityProfileStatus,
  AntigravityOAuthStartResult,
  AppSettings,
  AuthEvent,
  AuthValidationState,
  CodexLoginRequest,
  HealthReport,
  ManagedAccount,
  ProviderQuotaState,
  AccountImportPreview,
  SwitchHistoryItem,
  SwitchTransaction,
  UpdateCheckResult,
  WorkspaceBinding
} from "../shared/types";
import type { AppViewKey, CommandPaletteCommand } from "../shared/commandPalette";
import { buildUiCommands } from "./commandPresentation";
import {
  formatRemainingCountdown,
  formatResetTimeShort,
  sortAccountList,
  type AccountListSort
} from "../shared/accountListPresentation";
import { maskEmailForPrivacy, maskSensitiveDisplayText } from "../shared/privacyDisplay";
import { buildProviderQuotaState } from "../shared/providerAdapter";
import { hasCurrentQuotaRefreshFailure } from "../shared/quotaFreshness";
import { buildQuotaRefreshErrorMessage } from "../shared/quotaRefreshError";
import { buildQuotaRefreshAccountMessage, buildQuotaRefreshMessage } from "../shared/quotaRefreshMessage";
import { selectSmartAccount } from "../shared/smartSelection";
import { appVersion, releaseNotes } from "../shared/releaseNotes";
import { englishReleaseNotes } from "./releaseNotes";
import { productName } from "../shared/branding";
import { displayMetadata } from "./displayPrivacy";
import appAvatarUrl from "./assets/app-avatar-mark.png";
import { PlatformMark } from "./components/PlatformMark";
import { getUiText } from "./i18n";
import { SettingsPage } from "./pages/SettingsPage";
import { ActivityPage, verificationSummary } from "./components/v3/ActivityPage";
import { AuditDrawer } from "./components/v3/AuditDrawer";
import { OverviewPage } from "./components/v3/OverviewPage";
import { TrayPopover } from "./components/TrayPopover";
import { TrayHoverPopover } from "./components/TrayHoverPopover";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/montserrat";
import { useVisibleClock } from "./hooks/useVisibleClock";
import { useDialogManager } from "./hooks/useDialogManager";
import { AntigravityImportModal, type AntigravityExternalImportSource } from "./components/AntigravityImportModal";
import { AddAccountWizard, type LoginWizardState } from "./components/AddAccountWizard";
import { ProfileTable } from "./components/ProfileTable";
import { ImportPreviewDialog } from "./components/ImportPreviewDialog";
import { CommandPalette } from "./components/CommandPalette";
import { useMotionEnvironment, useSurfaceMotion } from "./hooks/useSurfaceMotion";
import { usePreservedScroll, type ScrollPosition } from "./hooks/usePreservedScroll";
import { RuntimeEvidence, runtimeLabel } from "./components/RuntimeEvidence";
import { profilePresentation } from "./profilePresentation";
import { mergeNotification, notificationDeadline, notificationOperation } from "./notificationPresentation";
import { formatQuotaRemaining } from "../shared/providerAdapter";
import "./styles.css";

const nowSeconds = () => Math.floor(Date.now() / 1000);

const useNowSeconds = useVisibleClock;

const demoSettings: AppSettings = {
  language: "ru",
  autoRefreshIntervalMs: 180_000,
  trayRefreshIntervalMs: 60_000,
  privacyMode: false,
  confirmSwitch: true,
  desktopClosePolicy: "exact-tree-fallback",
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
  getAppInfo: async () => ({ name: productName, publisher: "Egoist", version: appVersion, vaultDegraded: false }),
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
  previewImport: async () => null,
  applyImport: async () => ({ importedCount: 0, skippedCount: 0, accounts: demoAccounts }),
  verifyRuntimeAccount: async () => ({ profileApplied: true, credentials: "not_checked", credentialMethod: null, launch: "not_requested", runtime: "unsupported", runtimeSource: null, observedEmail: null, observedAt: null, runtimePid: null, message: "Runtime verification is available only in the desktop application." }),
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
  getAntigravityGodMode: async () => ({
    enabled: false,
    settingsPath: "browser-preview/settings.json",
    details: {
      workspaceTrustDisabled: false,
      chatAlwaysConfirmDisabled: false,
      terminalConfirmNever: false,
      telemetryOff: false
    }
  }),
  setAntigravityGodMode: async (enabled: boolean) => ({
    enabled,
    settingsPath: "browser-preview/settings.json",
    updatedKeys: ["chat.editing.alwaysConfirm", "telemetry.telemetryLevel"]
  }),
  regenerateAntigravityFingerprint: async (accountId: string) => {
    const target = demoAccounts.find((a) => a.id === accountId) ?? demoAccounts[0];
    return target;
  },
  cleanAntigravityHygiene: async () => ({
    cleanedLocks: [],
    cleanedCaches: [],
    freedBytes: 0,
    errors: []
  }),
  warmupAllQuotaTimers: async () => ({
    total: demoAccounts.length,
    triggered: demoAccounts.length,
    alreadyActive: 0,
    failed: 0,
    results: demoAccounts.map((a) => ({
      accountId: a.id,
      accountLabel: a.label,
      platform: a.platform,
      status: "triggered" as const,
      message: "Тестовый запрос отправлен в демо-режиме",
      resetsAt: nowSeconds() + 18000
    }))
  }),
  warmupAccountQuotaTimer: async (accountId: string) => {
    const acc = demoAccounts.find((a) => a.id === accountId) ?? demoAccounts[0];
    return {
      accountId: acc.id,
      accountLabel: acc.label,
      platform: acc.platform,
      status: "triggered" as const,
      message: "Таймер успешно запущен (демо)",
      resetsAt: nowSeconds() + 18000
    };
  },
  importAntigravityFromIde: async () => ({
    imported: false,
    account: null,
    reason: "Локальный профиль Antigravity не найден. Сначала войди в официальном Antigravity IDE или CLI.",
    status: demoAntigravityProfileStatus,
    identity: null
  }),
  importCurrentCodexSession: async () => ({
    imported: false,
    account: null,
    reason: "Импорт доступен только в desktop-приложении."
  }),
  importCurrentAntigravitySession: async () => ({
    imported: false,
    account: null,
    reason: "Импорт доступен только в desktop-приложении."
  }),
  detectLocalSessions: async () => ({
    codex: false,
    codexEmail: null,
    antigravity: false
  }),
  onAuthEvent: () => () => undefined,
  onAccountsUpdated: () => () => undefined,
  onSwitchTransaction: () => () => undefined,
  onAntigravityOAuthStep: () => () => undefined,
  onUpdateStatus: () => () => undefined,
  onAppNotification: () => () => undefined,
  getTrayPlatform: async () => "codex",
  onTrayPlatform: () => () => undefined
};

function formatTime(value: number | null, language: AppSettings["language"] = "ru"): string {
  if (!value) return language === "en" ? "No data" : "нет данных";
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value * 1000));
}

function authValidationLabel(state: AuthValidationState["state"], language: AppSettings["language"]): string {
  if (language === "en") return ({ unknown: "Unknown", authorized: "Authorized", expired: "Expired", revoked: "Revoked", needs_reauth: "Sign-in required", validation_failed: "Check failed" })[state];
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

function QuotaFreshnessChip({ account, language = "ru" }: { account: ManagedAccount; language?: AppSettings["language"] }) {
  const view = profilePresentation(account, useVisibleClock(), language);
  return <span className={`quota-freshness-chip ${view.refreshFailed ? "refresh-error failed" : view.readiness.state === "ready" ? "fresh" : "stale"}`} title={view.ageLabel}>{view.refreshFailed ? <AlertTriangle size={11} /> : <span className="status-dot" />}<span>{view.freshness}</span></span>;
}

function CredentialStateChip({ account, language = "ru" }: { account: ManagedAccount; language?: AppSettings["language"] }) {
  const view = profilePresentation(account, nowSeconds(), language);
  return <span className={`credential-chip ${account.credentialState === "ready" ? "ready" : "failed"}`}>{account.credentialState === "ready" ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}<span>{view.credentialsLabel}</span></span>;
}

function statusClass(account: ManagedAccount): string {
  if (account.status === "limited") return "limited";
  if (account.status === "near_limit") return "risk";
  if (account.status === "active") return "active";
  if (account.status === "error" && /not logged into a chatgpt account|belongs to a different chatgpt account|login required|reauth|required.*auth|sign.?in/i.test(account.statusReason ?? "")) return "risk";
  return "";
}

function uiErrorMessage(action: string): string {
  return `${action}. ${document.documentElement.lang === "en" ? "Details are available in the diagnostic log." : "Подробности доступны в журнале диагностики."}`;
}

function readableIpcError(error: unknown): string | null {
  if (!(error instanceof Error) || !error.message.trim()) return null;
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

function switchErrorMessage(error: unknown, platform: PlatformFilter, language: AppSettings["language"]): string {
  const detail = readableIpcError(error);
  const en = language === "en";
  if (platform === "antigravity") {
    if (detail && /still has an open window|could not be stopped|still running/i.test(detail)) {
      return en ? "Save your work, close Antigravity and retry the switch." : "Сохраните работу, закройте Antigravity и повторите переключение.";
    }
    if (detail && /Hub and IDE|multiple Antigravity installations|different Antigravity application|another Antigravity profile/i.test(detail)) {
      return en ? "Close the other Antigravity windows and retry with one installation open." : "Закройте другие окна Antigravity и повторите переключение с одним запущенным приложением.";
    }
    if (detail && /active Antigravity profile changed/i.test(detail)) {
      return en ? "The active Antigravity profile changed. Confirm the switch again." : "Текущий профиль Antigravity изменился. Подтвердите переключение заново.";
    }
    if (detail && /executable.*(unavailable|not found|unrecognized)/i.test(detail)) {
      return en ? "Antigravity could not be found. Open the installation you use and retry." : "Не удалось найти Antigravity. Откройте нужную версию приложения и повторите переключение.";
    }
    if (detail && /readback|write failed|rollback|launch failed|exited before|spawn returned|window was ready/i.test(detail)) {
      return en ? "Antigravity could not complete the switch. Check the switch journal for the restart and recovery result." : "Переключение Antigravity прервалось. Результат запуска и восстановления указан в журнале переключений.";
    }
    return uiErrorMessage(en ? "Could not switch the Antigravity profile" : "Не удалось переключить профиль Antigravity");
  }
  if (en) return uiErrorMessage(detail ?? "Could not switch profiles");
  if (!detail) return uiErrorMessage("Не удалось переключить аккаунт");
  if (/no auth\.json/i.test(detail)) {
    return "В Codex сейчас нет активной авторизации. Менеджер сохранил профили и попробует активировать выбранный аккаунт повторно.";
  }
  if (/different account|different provider account/i.test(detail)) {
    return "Текущая сессия Codex не совпала с отметкой в менеджере. Обновите список и повторите переключение. Сессия будет согласована автоматически.";
  }
  if (/hosted inside the active Codex process tree/i.test(detail)) {
    return "Квессер был открыт из процесса Codex, поэтому безопасное переключение остановлено до закрытия сессии. Перезапустите Квессер из меню «Пуск» или с ярлыка.";
  }
  if (/could not be safely closed|did not exit|still running/i.test(detail)) {
    return "Codex не удалось завершить. Включите «Автоматическое закрытие» в настройках и повторите попытку.";
  }
  if (/still being reauthenticated|reauthentication is still in progress/i.test(detail)) {
    return "Для выбранного профиля ещё открыт вход. Завершите его или запустите авторизацию заново. Предыдущая попытка будет безопасно заменена.";
  }
  if (/another switch transaction is already active/i.test(detail)) {
    return "Предыдущая попытка переключения ещё не завершена. Менеджер отменит её до изменения авторизации; затем повтори переключение.";
  }
  return `Не удалось переключить аккаунт: ${detail}`;
}



function meterTone(usedPercent: number | null): string {
  const usedValue = usedPercent ?? 0;
  if (usedValue >= 85) return "danger";
  if (usedValue >= 60) return "warn";
  return "good";
}

function remainingPercent(usedPercent: number | null): number | null {
  return usedPercent == null ? null : Math.max(0, Math.min(100, 100 - usedPercent));
}

function LimitMeter({
  label,
  usedPercent,
  resetsAt,
  unavailableReason,
  platform = "codex",
  language = "ru"
}: {
  label: string;
  usedPercent: number | null;
  resetsAt: number | null;
  unavailableReason?: string;
  platform?: "codex" | "antigravity";
  language?: AppSettings["language"];
}) {
  const now = useNowSeconds();
  const remaining = remainingPercent(usedPercent);
  const isAvailable = usedPercent !== null;
  const isEnglish = language === "en";
  const emptyReason = unavailableReason ?? (isEnglish ? "No quota data" : "Нет данных лимита");
  const countdown = formatRemainingCountdown(resetsAt, now, isEnglish);
  const isAntigravity = platform === "antigravity";
  const resetText = resetsAt
    ? (isEnglish ? `resets ${formatResetTimeShort(resetsAt, language, now)}` : `сброс ${formatResetTimeShort(resetsAt, language, now)}`)
    : (isAvailable ? (isEnglish ? "no timer" : "нет таймера") : "-");

  return (
    <div
      className={`limit-meter is-${platform} ${isAvailable ? meterTone(usedPercent) : "is-inactive"} ${remaining === 0 ? "is-depleted" : ""}`}
      title={isAvailable ? (isEnglish ? `Remaining ${formatQuotaRemaining(remaining, language)}, used ${usedPercent?.toFixed(0)}%` : `Осталось ${formatQuotaRemaining(remaining, language)}, использовано ${usedPercent?.toFixed(0)}%`) : emptyReason}
      aria-label={isAvailable ? `${label}: ${formatQuotaRemaining(remaining, language)}` : `${label}: ${emptyReason}`}
    >
      <div className="limit-line">
        <span className="limit-label-text">{label}</span>
        <strong className="limit-value-percent">{isAvailable ? formatQuotaRemaining(remaining, language) : "—"}</strong>
      </div>
      <div className="bar">
        <span style={{ width: `${isAvailable ? (remaining ?? 0) : 0}%` }} />
      </div>
      <div className="limit-meter-footer">
        <small
          className="limit-reset-time"
          title={resetsAt ? (isEnglish ? `Exact reset: ${formatTime(resetsAt, language)}` : `Точный сброс: ${formatTime(resetsAt, language)}`) : undefined}
        >
          {resetText}
        </small>
        {countdown ? (
          <span
            className={`limit-countdown-badge ${isAntigravity ? "is-ag" : "is-codex"}`}
            title={isEnglish ? `Time until reset: ${countdown}` : `До сброса: ${countdown}`}
          >
            <Clock className="countdown-icon" aria-hidden="true" />
            <span>{countdown}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function accountLimitDisplay(account: ManagedAccount, language: AppSettings["language"] = "ru") {
  const windows = profilePresentation(account, nowSeconds(), language).summaryWindows;
  return {
    primaryLabel: windows[0]?.title ?? (language === "en" ? "Limit window" : "Окно лимита"),
    primaryUsedPercent: windows[0]?.usedPercent ?? null,
    primaryResetsAt: windows[0]?.resetsAt ?? null,
    secondaryLabel: windows[1]?.title ?? (language === "en" ? "Other window" : "Другое окно"),
    secondaryUsedPercent: windows[1]?.usedPercent ?? null,
    secondaryResetsAt: windows[1]?.resetsAt ?? null,
    primaryUnavailableReason: "—",
    secondaryUnavailableReason: "—"
  };
}

function antigravityAccessLabel(account: ManagedAccount, language: AppSettings["language"] = "ru"): string {
  const view = profilePresentation(account, nowSeconds(), language);
  if (view.readiness.state === "ready") return language === "en" ? "ready" : "готов";
  if (view.readiness.state === "needs_reauth") return language === "en" ? "sign-in required" : "нужен вход";
  return language === "en" ? "needs verification" : "нужна проверка";
}

function accountPlatform(account: ManagedAccount): "codex" | "antigravity" {
  return account.platform === "antigravity" ? "antigravity" : "codex";
}

function platformLabel(account: ManagedAccount): string {
  return accountPlatform(account) === "antigravity" ? "Antigravity" : "Codex";
}

function AccountPlatformMark({ account, size = "small" }: { account: ManagedAccount; size?: "small" | "large" }) {
  return <PlatformMark platform={accountPlatform(account)} size={size} />;
}

function PlanBadge({ planType, language }: { planType: ManagedAccount["planType"]; language: AppSettings["language"] }) {
  const known: Record<string, string> = { free: "Free", go: "Go", plus: "Plus", pro: "Pro", pro5: "Pro X5", pro10: "Pro X10", pro20: "Pro X20", team: "Team", business: "Business", enterprise: "Enterprise", edu: "Edu", "google-ai-pro": "Google AI Pro", "google-ai-ultra": "Google AI Ultra", "google-ai-ultra-x20": "Google AI Ultra x20", standard: "Standard" };
  const label = planType === "unknown" ? (language === "en" ? "Plan unknown" : "Тариф неизвестен") : known[planType] ?? planType;
  return <span className="plan plan-badge" title={`${language === "en" ? "Reported plan" : "Сообщённый тариф"}: ${label}`}><span className="plan-glyph" aria-hidden="true" /><span>{label}</span></span>;
}
function AccountCard({
  account,
  selected,
  privacyMode,
  language,
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
  language: AppSettings["language"];
  busy: string | null;
  onRefresh: (id: string) => void;
  onSwitch: (id: string, trigger?: HTMLElement) => void;
  onReauth: (id: string) => void;
  onRepair: (id: string) => void;
  onSelect: (id: string) => void;
  onInspect: (id: string, trigger: HTMLElement) => void;
}) {
  const isEnglish = language === "en";
  const view = profilePresentation(account, useVisibleClock(), language);
  const isAntigravity = accountPlatform(account) === "antigravity";
  const hasFailure = account.status === "error" || account.credentialState !== "ready" || hasCurrentQuotaRefreshFailure(account);
  const needsRepair = hasCurrentQuotaRefreshFailure(account) || account.credentialState !== "ready";
  const limits = accountLimitDisplay(account, language);
  return (
    <article
      className={`profile-card ${selected ? "is-selected" : ""} ${account.isActive ? "is-active" : ""} ${hasFailure ? "has-error" : "is-healthy"} is-${isAntigravity ? "antigravity" : "codex"}`}
      tabIndex={selected ? 0 : -1}
      aria-label={displayMetadata(account.label, privacyMode, language)}
      onClick={(event) => { if (!(event.target as HTMLElement).closest("button")) onSelect(account.id); }}
      onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === "Enter") { event.preventDefault(); onInspect(account.id, event.currentTarget); } }}
    >
      <div className="profile-card-head">
        <div className="account-cell">
          <AccountPlatformMark account={account} />
          <div className="account-copy">
            <div className="name">
              <span className="account-label" title={privacyMode ? undefined : account.label}>{displayMetadata(account.label, privacyMode, language)}</span>
              {account.favorite ? <Star className="inline-mark" /> : null}
              {account.archived ? <span className="badge compact">{isEnglish ? "Archived" : "Архив"}</span> : null}
              {account.isActive ? (
                <span className="status-pill-clean is-live account-card-live-pill" title={runtimeLabel(account.runtimeVerification, language)}>
                  <span className="status-dot" />
                  <span>{isEnglish ? "Selected" : "Выбран"}</span>
                </span>
              ) : null}
            </div>
            <div className="email" title={privacyMode ? undefined : account.email}>{privacyMode ? maskEmailForPrivacy(account.email) : account.email}</div>
          </div>
        </div>
        <div className="profile-card-status">
          <PlanBadge planType={account.planType} language={language} />
          <CredentialStateChip account={account} language={language} />
        </div>
      </div>
      <div className="profile-card-body">
        <LimitMeter
          label={limits.primaryLabel}
          usedPercent={limits.primaryUsedPercent}
          resetsAt={limits.primaryResetsAt}
          unavailableReason={limits.primaryUnavailableReason}
          platform={account.platform}
          language={language}
        />
        <LimitMeter
          label={limits.secondaryLabel}
          usedPercent={limits.secondaryUsedPercent}
          resetsAt={limits.secondaryResetsAt}
          unavailableReason={limits.secondaryUnavailableReason}
          platform={account.platform}
          language={language}
        />
      </div>
      <div className="profile-card-foot">
        <QuotaFreshnessChip account={account} language={language} />
        <span className="profile-refresh-age">{view.ageLabel}</span>
      </div>
      <div className={`row-actions card-actions ${needsRepair ? "needs-repair" : ""}`} onClick={(event) => event.stopPropagation()}>
        <button className="icon-btn" aria-label={isEnglish ? "Refresh limits" : "Обновить лимиты"} disabled={busy !== null} onClick={() => onRefresh(account.id)} title={isEnglish ? "Refresh limits" : "Обновить лимиты"}>
          {busy === `refresh:${account.id}` ? <Loader2 className="spin" /> : <RefreshCcw />}
        </button>
        <button
          className={`icon-btn ${needsRepair ? "repair-action" : ""}`}
          aria-label={needsRepair ? (isEnglish ? "Repair profile" : "Восстановить профиль") : (isEnglish ? "Authorize again" : "Авторизовать заново")}
          disabled={busy !== null}
          onClick={() => needsRepair ? onRepair(account.id) : onReauth(account.id)}
          title={needsRepair ? (isEnglish ? "Check sign-in and refresh limits" : "Проверить вход и обновить лимиты") : (isEnglish ? "Authorize again" : "Авторизовать заново")}
        >
          {busy === `repair:${account.id}` || busy === `reauth:${account.id}` ? <Loader2 className="spin" /> : <KeyRound />}
        </button>
        <button className="icon-btn" aria-label={isEnglish ? "Profile details" : "Подробнее о профиле"} disabled={busy !== null} onClick={(event) => onInspect(account.id, event.currentTarget)} title={isEnglish ? "Profile details" : "Подробнее о профиле"}>
          <MoreHorizontal />
        </button>
        <button className={`profile-switch-action ${account.isActive ? "is-active" : ""}`} disabled={busy !== null || (account.isActive && account.runtimeVerification?.runtime === "verified") || !view.readiness.canSwitchManually} onClick={(event) => onSwitch(account.id, event.currentTarget)} title={account.isActive ? (isEnglish ? "Selected profile" : "Выбранный профиль") : (isEnglish ? "Switch profile" : "Переключить профиль")}>
          {busy === `switch:${account.id}` ? <Loader2 className="spin" /> : account.isActive ? <CheckCircle2 /> : <Zap />}
          <span>{account.isActive ? account.runtimeVerification?.runtime === "verified" ? (isEnglish ? "Selected" : "Выбран") : (isEnglish ? "Reapply" : "Применить снова") : (isEnglish ? "Switch" : "Переключить")}</span>
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
  onDelete,
  onVerifyRuntime
}: {
  account: ManagedAccount | null;
  privacyMode: boolean;
  language: AppSettings["language"];
  busy: string | null;
  onRefresh: (id: string) => void;
  onValidateAuth: (id: string) => void;
  onRepair: (id: string) => void;
  onSwitch: (id: string, trigger?: HTMLElement) => void;
  onReauth: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onMetadata: (id: string, input: { tags?: string[]; favorite?: boolean; archived?: boolean }) => void;
  onDelete: (id: string) => void;
  onVerifyRuntime: (id: string) => void;
}) {
  const isEnglish = language === "en";
  const text = getUiText(language);
  const now = useVisibleClock();
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
  const view = profilePresentation(account, now, language);
  const switchDisabled = busy !== null || (account.isActive && account.runtimeVerification?.runtime === "verified") || !view.readiness.canSwitchManually;
  const tags = account.tags ?? [];
  const visibleTags = tags.slice(0, 2);
  const hiddenTagCount = Math.max(0, tags.length - visibleTags.length);
  const antigravityProject = privacyMode ? (isEnglish ? "Project hidden" : "Проект скрыт") : account.antigravity?.googleProjectId ?? (isEnglish ? "no project" : "нет проекта");
  const currentQuotaFailure = hasCurrentQuotaRefreshFailure(account);

  return (
    <aside className={`inspector ${statusClass(account)} is-${isAntigravity ? "antigravity" : "codex"}`}>
      <div className="inspector-profile-row">
        <div className="inspector-identity">
          <AccountPlatformMark account={account} size="large" />
          <div>
            <strong>{displayMetadata(account.label, privacyMode, language)}</strong>
            <span>{privacyMode ? maskEmailForPrivacy(account.email) : account.email}</span>
          </div>
        </div>
        <div className="inspector-meta-chips inspector-meta-line">
          <PlanBadge planType={account.planType} language={language} />
          <CredentialStateChip account={account} language={language} />
          <QuotaFreshnessChip account={account} language={language} />
          <span className="inspector-refresh-age">{view.ageLabel}</span>
        </div>
      </div>
      <div className="inspector-command">
        <button
          className="button"
          aria-label={isEnglish ? "Activate account" : "Активировать аккаунт"}
          disabled={switchDisabled}
          onClick={(event) => onSwitch(account.id, event.currentTarget)}
          title={isAntigravity ? (isEnglish ? "Apply profile and restart Antigravity" : "Применить профиль и перезапустить Antigravity") : undefined}
        >
          <ArrowRightLeft />
          {account.isActive ? account.runtimeVerification?.runtime === "verified" ? (isEnglish ? "Selected" : "Выбран") : (isEnglish ? "Reapply profile" : "Применить снова") : (isEnglish ? "Switch profile" : "Переключить профиль")}
        </button>
        <button className="button secondary" disabled={busy !== null} aria-busy={busy === `refresh:${account.id}`} onClick={() => onRefresh(account.id)}>
          {busy === `refresh:${account.id}` ? <Loader2 className="spin" /> : <RefreshCcw />}
          {isEnglish ? "Refresh limits" : "Обновить лимиты"}
        </button>
      </div>
      <div className="inspector-tag-section">
        <div className="metadata-strip">
          <button className={`meta-toggle ${account.favorite ? "is-on" : ""}`} aria-pressed={Boolean(account.favorite)} disabled={busy !== null} onClick={() => onMetadata(account.id, { favorite: !account.favorite })}>
            <Star />
            {isEnglish ? "Favorite" : "Избранное"}
          </button>
          <button className={`meta-toggle ${account.archived ? "is-on" : ""}`} aria-pressed={Boolean(account.archived)} disabled={busy !== null} onClick={() => onMetadata(account.id, { archived: !account.archived })}>
            <Archive />
            {isEnglish ? "Archive" : "Архив"}
          </button>
          {visibleTags.length > 0 ? (
            <div className="tag-row compact-tag-row">
              {visibleTags.map((tag) => <span key={tag}><Tag />{displayMetadata(tag, privacyMode, language)}</span>)}
              {hiddenTagCount > 0 ? <span className="tag-more">+{hiddenTagCount}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="inspector-limit-grid">
        {view.windows.length ? view.windows.map((window) => <div className="inspector-quota-window" key={window.id}><LimitMeter label={window.title} usedPercent={window.usedPercent} resetsAt={window.resetsAt} platform={account.platform} language={language} /><small>{displayMetadata([window.label, window.modelId, window.scope].filter(Boolean).join(" · "), privacyMode, language)}</small></div>) : <LimitMeter label={isEnglish ? "Quota not observed" : "Лимит не наблюдался"} usedPercent={null} resetsAt={null} language={language} />}
      </div>
      {currentQuotaFailure ? (
        <div className="quota-refresh-warning" title={privacyMode ? undefined : account.lastRefreshError ?? undefined}>
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
          <span title={antigravityProject}><strong>{isEnglish ? "Project" : "Проект"}</strong>{antigravityProject}</span>
          <span><strong>IDE</strong>{account.antigravity?.ideStateDetected ? (isEnglish ? "found" : "найден") : (isEnglish ? "missing" : "не найден")}</span>
          <span><strong>{isEnglish ? "Access" : "Доступ"}</strong>{antigravityAccessLabel(account, language)}</span>
        </div>
      ) : null}
      <RuntimeEvidence evidence={account.runtimeVerification} privacyMode={privacyMode} language={language} selected={account.isActive} busy={busy !== null} onVerify={() => onVerifyRuntime(account.id)} />
      <div className="inspector-path" title={privacyMode ? (isEnglish ? "Path hidden" : "Путь скрыт") : account.profileDir}>
        <Database />
        <span>{privacyMode ? (isEnglish ? "Path hidden" : "Путь скрыт") : account.profileDir}</span>
      </div>
      <section className="inspector-management" aria-label={isEnglish ? "Profile management" : "Управление профилем"}>
        <div className="inspector-management-head">
          <strong>{isEnglish ? "Profile management" : "Управление профилем"}</strong>
        </div>
        <div className="inspector-action-grid">
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
  returnFocus?: HTMLElement;
};

function passwordStrength(value: string, language: AppSettings["language"]): { label: string; className: string } {
  const score = Number(value.length >= 8) + Number(value.length >= 14) + Number(/\p{Lu}/u.test(value)) + Number(/\d/.test(value)) + Number(/[^\p{L}\d]/u.test(value));
  if (!value) return { label: language === "en" ? "Enter a password" : "Введите пароль", className: "idle" };
  if (score <= 2) return { label: language === "en" ? "Weak password" : "Слабый пароль", className: "weak" };
  if (score <= 4) return { label: language === "en" ? "Moderate password" : "Нормальный пароль", className: "medium" };
  return { label: language === "en" ? "Strong password" : "Сильный пароль", className: "strong" };
}

function ConfirmDialog({
  state,
  language,
  onClose,
  registerTrigger
}: {
  state: ConfirmState | null;
  language: AppSettings["language"];
  onClose: (confirmed: boolean) => void;
  registerTrigger: (dialog: HTMLElement, trigger: HTMLElement) => void;
}) {
  if (!state) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={state.title} ref={(dialog) => {
      if (dialog && state.returnFocus) registerTrigger(dialog, state.returnFocus);
    }}>
      <div className={`confirm-modal ${state.tone === "danger" ? "danger" : ""}`}>
        <div className="modal-head">
          <div>
            <div className="panel-title">{state.title}</div>
            <p className="muted">{state.body}</p>
          </div>
          <button className="window-btn" onClick={() => onClose(false)} aria-label={language === "en" ? "Close" : "Закрыть"}>
            <X />
          </button>
        </div>
        {state.details?.length ? (
          <div className="confirm-details">
            {state.details.map((detail) => <span key={detail}>{detail}</span>)}
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="button secondary" onClick={() => onClose(false)}>{language === "en" ? "Cancel" : "Отмена"}</button>
          <button className={`button ${state.tone === "danger" ? "danger-action" : ""}`} onClick={() => onClose(true)}>{state.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

let lastNotificationSoundAt = 0;
let notificationAudioContext: AudioContext | null = null;

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
  const [message, setMessage] = useState<string>("");
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
  const now = useVisibleClock();
  const [importPreview, setImportPreview] = useState<AccountImportPreview | null>(null);
  const diagnosticsLoadedRef = useRef(false);
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
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => window.localStorage.getItem("cam.accountView") === "cards" ? "cards" : "table");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const inspectorCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("accounts");
  const profileMainRef = useRef<HTMLDivElement>(null);
  const profileScroll = useRef<Record<"table" | "cards", ScrollPosition>>({ table: { top: 0, left: 0 }, cards: { top: 0, left: 0 } });
  usePreservedScroll(profileMainRef, profileScroll.current.cards, activeView === "accounts" && viewMode === "cards" && loadState !== "loading");
  const contentRef = useRef<HTMLDivElement>(null);
  useSurfaceMotion(contentRef, `${activeView}:${viewMode}:${loadState}`);
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
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
    windowControls: isEnglish ? "Window controls" : "Управление окном",
    minimize: isEnglish ? "Minimize" : "Свернуть",
    maximize: isEnglish ? "Maximize" : "Развернуть",
    close: isEnglish ? "Close" : "Закрыть",
    noRefreshableAccounts: isEnglish ? "No accounts to refresh" : "Нет аккаунтов для обновления",
    refreshLimits: isEnglish ? "Refresh limits" : "Обновить лимиты"
  };
  const accountsText = {
    title: isEnglish ? "Profiles" : "Профили",
    searchProfile: isEnglish ? "Search profile" : "Поиск профиля",
    accountFilter: isEnglish ? "Account filter" : "Фильтр аккаунтов",
    viewMode: isEnglish ? "Account view" : "Вид аккаунтов",
    all: isEnglish ? "All" : "Все",
    table: isEnglish ? "Table" : "Таблица",
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
    return privacyMode && value ? (isEnglish ? "Path hidden" : "Путь скрыт") : (value ?? fallback);
  };

  const stats = useMemo(() => {
    const codex = accounts.filter((account) => accountPlatform(account) === "codex").length;
    const antigravity = accounts.filter((account) => accountPlatform(account) === "antigravity").length;
    return { codex, antigravity };
  }, [accounts]);

  const smartRecommendation = useMemo(() => selectSmartAccount(accounts, workspaceBinding, { now, staleAfterSeconds: 900 }), [accounts, workspaceBinding, now]);
  const bestAccount = useMemo(() => {
    return smartRecommendation ? accounts.find((account) => account.id === smartRecommendation.accountId) ?? null : null;
  }, [accounts, smartRecommendation]);
  const commandPalette = useMemo(() => buildUiCommands({
    accounts,
    activeView,
    smartRecommendation,
    privacyMode
  }, language, now), [accounts, activeView, privacyMode, smartRecommendation, language, now]);
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
  const scopedAttentionCount = scopedAccounts.filter((account) => profilePresentation(account, now, language).readiness.state !== "ready" || (account.isActive && account.runtimeVerification?.runtime !== "verified")).length;
  const refreshableAccountCount = accounts.length;
  const navItems: NavItem[] = [
    { key: "accounts", label: isEnglish ? "Profiles" : "Профили", description: isEnglish ? "Accounts and limits" : "Аккаунты и лимиты", icon: Layers3 },
    { key: "overview", label: isEnglish ? "Overview" : "Обзор", description: isEnglish ? "Session and readiness" : "Сессия и готовность", icon: LayoutDashboard },
    { key: "activity", label: isEnglish ? "Journal" : "Журнал", description: isEnglish ? "Switch evidence" : "Проверки переключений", icon: Activity },
    { key: "settings", label: uiText.nav.settings, description: isEnglish ? "App behavior" : "Поведение приложения", icon: SlidersHorizontal }
  ];
  const platformSummaries = [
    {
      id: "codex",
      label: "Codex",
      count: stats.codex,
      state: diagnostics?.codexPath ? (isEnglish ? "CLI found" : "CLI найден") : (isEnglish ? "CLI required" : "Нужен CLI"),
      tone: diagnostics?.codexPath ? "ready" : "warn",
    },
    {
      id: "antigravity",
      label: "Antigravity",
      count: stats.antigravity,
      state: antigravityProfileStatus?.detected || stats.antigravity > 0
        ? (isEnglish ? "Profile found" : "Профиль найден")
        : (isEnglish ? "Sign-in needed" : "Нужен вход"),
      tone: antigravityProfileStatus?.detected || stats.antigravity > 0 ? "ready" : "warn",
    }
  ] as const;

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
    const timers = appNotifications.flatMap((notice) => {
      const deadline = notificationDeadline(notice);
      if (deadline === null) return [];
      return [window.setTimeout(() => {
        setAppNotifications((current) => current.filter((item) => item !== notice));
      }, Math.max(0, deadline - Date.now()))];
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [appNotifications, visibilityEpoch]);

  const registerDialogTrigger = useDialogManager((label) => {
    if (label === "Profile details" || label === "Подробности профиля") setInspectorOpen(false);
    else if (label === "Предварительный импорт" || label === "Import preview") { if (busy !== "import:apply") setImportPreview(null); }
    else if (label === "Добавление аккаунта" || label === "Add account") closeLoginWizard();
    else if (label === "Добавить Antigravity" || label === "Add Antigravity") closeAntigravityImport();
    else if (label === "Командный центр" || label === "Command center") setCommandOpen(false);
    else if (label === "Что нового" || label === "What's new") closeReleaseNotes();
    else if (label === "Журнал диагностики" || label === "Diagnostic log") setShowLogViewer(false);
    else if (label === "Журнал аудита переключений" || label === "Switch audit log") setAuditDrawerOpen(false);
    else if (transferMode) closeTransferPrompt(null);
    else if (confirmState) closeConfirm(false);
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "Escape" && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        const menu = document.querySelector<HTMLDetailsElement>(".account-tools-menu[open]");
        if (menu) {
          event.preventDefault();
          menu.open = false;
          menu.querySelector<HTMLElement>("summary")?.focus();
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
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
      const [nextAccounts, nextSettings, nextBinding, nextTransactions, nextHistory] = await Promise.all([
        cam.listAccounts(), cam.getSettings().catch(() => null), cam.getWorkspaceBinding().catch(() => null), cam.listSwitchTransactions().catch(() => []), cam.getSwitchHistory().catch(() => [])
      ]);
      if (requestId !== reloadSequenceRef.current) return;
      setAccounts(nextAccounts); setSettingsData(nextSettings); setWorkspaceBinding(nextBinding); setSwitchTransactions(nextTransactions); setSwitchHistory(nextHistory);
      setLoadState("ready");
      if (!diagnosticsLoadedRef.current) {
        diagnosticsLoadedRef.current = true;
        void Promise.all([cam.getDiagnostics(), cam.getAntigravityProfileStatus().catch(() => null)]).then(([nextDiagnostics, nextStatus]) => {
          setDiagnostics(nextDiagnostics); setAntigravityProfileStatus(nextStatus);
          setLoadError(nextDiagnostics.startupError ?? null);
          if (nextDiagnostics.startupError) setLoadState("degraded");
        }).catch(() => { diagnosticsLoadedRef.current = false; });
      }
    } catch (error) {
      if (requestId !== reloadSequenceRef.current) return;
      setLoadError(error instanceof Error ? error.message : "Desktop bridge did not return data"); setLoadState("error");
      setMessage(uiErrorMessage(languageRef.current === "en" ? "Could not load profiles" : "Не удалось загрузить профили"));
    }
  }

  useEffect(() => {
    void reload();
    if (window.localStorage.getItem("cam.releaseNotesSeen") !== appVersion) {
      setShowReleaseNotes(true);
    }
    const offAuth = cam.onAuthEvent((event: AuthEvent) => {
      setMessage(event.success ? (languageRef.current === "en" ? "Profile added" : "Профиль добавлен") : uiErrorMessage(languageRef.current === "en" ? "Could not complete sign-in" : "Не удалось завершить вход"));
      setLoginWizard((current) => ({
        ...current,
        open: true,
        phase: event.success ? "done" : "error",
        error: event.success ? null : (event.error ?? "Codex не вернул успешное завершение входа")
      }));
      void reload();
    });
    const offAccountsUpdated = cam.onAccountsUpdated(() => {
      setMessage(languageRef.current === "en" ? "Profile data updated" : "Данные профилей обновлены");
      void reload();
    });
    const offSwitchTransaction = cam.onSwitchTransaction(({ transaction }) => {
      setSwitchTransactions((current) => [
        transaction,
        ...current.filter((item) => item.id !== transaction.id)
      ].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 30));
      setMessage(verificationSummary(transaction, languageRef.current === "en"));
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
      setAppNotifications((current) => mergeNotification(current, notification));
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

  async function importCurrentCodexSession() {
    setBusy("import:current-codex");
    try {
      const result = await cam.importCurrentCodexSession();
      if (result.imported) {
        closeLoginWizard();
        setMessage(result.reason);
        await reload();
        if (result.account) setSelectedAccountId(result.account.id);
      } else {
        setMessage(uiErrorMessage(result.reason));
      }
    } catch (error) {
      setMessage(uiErrorMessage(`Не удалось импортировать сессию Codex: ${error instanceof Error ? error.message : String(error)}`));
    } finally {
      setBusy(null);
    }
  }

  async function importCurrentAntigravitySession() {
    setBusy("import:current-antigravity");
    try {
      const result = await cam.importCurrentAntigravitySession();
      if (result.imported) {
        closeAntigravityImport();
        setMessage(result.reason);
        await reload();
        if (result.account) {
          setSelectedAccountId(result.account.id);
          setPlatformFilter("antigravity");
        }
      } else {
        setMessage(uiErrorMessage(result.reason));
      }
    } catch (error) {
      setMessage(uiErrorMessage(`Не удалось подхватить сессию Antigravity: ${error instanceof Error ? error.message : String(error)}`));
    } finally {
      setBusy(null);
    }
  }

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
        setMessage((isEnglish ? "Profile checked and saved locally" : "Аккаунт проверен и сохранён в локальном защищённом профиле"));
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
      setMessage(uiErrorMessage((isEnglish ? "Could not start sign-in" : "Не удалось начать вход")));
    } finally {
      setBusy(null);
    }
  }

  function openLoginWizard(): void {
    setLoginWizard((current) => current.phase === "waiting" || current.phase === "starting" ? { ...current, open: true } : { open: true, phase: "method", type: null, result: null, error: null });
  }

  function closeLoginWizard(): void {
    setLoginWizard((current) => ({ ...current, open: false }));
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
      setMessage(`${isEnglish ? "Sign-in status" : "Статус входа"}: ${authValidationLabel(result.state, language)}`);
    } catch {
      setMessage(uiErrorMessage((isEnglish ? "Could not check sign-in" : "Не удалось проверить вход")));
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
      setMessage((isEnglish ? "The saved profile is preserved. Complete device sign-in to restore the session." : "Сохранённый профиль сохранён. Завершите вход по коду устройства для восстановления сессии."));
    } catch (error) {
      setMessage(buildQuotaRefreshErrorMessage("Не удалось автоматически починить аккаунт", error));
    } finally {
      setBusy(null);
    }
  }

  async function refreshAllAccounts() {
    if (refreshableAccountCount === 0) {
      setMessage((isEnglish ? "No profiles to refresh" : "Нет аккаунтов для обновления лимитов"));
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
      setTransferError(isEnglish ? "Use at least 8 characters" : "Пароль должен быть не короче 8 символов");
      return;
    }
    if (transferMode === "export" && transferPassword !== transferConfirm) {
      setTransferError(isEnglish ? "Passwords do not match" : "Пароли не совпадают");
      return;
    }
    closeTransferPrompt(transferPassword);
  }

  async function exportAccounts() {
    if (accounts.length === 0) {
      setMessage((isEnglish ? "There are no profiles to export" : "Нечего экспортировать: список аккаунтов пуст"));
      return;
    }
    const confirmed = await requestConfirm({
      title: isEnglish ? "Export profiles" : "Экспорт профилей",
      body: isEnglish ? "The encrypted file contains sign-in secrets after decryption. Keep the file and its password private." : "После расшифровки файл содержит секреты входа. Храните файл и его пароль конфиденциально.",
      confirmLabel: isEnglish ? "Continue export" : "Продолжить экспорт",
      details: [`${isEnglish ? "Profiles" : "Профилей"}: ${accounts.length}`, `${isEnglish ? "Format" : "Формат"}: .cam-export`]
    });
    if (!confirmed) return;
    const passphrase = await requestTransferPassword("export");
    if (!passphrase) return;
    setBusy("export");
    try {
      const result = await cam.exportAccounts(passphrase);
      setMessage(result.exportedCount > 0 ? (isEnglish ? `Exported ${result.exportedCount} profiles` : `Экспортировано профилей: ${result.exportedCount}`) : (isEnglish ? "Export canceled" : "Экспорт отменён"));
    } catch {
      setMessage(uiErrorMessage((isEnglish ? "Could not export profiles" : "Не удалось экспортировать аккаунты")));
    } finally {
      setBusy(null);
    }
  }

  async function importAccounts() {
    const passphrase = await requestTransferPassword("import");
    if (!passphrase) return;
    setBusy("import");
    try {
      const preview = await cam.previewImport(passphrase);
      setImportPreview(preview);
      if (!preview) setMessage(isEnglish ? "Import canceled" : "Импорт отменён");
    } catch (error) {
      setMessage(uiErrorMessage(isEnglish ? "Could not validate the import file" : "Не удалось проверить файл импорта") + (readableIpcError(error) ? ` ${maskSensitiveDisplayText(readableIpcError(error)!)}` : ""));
    } finally { setBusy(null); }
  }

  async function applyImport() {
    if (!importPreview || importPreview.expiresAt <= nowSeconds()) return;
    setBusy("import:apply");
    try {
      const result = await cam.applyImport(importPreview.previewId);
      setAccounts(result.accounts);
      setImportPreview(null);
      setMessage(isEnglish ? `Imported ${result.importedCount}; skipped ${result.skippedCount ?? 0}.` : `Импортировано: ${result.importedCount}; пропущено: ${result.skippedCount ?? 0}.`);
      await reload();
    } catch (error) { setMessage(uiErrorMessage(isEnglish ? "Could not apply import" : "Не удалось применить импорт") + (readableIpcError(error) ? ` ${maskSensitiveDisplayText(readableIpcError(error)!)}` : "")); }
    finally { setBusy(null); }
  }

  async function verifyRuntimeAccount(id: string) {
    setBusy(`runtime:${id}`);
    try {
      const evidence = await cam.verifyRuntimeAccount(id);
      setAccounts((current) => current.map((account) => account.id === id ? { ...account, runtimeVerification: evidence } : account));
      setMessage(runtimeLabel(evidence, language));
    } catch { setMessage(uiErrorMessage(isEnglish ? "Could not verify the running IDE account" : "Не удалось проверить аккаунт работающей IDE")); }
    finally { setBusy(null); }
  }

  async function restoreSwitchSnapshot(eventId: string) {
    const event = switchHistory.find((item) => item.id === eventId);
    if (!event) return;
    const confirmed = await requestConfirm({ title: isEnglish ? "Restore snapshot" : "Восстановить снимок", body: isEnglish ? "The IDE will close while Квессер restores the saved local state. Runtime identity will be checked separately after restart." : "IDE будет закрыта для восстановления сохранённого локального состояния. Аккаунт работающей IDE проверяется отдельно после запуска.", confirmLabel: isEnglish ? "Restore" : "Восстановить", details: [`${isEnglish ? "Snapshot date" : "Дата снимка"}: ${new Date(event.startedAt * 1000).toLocaleString(isEnglish ? "en-US" : "ru-RU")}`] });
    if (!confirmed) return;
    setBusy(`rollback:${eventId}`);
    try { setSwitchHistory(await cam.rollbackSwitch(eventId)); await reload(); setMessage(isEnglish ? "Snapshot restored; runtime identity is shown separately." : "Снимок восстановлен; подтверждение IDE показано отдельно."); }
    catch (error) { setMessage((isEnglish ? "Could not restore the snapshot" : "Не удалось восстановить снимок") + (readableIpcError(error) ? `: ${maskSensitiveDisplayText(readableIpcError(error)!)}` : "")); await reload(); }
    finally { setBusy(null); }
  }

  async function inspectAntigravityProfile() {
    setBusy("antigravity-diagnostics");
    try {
      const inspection = await cam.inspectAntigravityProfile();
      const status = await cam.getAntigravityProfileStatus();
      setAntigravityProfileStatus({ ...status, inspection });
      setMessage((isEnglish ? "Antigravity diagnostics updated" : "Диагностика Antigravity обновлена"));
    } catch {
      setMessage(uiErrorMessage((isEnglish ? "Could not inspect Antigravity" : "Не удалось выполнить диагностику Antigravity")));
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
      setMessage(uiErrorMessage((isEnglish ? "Could not import the local Antigravity profile" : "Не удалось импортировать локальный профиль Antigravity")));
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
      setMessage((isEnglish ? "Start official Antigravity sign-in first." : "Сначала запусти OAuth авторизацию Antigravity."));
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
      setMessage((isEnglish ? "Enter a refresh token or its credential JSON." : "Вставь refresh_token или JSON с refresh_token."));
      return;
    }
    if (!await requestConfirm({ title: isEnglish ? "Import Antigravity sign-in" : "Импорт входа Antigravity", body: isEnglish ? "This import contains a sign-in secret. Continue only for profiles you are authorized to manage. The secret will not be displayed in the interface or logs." : "Импорт содержит секрет авторизации. Продолжайте только для профилей, которыми вы вправе управлять. Секрет не будет показан в интерфейсе или логах.", confirmLabel: isEnglish ? "Import" : "Импортировать" })) {
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
    if (!await requestConfirm({ title: isEnglish ? "Read local Antigravity sign-in" : "Прочитать локальный вход Antigravity", body: isEnglish ? "Квессер will read the credential files you select for the current Windows user. They can contain sign-in secrets." : "Квессер прочитает выбранные файлы входа текущего пользователя Windows. Они могут содержать секреты авторизации.", confirmLabel: isEnglish ? "Choose files" : "Выбрать файлы" })) {
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
    if (!await requestConfirm({ title: isEnglish ? "Import external Antigravity profiles" : "Импорт внешних профилей Antigravity", body: isEnglish ? "The external source may contain sign-in secrets. Continue only for profiles you are authorized to manage." : "Внешний источник может содержать секреты входа. Продолжайте только для профилей, которыми вы вправе управлять.", confirmLabel: isEnglish ? "Import" : "Импортировать", details: [source] })) {
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
    setAntigravityCallbackUrl("");
    setAntigravityTokenPayload("");
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
      setMessage((isEnglish ? "Sign-in is open. Complete it to update this saved profile." : "Открыл reauth. Заверши вход, профиль обновится без пересоздания списка"));
    } catch {
      setLoginWizard({ open: true, phase: "error", type: "chatgptDeviceCode", result: null, error: `Не удалось обновить авторизацию${account ? ` для ${displayEmail(account.email)}` : ""}.` });
      setMessage(uiErrorMessage((isEnglish ? "Could not update sign-in" : "Не удалось обновить авторизацию")));
    } finally {
      setBusy(null);
    }
  }

  async function openProfileFolder(id: string) {
    setBusy(`folder:${id}`);
    try {
      await cam.openProfileFolder(id);
      setMessage((isEnglish ? "Profile folder opened" : "Папка профиля открыта"));
    } catch {
      setMessage(uiErrorMessage((isEnglish ? "Could not open the profile folder" : "Не удалось открыть папку профиля")));
    } finally {
      setBusy(null);
    }
  }

  async function switchAccount(id: string, trigger?: HTMLElement) {
    const account = accounts.find((item) => item.id === id);
    // Блокировка кнопки на время подготовки может снять с неё фокус.
    const returnFocus = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    setBusy(`prepare-switch:${id}`);
    let preparation;
    try {
      preparation = await cam.prepareSwitch(id);
    } catch (error) {
      setMessage(switchErrorMessage(error, account ? accountPlatform(account) : platformFilter, language));
      setBusy(null);
      return;
    }
    setBusy(null);
    if (account && settingsData?.confirmSwitch !== false) {
      const isAntigravity = accountPlatform(account) === "antigravity";
      const current = accounts.find((item) => item.isActive && accountPlatform(item) === accountPlatform(account));
      const currentLabel = current ? displayMetadata(current.label, privacyMode, language) : (isEnglish ? "None selected" : "Не выбран");
      const confirmed = await requestConfirm({
        title: isEnglish ? "Switch profile" : "Переключить профиль",
        body: isAntigravity
          ? (isEnglish ? "Квессер will save a protected snapshot and restart Antigravity with the selected profile. The journal will show the restart and any available account confirmation." : "Квессер сохранит защищённый снимок и перезапустит Antigravity с выбранным профилем. В журнале будут видны запуск и результат проверки аккаунта, если она доступна.")
          : settingsData?.desktopClosePolicy === "graceful-only"
            ? (isEnglish ? "Квессер will apply the profile and relaunch Codex after it closes normally. If Codex stays open, the switch will be canceled." : "Квессер применит профиль и снова запустит Codex после штатного закрытия. Если Codex останется открыт, переключение будет отменено.")
            : (isEnglish ? "Квессер will close the installed Codex and restart it with the selected profile. If needed, it will stop the verified Codex process tree." : "Квессер закроет установленный Codex и запустит его с выбранным профилем. При необходимости он завершит проверенное дерево процессов Codex."),
        confirmLabel: isEnglish ? "Switch" : "Переключить",
        returnFocus,
        details: [
          `${isEnglish ? "Provider" : "Платформа"}: ${platformLabel(account)}`,
          `${isEnglish ? "Current profile" : "Текущий профиль"}: ${currentLabel}`,
          `${isEnglish ? "Target profile" : "Новый профиль"}: ${displayMetadata(account.label, privacyMode, language)}`,
          `Email: ${displayEmail(account.email)}`,
          ...preparation.warnings.map((warning) => displayMetadata(warning, privacyMode, language))
        ]
      });
      if (!confirmed) {
        await cam.cancelSwitch(preparation.transaction.id).catch(() => undefined);
        return;
      }
    }
    setInspectorOpen(false);
    setBusy(`switch:${id}`);
    try {
      const switched = await cam.switchAccount(id, preparation.transaction.id);
      setAccounts((current) => current.map((item) => item.id === switched.id
        ? switched
        : accountPlatform(item) === accountPlatform(switched)
          ? { ...item, isActive: false }
          : item));
      setMessage(runtimeLabel(switched.runtimeVerification, language));
      void reload();
    } catch (error) {
      await cam.cancelSwitch(preparation.transaction.id).catch(() => undefined);
      setMessage(switchErrorMessage(error, account ? accountPlatform(account) : platformFilter, language));
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount(id: string) {
    const account = accounts.find((item) => item.id === id);
    if (account) {
      const confirmed = await requestConfirm({
        title: isEnglish ? "Delete profile" : "Удалить профиль",
        body: isEnglish ? "The saved profile and its local folder will be removed from Квессер." : "Сохранённый профиль и его локальная папка будут удалены из Квессер.",
        confirmLabel: isEnglish ? "Delete" : "Удалить",
        tone: "danger",
        details: [`${isEnglish ? "Profile" : "Профиль"}: ${account.label}`, `Email: ${displayEmail(account.email)}`]
      });
      if (!confirmed) return;
    }
    setBusy(`delete:${id}`);
    try {
      await cam.deleteAccount(id);
      setMessage((isEnglish ? "Profile removed from Квессер" : "Профиль удалён из менеджера"));
      await reload();
    } catch {
      setMessage(uiErrorMessage((isEnglish ? "Could not delete the profile" : "Не удалось удалить профиль")));
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
      setMessage(uiErrorMessage((isEnglish ? "Could not choose the workspace" : "Не удалось выбрать рабочую папку")));
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
      setMessage(uiErrorMessage((isEnglish ? "Could not save settings" : "Не удалось сохранить настройки")));
    } finally {
      setBusy(null);
    }
  }

  async function openLogViewer() {
    setBusy("logs");
    try {
      const lines = await cam.readLogTail();
      const visibleLines = lines.map(maskSensitiveDisplayText);
      setLogLines(visibleLines.length ? visibleLines : [(isEnglish ? "The log is empty." : "Журнал пока пуст.")]);
      setShowLogViewer(true);
      setMessage((isEnglish ? "Diagnostic log opened" : "Журнал диагностики открыт"));
    } catch {
      setMessage(uiErrorMessage((isEnglish ? "Could not open the diagnostic log" : "Не удалось открыть журнал диагностики")));
    } finally {
      setBusy(null);
    }
  }

  async function openLogsFolder() {
    setBusy("logs-folder");
    try {
      await cam.openLogsFolder();
      setMessage((isEnglish ? "Log folder opened" : "Папка журналов открыта"));
    } catch {
      setMessage(uiErrorMessage((isEnglish ? "Could not open the log folder" : "Не удалось открыть папку журналов")));
    } finally {
      setBusy(null);
    }
  }

  async function exportDiagnosticReport() {
    setBusy("diagnostic-report");
    try {
      const result = await cam.exportDiagnosticReport();
      setMessage(result.filePath ? (isEnglish ? "Diagnostic report saved" : "Отчёт диагностики сохранён") : (isEnglish ? "Report export canceled" : "Экспорт отчёта отменён"));
    } catch {
      setMessage(uiErrorMessage((isEnglish ? "Could not save the diagnostic report" : "Не удалось сохранить отчёт диагностики")));
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
      setMessage((isEnglish ? "Profile metadata updated" : "Метки профиля обновлены"));
    } catch {
      setMessage(uiErrorMessage((isEnglish ? "Could not update profile metadata" : "Не удалось обновить метки профиля")));
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
    if (command.view === "activity" || command.action === "navigate:activity") {
      setActiveView("activity");
      return;
    }
    if (command.view) {
      setActiveView(command.view);
      return;
    }
    if (command.action === "login") {
      if (command.platform === "antigravity" || (platformFilter === "antigravity" && !command.platform)) {
        openAntigravityImport();
      } else {
        openLoginWizard();
      }
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
            accounts={accounts}
            diagnostics={diagnostics}
            latestTransaction={switchTransactions[0] ?? null}
            busy={busy}
            autoRefreshIntervalMs={settingsData?.autoRefreshIntervalMs ?? 180_000}
            smartSwitchThresholdPercent={settingsData?.smartSwitchThresholdPercent ?? 10}
            isEnglish={isEnglish}
            displayEmail={displayEmail}
            displayLabel={(value) => displayMetadata(value, privacyMode, language)}
            onAdd={platformFilter === "antigravity" ? () => openAntigravityImport() : openLoginWizard}
            onAddAntigravity={() => openAntigravityImport()}
            onAddCodex={openLoginWizard}
            onRefresh={() => void refreshAllAccounts()}
            onSwitch={(accountId) => void switchAccount(accountId)}
            onOpenAccounts={() => setActiveView("accounts")}
            onOpenActivity={() => setActiveView("activity")}
          />
        );
      case "accounts":
        return (
          <section className="profile-page">
            <header className="page-head">
                <div>
                  <h2>{accountsText.title}</h2>
                  <p>
                    {isEnglish
                      ? `${scopedProtectedCount} with saved sign-in · ${scopedAttentionCount} need attention`
                      : `${scopedProtectedCount} с сохранённым входом · ${scopedAttentionCount} ${scopedAttentionCount === 1 ? "требует" : "требуют"} внимания`}
                  </p>
                </div>
                <div className="panel-actions">
                  <button className="button secondary" disabled={busy !== null || refreshableAccountCount === 0} aria-busy={busy === "refresh:all"} onClick={refreshAllAccounts} title={refreshableAccountCount === 0 ? shellText.noRefreshableAccounts : shellText.refreshLimits}>
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
            </header>
            <section className="panel account-panel" aria-label={accountsText.title}>
              <div className="profile-toolbar">
                  <div className="search-wrap">
                    <Search aria-hidden="true" />
                    <input
                      className="search"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={accountsText.searchProfile}
                      aria-label={accountsText.searchProfile}
                    />
                    {search ? <button className="search-clear" onClick={() => setSearch("")} aria-label={isEnglish ? "Clear search" : "Очистить поиск"}><X /></button> : null}
                  </div>
                  <label className="account-sort-control provider-filter-control"><span className="sr-only">{isEnglish ? "Provider filter" : "Фильтр провайдера"}</span><select aria-label={isEnglish ? "Provider filter" : "Фильтр провайдера"} value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value as PlatformFilter)}><option value="all">{isEnglish ? "All providers" : "Все провайдеры"}</option><option value="codex">Codex</option><option value="antigravity">Antigravity</option></select></label>
                  <div className="segmented account-view-toggle" role="group" aria-label={accountsText.viewMode}>
                    <button className={viewMode === "cards" ? "is-selected" : ""} aria-pressed={viewMode === "cards"} onClick={() => setViewMode("cards")} title={accountsText.cards} aria-label={accountsText.cards}><LayoutGrid /><span>{accountsText.cards}</span></button>
                    <button className={viewMode === "table" ? "is-selected" : ""} aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")} title={accountsText.table} aria-label={accountsText.table}><List /><span>{accountsText.table}</span></button>
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
              </div>
              <div className="profile-workbench">
                <div ref={profileMainRef} className="profile-main is-scrollable">
                  {viewMode === "table" ? (
                    <ProfileTable accounts={visibleAccounts} selectedId={selectedAccount?.id ?? null} now={now} language={language} privacyMode={privacyMode} busy={busy} onSelect={setSelectedAccountId} onRefresh={refreshAccount} onRepair={repairAccount} onReauth={reauthenticateAccount} onSwitch={switchAccount} scrollPosition={profileScroll.current.table} onAdd={scopedAccounts.length === 0 ? platformFilter === "antigravity" ? openAntigravityImport : openLoginWizard : undefined} onInspect={(id, trigger) => { inspectorTriggerRef.current = trigger; setSelectedAccountId(id); setInspectorOpen(true); }} />
                  ) : (
                    <div className="profile-grid">
                      {visibleAccounts.map((account) => (
                        <AccountCard
                          key={account.id}
                          account={account}
                          selected={selectedAccount?.id === account.id}
                          privacyMode={privacyMode}
                          language={language}
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
                          <strong>{isEnglish ? "No profiles yet" : "Профилей пока нет"}</strong>
                          <span>{isEnglish ? "Add a profile using an official sign-in method." : "Добавьте профиль одним из официальных способов входа."}</span>
                          <div className="mini-actions">
                            {platformFilter === "antigravity" ? (
                              <button className="button" disabled={busy !== null} onClick={() => openAntigravityImport()}><KeyRound />{shellText.addAntigravity}</button>
                            ) : (
                              <>
                                <button className="button" disabled={busy !== null} onClick={openLoginWizard}><LogIn />{shellText.addCodex}</button>
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
              <footer className="profile-table-footer">
                <span role="status">{isEnglish ? "Profiles shown" : "Показано профилей"} <strong>{visibleAccounts.length}</strong> {isEnglish ? "of" : "из"} {scopedAccounts.length}</span>
                {viewMode === "table" && visibleAccounts.length > 0 ? <span><kbd>↑</kbd><kbd>↓</kbd>{isEnglish ? "select" : "выбор"}<kbd>Enter</kbd>{isEnglish ? "details" : "подробности"}</span> : null}
              </footer>
            </section>
          </section>
        );
      case "activity":
        return (
          <ActivityPage
            transactions={switchTransactions}
            history={switchHistory}
            accounts={accounts}
            isEnglish={isEnglish}
            privacyMode={privacyMode}
            busy={busy}
            onRollback={(eventId) => void restoreSwitchSnapshot(eventId)}
            onVerifyRuntime={(id) => void verifyRuntimeAccount(id)}
            onOpenSettings={() => setActiveView("settings")}
          />
        );
      case "settings":
        return (
          <SettingsPage
            settings={settingsData}
            diagnostics={diagnostics}
            antigravityStatus={antigravityProfileStatus}
            accounts={accounts}
            busy={busy === "settings"}
            onUpdate={(input) => void updateSettings(input)}
            onSelectWorkspace={selectWorkspace}
            onOpenLogViewer={openLogViewer}
            onExportDiagnosticReport={exportDiagnosticReport}
            displayPath={displayPath}
          />
        );
    }
  })();

  return (
    <main className="shell ops-shell">
      <aside className="side-rail" aria-label={isEnglish ? "Main sections" : "Основные разделы"}>
        <div className="rail-brand">
          <div className="mark">
            <img src={appAvatarUrl} alt="" aria-hidden="true" />
          </div>
          <h1>{productName}</h1>
        </div>
        <nav className="rail-nav" style={{ "--nav-index": navItems.findIndex((item) => item.key === activeView) } as React.CSSProperties}><span className="rail-nav-selection" aria-hidden="true" />
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
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <section className="platform-stack" aria-label={shellText.platformFilter}>
          <div className="rail-section-title">{shellText.platform}</div>
          {platformSummaries.map((platform) => (
            <button
              key={platform.id}
              className={`platform-tile ${platform.tone} ${activeView === "accounts" && platformFilter === platform.id ? "is-active" : ""}`}
              aria-label={`${platform.label}: ${platform.count} · ${platform.state}`}
              aria-pressed={activeView === "accounts" && platformFilter === platform.id}
              title={`${platform.label} · ${platform.state}`}
              onClick={() => {
                setActiveView("accounts");
                setPlatformFilter((current) => activeView === "accounts" && current === platform.id ? "all" : platform.id);
              }}
            >
              <span className="platform-tile-label">
                <PlatformMark platform={platform.id} size="tile" />
                <span><b>{platform.label}</b><small>{platform.state}</small></span>
              </span>
              <strong>{platform.count}</strong>
            </button>
          ))}
        </section>
        <div className="rail-footer">
          <p role="status"><span className={`rail-status-dot is-${loadState}`} aria-hidden="true" />{message ? displayMetadata(message, privacyMode, language) : uiText.states.success}</p>
          <span className="version">v{appVersion}</span>
        </div>
      </aside>

      <section className="app-frame">
        <header className="topbar">
          <button className="button secondary command-trigger" aria-label={shellText.commands} title={shellText.commands} aria-keyshortcuts="Control+k Meta+k" onClick={() => {
            setCommandOpen(true);
            setCommandSearch("");
          }}>
            <Command aria-hidden="true" />
            <span>{shellText.commands}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="actions top-actions">
            <button
              className="button secondary audit-top-trigger"
              onClick={() => setAuditDrawerOpen(true)}
              title={isEnglish ? "Switch audit journal" : "Журнал аудита переключений"}
              aria-label={isEnglish ? "Switch audit journal" : "Журнал аудита переключений"}
            >
              <Activity size={14} />
              <span>{isEnglish ? "Audit" : "Аудит"}</span>
            </button>
            <button className="icon-btn update-check-button" aria-label={isEnglish ? "Check app updates" : "Проверить обновления приложения"} title={isEnglish ? "Check app updates" : "Проверить обновления приложения"} disabled={busy !== null} aria-busy={busy === "updates"} onClick={checkApplicationUpdates}>
              {busy === "updates" ? <Loader2 className="spin" /> : <PackageCheck />}
            </button>
            <button className="button" disabled={busy !== null} onClick={platformFilter === "antigravity" ? () => openAntigravityImport() : openLoginWizard}>
              <Plus />
              <span>{isEnglish ? "Add profile" : "Добавить профиль"}</span>
            </button>
            <div className="window-controls" aria-label={shellText.windowControls}>
              <button className="window-btn" onClick={() => void cam.minimizeWindow()} title={shellText.minimize} aria-label={shellText.minimize}>
                <Minus />
              </button>
              <button className="window-btn" onClick={() => void cam.toggleMaximizeWindow()} title={shellText.maximize} aria-label={shellText.maximize}>
                <Maximize2 />
              </button>
              <button className="window-btn close" onClick={() => void cam.closeWindow()} title={shellText.close} aria-label={shellText.close}>
                <X />
              </button>
            </div>
          </div>
        </header>

        {appNotifications.length > 0 ? (
          <section className="process-notice-stack" aria-label={isEnglish ? "Application notifications" : "Уведомления приложения"}>
            {appNotifications.map((notice) => (
              <aside className={`process-notice is-${notice.tone}`} key={notificationOperation(notice.key)}>
                <span className="process-notice-icon" aria-hidden="true">
                  {notice.tone === "progress" ? <Loader2 className="spin" /> : notice.tone === "success" ? <CheckCircle2 /> : <AlertTriangle />}
                </span>
                <div className="process-notice-copy" role={notice.tone === "error" ? "alert" : "status"}>
                  <strong>{displayMetadata(notice.title, privacyMode, language)}</strong>
                  <small>{displayMetadata(notice.body, privacyMode, language)}</small>
                </div>
                <button className="process-notice-close" onClick={() => setAppNotifications((current) => current.filter((item) => item.key !== notice.key))} aria-label={isEnglish ? "Dismiss notification" : "Закрыть уведомление"}><X /></button>
                {notice.progress && notice.tone === "progress" ? (
                  <span className="process-notice-progress" role="progressbar" aria-label={notice.progress.label} aria-valuetext={notice.progress.status} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(1, notice.progress.value)) * 100)}>
                    <span><small>{notice.progress.status}</small><b>{Math.round(Math.max(0, Math.min(1, notice.progress.value)) * 100)}%</b></span>
                    <i><em style={{ width: `${Math.max(0, Math.min(100, notice.progress.value * 100))}%` }} /></i>
                  </span>
                ) : null}
                {notice.key.startsWith("switch:") && (notice.tone === "error" || notice.tone === "warning") ? (
                  <button className="notice-journal-link" onClick={() => {
                    setActiveView("activity");
                    setAppNotifications((current) => current.filter((item) => item.key !== notice.key));
                  }}>{isEnglish ? "Open journal" : "Открыть журнал"}</button>
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
            <div>
              <strong>{loadState === "error" ? (isEnglish ? "Account data did not load" : "Данные аккаунтов не загрузились") : (isEnglish ? "Limited mode" : "Ограниченный режим")}</strong>
              <p>{isEnglish ? "Retry the connection to the local vault." : "Повторите подключение к локальному хранилищу."}</p>
            </div>
            <div className="runtime-state-actions">
              {loadError ? (
                <button className="button ghost" onClick={() => void openLogsFolder()}><TerminalSquare />{isEnglish ? "Log" : "Журнал"}</button>
              ) : null}
              <button className="button secondary" disabled={busy !== null} onClick={() => { setLoadState("loading"); void reload(); }}><RefreshCcw />{isEnglish ? "Retry" : "Повторить"}</button>
            </div>
          </div>
        ) : null}
        {!loginWizard.open && (loginWizard.phase === "waiting" || loginWizard.phase === "starting") ? <div className="pending-login-banner" role="status"><KeyRound /><span>{isEnglish ? "Codex sign-in is still pending." : "Вход Codex ещё ожидает завершения."}</span><button className="button secondary compact-button" onClick={openLoginWizard}>{isEnglish ? "Continue sign-in" : "Продолжить вход"}</button></div> : null}
        {!antigravityImportOpen && antigravityOAuthSession ? <div className="pending-login-banner" role="status"><KeyRound /><span>{isEnglish ? "Antigravity sign-in is still pending." : "Вход Antigravity ещё ожидает завершения."}</span><button className="button secondary compact-button" onClick={() => setAntigravityImportOpen(true)}>{isEnglish ? "Continue sign-in" : "Продолжить вход"}</button></div> : null}
        {loadState === "loading" ? (
          <div className="content boot-loading" role="status" aria-live="polite">
            <Loader2 className="spin" />
            <strong>{isEnglish ? "Opening the local vault…" : "Открываем локальное хранилище…"}</strong>
          </div>
        ) : (
          <div ref={contentRef} className={`content content-${activeView}`}>{pageContent}</div>
        )}
      </section>
      <AddAccountWizard
        state={loginWizard}
        language={language}
        busy={busy}
        capabilities={diagnostics?.codexCapabilities}
        onStart={(input) => void startLogin(input)}
        onOpen={(url) => void cam.openExternal(url)}
        onCopyDeviceCode={(userCode) => cam.copyDeviceCode(userCode)}
        onOpenDeviceLogin={(url, userCode) => cam.openDeviceLogin(url, userCode)}
        onImportCurrentSession={() => void importCurrentCodexSession()}
        onClose={closeLoginWizard}
      />
      <CommandPalette
        language={language}
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
              <h2 className="panel-title">{isEnglish ? "Profile details" : "Подробности профиля"}</h2>
              <button ref={inspectorCloseButtonRef} className="icon-btn" onClick={() => setInspectorOpen(false)} title={isEnglish ? "Close" : "Закрыть"} aria-label={isEnglish ? "Close" : "Закрыть"}>
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
              onVerifyRuntime={verifyRuntimeAccount}
            />
          </div>
        </div>
      ) : null}
      {antigravityImportOpen ? (
        <AntigravityImportModal
          busy={busy}
          language={language}
          profileStatus={antigravityProfileStatus}
          oauthSession={antigravityOAuthSession}
          callbackUrl={antigravityCallbackUrl}
          onCallbackUrl={setAntigravityCallbackUrl}
          tokenPayload={antigravityTokenPayload}
          onTokenPayload={setAntigravityTokenPayload}
          result={antigravityImportResult}
          displayEmail={displayEmail}
          onClose={closeAntigravityImport}
          onStartOAuth={() => void startAntigravityOAuthAuthorization()}
          onFinishOAuth={(manualCallback) => void finishAntigravityOAuthAuthorization(manualCallback)}
          onImportToken={() => void importAntigravityTokenPayload()}
          onImportFiles={() => void importAntigravityLocalFiles()}
          onImportSource={(source) => void importAntigravityExternalSource(source)}
          onImportLocalProfile={() => void importAntigravityLocalProfile()}
          onInspect={() => void inspectAntigravityProfile()}
          onOpenDocs={() => void cam.openExternal(ANTIGRAVITY_CLI_DOCS_URL)}
          onImportCurrentSession={() => void importCurrentAntigravitySession()}
        />
      ) : null}
      {importPreview ? <ImportPreviewDialog preview={importPreview} language={language} privacyMode={privacyMode} now={now} busy={busy === "import:apply"} onApply={() => void applyImport()} onClose={() => setImportPreview(null)} /> : null}
      {transferMode ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={transferMode === "export" ? (isEnglish ? "Export profiles" : "Экспорт профилей") : (isEnglish ? "Import profiles" : "Импорт профилей")}>
          <div className="transfer-modal">
            <div className="panel-title">{transferMode === "export" ? (isEnglish ? "Export profiles" : "Экспорт профилей") : (isEnglish ? "Import profiles" : "Импорт профилей")}</div>
            <p className="muted">
              {transferMode === "export"
                ? (isEnglish ? "Set a password for the encrypted file. Keep it for import on another PC." : "Задайте пароль для зашифрованного файла. Он понадобится для импорта на другом ПК.")
                : (isEnglish ? "Enter the exported file password to review its profiles before import." : "Введите пароль экспортированного файла, чтобы проверить профили перед импортом.")}
            </p>
            <label className="field">
              <span>{isEnglish ? "Password" : "Пароль"}</span>
              <input data-dialog-initial-focus type="password" aria-label={transferMode === "export" ? (isEnglish ? "Export password" : "Пароль экспорта") : (isEnglish ? "Import password" : "Пароль импорта")} value={transferPassword} onChange={(event) => setTransferPassword(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter") submitTransferPrompt();
                if (event.key === "Escape") closeTransferPrompt(null);
              }} />
              <small className={`password-hint ${passwordStrength(transferPassword, language).className}`}>{passwordStrength(transferPassword, language).label}</small>
            </label>
            {transferMode === "export" ? (
              <label className="field">
                <span>{isEnglish ? "Confirm password" : "Повтор пароля"}</span>
                <input type="password" aria-label={isEnglish ? "Confirm export password" : "Повтор пароля экспорта"} value={transferConfirm} onChange={(event) => setTransferConfirm(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter") submitTransferPrompt();
                  if (event.key === "Escape") closeTransferPrompt(null);
                }} />
              </label>
            ) : null}
            {transferError ? <div className="form-error">{transferError}</div> : null}
            <div className="modal-actions">
              <button className="button secondary" onClick={() => closeTransferPrompt(null)}>{isEnglish ? "Cancel" : "Отмена"}</button>
              <button className="button" onClick={submitTransferPrompt}>{transferMode === "export" ? (isEnglish ? "Export" : "Экспорт") : (isEnglish ? "Review import" : "Проверить импорт")}</button>
            </div>
          </div>
        </div>
      ) : null}
      {showLogViewer ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={isEnglish ? "Diagnostic log" : "Журнал диагностики"}>
          <div className="transfer-modal log-viewer">
            <div className="modal-head">
              <div>
                <div className="panel-title">{isEnglish ? "Diagnostic log" : "Журнал диагностики"}</div>
                <p className="muted">{isEnglish ? "Recent diagnostic events" : "Последние события диагностики"}</p>
              </div>
              <button className="icon-btn" onClick={() => setShowLogViewer(false)} aria-label={isEnglish ? "Close" : "Закрыть"}>
                <X />
              </button>
            </div>
            <pre className="log-lines">{(privacyMode ? logLines.map((line) => displayMetadata(line, true, language)) : logLines).join("\n")}</pre>
            <div className="modal-actions">
              <button className="button secondary" onClick={openLogsFolder}>
                <FolderOpen />
                {isEnglish ? "Log folder" : "Папка логов"}
              </button>
              <button className="button" onClick={() => setShowLogViewer(false)}>{isEnglish ? "Done" : "Готово"}</button>
            </div>
          </div>
        </div>
      ) : null}
      {showReleaseNotes ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={isEnglish ? "What's new" : "Что нового"}>
          <div className="transfer-modal release-notes-modal">
            <div className="modal-head">
              <div>
                <div className="panel-title">{isEnglish ? "New in" : "Что нового в"} {appVersion}</div>
                <p className="muted">{isEnglish ? "Changes in this local release candidate." : "Изменения локальной предварительной версии."}</p>
              </div>
              <button className="icon-btn" onClick={closeReleaseNotes} aria-label={isEnglish ? "Close" : "Закрыть"}>
                <X />
              </button>
            </div>
            <div className="release-notes-list">
              {(isEnglish ? englishReleaseNotes : releaseNotes).map((note) => (
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
              }}>{isEnglish ? "Profiles" : "Профили"}</button>
              <button className="button" onClick={closeReleaseNotes}>{isEnglish ? "Got it" : "Понятно"}</button>
            </div>
          </div>
        </div>
      ) : null}
      <AuditDrawer
        open={auditDrawerOpen}
        onClose={() => setAuditDrawerOpen(false)}
        transactions={switchTransactions}
        history={switchHistory}
        accounts={accounts}
        isEnglish={isEnglish}
        displayEmail={displayEmail}
        privacyMode={privacyMode}
      />
      <ConfirmDialog state={confirmState ? { ...confirmState, body: displayMetadata(confirmState.body, privacyMode, language), details: confirmState.details?.map((detail) => displayMetadata(detail, privacyMode, language)) } : null} language={language} onClose={closeConfirm} registerTrigger={registerDialogTrigger} />
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
        <p>Данные аккаунтов не загружены и не потеряны. Перезапустите Квессер. При повторении экрана переустановите текущую версию поверх существующей.</p>
      </div>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
const surface = new URLSearchParams(window.location.search).get("surface");
function ApplicationSurface() {
  useMotionEnvironment();
  return window.cam || import.meta.env.DEV
    ? surface === "tray"
      ? <TrayPopover api={cam} />
      : surface === "tray-hover"
        ? <TrayHoverPopover api={cam} />
        : <App />
    : <BridgeUnavailable />;
}
root.render(
  <React.StrictMode>
    <ApplicationSurface />
  </React.StrictMode>
);
