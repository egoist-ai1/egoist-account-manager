import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, Tray, app, clipboard, dialog, ipcMain, nativeImage, nativeTheme, powerMonitor, screen, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type Rectangle } from "electron";
import { AccountStore } from "./db.js";
import { Vault } from "./security.js";
import { getAppDataDir, getDefaultCodexHome } from "./paths.js";
import { AccountManager } from "./accountManager.js";
import { discoverCodexRuntime, type CodexRuntimeDiscovery } from "./services/nativeDiscoveryService.js";
import { inspectCodexCredentialStore } from "./services/codexCredentialStoreService.js";
import { DiagnosticsService } from "./services/diagnosticsService.js";
import { CodexCapabilityService } from "./services/codexCapabilityService.js";
import { SettingsService } from "./services/settingsService.js";
import { registerHealthIpc } from "./ipc/healthIpc.js";
import { registerSettingsIpc } from "./ipc/settingsIpc.js";
import type { AccountPlatform, AntigravityImportResult, AppDiagnostics, AppNotificationPayload, AppSettings, LoginStartResult, ManagedAccount } from "../shared/types.js";
import { redactDiagnosticReport } from "../shared/diagnosticRedaction.js";
import {
  antigravityCredentialPayloadImportInputSchema,
  antigravityExternalImportInputSchema,
  antigravityOAuthCancelInputSchema,
  antigravityOAuthFinishInputSchema,
  accountActionInputSchema,
  deviceCodeActionInputSchema,
  deviceCodeOpenInputSchema,
  loginStartInputSchema,
  openExternalInputSchema,
  quotaStateInputSchema,
  reauthenticateAccountInputSchema,
  switchAccountInputSchema,
  switchEventInputSchema,
  switchTransactionActionInputSchema,
  validateAuthInputSchema,
  workspaceBindingInputSchema
} from "../shared/ipcSchemas.js";
import { redactSensitiveText } from "../shared/redaction.js";
import { selectSmartAccount } from "../shared/smartSelection.js";
import { buildTrayAccountLabel } from "../shared/trayLabel.js";
import { toRendererDto } from "./services/rendererDtoService.js";
import { LIVE_TRAY_REPRESENTATIONS, buildDualLiveTraySnapshot, buildLiveTraySnapshot, buildTaskbarQuotaValue, renderLiveTrayBitmap } from "../shared/liveTray.js";
import { calculateTraySurfacePosition } from "../shared/traySurfacePosition.js";
import { appVersion } from "../shared/releaseNotes.js";
import { productName, productLatinName } from "../shared/branding.js";
import { resolveStoredUserData } from "./services/storageIdentityService.js";
import { ReleaseService } from "./services/releaseService.js";
import { getCrashReportsDir, writeCrashReport } from "./services/crashReportService.js";
import { UpdaterService } from "./services/updaterService.js";
import { syncWindowsShortcutIconAsync } from "./services/windowsShortcutIconService.js";
import { getAntigravityDiagnostics } from "./services/antigravityPaths.js";
import { inspectAntigravityProfile } from "./services/antigravityProfileReader.js";
import { getAntigravityProfileStatus } from "./services/antigravityProfileService.js";
import { performAntigravityHygiene } from "./services/antigravityHygieneService.js";
import {
  createAntigravityGoogleOAuthAuthorization,
  finishAntigravityGoogleOAuthAuthorization,
  parseAntigravityGoogleOAuthCallbackUrl,
  runAntigravityGoogleOAuthFlow,
  type AntigravityGoogleOAuthAuthorization
} from "./services/antigravityGoogleAuthService.js";
import { readAntigravityCredentialStorePayloadAsync, writeAntigravityCredentialStoreTokenAsync,
  writeAntigravityCredentialStorePayloadAsync, deleteAntigravityCredentialStorePayloadAsync } from "./services/antigravityCredentialStore.js";
import { initializeProbeIsolation, assertProbeOperationAllowed, installProbeNetworkGuards } from "./services/probeIsolationService.js";
import { quiesceAntigravityAsync, launchAntigravityAsync, resolveAntigravitySwitchTarget } from "./services/antigravityProcessService.js";
import { createProviderRuntimeAdapters } from "./services/providerRuntimeAdapter.js";
import { WindowsDesktopLifecycleService } from "./services/windowsDesktopLifecycleService.js";
import { QuotaAlertService } from "./services/quotaAlertService.js";
import { QuotaTaskbarWidget, type TaskbarWidgetInput } from "./services/quotaTaskbarWidget.js";
import { DeviceCodeHandoffService } from "./services/deviceCodeHandoffService.js";
import {
  InAppNotificationService,
  buildAuthNotification,
  buildQuotaNotification,
  buildSwitchNotification,
  buildUpdateNotification
} from "./services/inAppNotificationService.js";

const probeIsolation = initializeProbeIsolation();
installProbeNetworkGuards(probeIsolation, !app.isPackaged ? "http://127.0.0.1:5173" : undefined);
let mainWindow: BrowserWindow | null = null;
let manager: AccountManager | null = null;
let vault: Vault | null = null;
let tray: Tray | null = null;
let antigravityTray: Tray | null = null;
let quotaTaskbarWidget: QuotaTaskbarWidget | null = null;
let taskbarWidgetReady = false;
let taskbarContextMenu: Menu | null = null;
type TrayAnchor = { platform: AccountPlatform; bounds: Rectangle };
let trayPopoverWindow: BrowserWindow | null = null;
let trayHoverWindow: BrowserWindow | null = null;
let currentPopoverPlatform: "codex" | "antigravity" = "codex";
let currentHoverPlatform: "codex" | "antigravity" = "codex";
let isQuitting = false;
let startupError: string | null = null;
let servicesReady = false;
let settingsService: SettingsService | null = null;
let logPath: string | null = null;
let autoRefreshTimer: NodeJS.Timeout | null = null;
let trayRefreshTimer: NodeJS.Timeout | null = null;
let sessionSnapshotTimer: NodeJS.Timeout | null = null;
let trayHoverShowTimer: NodeJS.Timeout | null = null;
let trayHoverHideTimer: NodeJS.Timeout | null = null;
let trayHoverTarget: TrayAnchor | null = null;
let trayPopoverRequest = 0;
let autoRefreshInFlight = false;
let trayRefreshInFlight = false;
let updaterService: UpdaterService | null = null;
let codexCapabilityService: CodexCapabilityService | null = null;
let cachedCodexQuotaReadOptions: { excludeResetCreditDetails?: boolean } | undefined;
let desktopLifecycleService: WindowsDesktopLifecycleService | null = null;
let runtimeDiscoveryReady: Promise<void> | null = null;
let runtimeDiscovery: CodexRuntimeDiscovery = { codexPath: null, codexDesktopPath: null, codexAppUserModelId: null };
let quotaAlertService: QuotaAlertService | null = null;
let antigravityGoogleLoginInFlight: Promise<unknown> | null = null;
const deviceCodeHandoff = new DeviceCodeHandoffService(clipboard);
const inAppNotificationService = new InAppNotificationService();
const antigravityGoogleOAuthSessions = new Map<string, {
  authorization: AntigravityGoogleOAuthAuthorization;
  expiresAt: number;
  completion?: Promise<AntigravityImportResult>;
}>();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publisherName = "Egoist";
const appUserModelId = "one.egoist.codex-account-manager";
// Packaged code must never trust an environment flag to enable a localhost
// renderer with privileged preload IPC.
const isDevelopmentRuntime = !app.isPackaged;
const allowedExternalHosts = new Set([
  "auth.openai.com",
  "chatgpt.com",
  "platform.openai.com",
  "help.openai.com",
  "github.com",
  "api.github.com",
  "accounts.google.com",
  "oauth2.googleapis.com",
  "antigravity.google",
  "www.antigravity.google"
]);
let currentRateLimitRefreshIntervalMs: AppSettings["autoRefreshIntervalMs"] = 180_000;
let currentTrayRefreshIntervalMs: AppSettings["trayRefreshIntervalMs"] = 60_000;
const trayHoverDwellMs = 240;
const trayHoverExitMs = 120;

function getWindowIconPath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(process.cwd(), "assets", "icon.png");
}

function getWindowsShortcutIconSourcePath(): string {
  return app.isPackaged ? path.join(app.getAppPath(), "assets", "icon.ico") : path.join(process.cwd(), "assets", "icon.ico");
}

function log(message: string, error?: unknown): void {
  const details = error instanceof Error ? `${error.stack ?? error.message}` : error ? String(error) : "";
  const line = redactSensitiveText(`[${new Date().toISOString()}] ${message}${details ? `\n${details}` : ""}\n`);
  console.log(line.trimEnd());
  if (!logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line, "utf8");
  } catch {
    // Logging must never prevent the app from opening.
  }
}

function readLogTail(maxLines = 120): string[] {
  if (!logPath || !fs.existsSync(logPath)) return [];
  try {
    return fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean).slice(-maxLines).map((line) => redactSensitiveText(line));
  } catch {
    return [];
  }
}

function readPackageConfig(): { build?: { publish?: unknown; win?: { signAndEditExecutable?: boolean; signExecutable?: boolean; verifyUpdateCodeSignature?: boolean } } } {
  const candidates = app.isPackaged
    ? [path.join(app.getAppPath(), "package.json")]
    : [path.join(process.cwd(), "package.json"), path.join(app.getAppPath(), "package.json")];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, "utf8"));
    } catch (error) {
      log(`Failed to read package config: ${candidate}`, error);
    }
  }
  return {};
}

