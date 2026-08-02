import { contextBridge, ipcRenderer } from "electron";
import type { AntigravityImportResult, AppApi, AuthEvent } from "../shared/types.js";

const api: AppApi = {
  listAccounts: () => ipcRenderer.invoke("accounts:list"),
  getAppInfo: () => ipcRenderer.invoke("app:getInfo"),
  startLogin: (input) => ipcRenderer.invoke("accounts:login:start", input),
  reauthenticateAccount: (accountId, input) => ipcRenderer.invoke("accounts:reauth:start", { accountId, ...input }),
  copyDeviceCode: (userCode) => ipcRenderer.invoke("accounts:deviceCode:copy", { userCode }),
  openDeviceLogin: (url, userCode) => ipcRenderer.invoke("accounts:deviceCode:open", { url, userCode }),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", { url }),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  selectWorkspace: () => ipcRenderer.invoke("app:workspace:select"),
  refreshAccount: (accountId) => ipcRenderer.invoke("accounts:refresh", { accountId }),
  validateAuth: (accountId) => ipcRenderer.invoke("accounts:auth:validate", { accountId }),
  getProviderQuotaState: (accountId) => ipcRenderer.invoke("accounts:quota:state", { accountId }),
  refreshAllAccounts: () => ipcRenderer.invoke("accounts:refreshAll"),
  exportAccounts: (passphrase) => ipcRenderer.invoke("accounts:export", passphrase),
  importAccounts: (passphrase) => ipcRenderer.invoke("accounts:import", passphrase),
  openProfileFolder: (accountId) => ipcRenderer.invoke("accounts:profileFolder:open", { accountId }),
  prepareSwitch: (accountId) => ipcRenderer.invoke("switch:prepare", { accountId }),
  cancelSwitch: (transactionId) => ipcRenderer.invoke("switch:cancel", { transactionId }),
  listSwitchTransactions: () => ipcRenderer.invoke("switch:transactions"),
  switchAccount: (accountId, transactionId) => ipcRenderer.invoke("accounts:switch", { accountId, transactionId }),
  deleteAccount: (accountId) => ipcRenderer.invoke("accounts:delete", { accountId }),
  bindWorkspaceAccount: (accountId) => ipcRenderer.invoke("workspace:bindAccount", { accountId }),
  getWorkspaceBinding: () => ipcRenderer.invoke("workspace:getBinding"),
  getSwitchHistory: () => ipcRenderer.invoke("switch:history"),
  getLimitHistory: (accountId) => ipcRenderer.invoke("limits:history", { accountId }),
  rollbackSwitch: (eventId) => ipcRenderer.invoke("switch:rollback", { eventId }),
  readLogTail: () => ipcRenderer.invoke("logs:tail"),
  openLogsFolder: () => ipcRenderer.invoke("logs:openFolder"),
  updateAccount: (input) => ipcRenderer.invoke("accounts:update", input),
  getDiagnostics: () => ipcRenderer.invoke("app:diagnostics"),
  getHealth: () => ipcRenderer.invoke("health:get"),
  getProfileIntegrity: () => ipcRenderer.invoke("profiles:integrity"),
  exportDiagnosticReport: () => ipcRenderer.invoke("diagnostics:exportReport"),
  getReleaseReadiness: () => ipcRenderer.invoke("release:readiness"),
  checkForUpdates: () => ipcRenderer.invoke("release:checkUpdates"),
  openUpdateRelease: () => ipcRenderer.invoke("release:openUpdate"),
  openReleaseFolder: () => ipcRenderer.invoke("release:openFolder"),
  openCrashReportsFolder: () => ipcRenderer.invoke("crashReports:openFolder"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (input) => ipcRenderer.invoke("settings:update", input),
  getAntigravityDiagnostics: () => ipcRenderer.invoke("antigravity:diagnostics"),
  getAntigravityProfileStatus: () => ipcRenderer.invoke("antigravity:profileStatus"),
  inspectAntigravityProfile: () => ipcRenderer.invoke("antigravity:inspectProfile"),
  importAntigravityFromIde: () => ipcRenderer.invoke("antigravity:importFromIde"),
  openAntigravityLogin: () => ipcRenderer.invoke("antigravity:openLogin"),
  startAntigravityGoogleLogin: () => ipcRenderer.invoke("antigravity:googleLogin"),
  startAntigravityGoogleOAuth: () => ipcRenderer.invoke("antigravity:googleOAuth:start"),
  finishAntigravityGoogleOAuth: (input) => ipcRenderer.invoke("antigravity:googleOAuth:finish", input),
  cancelAntigravityGoogleOAuth: (sessionId) => ipcRenderer.invoke("antigravity:googleOAuth:cancel", { sessionId }),
  importAntigravityCredentialPayload: (input) => ipcRenderer.invoke("antigravity:credentials:importPayload", input),
  importAntigravityFromLocalFiles: () => ipcRenderer.invoke("antigravity:credentials:importFiles"),
  importAntigravityFromExternalSource: (source) => ipcRenderer.invoke("antigravity:credentials:importExternal", { source }),
  onAuthEvent: (callback: (event: AuthEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AuthEvent) => callback(payload);
    ipcRenderer.on("auth:event", listener);
    return () => ipcRenderer.off("auth:event", listener);
  },
  onAccountsUpdated: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("accounts:updated", listener);
    return () => ipcRenderer.off("accounts:updated", listener);
  },
  onSwitchTransaction: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload);
    ipcRenderer.on("switch:transaction", listener);
    return () => ipcRenderer.off("switch:transaction", listener);
  },
  onAntigravityOAuthStep: (callback: (step: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, step: string) => callback(step);
    ipcRenderer.on("antigravity:oauth-step", listener);
    return () => ipcRenderer.off("antigravity:oauth-step", listener);
  },
  onAntigravityOAuthResult: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, result: unknown) => callback(result as AntigravityImportResult);
    ipcRenderer.on("antigravity:oauth-result", listener);
    return () => ipcRenderer.off("antigravity:oauth-result", listener);
  },
  onAntigravityOAuthError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("antigravity:oauth-error", listener);
    return () => ipcRenderer.off("antigravity:oauth-error", listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, result: unknown) => callback(result as Awaited<ReturnType<AppApi["checkForUpdates"]>>);
    ipcRenderer.on("release:updateStatus", listener);
    return () => ipcRenderer.off("release:updateStatus", listener);
  }
};

contextBridge.exposeInMainWorld("cam", api);
