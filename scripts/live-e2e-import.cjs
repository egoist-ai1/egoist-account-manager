const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");

let currentStage = "arguments";

function classifyImportError(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (message.includes("target is not empty")) return "target-not-empty";
  if (code === "ERR_MODULE_NOT_FOUND" || message.includes("cannot find module")) return "runtime-module-not-found";
  if (message.includes("node_module_version") || message.includes("compiled against a different node.js version")) return "native-module-abi";
  if (message.includes("could not locate the bindings file") || message.includes("specified module could not be found")) return "native-binding-unavailable";
  if (message.includes("not a valid win32 application")) return "native-binary-invalid";
  if (code === "EACCES" || code === "EPERM" || message.includes("access is denied")) return "runtime-access-denied";
  if (message.includes("unsupported account export")) return "unsupported-export";
  if (message.includes("decrypt") || message.includes("authenticate data")) return "bundle-decrypt";
  if (message.includes("safe storage") || message.includes("safe_storage") || message.includes("encrypt")) return "safe-storage";
  if (message.includes("sqlite") || message.includes("database")) return "database";
  if (message.includes("auth.json") || message.includes("account entry")) return "import-validation";
  return "unknown";
}

function safeErrorCode(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return /^(?:ERR_|MODULE_|SQLITE_|E[A-Z0-9_]+)[A-Z0-9_]*$/.test(code) ? code : null;
}

function runtimePreflight(runtimeRoot) {
  if (!runtimeRoot) return null;
  const moduleRoot = path.resolve(runtimeRoot, "..", "node_modules", "better-sqlite3");
  const nodeModulesRoot = path.dirname(moduleRoot);
  return {
    databaseModule: fs.existsSync(path.join(runtimeRoot, "db.js")),
    securityModule: fs.existsSync(path.join(runtimeRoot, "security.js")),
    accountManagerModule: fs.existsSync(path.join(runtimeRoot, "accountManager.js")),
    betterSqlitePackage: fs.existsSync(path.join(moduleRoot, "package.json")),
    betterSqliteNative: fs.existsSync(path.join(moduleRoot, "build", "Release", "better_sqlite3.node")),
    nanoidPackage: fs.existsSync(path.join(nodeModulesRoot, "nanoid", "package.json"))
  };
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function writeReport(reportPath, value) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, reportPath);
}

const appDataDir = readArg("--app-data");
if (appDataDir) app.setPath("userData", path.resolve(appDataDir));

app.whenReady().then(async () => {
  currentStage = "load-runtime";
  const bundlePath = readArg("--bundle");
  const passphrasePath = readArg("--passphrase-file");
  const reportPath = readArg("--report");
  const runtimeRoot = readArg("--runtime-root");
  const codexPath = readArg("--codex-path");
  if (!appDataDir || !bundlePath || !passphrasePath || !reportPath || !runtimeRoot || !codexPath) throw new Error("Import arguments are incomplete");

  const [{ AccountStore }, { Vault }, { AccountManager }] = await Promise.all([
    import(pathToFileURL(path.join(runtimeRoot, "db.js")).href),
    import(pathToFileURL(path.join(runtimeRoot, "security.js")).href),
    import(pathToFileURL(path.join(runtimeRoot, "accountManager.js")).href)
  ]);
  currentStage = "open-store";
  const store = new AccountStore(appDataDir);
  let exitCode = 1;
  try {
    currentStage = "verify-empty-target";
    if (store.list().length !== 0) throw new Error("Sandbox import target is not empty");
    currentStage = "open-vault";
    const vault = new Vault(appDataDir);
    const manager = new AccountManager(store, vault, appDataDir, codexPath);
    const passphrase = fs.readFileSync(passphrasePath, "utf8").trim();
    currentStage = "import-bundle";
    const imported = await manager.importAccounts(bundlePath, passphrase);
    currentStage = "validate-live-identities";
    const candidates = store.list()
      .filter((account) => account.platform === "codex")
      .sort((left, right) => (right.lastAuthenticatedAt ?? 0) - (left.lastAuthenticatedAt ?? 0));
    const selected = [];
    let attemptedCount = 0;
    let invalidCount = 0;
    for (const account of candidates) {
      if (selected.length >= 2) break;
      attemptedCount += 1;
      try {
        const validation = await manager.validateAuth(account.id);
        if (validation.state === "authorized") selected.push(account.id);
        else invalidCount += 1;
      } catch {
        invalidCount += 1;
      }
    }
    if (selected.length !== 2) {
      const failure = new Error("Insufficient live identities");
      failure.liveDiagnostics = {
        importedCount: imported.importedCount,
        attemptedCount,
        validCount: selected.length,
        invalidCount,
        errorStage: "validate-live-identities",
        errorClass: "insufficient-live-identities"
      };
      throw failure;
    }
    const selectedIds = new Set(selected);
    for (const account of candidates) {
      if (selectedIds.has(account.id)) continue;
      store.delete(account.id);
      const relative = path.relative(path.resolve(appDataDir), path.resolve(account.profileDir));
      if (relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
        fs.rmSync(account.profileDir, { recursive: true, force: true });
      }
    }

    currentStage = "verify-import";
    const accounts = store.list().filter((account) => account.platform === "codex");
    const importedCountMatches = imported.importedCount >= 2;
    const storedCountMatches = accounts.length === 2;
    const inactiveProfilesOnly = accounts.every((account) => !account.isActive);
    const readyCredentialsOnly = accounts.every((account) => account.credentialState === "ready");
    const vaultHealthy = !vault.isDegraded();
    const passed = importedCountMatches
      && storedCountMatches
      && inactiveProfilesOnly
      && readyCredentialsOnly
      && vaultHealthy;
    writeReport(reportPath, {
      passed,
      importedCount: imported.importedCount,
      selectedCount: accounts.length,
      attemptedCount,
      validCount: selected.length,
      invalidCount,
      identitiesVerifiedByOfficialAppServer: true,
      activeProfilesImported: accounts.filter((account) => account.isActive).length,
      vaultDegraded: vault.isDegraded(),
      postconditions: {
        importedCountMatches,
        storedCountMatches,
        inactiveProfilesOnly,
        readyCredentialsOnly,
        vaultHealthy
      }
    });
    exitCode = passed ? 0 : 1;
  } finally {
    store.close();
  }
  app.exit(exitCode);
}).catch((error) => {
  const reportPath = readArg("--report");
  if (reportPath) {
    writeReport(reportPath, error && typeof error === "object" && error.liveDiagnostics ? {
      passed: false,
      ...error.liveDiagnostics
    } : {
      passed: false,
      error: "Backend import failed",
      errorStage: currentStage,
      errorClass: classifyImportError(error),
      errorCode: safeErrorCode(error),
      runtimePreflight: runtimePreflight(readArg("--runtime-root"))
    });
  }
  app.exit(1);
});