function createReleaseService(): ReleaseService {
  return new ReleaseService({
    projectRoot: process.cwd(),
    version: appVersion,
    productName: productLatinName,
    packageConfig: readPackageConfig(),
    env: process.env
  });
}

function captureCrash(kind: string, error: unknown): void {
  log(kind, error);
  try {
    const reportPath = writeCrashReport(getAppDataDir(), kind, error);
    log(`Crash report saved: ${reportPath}`);
  } catch (reportError) {
    log("Failed to save crash report", reportError);
  }
}

async function buildDiagnosticReport(appDataDir: string) {
  const diagnostics = await getCurrentDiagnostics(appDataDir);
  const health = await new DiagnosticsService({
    appDataDir,
    codexHome: getDefaultCodexHome(),
    logPath,
    resolveCodexPath: async () => runtimeDiscovery.codexPath,
    resolveCodexDesktopPath: () => runtimeDiscovery.codexDesktopPath,
    getSchemaVersion: () => manager?.getSchemaVersion() ?? 0,
    isVaultDegraded: () => false
  }).getHealth();
  const accounts = manager?.list().map((account) => ({
    id: account.id,
    label: account.label,
    email: account.email,
    planType: account.planType,
    status: account.status,
    isActive: account.isActive,
    lastRefreshAt: account.lastRefreshAt,
    profileDir: account.profileDir
  })) ?? [];
  return redactDiagnosticReport({
    format: "one.egoist.codex-account-manager.diagnostic-report",
    appVersion,
    generatedAt: new Date().toISOString(),
    diagnostics,
    health,
    profileIntegrity: manager?.getProfileIntegrity() ?? null,
    releaseReadiness: createReleaseService().getReadiness(),
    crashReportsDir: getCrashReportsDir(appDataDir),
    settings: settingsService ? {
      autoRefreshIntervalMs: settingsService.get().autoRefreshIntervalMs,
      trayRefreshIntervalMs: settingsService.get().trayRefreshIntervalMs,
      privacyMode: settingsService.get().privacyMode,
      confirmSwitch: settingsService.get().confirmSwitch,
      smartSwitchMode: settingsService.get().smartSwitchMode,
      smartSwitchThresholdPercent: settingsService.get().smartSwitchThresholdPercent,
      notificationSoundEnabled: settingsService.get().notificationSoundEnabled,
      desktopClosePolicy: settingsService.get().desktopClosePolicy,
      trayEnabled: settingsService.get().trayEnabled,
      autostartEnabled: settingsService.get().autostartEnabled
    } : null,
    accounts
  });
}

async function getCurrentDiagnostics(appDataDir: string): Promise<AppDiagnostics> {
  await runtimeDiscoveryReady;
  const base = { ...runtimeDiscovery, activeCodexHome: getDefaultCodexHome(), appDataDir,
    workspacePath: manager?.getWorkspacePath(), credentialStore: inspectCodexCredentialStore(getDefaultCodexHome()) };
  const [codexCapabilities, desktopLifecycle] = await Promise.all([
    codexCapabilityService
      ? codexCapabilityService.getReport().catch((error) => {
      log("Codex capability probe failed", error);
      return null;
    })
      : Promise.resolve(null),
    desktopLifecycleService
      ? desktopLifecycleService.getDiagnostics().catch((error) => {
        log("Codex desktop lifecycle probe failed", error);
        return null;
      })
      : Promise.resolve(null)
  ]);
  cachedCodexQuotaReadOptions = codexCapabilities?.features?.excludeResetCreditDetails.available
    ? { excludeResetCreditDetails: true } : undefined;
  return {
    ...base,
    workspacePath: manager?.getWorkspacePath() ?? base.workspacePath,
    rateLimitRefreshIntervalMs: currentRateLimitRefreshIntervalMs,
    startupError,
    logPath,
    codexCapabilities,
    desktopLifecycle
  };
}

interface WindowBoundsState {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

function loadWindowState(): WindowBoundsState {
  const fallback = { width: 1578, height: 895 };
  try {
    const dir = getAppDataDir();
    const file = path.join(dir, "window-state.json");
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as WindowBoundsState;
      if (typeof data.width === "number" && typeof data.height === "number" && data.width >= 860 && data.height >= 560) {
        return data;
      }
    }
  } catch {
    // Ignore corrupt or unreadable window state
  }
  return fallback;
}

function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
  try {
    const dir = getAppDataDir();
    fs.mkdirSync(dir, { recursive: true });
    const bounds = win.getBounds();
    const file = path.join(dir, "window-state.json");
    fs.writeFileSync(file, JSON.stringify(bounds), "utf8");
  } catch {
    // Ignore file write errors on shutdown or unmounted volumes
  }
}

function createWindow(): BrowserWindow {
  const state = loadWindowState();
  const window = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 860,
    minHeight: 560,
    center: state.x == null || state.y == null,
    show: false,
    frame: false,
    backgroundColor: "#000000",
    title: productName,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  if (probeIsolation.enabled) {
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const localFile = url.protocol === "file:" || url.protocol === "data:" || url.protocol === "devtools:";
      const renderer = isDevelopmentRuntime && url.origin === "http://127.0.0.1:5173";
      callback({ cancel: !localFile && !renderer });
    });
  }
  let saveTimer: NodeJS.Timeout | null = null;
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(window), 400);
  };
  window.on("resize", debouncedSave);
  window.on("moved", debouncedSave);

  const showFallbackTimer = setTimeout(() => {
    if (process.env.CAM_BACKGROUND_PROBE !== "1" && !window.isDestroyed() && !window.isVisible()) {
      window.show();
      window.focus();
    }
  }, 1500);

  window.once("ready-to-show", () => {
    clearTimeout(showFallbackTimer);
    if (process.env.CAM_BACKGROUND_PROBE !== "1") {
      window.show();
      window.focus();
    }
    saveWindowState(window);
  });
  window.on("close", (event) => {
    saveWindowState(window);
    if (isQuitting || settingsService?.get().trayEnabled !== true) return;
    event.preventDefault();
    window.hide();
    log("Main window hidden to tray");
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.on("blur", () => syncActiveSessions("window-blur"));
  window.on("focus", () => syncActiveSessions("window-focus"));

  window.webContents.on("render-process-gone", (_event, details) => {
    log(`Renderer process gone: ${details.reason}`);
  });
  window.webContents.once("did-finish-load", () => {
    log("Renderer loaded");
    if (probeIsolation.enabled && process.env.CAM_PROBE_READY_FILE && probeIsolation.root) {
      const target = path.resolve(process.env.CAM_PROBE_READY_FILE);
      const relative = path.relative(probeIsolation.root, target);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || fs.existsSync(target)) {
        throw new Error("Invalid or already used probe readiness path");
      }
      fs.writeFileSync(target, JSON.stringify({ schemaVersion: 1, token: process.env.CAM_PROBE_TOKEN,
        pid: process.pid, version: app.getVersion(), rendererReadyAtUnixMs: Date.now(),
        processUptimeMs: process.uptime() * 1000,
        guards: { credentialManager: true, autostart: true, externalLaunch: true, providerNetwork: true } }), { flag: "wx" });
    }
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      log(`Blocked renderer navigation to ${safeUrlForLog(url)}`);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url, "window-open").catch((error) => log("Blocked external window open", error));
    return { action: "deny" };
  });

  const packagedRendererPath = path.join(__dirname, "../renderer/index.html");
  const loadPackagedRenderer = () =>
    window.loadFile(packagedRendererPath).catch((error) => log("Failed to load packaged renderer", error));

  if (isDevelopmentRuntime) {
    const devRendererUrl = "http://127.0.0.1:5173";
    void (async () => {
      try {
        const response = await fetch(devRendererUrl, { signal: AbortSignal.timeout(1200) });
        const html = await response.text();
        if (!response.ok || !html.includes(`<title>${productName}</title>`) || !html.includes("/src/renderer/App.tsx")) {
          throw new Error(`Unexpected dev renderer at ${devRendererUrl}`);
        }
        await window.loadURL(devRendererUrl);
      } catch (error) {
        log("Failed to load matching dev renderer, falling back to packaged renderer", error);
        if (fs.existsSync(packagedRendererPath)) {
          void loadPackagedRenderer();
        }
      }
    })();
  } else {
    void loadPackagedRenderer();
  }

  return window;
}

function requireManager(): AccountManager {
  if (!manager) throw new Error(startupError ?? "Account manager is not ready");
  return manager;
}

async function openExternalUrl(url: string, reason: string): Promise<void> {
  assertProbeOperationAllowed("external-url", probeIsolation);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !allowedExternalHosts.has(parsed.hostname)) {
    throw new Error("External URL is not allowlisted");
  }
  log(`Opening external URL for ${reason}: ${parsed.origin}${parsed.pathname}`);
  if (process.env.CAM_DISABLE_EXTERNAL_OPEN === "1") {
    log(`External URL opening skipped by CAM_DISABLE_EXTERNAL_OPEN for ${reason}`);
    return;
  }
  await shell.openExternal(url);
}

async function prepareLoginHandoff(result: LoginStartResult, reason: string): Promise<LoginStartResult> {
  const url = result.authUrl ?? result.verificationUrl;
  let deviceCodeCopied: boolean | undefined;
  let loginPageOpened: boolean | undefined;

  if (result.userCode) {
    try {
      const userCode = deviceCodeActionInputSchema.parse({ userCode: result.userCode }).userCode;
      deviceCodeHandoff.copy(userCode);
      deviceCodeCopied = true;
    } catch (error) {
      deviceCodeCopied = false;
      log(`Device-code clipboard handoff failed for ${reason}`, error);
    }
  }

  if (url) {
    try {
      await openExternalUrl(url, reason);
      loginPageOpened = true;
    } catch (error) {
      loginPageOpened = false;
      log(`Automatic login page opening failed for ${reason}`, error);
    }
  } else {
    log(`Login flow did not return an external URL: ${reason}`);
  }

  return { ...result, deviceCodeCopied, loginPageOpened };
}

