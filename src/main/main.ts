import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { BrowserWindow, Menu, Notification, Tray, app, clipboard, dialog, ipcMain, powerMonitor, screen, shell, type IpcMainInvokeEvent } from "electron";
import { AccountStore } from "./db.js";
import { Vault } from "./security.js";
import { getAppDataDir, getDefaultCodexHome } from "./paths.js";
import { AccountManager, getDiagnostics } from "./accountManager.js";
import { resolveCodexDesktopPath, resolveCodexPath } from "./processManager.js";
import { DiagnosticsService } from "./services/diagnosticsService.js";
import { CodexCapabilityService } from "./services/codexCapabilityService.js";
import { SettingsService } from "./services/settingsService.js";
import { registerHealthIpc } from "./ipc/healthIpc.js";
import { registerSettingsIpc } from "./ipc/settingsIpc.js";
import type { AntigravityImportResult, AppDiagnostics, AppSettings, LoginStartResult } from "../shared/types.js";
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
import { appVersion } from "../shared/releaseNotes.js";
import { ReleaseService } from "./services/releaseService.js";
import { getCrashReportsDir, writeCrashReport } from "./services/crashReportService.js";
import { UpdaterService } from "./services/updaterService.js";
import { syncWindowsShortcutIcon } from "./services/windowsShortcutIconService.js";
import { getAntigravityDiagnostics } from "./services/antigravityPaths.js";
import { inspectAntigravityProfile } from "./services/antigravityProfileReader.js";
import { getAntigravityProfileStatus } from "./services/antigravityProfileService.js";
import {
  createAntigravityGoogleOAuthAuthorization,
  finishAntigravityGoogleOAuthAuthorization,
  parseAntigravityGoogleOAuthCallbackUrl,
  runAntigravityGoogleOAuthFlow,
  type AntigravityGoogleOAuthAuthorization
} from "./services/antigravityGoogleAuthService.js";
import { readAntigravityCredentialStorePayload, writeAntigravityCredentialStoreToken } from "./services/antigravityCredentialStore.js";
import { restartAntigravityIntegration } from "./services/antigravityProcessService.js";
import { createProviderRuntimeAdapters } from "./services/providerRuntimeAdapter.js";
import { WindowsDesktopLifecycleService } from "./services/windowsDesktopLifecycleService.js";
import { QuotaAlertService } from "./services/quotaAlertService.js";
import { DeviceCodeHandoffService } from "./services/deviceCodeHandoffService.js";
import {
  DesktopNotificationService,
  buildAuthNotification,
  buildQuotaNotification,
  buildSwitchNotification,
  buildUpdateNotification,
  createWindowsToastXml,
  type DesktopNotificationPayload
} from "./services/desktopNotificationService.js";

let mainWindow: BrowserWindow | null = null;
let manager: AccountManager | null = null;
let vault: Vault | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let startupError: string | null = null;
let settingsService: SettingsService | null = null;
let logPath: string | null = null;
let autoRefreshTimer: NodeJS.Timeout | null = null;
let sessionSnapshotTimer: NodeJS.Timeout | null = null;
let autoRefreshInFlight = false;
let updaterService: UpdaterService | null = null;
let codexCapabilityService: CodexCapabilityService | null = null;
let desktopLifecycleService: WindowsDesktopLifecycleService | null = null;
let quotaAlertService: QuotaAlertService | null = null;
let antigravityGoogleLoginInFlight: Promise<unknown> | null = null;
const deviceCodeHandoff = new DeviceCodeHandoffService(clipboard);
const desktopNotificationService = new DesktopNotificationService();
const antigravityGoogleOAuthSessions = new Map<string, {
  authorization: AntigravityGoogleOAuthAuthorization;
  expiresAt: number;
  completion?: Promise<AntigravityImportResult>;
}>();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const productName = "Codex Account Manager";
const publisherName = "Egoist AI";
const legacyProductName = "Egoist AI Manager";
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
    productName,
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
    resolveCodexPath: async () => resolveCodexPath(),
    resolveCodexDesktopPath,
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
      privacyMode: settingsService.get().privacyMode,
      confirmSwitch: settingsService.get().confirmSwitch,
      smartSwitchMode: settingsService.get().smartSwitchMode,
      smartSwitchThresholdPercent: settingsService.get().smartSwitchThresholdPercent,
      desktopNotifications: settingsService.get().desktopNotifications,
      desktopClosePolicy: settingsService.get().desktopClosePolicy,
      trayEnabled: settingsService.get().trayEnabled,
      autostartEnabled: settingsService.get().autostartEnabled
    } : null,
    accounts
  });
}

