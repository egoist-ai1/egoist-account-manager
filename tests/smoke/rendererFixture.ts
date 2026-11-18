import type { Page } from "@playwright/test";
import type { AppApi, AppSettings, ManagedAccount, SwitchHistoryItem, SwitchTransaction, SwitchVerificationEvidence } from "../../src/shared/types";
import { appVersion } from "../../src/shared/releaseNotes";

export interface FixtureControl {
  accounts: ManagedAccount[];
  settings: AppSettings;
  transactions: SwitchTransaction[];
  history: SwitchHistoryItem[];
  calls: Record<string, number>;
  failRefresh: boolean;
  resumePrepareSwitch?: () => void;
  emitAccounts(): void;
}
declare global { interface Window { egoistFixture: FixtureControl; fixtureIntervals: Set<number> } }

export async function installRendererFixture(page: Page, options: { count?: number; language?: "ru" | "en"; privacyMode?: boolean; notes?: boolean; unknown?: boolean; surface?: string; deferPrepareSwitch?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const accounts: ManagedAccount[] = Array.from({ length: options.count ?? 10 }, (_, index) => ({
    id: `fixture-${index}`, platform: index % 4 === 3 ? "antigravity" : "codex", label: `Profile ${String(index + 1).padStart(3, "0")}`, email: `hidden-address+${index}@privacy.example`,
    authMode: "chatgpt", providerAccountId: `provider-${index}`, workspaceAccountId: null, workspaceLabel: null, authFingerprint: "safe-fixture-fingerprint", credentialState: "ready", lastAuthenticatedAt: now, expiresAt: null, version: 1, planType: "plus", profileDir: `C:\\isolated-fixture\\profiles\\${index}`, isActive: index === 0,
    createdAt: now - index, updatedAt: now, lastUsedAt: null, lastRefreshAt: now, lastRefreshErrorAt: null, lastRefreshError: null, subscriptionEndsAt: null, status: "active", statusReason: null,
    primaryUsedPercent: null, primaryResetsAt: null, primaryWindowDurationMins: null, secondaryUsedPercent: null, secondaryResetsAt: null, secondaryWindowDurationMins: null,
    fiveHourUsedPercent: options.unknown ? null : index === 0 ? 99.6 : 48, fiveHourResetsAt: options.unknown ? null : now + 3_600, weeklyUsedPercent: options.unknown ? null : 48, weeklyResetsAt: options.unknown ? null : now + 86_400, notes: null,
    ...(index === 0 && !options.unknown ? { quotaSnapshot: { limitId: "codex", limitName: null, primary: null, secondary: null, credits: null, planType: "plus", rateLimitReachedType: null, capturedAt: now, source: "fixture", buckets: [
      { limitId: "codex", limitName: null, modelId: null, scope: "aggregate", primary: { usedPercent: 99.6, windowDurationMins: 300, resetsAt: now + 3_600 }, secondary: { usedPercent: 48, windowDurationMins: 10_080, resetsAt: now + 86_400 } },
      { limitId: "model-a", limitName: null, modelId: "fixture-model-a", scope: "model", primary: { usedPercent: 18.5, windowDurationMins: 120, resetsAt: now + 1_800 }, secondary: null }
    ] } } : {}),
    ...(index === 0 ? { runtimeVerification: { profileApplied: true, credentials: "probe_observed", credentialMethod: "independent app-server probe", launch: "process_started", runtime: "unsupported", runtimeSource: null, observedEmail: "separate-probe-b@privacy.example", observedAt: now, runtimePid: null, message: "Desktop account cannot be verified" } as SwitchVerificationEvidence } : {})
  }));
  const settings: AppSettings = { language: options.language ?? "ru", autoRefreshIntervalMs: 0, trayRefreshIntervalMs: 0, privacyMode: options.privacyMode ?? false, confirmSwitch: true, desktopClosePolicy: "graceful-only", smartSwitchMode: "suggest", smartSwitchThresholdPercent: 10, notificationSoundEnabled: false, trayEnabled: false, autostartEnabled: false };
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.addInitScript(({ accounts: initialAccounts, settings: initialSettings, version, showNotes, deferPrepareSwitch }) => {
    const events = new Map<string, Set<(value: unknown) => void>>();
    window.egoistFixture = { accounts: initialAccounts, settings: initialSettings, transactions: [], history: [], calls: {}, failRefresh: false, emitAccounts() { for (const handler of events.get("onAccountsUpdated") ?? []) handler(undefined); } };
    const state = window.egoistFixture;
    const stamp = Math.floor(Date.now() / 1000);
    const transaction = (id: string): SwitchTransaction => ({ id: "fixture-transaction", platform: "codex", targetAccountId: id, previousAccountId: "fixture-0", status: "pending", phase: "ready", targetFingerprint: "fixture", previousFingerprint: "fixture", backupPath: null, errorCode: null, errorMessage: null, createdAt: stamp, updatedAt: stamp, completedAt: null, version: 1 });
    const diagnostics = { codexPath: "C:\\isolated-fixture\\codex.exe", activeCodexHome: "C:\\isolated-fixture\\codex", appDataDir: "C:\\isolated-fixture\\app", workspacePath: "C:\\isolated-fixture\\workspace", startupError: null };
    const profileStatus = { detected: false, profileKind: "unknown", email: null, warnings: [], stateDbExists: false, storageJsonExists: false, machineIdExists: false };
    window.cam = new Proxy({} as AppApi, { get(_target, property) {
      const method = String(property);
      if (method.startsWith("on")) return (callback: (value: unknown) => void) => { const handlers = events.get(method) ?? new Set(); handlers.add(callback); events.set(method, handlers); return () => handlers.delete(callback); };
      return async (...args: unknown[]) => {
        state.calls[method] = (state.calls[method] ?? 0) + 1;
        switch (method) {
          case "listAccounts": return state.accounts;
          case "getSettings": return state.settings;
          case "updateSettings": state.settings = { ...state.settings, ...args[0] as Partial<AppSettings> }; return state.settings;
          case "getDiagnostics": return diagnostics;
          case "getAntigravityProfileStatus": return profileStatus;
          case "getWorkspaceBinding": return { workspacePath: diagnostics.workspacePath, accountId: null, accountLabel: null, accountEmail: null };
          case "listSwitchTransactions": return state.transactions;
          case "getSwitchHistory": return state.history;
          case "getLimitHistory": return [];
          case "rollbackSwitch": state.transactions = state.transactions.map((item) => ({ ...item, status: "rolled_back", phase: "rolled_back" })); return state.history;
          case "getAppInfo": return { name: "Квессер", publisher: "Egoist", version, vaultDegraded: false };
          case "getTrayPlatform": return "codex";
          case "refreshAccount": if (state.failRefresh) throw new Error("fixture offline"); return state.accounts.find((account) => account.id === args[0]);
          case "refreshAllAccounts": return state.accounts;
          case "prepareSwitch":
            if (deferPrepareSwitch) await new Promise<void>((resolve) => { state.resumePrepareSwitch = resolve; });
            return { transaction: transaction(String(args[0])), canCommit: true, warnings: [] };
          case "cancelSwitch": return { ...transaction("fixture-0"), status: "aborted", phase: "aborted" };
          case "switchAccount": { const target = state.accounts.find((account) => account.id === args[0])!; state.accounts = state.accounts.map((account) => ({ ...account, isActive: account.id === target.id })); return { ...target, isActive: true, runtimeVerification: state.accounts[0].runtimeVerification }; }
          case "verifyRuntimeAccount": return state.accounts.find((account) => account.id === args[0])?.runtimeVerification;
          case "startLogin": return { loginId: "fixture-login", profileId: "pending", type: "chatgptDeviceCode", userCode: "TEST-CODE", verificationUrl: "https://example.invalid/sign-in" };
          case "startAntigravityGoogleOAuth": return { sessionId: "fixture-oauth", authUrl: "https://example.invalid/oauth", redirectUri: "http://127.0.0.1:1", expiresAt: stamp + 300 };
          case "copyDeviceCode": case "openDeviceLogin": return { copied: true };
          case "validateAuth": return { state: "authorized", checkedAt: stamp, message: "Fixture credentials checked" };
          case "updateAccount": { const update = args[0] as Partial<ManagedAccount> & { id: string }; state.accounts = state.accounts.map((account) => account.id === update.id ? { ...account, ...update } : account); return state.accounts.find((account) => account.id === update.id); }
          case "previewImport": return { previewId: "fixture-preview", total: 2, importableCount: 1, skippedCount: 1, expiresAt: stamp + 300, entries: [{ email: "new-fixture@privacy.example", label: "New profile", platform: "codex", action: "import", reason: null }, { email: "hidden-address+0@privacy.example", label: "Existing profile", platform: "codex", action: "skip", reason: "Already exists" }] };
          case "applyImport": return { importedCount: 1, skippedCount: 1, accounts: state.accounts };
          case "readLogTail": return ["Fixture event without secrets"];
          case "exportDiagnosticReport": return { filePath: null };
          case "checkForUpdates": return { status: "up_to_date", currentVersion: version, latestVersion: version, message: "Fixture up to date" };
          case "hideTrayPopover": case "showMainWindow": case "openExternal": case "openLogsFolder": case "minimizeWindow": case "toggleMaximizeWindow": case "closeWindow": return;
          default: throw new Error(`Unexpected fixture operation: ${method}`);
        }
      };
    } });
    window.localStorage.setItem("cam.accountSort", "name");
    if (!showNotes) window.localStorage.setItem("cam.releaseNotesSeen", version);
  }, { accounts, settings, version: appVersion, showNotes: options.notes ?? false, deferPrepareSwitch: options.deferPrepareSwitch ?? false });
  await page.goto(options.surface ? `/?surface=${options.surface}` : "/");
}