async function openAntigravityLogin(): Promise<void> {
  log("Opening Antigravity official login entrypoint");
  if (process.env.CAM_DISABLE_EXTERNAL_OPEN === "1") {
    log("Antigravity login opening skipped by CAM_DISABLE_EXTERNAL_OPEN");
    return;
  }
  try {
    await shell.openExternal("antigravity://auth");
    return;
  } catch {
    const exePath = process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Programs", "antigravity", "Antigravity.exe")
      : null;
    if (exePath && fs.existsSync(exePath)) {
      const error = await shell.openPath(exePath);
      if (error) throw new Error(error);
      return;
    }
    await openExternalUrl("https://antigravity.google/download", "antigravity-login-fallback");
  }
}

async function startAntigravityGoogleLogin(): Promise<AntigravityImportResult> {
  if (antigravityGoogleLoginInFlight) {
    throw new Error("Antigravity Google login is already running");
  }
  const task = (async () => {
    try {
      log("Starting Antigravity Google OAuth login");
      const oauth = await runAntigravityGoogleOAuthFlow({
        env: process.env,
        openExternal: (url) => openExternalUrl(url, "antigravity-google-oauth"),
        requestTimeoutMs: 20_000,
        resolveAccountContext: true,
        onStep: (step) => {
          log(`Antigravity Google OAuth step: ${step}`);
          mainWindow?.webContents.send("antigravity:oauth-step", step);
        }
      });
      const imported = await requireManager().importAntigravityGoogleOAuth(oauth, {
        platform: process.platform,
        appData: process.env.APPDATA,
        home: process.env.USERPROFILE
      });
      log(`Antigravity Google OAuth login completed for ${imported.account?.email ?? "unknown"}`);
      mainWindow?.webContents.send("accounts:updated");
      updateTrayMenu();
      return imported;
    } catch (error) {
      log("Antigravity Google OAuth login failed", error);
      throw error;
    }
  })();
  antigravityGoogleLoginInFlight = task.finally(() => {
    antigravityGoogleLoginInFlight = null;
  });
  return task;
}

async function startAntigravityGoogleOAuthSession() {
  const sessionId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const authorization = await createAntigravityGoogleOAuthAuthorization({
    env: process.env,
    timeoutMs: 10 * 60_000
  });
  antigravityGoogleOAuthSessions.set(sessionId, { authorization, expiresAt });
  mainWindow?.webContents.send("antigravity:oauth-step", "callback_server_ready");
  try {
    await openExternalUrl(authorization.authUrl, "antigravity-google-oauth");
    mainWindow?.webContents.send("antigravity:oauth-step", "browser_opened");
  } catch (error) {
    log("Antigravity Google OAuth browser open failed; auth URL remains copyable", error);
  }
  void authorization.waitForCallback
    .then((callback) => completeAntigravityGoogleOAuthSession(sessionId, callback))
    .catch((error) => {
      if (antigravityGoogleOAuthSessions.has(sessionId)) {
        log("Antigravity Google OAuth callback wait failed", error);
        mainWindow?.webContents.send("antigravity:oauth-step", "callback_failed");
      }
    });
  return {
    sessionId,
    authUrl: authorization.authUrl,
    redirectUri: authorization.redirectUri,
    expiresAt
  };
}

function emitAntigravityOAuthResult(result: AntigravityImportResult): void {
  mainWindow?.webContents.send("accounts:updated");
  mainWindow?.webContents.send("antigravity:oauth-result", toRendererDto(result));
  updateTrayMenu();
}

function emitAntigravityOAuthError(error: unknown): void {
  const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
  mainWindow?.webContents.send("antigravity:oauth-error", `Antigravity Google вход не завершился: ${message}`);
}

function completeAntigravityGoogleOAuthSession(
  sessionId: string,
  callback: { code: string; state: string }
): Promise<AntigravityImportResult> {
  const session = antigravityGoogleOAuthSessions.get(sessionId);
  if (!session) throw new Error("Antigravity Google OAuth session was not found or has expired");
  if (session.completion) return session.completion;

  session.completion = (async () => {
    try {
      log("Antigravity Google OAuth step: callback_received");
      mainWindow?.webContents.send("antigravity:oauth-step", "callback_received");
      const oauth = await finishAntigravityGoogleOAuthAuthorization({
        authorization: session.authorization,
        callback,
        requestTimeoutMs: 20_000,
        resolveAccountContext: true,
        onStep: (step) => {
          log(`Antigravity Google OAuth step: ${step}`);
          mainWindow?.webContents.send("antigravity:oauth-step", step);
        }
      });
      const imported = await requireManager().importAntigravityGoogleOAuth(oauth, {
        platform: process.platform,
        appData: process.env.APPDATA,
        home: process.env.USERPROFILE
      });
      log(`Antigravity Google OAuth login completed for ${imported.account?.email ?? "unknown"}`);
      emitAntigravityOAuthResult(imported);
      return imported;
    } catch (error) {
      log("Antigravity Google OAuth session failed", error);
      mainWindow?.webContents.send("antigravity:oauth-step", "failed");
      emitAntigravityOAuthError(error);
      throw error;
    } finally {
      antigravityGoogleOAuthSessions.delete(sessionId);
      await session.authorization.close();
    }
  })();

  return session.completion;
}

async function finishAntigravityGoogleOAuthSession(input: { sessionId: string; callbackUrl?: string | null }): Promise<AntigravityImportResult> {
  const session = antigravityGoogleOAuthSessions.get(input.sessionId);
  if (!session) throw new Error("Antigravity Google OAuth session was not found or has expired");
  if (session.completion && !input.callbackUrl?.trim()) return session.completion;
  const callback = input.callbackUrl?.trim()
    ? parseAntigravityGoogleOAuthCallbackUrl(input.callbackUrl)
    : await session.authorization.waitForCallback;
  return completeAntigravityGoogleOAuthSession(input.sessionId, callback);
}

async function cancelAntigravityGoogleOAuthSession(sessionId: string): Promise<void> {
  const session = antigravityGoogleOAuthSessions.get(sessionId);
  antigravityGoogleOAuthSessions.delete(sessionId);
  await session?.authorization.close();
}

function safeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function isTrustedRendererUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      return path.normalize(fileURLToPath(parsed)).toLowerCase() === path.normalize(path.join(__dirname, "../renderer/index.html")).toLowerCase();
    }
    return isDevelopmentRuntime && parsed.origin === "http://127.0.0.1:5173";
  } catch {
    return false;
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? event.sender.getURL();
  if (!isTrustedRendererUrl(url)) {
    log(`Rejected IPC from untrusted renderer: ${safeUrlForLog(url)}`);
    throw new Error("Untrusted renderer");
  }
}