async function getCurrentDiagnostics(appDataDir: string): Promise<AppDiagnostics> {
  const base = getDiagnostics(appDataDir);
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

function createWindow(): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1460, Math.max(920, workArea.width - 24));
  const height = Math.min(900, Math.max(620, workArea.height - 24));
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 920,
    minHeight: 620,
    center: true,
    show: false,
    frame: false,
    backgroundColor: "#0a0b10",
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

  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });
  window.on("close", (event) => {
    if (isQuitting || settingsService?.get().trayEnabled !== true) return;
    event.preventDefault();
    window.hide();
    log("Main window hidden to tray");
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.on("blur", () => syncActiveCodexSession("window-blur"));

  window.webContents.on("render-process-gone", (_event, details) => {
    log(`Renderer process gone: ${details.reason}`);
  });
  window.webContents.on("did-finish-load", () => {
    log("Renderer loaded");
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
        resolveAccountContext: false,
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
  mainWindow?.webContents.send("antigravity:oauth-result", result);
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
        resolveAccountContext: false,
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
        return await listener(event, ...args);
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
      resolveCodexPath: async () => resolveCodexPath(),
      resolveCodexDesktopPath,
      getSchemaVersion: () => manager?.getSchemaVersion() ?? 0,
      isVaultDegraded: () => vault?.isDegraded() ?? true
    }),
    assertTrustedSender
  );
  handle("accounts:list", () => requireManager().list());
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
  handle("accounts:refresh", (_event, input) => {
    const parsed = accountActionInputSchema.parse(input);
    log(`Refreshing account: ${parsed.accountId}`);
    return requireManager().refreshAccount(parsed.accountId);
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
  handle("accounts:export", async (_event, passphrase: string) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const options: Electron.SaveDialogOptions = {
      title: "Export ChatGPT accounts",
      defaultPath: `codex-account-manager-accounts-${stamp}.cam-export`,
      filters: [{ name: "Codex Account Manager export", extensions: ["cam-export"] }]
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { exportedCount: 0, filePath: "" };
    const exported = await requireManager().exportAccounts(result.filePath, passphrase);
    log(`Exported ${exported.exportedCount} account(s) to ${exported.filePath}`);
    return exported;
  });
  handle("accounts:import", async (_event, passphrase: string) => {
    const options: Electron.OpenDialogOptions = {
      title: "Import ChatGPT accounts",
      properties: ["openFile"],
      filters: [{ name: "Codex Account Manager export", extensions: ["cam-export", "json"] }]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { importedCount: 0, accounts: requireManager().list() };
    const imported = await requireManager().importAccounts(result.filePaths[0], passphrase);
    log(`Imported ${imported.importedCount} account(s) from ${result.filePaths[0]}`);
    mainWindow?.webContents.send("accounts:updated");
    return imported;
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
      defaultPath: `codex-account-manager-diagnostics-${stamp}.json`,
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
}

function showMainWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function updateTrayMenu(): void {
  if (!tray || !manager) return;
  const accounts = manager.list();
  const active = accounts.find((account) => account.isActive);
  const recommendation = selectSmartAccount(accounts, manager.getWorkspaceBinding());
  const best = recommendation ? accounts.find((account) => account.id === recommendation.accountId) : null;
  const privacyMode = settingsService?.get().privacyMode === true;

  tray.setToolTip(`${productName}${active ? ` · ${active.label}` : ""}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: active ? `Активный: ${active.label}` : "Активный аккаунт не выбран", enabled: false },
      { type: "separator" },
      {
        label: best ? `Умный выбор: ${best.label}` : "Умный выбор недоступен",
        enabled: Boolean(best && !best.isActive),
        click: () => {
          if (best) void manager?.switchAccount(best.id).finally(() => updateTrayMenu());
        }
      },
      {
        label: "Аккаунты",
        enabled: accounts.length > 0,
        submenu: accounts.slice(0, 12).map((account) => ({
          label: buildTrayAccountLabel(account, privacyMode),
          enabled: !account.isActive,
          click: () => void manager?.switchAccount(account.id).finally(() => updateTrayMenu())
        }))
      },
      { type: "separator" },
      {
        label: "Обновить лимиты",
        enabled: accounts.length > 0,
        click: () => void refreshAllRateLimits("manual").finally(() => updateTrayMenu())
      },
      { label: "Открыть окно", click: showMainWindow },
      {
        label: "Выход",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

function createTray(): void {
  if (tray) return;
  tray = new Tray(getWindowIconPath());
  tray.on("click", showMainWindow);
  updateTrayMenu();
}

function applyDesktopIntegrationSettings(settings: AppSettings): void {
  if (settings.trayEnabled) {
    createTray();
    updateTrayMenu();
  } else if (tray) {
    tray.destroy();
    tray = null;
  }

  if (process.platform === "win32" && app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: settings.autostartEnabled,
      path: process.execPath
    });
  }
}

function notify(payload: DesktopNotificationPayload): void {
  if (settingsService?.get().desktopNotifications === false || !Notification.isSupported()) return;
  const safePayload = {
    ...payload,
    title: redactSensitiveText(payload.title),
    body: redactSensitiveText(payload.body)
  };
  const showBasicNotification = (): void => {
    const fallback = new Notification({
      title: safePayload.title,
      body: safePayload.body,
      silent: safePayload.silent,
      timeoutType: safePayload.timeoutType,
      icon: getWindowIconPath()
    });
    fallback.on("click", showMainWindow);
    fallback.on("failed", (_event, error) => log("Desktop notification failed", error));
    fallback.show();
  };

  try {
    if (process.platform !== "win32") {
      showBasicNotification();
      return;
    }
    const notification = new Notification({
      toastXml: createWindowsToastXml(safePayload, getWindowIconPath())
    });
    let fellBack = false;
    notification.on("click", showMainWindow);
    notification.on("failed", (_event, error) => {
      log("Branded Windows notification failed; using native fallback", error);
      if (fellBack) return;
      fellBack = true;
      showBasicNotification();
    });
    notification.show();
  } catch (error) {
    log("Branded Windows notification could not be created; using native fallback", error);
    showBasicNotification();
  }
}

function startAutoRefresh(intervalMs: AppSettings["autoRefreshIntervalMs"] = currentRateLimitRefreshIntervalMs): void {
  currentRateLimitRefreshIntervalMs = intervalMs;
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  if (currentRateLimitRefreshIntervalMs <= 0) {
    log("Auto-refresh disabled");
    return;
  }
  autoRefreshTimer = setInterval(() => {
    void runAutoRefresh();
  }, currentRateLimitRefreshIntervalMs);
}

function syncActiveCodexSession(reason: string): void {
  if (!manager) return;
  try {
    const result = manager.syncActiveCodexSession();
    if (result.status === "updated") {
      log(`Active Codex session snapshot updated: ${reason}`);
      mainWindow?.webContents.send("accounts:updated");
      updateTrayMenu();
    }
  } catch (error) {
    log(`Active Codex session snapshot skipped: ${reason}`, error);
  }
}

function startSessionSnapshotSync(): void {
  if (sessionSnapshotTimer) clearInterval(sessionSnapshotTimer);
  syncActiveCodexSession("startup");
  sessionSnapshotTimer = setInterval(() => syncActiveCodexSession("periodic"), 30_000);
}

async function runAutoRefresh(): Promise<void> {
  await refreshAllRateLimits("auto");
}

async function refreshAllRateLimits(reason: "auto" | "manual") {
  if (!manager) return [];
  if (autoRefreshInFlight) {
    log(`Rate-limit refresh skipped because another refresh is already running: ${reason}`);
    return manager.list();
  }

  const accounts = manager.list();
  const refreshableAccounts = accounts;
  if (refreshableAccounts.length === 0) return accounts;
  autoRefreshInFlight = true;
  try {
    const beforeRefresh = new Map(accounts.map((account) => [account.id, {
      success: account.lastRefreshAt ?? null,
      error: account.lastRefreshErrorAt ?? null
    }]));
    log(`${reason === "auto" ? "Auto-refreshing" : "Refreshing"} account limits for ${refreshableAccounts.length} account(s)`);
    const refreshed = await manager.refreshAllAccounts();
    mainWindow?.webContents.send("accounts:updated");
    const failedCount = refreshed.filter((account) => account.lastRefreshErrorAt != null && account.lastRefreshErrorAt !== beforeRefresh.get(account.id)?.error).length;
    const updatedCount = refreshed.filter((account) => account.lastRefreshAt != null && account.lastRefreshAt !== beforeRefresh.get(account.id)?.success).length;
    const skippedCount = Math.max(0, refreshed.length - failedCount - updatedCount);
    log(`${reason === "auto" ? "Auto-refresh" : "Manual refresh"} completed: updated=${updatedCount}, failed=${failedCount}, deferred=${skippedCount}`);
    const settings = settingsService?.get();
    const recommendation = selectSmartAccount(refreshed, manager.getWorkspaceBinding(), { staleAfterSeconds: 15 * 60 });
    if (settings?.smartSwitchMode !== "off" && recommendation) {
      log(`Smart suggestion: ${recommendation.accountEmail}. Reason=${recommendation.reason}`);
    }
    if (settings?.desktopNotifications !== false) {
      const alerts = quotaAlertService?.evaluate(refreshed, settings?.smartSwitchThresholdPercent ?? 10) ?? [];
      for (const alert of alerts) {
        const payload = desktopNotificationService.take(buildQuotaNotification(alert, settings?.language === "en"));
        if (payload) notify(payload);
      }
    }
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
  } else {
    const legacyUserDataDir = path.join(app.getPath("appData"), legacyProductName);
    const renamedUserDataDir = path.join(app.getPath("appData"), productName);
    const legacyDbPath = path.join(legacyUserDataDir, "accounts.sqlite");
    const renamedDbPath = path.join(renamedUserDataDir, "accounts.sqlite");
    if (fs.existsSync(legacyDbPath) && !fs.existsSync(renamedDbPath)) {
      app.setPath("userData", legacyUserDataDir);
    }
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
    const appDataDir = getAppDataDir();
    logPath = path.join(appDataDir, "logs", "main.log");
    syncWindowsShortcutIcon({
      env: process.env,
      platform: process.platform,
      productName,
      sourceIcoPath: getWindowsShortcutIconSourcePath(),
      version: appVersion,
      log
    });
    updaterService = new UpdaterService(
      () => mainWindow,
      log,
      {
        onUpdateAvailable: (result) => {
          if (!result.version) return;
          const payload = desktopNotificationService.take(
            buildUpdateNotification(result.version, settingsService?.get().language === "en")
          );
          if (payload) notify(payload);
        }
      }
    );
    registerIpc(appDataDir);

    try {
      const store = new AccountStore(appDataDir);
      vault = new Vault(appDataDir);
      const codexPath = resolveCodexPath();
      log(`Resolved Codex CLI: ${codexPath ?? "not found"}`);
      codexCapabilityService = new CodexCapabilityService({
        appDataDir,
        codexHome: getDefaultCodexHome(),
        codexPath
      });
      settingsService = new SettingsService(store);
      quotaAlertService = new QuotaAlertService({
        readState: () => store.getSetting("quotaAlertState.v1"),
        writeState: (value) => store.setSetting("quotaAlertState.v1", value)
      });
      desktopLifecycleService = new WindowsDesktopLifecycleService();
      manager = new AccountManager(store, vault, appDataDir, codexPath, {
        readAntigravityCredentialStorePayload,
        writeAntigravityCredentialStoreToken,
        restartAntigravityIntegration,
        desktopLifecycle: desktopLifecycleService,
        getDesktopClosePolicy: () => settingsService?.get().desktopClosePolicy ?? "graceful-only"
      });
      currentRateLimitRefreshIntervalMs = settingsService.get().autoRefreshIntervalMs;
      registerSettingsIpc(settingsService, (settings) => {
        startAutoRefresh(settings.autoRefreshIntervalMs);
        applyDesktopIntegrationSettings(settings);
        log(`Auto-refresh interval updated: ${settings.autoRefreshIntervalMs}ms`);
      }, assertTrustedSender);
      manager.on("auth-event", (event) => {
        mainWindow?.webContents.send("auth:event", event);
        const payload = desktopNotificationService.take(buildAuthNotification(event, settingsService?.get().language === "en"));
        if (payload) notify(payload);
      });
      manager.on("accounts-updated", () => {
        mainWindow?.webContents.send("accounts:updated");
        updateTrayMenu();
      });
      manager.on("switch-transaction", (event) => {
        mainWindow?.webContents.send("switch:transaction", event);
        const targetLabel = manager?.list().find((account) => account.id === event.transaction.targetAccountId)?.label ?? null;
        const payload = desktopNotificationService.take(buildSwitchNotification(
          event.transaction,
          targetLabel,
          settingsService?.get().language === "en"
        ));
        if (payload) notify(payload);
      });
      manager.on("log", (message) => log(String(message)));
      const reconciledSwitches = await manager.recoverInterruptedSwitches();
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
      startSessionSnapshotSync();
      startAutoRefresh(currentRateLimitRefreshIntervalMs);
      applyDesktopIntegrationSettings(settingsService.get());
      log("Application services initialized");
    } catch (error) {
      startupError = error instanceof Error ? error.message : String(error);
      log("Failed to initialize application services", error);
    }

    mainWindow = createWindow();
    if (app.isPackaged && process.env.CAM_DISABLE_AUTO_UPDATE !== "1") {
      setTimeout(() => {
        void updaterService?.checkForUpdates();
      }, 8_000);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
    powerMonitor.on("suspend", () => syncActiveCodexSession("system-suspend"));
    powerMonitor.on("lock-screen", () => syncActiveCodexSession("screen-lock"));
  });

  app.on("child-process-gone", (_event, details) => {
    log(`Child process gone: ${details.type} ${details.reason}`);
  });

  process.on("uncaughtException", (error) => captureCrash("Uncaught exception", error));
  process.on("unhandledRejection", (reason) => captureCrash("Unhandled rejection", reason));

  app.on("before-quit", () => {
    isQuitting = true;
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    if (sessionSnapshotTimer) clearInterval(sessionSnapshotTimer);
    deviceCodeHandoff.dispose();
    syncActiveCodexSession("before-quit");
    tray?.destroy();
    tray = null;
    void manager?.shutdown().catch((error) => log("Failed to stop Codex child processes", error));
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && settingsService?.get().trayEnabled !== true) app.quit();
  });
}