function registerIpc(appDataDir: string): void {
  const handle = <Args extends unknown[], Result>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>
  ) => {
    ipcMain.handle(channel, async (event, ...args: Args) => {
      assertTrustedSender(event);
      try {
        const readOrWindow = [
          "accounts:list", "app:getInfo", "app:diagnostics", "workspace:getBinding", "switch:history", "switch:transactions",
          "limits:history", "logs:tail", "profiles:integrity", "accounts:quota:state", "accounts:update",
          "antigravity:diagnostics", "antigravity:profileStatus", "antigravity:inspectProfile",
          "window:minimize", "window:toggleMaximize", "window:close", "window:showMain", "tray:hidePopover", "tray:getPlatform"
        ].includes(channel);
        if (!servicesReady && !readOrWindow) throw new Error(startupError ?? "Квессер is preparing recovery. Try again after initialization.");
        if (probeIsolation.enabled && !readOrWindow) assertProbeOperationAllowed("external-app", probeIsolation);
        return toRendererDto(await listener(event, ...args));
      } catch (error) {
        log(`IPC ${channel} failed`, error);
        throw error;
      }
    });
  };

  registerHealthIpc(
    new DiagnosticsService({
      appDataDir,
      codexHome: getDefaultCodexHome(),
      logPath,
      resolveCodexPath: async () => runtimeDiscovery.codexPath,
      resolveCodexDesktopPath: () => runtimeDiscovery.codexDesktopPath,
      getSchemaVersion: () => manager?.getSchemaVersion() ?? 0,
      isVaultDegraded: () => vault?.isDegraded() ?? true
    }),
    assertTrustedSender
  );
  handle("accounts:list", () => {
    return requireManager().list();
  });
  handle("app:getInfo", () => ({
    name: productName,
    publisher: publisherName,
    version: appVersion,
    vaultDegraded: vault?.isDegraded() ?? true
  }));
  handle("accounts:login:start", async (_event, input) => {
    const parsed = loginStartInputSchema.parse(input);
    log(`Starting login flow: ${parsed.type}`);
    const result = await requireManager().startLogin(parsed);
    return prepareLoginHandoff(result, `login:${parsed.type}`);
  });
  handle("accounts:reauth:start", async (_event, input) => {
    const parsed = reauthenticateAccountInputSchema.parse(input);
    log(`Starting reauthentication flow: ${parsed.type} for ${parsed.accountId}`);
    const request = parsed.type === "apiKey" || parsed.type === "enterpriseAccessToken"
      ? { type: parsed.type, credential: parsed.credential } as const
      : { type: parsed.type } as const;
    const result = await requireManager().reauthenticateAccount(parsed.accountId, request);
    return prepareLoginHandoff(result, `reauth:${parsed.type}`);
  });
  handle("accounts:deviceCode:copy", (_event, input) => {
    const parsed = deviceCodeActionInputSchema.parse(input);
    deviceCodeHandoff.copy(parsed.userCode);
    return { copied: true };
  });
  handle("accounts:deviceCode:open", async (_event, input) => {
    const parsed = deviceCodeOpenInputSchema.parse(input);
    deviceCodeHandoff.copy(parsed.userCode);
    await openExternalUrl(parsed.url, "device-code-reopen");
    return { copied: true, opened: true };
  });
  handle("accounts:importCurrentCodexSession", async () => {
    log("Importing current local Codex session from ~/.codex");
    const result = await requireManager().importCurrentCodexSession();
    if (result.imported) {
      mainWindow?.webContents.send("accounts:updated");
      updateTrayMenu();
    }
    return result;
  });
  handle("accounts:importCurrentAntigravitySession", async () => {
    const result = await requireManager().importCurrentAntigravitySession();
    if (result.imported) {
      mainWindow?.webContents.send("accounts:updated");
      updateTrayMenu();
    }
    return result;
  });
  handle("accounts:detectLocalSessions", () => {
    return requireManager().detectLocalSessions();
  });
  handle("accounts:refresh", async (_event, input) => {
    const parsed = accountActionInputSchema.parse(input);
    log(`Refreshing account: ${parsed.accountId}`);
    syncActiveCodexSession("accounts:refresh");
    await syncActiveAntigravitySession("accounts:refresh");
    const account = await requireManager().refreshAccount(parsed.accountId);
    broadcastAccountsUpdated();
    updateTrayMenu();
    return account;
  });
  handle("accounts:auth:validate", (_event, input) => {
    const parsed = validateAuthInputSchema.parse(input);
    log("Validating account authorization state");
    return requireManager().validateAuth(parsed.accountId);
  });
  handle("accounts:quota:state", (_event, input) => {
    const parsed = quotaStateInputSchema.parse(input);
    const activeManager = requireManager();
    const account = activeManager.list().find((item) => item.id === parsed.accountId);
    if (!account) throw new Error("Account not found");
    return createProviderRuntimeAdapters(activeManager)[account.platform].getQuotaState(parsed.accountId);
  });
  handle("accounts:refreshAll", () => refreshAllRateLimits("manual"));
  handle("accounts:warmupAll", () => { throw new Error("Quota refresh does not run inference"); });
  handle("accounts:warmup", () => { throw new Error("Quota refresh does not run inference"); });
  handle("accounts:export", async (_event, passphrase: string) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const options: Electron.SaveDialogOptions = {
      title: "Export ChatGPT accounts",
      defaultPath: `egoist-account-manager-accounts-${stamp}.cam-export`,
      filters: [{ name: "Квессер export", extensions: ["cam-export"] }]
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { exportedCount: 0, filePath: "" };
    const exported = await requireManager().exportAccounts(result.filePath, passphrase);
    log(`Exported ${exported.exportedCount} account(s) to ${exported.filePath}`);
    return exported;
  });
  const previewImportFile = async (passphrase: string) => {
    z.string().min(12).max(4096).parse(passphrase);
    const options: Electron.OpenDialogOptions = { title: "Импорт профилей Квессер",
      properties: ["openFile"], filters: [{ name: "Квессер export", extensions: ["cam-export", "json"] }] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : requireManager().previewImport(result.filePaths[0], passphrase);
  };
  handle("accounts:import:preview", (_event, passphrase: string) => previewImportFile(passphrase));
  handle("accounts:import:apply", async (_event, input) => {
    const parsed = z.object({ previewId: z.string().uuid() }).strict().parse(input);
    const imported = await requireManager().applyImport(parsed.previewId);
    broadcastAccountsUpdated();
    return imported;
  });
  handle("accounts:import", async (_event, passphrase: string) => {
    const preview = await previewImportFile(passphrase);
    if (!preview) return { importedCount: 0, skippedCount: 0, accounts: requireManager().list() };
    return requireManager().applyImport(preview.previewId);
  });
  handle("accounts:runtime:verify", (_event, input) => {
    const parsed = accountActionInputSchema.parse(input);
    return requireManager().verifyRuntimeAccount(parsed.accountId);
  });
  handle("accounts:profileFolder:open", async (_event, input) => {
    const parsed = accountActionInputSchema.parse(input);
    const profileDir = requireManager().getProfileFolder(parsed.accountId);
    log(`Opening account profile folder: ${profileDir}`);
    const error = await shell.openPath(profileDir);
    if (error) throw new Error(error);
  });
  handle("switch:prepare", (_event, input) => {
    const parsed = accountActionInputSchema.parse(input);
    log(`Preparing switch transaction for account: ${parsed.accountId}`);
    return requireManager().prepareSwitchAccount(parsed.accountId);
  });
  handle("switch:cancel", (_event, input) => {
    const parsed = switchTransactionActionInputSchema.parse(input);
    log(`Cancelling switch transaction: ${parsed.transactionId}`);
    return requireManager().cancelSwitch(parsed.transactionId);
  });
  handle("switch:transactions", () => requireManager().listSwitchTransactions());
  handle("accounts:switch", async (_event, input) => {
    const parsed = switchAccountInputSchema.parse(input);
    log(`Switching active account: ${parsed.accountId}`);
    try {
      const account = await requireManager().switchAccount(parsed.accountId, parsed.transactionId);
      return account;
    } finally {
      broadcastAccountsUpdated();
      updateTrayMenu();
    }
  });
  handle("accounts:delete", async (_event, input) => {
    const parsed = accountActionInputSchema.parse(input);
    log(`Deleting account: ${parsed.accountId}`);
    await requireManager().deleteAccount(parsed.accountId);
    updateTrayMenu();
  });
  handle("workspace:bindAccount", (_event, input) => {
    const parsed = workspaceBindingInputSchema.parse(input);
    return requireManager().bindWorkspaceAccount(parsed.accountId);
  });
  handle("workspace:getBinding", () => requireManager().getWorkspaceBinding());
  handle("switch:history", () => requireManager().getSwitchHistory());
  handle("limits:history", (_event, input) => {
    const parsed = accountActionInputSchema.parse(input);
    return requireManager().getLimitHistory(parsed.accountId);
  });
  handle("switch:rollback", async (_event, input) => {
    const parsed = switchEventInputSchema.parse(input);
    log(`Rolling back switch event: ${parsed.eventId}`);
    const history = await requireManager().rollbackSwitch(parsed.eventId);
    updateTrayMenu();
    mainWindow?.webContents.send("accounts:updated");
    return history;
  });
  handle("logs:tail", () => readLogTail());
  handle("logs:openFolder", async () => {
    if (!logPath) throw new Error("Log path is not ready");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const error = await shell.openPath(path.dirname(logPath));
    if (error) throw new Error(error);
  });
  handle("crashReports:openFolder", async () => {
    const crashDir = getCrashReportsDir(appDataDir);
    fs.mkdirSync(crashDir, { recursive: true });
    const error = await shell.openPath(crashDir);
    if (error) throw new Error(error);
  });
  handle("profiles:integrity", () => requireManager().getProfileIntegrity());
  handle("release:readiness", () => createReleaseService().getReadiness());
  handle("release:checkUpdates", () => updaterService?.checkForUpdates() ?? createReleaseService().checkForUpdates());
  handle("release:openUpdate", () => updaterService?.openUpdateRelease() ?? createReleaseService().checkForUpdates());
  handle("release:openFolder", async () => {
    const releaseDir = createReleaseService().getReleaseDir();
    fs.mkdirSync(releaseDir, { recursive: true });
    const error = await shell.openPath(releaseDir);
    if (error) throw new Error(error);
  });
  handle("diagnostics:exportReport", async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const options: Electron.SaveDialogOptions = {
      title: "Сохранить отчёт диагностики",
      defaultPath: `egoist-account-manager-diagnostics-${stamp}.json`,
      filters: [{ name: "Diagnostic JSON", extensions: ["json"] }]
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { filePath: "" };
    const report = await buildDiagnosticReport(appDataDir);
    fs.writeFileSync(result.filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    log(`Diagnostic report exported: ${result.filePath}`);
    return { filePath: result.filePath };
  });
  handle("accounts:update", (_event, input: Parameters<AccountManager["updateAccount"]>[0]) => requireManager().updateAccount(input));
  handle("app:diagnostics", () => getCurrentDiagnostics(appDataDir));
  handle("antigravity:diagnostics", () => getAntigravityDiagnostics({
    platform: process.platform,
    appData: process.env.APPDATA,
    home: process.env.USERPROFILE
  }));
  handle("antigravity:profileStatus", () => getAntigravityProfileStatus({
    platform: process.platform,
    appData: process.env.APPDATA,
    home: process.env.USERPROFILE
  }));
  handle("antigravity:inspectProfile", () => inspectAntigravityProfile({
    platform: process.platform,
    appData: process.env.APPDATA,
    home: process.env.USERPROFILE
  }));
  handle("antigravity:importFromIde", () => {
    return requireManager().importAntigravityFromIde({
      platform: process.platform,
      appData: process.env.APPDATA,
      home: process.env.USERPROFILE
    }).then((result) => {
      if (result.imported) log(`Imported Antigravity local profile metadata: ${result.identity?.email ?? result.identity?.accountId ?? "unknown"}`);
      mainWindow?.webContents.send("accounts:updated");
      return result;
    });
  });
  handle("antigravity:openLogin", () => openAntigravityLogin());
  handle("antigravity:googleLogin", () => startAntigravityGoogleLogin());
  handle("antigravity:googleOAuth:start", () => startAntigravityGoogleOAuthSession());
  handle("antigravity:googleOAuth:finish", (_event, input) => {
    const parsed = antigravityOAuthFinishInputSchema.parse(input);
    return finishAntigravityGoogleOAuthSession(parsed);
  });
  handle("antigravity:googleOAuth:cancel", (_event, input) => {
    const parsed = antigravityOAuthCancelInputSchema.parse(input);
    return cancelAntigravityGoogleOAuthSession(parsed.sessionId);
  });
  handle("antigravity:credentials:importPayload", (_event, input) => {
    const parsed = antigravityCredentialPayloadImportInputSchema.parse(input);
    return requireManager().importAntigravityCredentialPayload(parsed, {
      platform: process.platform,
      appData: process.env.APPDATA,
      home: process.env.USERPROFILE
    }).then((result) => {
      if (result.importedCount > 0) {
        log(`Imported Antigravity credential payload account(s): ${result.importedCount}`);
        mainWindow?.webContents.send("accounts:updated");
        updateTrayMenu();
      }
      return result;
    });
  });
  handle("antigravity:credentials:importFiles", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Import Antigravity token or account JSON",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Antigravity JSON", extensions: ["json", "txt"] }]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { importedCount: 0, failedCount: 0, imported: [], failures: [], accounts: requireManager().list() };
    }
    const payloads = result.filePaths.flatMap((filePath) => {
      try {
        const stats = fs.statSync(filePath);
        if (!stats.isFile() || stats.size <= 0 || stats.size > 2_000_000) {
          return [{ payload: "", source: filePath, fileName: path.basename(filePath) }];
        }
        return [{ payload: fs.readFileSync(filePath, "utf8"), source: filePath, fileName: path.basename(filePath) }];
      } catch {
        return [{ payload: "", source: filePath, fileName: path.basename(filePath) }];
      }
    }).filter((payload) => payload.payload.trim().length > 0);
    const imported = await requireManager().importAntigravityCredentialPayloads(payloads, {
      platform: process.platform,
      appData: process.env.APPDATA,
      home: process.env.USERPROFILE
    });
    if (imported.importedCount > 0) {
      log(`Imported Antigravity credential file account(s): ${imported.importedCount}`);
      mainWindow?.webContents.send("accounts:updated");
      updateTrayMenu();
    }
    return imported;
  });
  handle("antigravity:credentials:importExternal", (_event, input) => {
    const parsed = antigravityExternalImportInputSchema.parse(input);
    return requireManager().importAntigravityExternalSource(parsed.source, {
      platform: process.platform,
      appData: process.env.APPDATA,
      home: process.env.USERPROFILE,
      localAppData: process.env.LOCALAPPDATA
    }).then((result) => {
      if (result.importedCount > 0) {
        log(`Imported Antigravity external source account(s): ${result.importedCount} from ${parsed.source}`);
        mainWindow?.webContents.send("accounts:updated");
        updateTrayMenu();
      }
      return result;
    });
  });
  handle("antigravity:godMode:get", () => ({ supported: false, enabled: false, reason: "Unavailable in Egoist" }));
  handle("antigravity:godMode:set", () => { throw new Error("GodMode is unavailable in Egoist"); });
  handle("antigravity:fingerprint:regenerate", () => { throw new Error("Fingerprint manipulation is unavailable in Egoist"); });
  handle("antigravity:hygiene:clean", () => {
    const result = performAntigravityHygiene({
      platform: process.platform,
      appData: process.env.APPDATA,
      home: process.env.USERPROFILE
    });
    log(`Antigravity Context Hygiene completed: ${result.cleanedLocks.length} locks, ${result.cleanedCaches.length} caches freed (${result.freedBytes} bytes)`);
    return result;
  });
  handle("app:openExternal", (_event, input) => {
    const parsed = openExternalInputSchema.parse(input);
    return openExternalUrl(parsed.url, "manual-open");
  });
  handle("app:workspace:select", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Выбери рабочую папку Codex",
      properties: ["openDirectory", "createDirectory"]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (!result.canceled && result.filePaths[0]) {
      requireManager().setWorkspacePath(result.filePaths[0]);
      log(`Workspace path updated: ${result.filePaths[0]}`);
    }
    return getCurrentDiagnostics(appDataDir);
  });
  handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  handle("window:toggleMaximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  handle("window:showMain", () => {
    hideTrayHoverPopover();
    trayPopoverWindow?.hide();
    showMainWindow();
  });
  handle("tray:hidePopover", (event) => {
    const source = BrowserWindow.fromWebContents(event.sender);
    if (source && source === trayPopoverWindow) source.hide();
  });
  handle("tray:getPlatform", (event) => {
    if (trayHoverWindow && !trayHoverWindow.isDestroyed() && event.sender === trayHoverWindow.webContents) {
      return currentHoverPlatform;
    }
    return currentPopoverPlatform;
  });
}

function showMainWindow(): void {
  hideTrayHoverPopover();
  if (!mainWindow) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function broadcastAccountsUpdated(): void {
  for (const window of [mainWindow, trayPopoverWindow, trayHoverWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("accounts:updated");
  }
}

function publishInAppNotification(payload: AppNotificationPayload): void {
  const safePayload: AppNotificationPayload = {
    ...payload,
    title: redactSensitiveText(payload.title),
    body: redactSensitiveText(payload.body)
  };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("app:notification", safePayload);
}

function publishQuotaAlerts(accounts: ManagedAccount[]): void {
  const settings = settingsService?.get();
  const alerts = quotaAlertService?.evaluate(accounts, settings?.smartSwitchThresholdPercent ?? 10) ?? [];
  for (const alert of alerts) {
    const payload = inAppNotificationService.take(buildQuotaNotification(alert, settings?.language === "en"));
    if (payload) publishInAppNotification(payload);
  }
}

function createLiveTrayImage(platform?: "codex" | "antigravity"): Electron.NativeImage {
  const settings = settingsService?.get();
  const snapshot = buildLiveTraySnapshot(manager?.list() ?? [], {
    privacyMode: settings?.privacyMode,
    language: settings?.language
  }, platform);
  const image = nativeImage.createEmpty();
  const theme = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? "dark" : "light";
  for (const representation of LIVE_TRAY_REPRESENTATIONS) {
    image.addRepresentation({
      width: representation.pixelSize,
      height: representation.pixelSize,
      scaleFactor: representation.scaleFactor,
      buffer: Buffer.from(renderLiveTrayBitmap(snapshot, representation.pixelSize, platform, theme))
    });
  }
  return image.isEmpty() ? nativeImage.createFromPath(getWindowIconPath()) : image;
}

function loadTraySurface(window: BrowserWindow, surface: "tray" | "tray-hover"): void {
  const packagedRendererPath = path.join(__dirname, "../renderer/index.html");
  if (isDevelopmentRuntime) {
    void window.loadURL(`http://127.0.0.1:5173/?surface=${surface}`).catch((error) => {
      log("Failed to load tray dev renderer, falling back to packaged renderer", error);
      if (fs.existsSync(packagedRendererPath)) void window.loadFile(packagedRendererPath, { query: { surface } });
    });
    return;
  }
  void window.loadFile(packagedRendererPath, { query: { surface } }).catch((error) => log("Failed to load tray renderer", error));
}

function createTrayPopoverWindow(): BrowserWindow {
  if (trayPopoverWindow && !trayPopoverWindow.isDestroyed()) return trayPopoverWindow;
  const window = new BrowserWindow({
    width: 310,
    height: 192,
    minWidth: 310,
    minHeight: 192,
    maxWidth: 310,
    maxHeight: 192,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    title: `${productName} · Live`,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  window.on("blur", () => window.hide());
  window.on("closed", () => {
    if (trayPopoverWindow === window) trayPopoverWindow = null;
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  loadTraySurface(window, "tray");
  trayPopoverWindow = window;
  return window;
}

function createTrayHoverWindow(): BrowserWindow {
  if (trayHoverWindow && !trayHoverWindow.isDestroyed()) return trayHoverWindow;
  const window = new BrowserWindow({
    width: 310,
    height: 142,
    minWidth: 310,
    minHeight: 142,
    maxWidth: 310,
    maxHeight: 142,
    show: false,
    frame: false,
    transparent: true,
    focusable: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    title: `${productName} · Hover`,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  window.setIgnoreMouseEvents(true);
  window.on("closed", () => {
    if (trayHoverWindow === window) trayHoverWindow = null;
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  loadTraySurface(window, "tray-hover");
  trayHoverWindow = window;
  return window;
}

function updateTraySurfaceSize(window: BrowserWindow, isHover: boolean): void {
  if (isHover) {
    window.setContentSize(310, 142);
  } else {
    window.setContentSize(310, 192);
  }
}

function positionTraySurface(window: BrowserWindow, anchor: TrayAnchor, gap: number): void {
  const { bounds } = anchor;
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const position = calculateTraySurfacePosition(bounds, window.getBounds(), display.workArea, gap);
  window.setPosition(position.x, position.y, false);
}

function openTrayPopover(anchor: TrayAnchor, toggle = false): void {
  taskbarContextMenu?.closePopup();
  hideTrayHoverPopover();
  const window = createTrayPopoverWindow();
  const request = ++trayPopoverRequest;
  if (toggle && window.isVisible() && currentPopoverPlatform === anchor.platform) {
    window.hide();
    return;
  }

  currentPopoverPlatform = anchor.platform;
  updateTraySurfaceSize(window, false);
  const show = () => {
    if (window.isDestroyed() || request !== trayPopoverRequest) return;
    positionTraySurface(window, anchor, 10);
    window.webContents.send("tray:platform", anchor.platform);
    window.webContents.send("accounts:updated");
    window.show();
    window.focus();
  };
  if (window.webContents.isLoadingMainFrame()) window.webContents.once("did-finish-load", show);
  else show();
}

function clearTrayHoverTimers(): void {
  if (trayHoverShowTimer) clearTimeout(trayHoverShowTimer);
  if (trayHoverHideTimer) clearTimeout(trayHoverHideTimer);
  trayHoverShowTimer = null;
  trayHoverHideTimer = null;
}

function hideTrayHoverPopover(): void {
  trayHoverTarget = null;
  clearTrayHoverTimers();
  if (trayHoverWindow && !trayHoverWindow.isDestroyed()) trayHoverWindow.hide();
}

function showTrayHoverPopover(anchor: TrayAnchor): void {
  if (trayHoverTarget !== anchor || trayPopoverWindow?.isVisible() || taskbarContextMenu) return;
  currentHoverPlatform = anchor.platform;
  const window = createTrayHoverWindow();
  updateTraySurfaceSize(window, true);
  const show = () => {
    if (trayHoverTarget !== anchor || window.isDestroyed()) return;
    positionTraySurface(window, anchor, 8);
    window.webContents.send("tray:platform", anchor.platform);
    window.webContents.send("accounts:updated");
    window.showInactive();
  };
  if (window.webContents.isLoadingMainFrame()) window.webContents.once("did-finish-load", show);
  else show();
}

function scheduleTrayHoverShow(anchor: TrayAnchor): void {
  clearTrayHoverTimers();
  trayHoverTarget = anchor;
  if (trayHoverWindow?.isVisible()) {
    if (currentHoverPlatform !== anchor.platform) showTrayHoverPopover(anchor);
    return;
  }
  trayHoverShowTimer = setTimeout(() => {
    trayHoverShowTimer = null;
    showTrayHoverPopover(anchor);
  }, trayHoverDwellMs);
}

function scheduleTrayHoverHide(): void {
  trayHoverTarget = null;
  clearTrayHoverTimers();
  trayHoverHideTimer = setTimeout(() => {
    trayHoverHideTimer = null;
    trayHoverWindow?.hide();
  }, trayHoverExitMs);
}

function platformTrayItems(anchor: TrayAnchor, accounts: ManagedAccount[], settings: AppSettings): MenuItemConstructorOptions[] {
  const { platform } = anchor;
  const providerName = platform === "codex" ? "Codex" : "Antigravity";
  const isEnglish = settings.language === "en";
  const profiles = accounts.filter((account) => (account.platform ?? "codex") === platform);
  const active = profiles.find((account) => account.isActive);
  const recommendation = selectSmartAccount(profiles, manager?.getWorkspaceBinding(), { provider: platform });
  const best = recommendation ? profiles.find((account) => account.id === recommendation.accountId) : null;
  const switchProfile = (accountId: string) => {
    void manager?.switchAccount(accountId).catch((error) => log(`${providerName} switch failed`, error)).finally(updateTrayMenu);
  };
  const bestLabel = settings.privacyMode ? (isEnglish ? `${providerName} profile` : `профиль ${providerName}`) : best?.label;
  return [
    { label: isEnglish ? `Open ${providerName} quota` : `Лимит ${providerName}`, click: () => openTrayPopover(anchor) },
    {
      label: active
        ? (settings.privacyMode
          ? (isEnglish ? `${providerName} profile selected` : `Выбранный профиль ${providerName}`)
          : `${providerName}: ${active.label}`)
        : (isEnglish ? `No ${providerName} profile selected` : `Профиль ${providerName} не выбран`),
      enabled: false
    },
    { type: "separator" },
    {
      label: best
        ? (isEnglish ? `Smart Switch: ${bestLabel}` : `Умный выбор: ${bestLabel}`)
        : (isEnglish ? "Smart switch unavailable" : "Умный выбор недоступен"),
      enabled: Boolean(best && !best.isActive),
      click: () => { if (best) switchProfile(best.id); }
    },
    {
      label: isEnglish ? `${providerName} Accounts` : `Аккаунты ${providerName}`,
      enabled: profiles.length > 0,
      submenu: profiles.slice(0, 12).map((account) => ({
        label: buildTrayAccountLabel(account, settings.privacyMode, settings.language),
        enabled: account.credentialState === "ready" && (!account.isActive || account.runtimeVerification?.runtime !== "verified"),
        click: () => switchProfile(account.id)
      }))
    }
  ];
}

function commonTrayItems(accounts: ManagedAccount[], settings: AppSettings): MenuItemConstructorOptions[] {
  const isEnglish = settings.language === "en";
  return [
    { type: "separator" },
    {
      label: isEnglish ? "Refresh Quotas" : "Обновить лимиты",
      enabled: accounts.length > 0,
      click: () => void refreshAllRateLimits("manual").finally(updateTrayMenu)
    },
    { label: isEnglish ? "Open Manager" : "Открыть окно", click: showMainWindow },
    { label: isEnglish ? "Quit" : "Выход", click: () => app.quit() }
  ];
}

function setTrayMenu(icon: Tray, platform: AccountPlatform, accounts: ManagedAccount[], settings: AppSettings): void {
  const items = platformTrayItems({ platform, bounds: icon.getBounds() }, accounts, settings);
  icon.setContextMenu(Menu.buildFromTemplate([...items, ...commonTrayItems(accounts, settings)]));
}

function destroyTrayIcons(): void {
  const icons = [tray, antigravityTray];
  tray = null;
  antigravityTray = null;
  for (const icon of icons) icon?.destroy();
}

function createTrayIcon(platform: AccountPlatform): Tray {
  const windows = process.platform === "win32";
  const icon = new Tray(windows ? nativeImage.createFromPath(getWindowIconPath()) : createLiveTrayImage(platform));
  const anchor = () => ({ platform, bounds: icon.getBounds() });
  icon.setToolTip(windows ? productName : "");
  const onHover = () => scheduleTrayHoverShow(anchor());
  icon.on("mouse-enter", onHover);
  icon.on("mouse-move", onHover);
  icon.on("mouse-leave", scheduleTrayHoverHide);
  icon.on("click", () => openTrayPopover(anchor(), true));
  if (windows) {
    icon.on("right-click", () => {
      const settings = settingsService?.get();
      if (!settings || !manager) return;
      const accounts = manager.list();
      const bounds = icon.getBounds();
      const platforms = ["codex", "antigravity"] as const;
      const menu = Menu.buildFromTemplate([
        ...platforms.map((provider) => ({
          label: provider === "codex" ? "Codex" : "Antigravity",
          submenu: platformTrayItems({ platform: provider, bounds }, accounts, settings)
        })),
        ...commonTrayItems(accounts, settings)
      ]);
      icon.popUpContextMenu(menu);
    });
  }
  return icon;
}

function updateTrayMenu(): void {
  const settings = settingsService?.get();
  if (!settings?.trayEnabled || !manager || isQuitting) return;
  const accounts = manager.list();
  if (quotaTaskbarWidget) {
    const snapshots = buildDualLiveTraySnapshot(accounts, { language: settings.language, privacyMode: true });
    quotaTaskbarWidget.setState(
      buildTaskbarQuotaValue(snapshots.codex).text,
      buildTaskbarQuotaValue(snapshots.antigravity).text,
      nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? "dark" : "light"
    );
  }

  if (process.platform === "win32") {
    if (!taskbarWidgetReady && !tray) tray = createTrayIcon("codex");
    return;
  }

  tray ??= createTrayIcon("codex");
  tray.setImage(createLiveTrayImage("codex"));
  setTrayMenu(tray, "codex", accounts, settings);
  if (accounts.some((account) => account.platform === "antigravity")) {
    antigravityTray ??= createTrayIcon("antigravity");
    antigravityTray.setImage(createLiveTrayImage("antigravity"));
    setTrayMenu(antigravityTray, "antigravity", accounts, settings);
  } else {
    antigravityTray?.destroy();
    antigravityTray = null;
  }
}

function onTaskbarWidgetInput(event: TaskbarWidgetInput): void {
  if (!settingsService?.get().trayEnabled || isQuitting) return;
  if (event.type === "leave") {
    scheduleTrayHoverHide();
    return;
  }

  const point = screen.screenToDipPoint(event.point);
  const anchor = { platform: event.platform, bounds: { ...point, width: 1, height: 1 } };
  if (event.type === "enter") {
    scheduleTrayHoverShow(anchor);
  } else if (event.type === "click") {
    openTrayPopover(anchor, true);
  } else {
    hideTrayHoverPopover();
    const accounts = manager?.list() ?? [];
    const settings = settingsService.get();
    const menu = Menu.buildFromTemplate([
      ...platformTrayItems(anchor, accounts, settings), ...commonTrayItems(accounts, settings)
    ]);
    taskbarContextMenu?.closePopup();
    taskbarContextMenu = menu;
    const window = mainWindow ?? createTrayPopoverWindow();
    const content = window.getContentBounds();
    menu.popup({
      window,
      x: point.x - content.x,
      y: point.y - content.y,
      callback: () => { if (taskbarContextMenu === menu) taskbarContextMenu = null; }
    });
  }
}

function applyDesktopIntegrationSettings(settings: AppSettings): void {
  if (settings.trayEnabled) {
    if (process.platform === "win32" && !probeIsolation.enabled) {
      quotaTaskbarWidget ??= new QuotaTaskbarWidget(
        app.isPackaged
          ? path.join(process.resourcesPath, "KvesserQuotaWidget.exe")
          : path.join(app.getAppPath(), "build", "taskbar", "KvesserQuotaWidget.exe"),
        {
          onAvailability(available) {
            taskbarWidgetReady = available;
            taskbarContextMenu?.closePopup();
            hideTrayHoverPopover();
            if (available) destroyTrayIcons();
            else updateTrayMenu();
          },
          onInput: onTaskbarWidgetInput
        }
      );
    }
    updateTrayMenu();
    quotaTaskbarWidget?.start();
    broadcastAccountsUpdated();
  } else {
    quotaTaskbarWidget?.stop();
    taskbarContextMenu?.closePopup();
    hideTrayHoverPopover();
    trayHoverWindow?.destroy();
    trayHoverWindow = null;
    trayPopoverWindow?.destroy();
    trayPopoverWindow = null;
    destroyTrayIcons();
  }

  if (!probeIsolation.enabled && process.platform === "win32" && app.isPackaged) {
    const current = app.getLoginItemSettings({ path: process.execPath });
    if (current.openAtLogin !== settings.autostartEnabled) {
      app.setLoginItemSettings({ openAtLogin: settings.autostartEnabled, path: process.execPath });
    }
  }
}

function startAutoRefresh(intervalMs: AppSettings["autoRefreshIntervalMs"] = currentRateLimitRefreshIntervalMs): void {
  currentRateLimitRefreshIntervalMs = intervalMs;
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  if (probeIsolation.enabled) return;
  if (currentRateLimitRefreshIntervalMs <= 0) {
    log("Auto-refresh disabled");
    return;
  }
  autoRefreshTimer = setInterval(() => {
    void runAutoRefresh();
  }, currentRateLimitRefreshIntervalMs);
}

function startTrayRefresh(intervalMs: AppSettings["trayRefreshIntervalMs"] = currentTrayRefreshIntervalMs): void {
  currentTrayRefreshIntervalMs = intervalMs;
  if (trayRefreshTimer) clearInterval(trayRefreshTimer);
  trayRefreshTimer = null;
  if (probeIsolation.enabled) return;
  updateTrayMenu();
  if (settingsService?.get().trayEnabled !== true || intervalMs <= 0) {
    log("Live tray refresh disabled");
    return;
  }
  trayRefreshTimer = setInterval(() => {
    void refreshActiveTrayAccount("timer");
  }, intervalMs);
  log(`Live tray refresh interval: ${intervalMs}ms`);
}

async function refreshActiveTrayAccount(reason: "timer" | "resume" | "manual"): Promise<void> {
  if (probeIsolation.enabled) return;
  if (!manager || trayRefreshInFlight || autoRefreshInFlight) return;
  const minimumAgeSeconds = Math.max(15, Math.floor(currentTrayRefreshIntervalMs / 1000) - 5);
  const due = manager.list().filter((account) => account.isActive && (
    reason === "manual" || !account.lastRefreshAt
    || Math.floor(Date.now() / 1000) - account.lastRefreshAt >= minimumAgeSeconds
  ));
  if (!due.length) {
    updateTrayMenu();
    return;
  }
  trayRefreshInFlight = true;
  try {
    for (const active of due) {
      try {
        await manager.refreshAccount(active.id);
        log(`Live tray ${active.platform} quota refreshed: ${reason}`);
      } catch (error) {
        log(`Live tray ${active.platform} quota refresh failed: ${reason}`, error);
      }
    }
    publishQuotaAlerts(manager.list());
    broadcastAccountsUpdated();
    updateTrayMenu();
  } finally {
    trayRefreshInFlight = false;
  }
}

function syncActiveCodexSession(reason: string): void {
  if (!manager) return;
  try {
    const result = manager.syncActiveCodexSession();
    if (result.status === "updated" || result.status === "signed_out" || result.status === "unmanaged") {
      log(`Active Codex session snapshot updated: ${reason} (${result.status})`);
      broadcastAccountsUpdated();
      updateTrayMenu();
    }
  } catch (error) {
    log(`Active Codex session snapshot skipped: ${reason}`, error);
  }
}

let lastAntigravitySyncAt = 0;

async function syncActiveAntigravitySession(reason: string): Promise<void> {
  if (!manager) return;
  const now = Date.now();
  if (reason !== "startup" && reason !== "explicit" && now - lastAntigravitySyncAt < 10_000) {
    return;
  }
  lastAntigravitySyncAt = now;
  try {
    const result = await manager.syncActiveAntigravitySession();
    if (result.status === "updated" || result.status === "signed_out" || result.status === "unmanaged") {
      log(`Active Antigravity session snapshot updated: ${reason} (${result.status})`);
      broadcastAccountsUpdated();
      updateTrayMenu();
    }
  } catch (error) {
    log(`Active Antigravity session snapshot skipped: ${reason}`, error);
  }
}

async function syncActiveSessions(reason: string): Promise<void> {
  if (probeIsolation.enabled) return;
  syncActiveCodexSession(reason);
  await syncActiveAntigravitySession(reason);
}

let stateDbWatcher: fs.FSWatcher | null = null;
let agLogsWatcher: fs.FSWatcher | null = null;

function startSessionSnapshotSync(): void {
  if (probeIsolation.enabled) return;
  if (sessionSnapshotTimer) clearInterval(sessionSnapshotTimer);
  void syncActiveSessions("startup");
  sessionSnapshotTimer = setInterval(() => {
    void syncActiveSessions("periodic");
  }, 60_000);

  try {
    const appData = process.env.APPDATA || (process.platform === "win32" ? path.join(process.env.USERPROFILE || "C:\\Users\\Default", "AppData", "Roaming") : "");
    if (appData) {
      // 1. Watch Antigravity log directory (main.log contains port and csrf token for running language server)
      const agLogsDir = path.join(appData, "Antigravity", "logs");
      if (fs.existsSync(agLogsDir)) {
        let agDebounceTimer: NodeJS.Timeout | null = null;
        agLogsWatcher = fs.watch(agLogsDir, (_eventType, filename) => {
          if (!filename || filename.includes("main.log")) {
            if (agDebounceTimer) clearTimeout(agDebounceTimer);
            agDebounceTimer = setTimeout(() => {
              void syncActiveAntigravitySession("main-log-watch");
            }, 300);
          }
        });
      }

      // 2. Also watch legacy state.vscdb
      const storageDir = path.join(appData, "Antigravity IDE", "User", "globalStorage");
      if (fs.existsSync(storageDir)) {
        let debounceTimer: NodeJS.Timeout | null = null;
        stateDbWatcher = fs.watch(storageDir, (_eventType, filename) => {
          if (!filename || filename.includes("state.vscdb")) {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              void syncActiveAntigravitySession("vscdb-file-watch");
            }, 300);
          }
        });
      }
    }
  } catch (error) {
    log("State DB / Antigravity log file watcher setup skipped", error);
  }
}

async function runAutoRefresh(): Promise<void> {
  await refreshAllRateLimits("auto");
}

async function refreshAllRateLimits(reason: "auto" | "manual") {
  assertProbeOperationAllowed("provider-network", probeIsolation);
  if (!manager) return [];
  if (autoRefreshInFlight) {
    log(`Rate-limit refresh skipped because another refresh is already running: ${reason}`);
    return manager.list();
  }

  await syncActiveSessions(`pre-refresh-${reason}`);

  const accounts = manager.list();
  const trayActiveAccountId = trayRefreshInFlight
    ? accounts.find((account) => account.isActive)?.id ?? null
    : null;
  const excludedAccountIds = trayActiveAccountId ? new Set([trayActiveAccountId]) : undefined;
  const refreshableAccounts = trayActiveAccountId
    ? accounts.filter((account) => account.id !== trayActiveAccountId)
    : accounts;
  if (refreshableAccounts.length === 0) return accounts;
  autoRefreshInFlight = true;
  try {
    const beforeRefresh = new Map(accounts.map((account) => [account.id, {
      success: account.lastRefreshAt ?? null,
      error: account.lastRefreshErrorAt ?? null
    }]));
    log(`${reason === "auto" ? "Auto-refreshing" : "Refreshing"} account limits for ${refreshableAccounts.length} account(s)`);
    if (trayActiveAccountId) log(`Fleet refresh excludes active tray probe already in flight: ${trayActiveAccountId}`);
    const refreshed = await manager.refreshAllAccounts({ excludeAccountIds: excludedAccountIds });
    broadcastAccountsUpdated();
    const failedCount = refreshed.filter((account) => account.lastRefreshErrorAt != null && account.lastRefreshErrorAt !== beforeRefresh.get(account.id)?.error).length;
    const updatedCount = refreshed.filter((account) => account.lastRefreshAt != null && account.lastRefreshAt !== beforeRefresh.get(account.id)?.success).length;
    const skippedCount = Math.max(0, refreshed.length - failedCount - updatedCount);
    log(`${reason === "auto" ? "Auto-refresh" : "Manual refresh"} completed: updated=${updatedCount}, failed=${failedCount}, deferred=${skippedCount}`);
    const settings = settingsService?.get();
    const recommendation = selectSmartAccount(refreshed, manager.getWorkspaceBinding(), { staleAfterSeconds: 15 * 60, provider: "codex" });
    if (settings?.smartSwitchMode !== "off" && recommendation) {
      log(`Smart suggestion: ${recommendation.accountEmail}. Reason=${recommendation.reason}`);
    }
    publishQuotaAlerts(refreshed);
    updateTrayMenu();
    return refreshed;
  } catch (error) {
    log(`${reason === "auto" ? "Auto-refresh" : "Manual refresh"} failed`, error);
    throw error;
  } finally {
    autoRefreshInFlight = false;
  }
}

const gotLock = process.env.CAM_ALLOW_MULTIPLE_INSTANCE === "1" || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setName(productName);
  if (process.platform === "win32") {
    app.setAppUserModelId(appUserModelId);
  }

  if (process.env.CAM_USER_DATA_DIR) {
    app.setPath("userData", process.env.CAM_USER_DATA_DIR);
    if (probeIsolation.enabled) {
      app.setPath("sessionData", process.env.CAM_USER_DATA_DIR);
      const crashes = path.join(process.env.CAM_USER_DATA_DIR, "crash-dumps");
      fs.mkdirSync(crashes, { recursive: true });
      app.setPath("crashDumps", crashes);
    }
  } else {
    app.setPath("userData", resolveStoredUserData(app.getPath("appData")));
  }

  app.on("second-instance", () => {
    if (!mainWindow) {
      mainWindow = createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    let darkTray = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
    nativeTheme.on("updated", () => {
      if (darkTray === nativeTheme.shouldUseDarkColorsForSystemIntegratedUI) return;
      darkTray = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
      updateTrayMenu();
    });
    const appDataDir = getAppDataDir();
    logPath = path.join(appDataDir, "logs", "main.log");
    updaterService = new UpdaterService(
      () => mainWindow,
      log,
      {
        onUpdateAvailable: (result) => {
          if (!result.version) return;
          const payload = inAppNotificationService.take(
            buildUpdateNotification(result.version, settingsService?.get().language === "en")
          );
          if (payload) publishInAppNotification(payload);
        }
      }
    );
    registerIpc(appDataDir);

    try {
      const store = new AccountStore(appDataDir);
      vault = new Vault(appDataDir);
      const codexPath = null;
      log(`Resolved Codex CLI: ${codexPath ?? "not found"}`);
      settingsService = new SettingsService(store);
      quotaAlertService = new QuotaAlertService({
        readState: () => store.getSetting("quotaAlertState.v1"),
        writeState: (value) => store.setSetting("quotaAlertState.v1", value)
      });
      desktopLifecycleService = probeIsolation.enabled ? null : new WindowsDesktopLifecycleService();
      manager = new AccountManager(store, vault, appDataDir, codexPath, {
        readAntigravityCredentialStorePayload: readAntigravityCredentialStorePayloadAsync,
        writeAntigravityCredentialStoreToken: writeAntigravityCredentialStoreTokenAsync,
        restoreAntigravityCredentialStorePayload: async (snapshot) => {
          if (snapshot.existed) await writeAntigravityCredentialStorePayloadAsync(snapshot.value!);
          else await deleteAntigravityCredentialStorePayloadAsync();
          const actual = await readAntigravityCredentialStorePayloadAsync();
          if ((actual?.payload ?? null) !== (snapshot.existed ? snapshot.value : null)) throw new Error("Credential Manager rollback verification failed");
        },
        quiesceAntigravity: quiesceAntigravityAsync, launchAntigravity: launchAntigravityAsync,
        resolveAntigravitySwitchTarget,
        desktopLifecycle: desktopLifecycleService ?? undefined,
        getCodexQuotaReadOptions: () => cachedCodexQuotaReadOptions,
        getDesktopClosePolicy: () => settingsService?.get().desktopClosePolicy ?? "exact-tree-fallback"
      });
      currentRateLimitRefreshIntervalMs = settingsService.get().autoRefreshIntervalMs;
      currentTrayRefreshIntervalMs = settingsService.get().trayRefreshIntervalMs;
      registerSettingsIpc(settingsService, (settings) => {
        if (!servicesReady) return;
        startAutoRefresh(settings.autoRefreshIntervalMs);
        applyDesktopIntegrationSettings(settings);
        startTrayRefresh(settings.trayRefreshIntervalMs);
        log(`Auto-refresh interval updated: ${settings.autoRefreshIntervalMs}ms`);
      }, assertTrustedSender);
      manager.on("auth-event", (event) => {
        mainWindow?.webContents.send("auth:event", toRendererDto(event));
        const payload = inAppNotificationService.take(buildAuthNotification(event, settingsService?.get().language === "en"));
        if (payload) publishInAppNotification(payload);
      });
      manager.on("accounts-updated", () => {
        broadcastAccountsUpdated();
        updateTrayMenu();
      });
      manager.on("switch-transaction", (event) => {
        mainWindow?.webContents.send("switch:transaction", toRendererDto(event));
        const targetLabel = manager?.list().find((account) => account.id === event.transaction.targetAccountId)?.label ?? null;
        const payload = inAppNotificationService.take(buildSwitchNotification(
          event.transaction,
          targetLabel,
          settingsService?.get().language === "en"
        ));
        if (payload) publishInAppNotification(payload);
      });
      manager.on("log", (message) => log(String(message)));
      runtimeDiscoveryReady = probeIsolation.enabled ? Promise.resolve() : discoverCodexRuntime().then((result) => {
        runtimeDiscovery = result;
        manager?.setCodexPath(result.codexPath);
        codexCapabilityService = new CodexCapabilityService({ appDataDir, codexHome: getDefaultCodexHome(), codexPath: result.codexPath });
      }).catch((error) => log("Native discovery unavailable", error));
      mainWindow = createWindow();
      await runtimeDiscoveryReady;
      const reconciledSwitches = probeIsolation.enabled ? [] : await manager.recoverInterruptedSwitches();
      if (reconciledSwitches.length > 0) {
        log(`Reconciled ${reconciledSwitches.length} interrupted switch transaction(s)`);
      }
      const securedProfiles = manager.secureManagedProfileHomes();
      if (securedProfiles.sealed > 0 || securedProfiles.drifted > 0) {
        log(`Secured managed Codex profiles: sealed=${securedProfiles.sealed}, drifted=${securedProfiles.drifted}`);
      }
      const repairedAuths = manager.repairEncryptedAuthCache();
      if (repairedAuths > 0) log(`Recovered encrypted auth cache for ${repairedAuths} account profile(s)`);
      const repairedQuotaStates = manager.repairLegacyQuotaRefreshState();
      if (repairedQuotaStates > 0) log(`Separated ${repairedQuotaStates} legacy quota failure(s) from account authorization state`);
      servicesReady = true;
      if (!probeIsolation.enabled) void syncWindowsShortcutIconAsync({
        env: process.env, platform: process.platform, productName,
        sourceIcoPath: getWindowsShortcutIconSourcePath(), version: appVersion,
        executablePath: process.execPath, iconDirectory: path.join(appDataDir, "icons"), log
      }).catch((error) => log("Shortcut integration skipped", error));
      startSessionSnapshotSync();
      startAutoRefresh(currentRateLimitRefreshIntervalMs);
      applyDesktopIntegrationSettings(settingsService.get());
      startTrayRefresh(currentTrayRefreshIntervalMs);
      log("Application services initialized");
    } catch (error) {
      startupError = error instanceof Error ? error.message : String(error);
      log("Failed to initialize application services", error);
    }

    mainWindow ??= createWindow();
    if (!probeIsolation.enabled && app.isPackaged && process.env.CAM_DISABLE_AUTO_UPDATE !== "1") {
      setTimeout(() => {
        void updaterService?.checkForUpdates();
      }, 8_000);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
    powerMonitor.on("suspend", () => {
      hideTrayHoverPopover();
      syncActiveSessions("system-suspend");
    });
    powerMonitor.on("lock-screen", () => {
      hideTrayHoverPopover();
      syncActiveSessions("screen-lock");
    });
    powerMonitor.on("resume", () => {
      syncActiveSessions("system-resume");
      void refreshActiveTrayAccount("resume");
    });
  });

  app.on("child-process-gone", (_event, details) => {
    log(`Child process gone: ${details.type} ${details.reason}`);
  });

  process.on("uncaughtException", (error) => captureCrash("Uncaught exception", error));
  process.on("unhandledRejection", (reason) => captureCrash("Unhandled rejection", reason));

  app.on("before-quit", () => {
    isQuitting = true;
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    if (trayRefreshTimer) clearInterval(trayRefreshTimer);
    if (sessionSnapshotTimer) clearInterval(sessionSnapshotTimer);
    if (stateDbWatcher) {
      stateDbWatcher.close();
      stateDbWatcher = null;
    }
    if (agLogsWatcher) {
      agLogsWatcher.close();
      agLogsWatcher = null;
    }
    deviceCodeHandoff.dispose();
    syncActiveSessions("before-quit");
    quotaTaskbarWidget?.stop();
    taskbarContextMenu?.closePopup();
    destroyTrayIcons();
    hideTrayHoverPopover();
    trayHoverWindow?.destroy();
    trayHoverWindow = null;
    trayPopoverWindow?.destroy();
    trayPopoverWindow = null;
    void manager?.shutdown().catch((error) => log("Failed to stop Codex child processes", error));
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && settingsService?.get().trayEnabled !== true) app.quit();
  });
}
