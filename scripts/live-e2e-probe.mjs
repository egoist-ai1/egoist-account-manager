import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app } from "electron";

let currentStage = "arguments";

function classifyProbeError(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND" || message.includes("cannot find module")) return "runtime-module-not-found";
  if (message.includes("node_module_version") || message.includes("compiled against a different node.js version")) return "native-module-abi";
  if (message.includes("sqlite") || message.includes("database")) return "database";
  if (message.includes("decrypt") || message.includes("safe storage") || message.includes("vault")) return "vault";
  return "unknown";
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeReport(reportPath, value) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, reportPath);
}

await app.whenReady();

let database = null;
try {
  const appDataDir = readArg("--app-data");
  const codexHome = readArg("--codex-home");
  const reportPath = readArg("--report");
  const runtimeRoot = readArg("--runtime-root");
  const startedAt = Number(readArg("--started-at") ?? "0");
  if (!appDataDir || !codexHome || !reportPath || !runtimeRoot || !Number.isFinite(startedAt)) {
    throw new Error("Probe arguments are invalid");
  }
  currentStage = "load-runtime";
  const requireFromRuntime = createRequire(path.join(runtimeRoot, "package.json"));
  const Database = requireFromRuntime("better-sqlite3");
  const { Vault } = await import(pathToFileURL(path.join(runtimeRoot, "security.js")).href);
  const databasePath = path.join(appDataDir, "accounts.sqlite");
  if (!fs.existsSync(databasePath)) {
    writeReport(reportPath, { databaseReady: false });
    app.exit(0);
    process.exit(0);
  }

  currentStage = "open-vault";
  const vault = new Vault(appDataDir);
  currentStage = "open-database";
  database = new Database(databasePath, { readonly: true, fileMustExist: true });
  database.pragma("query_only = ON");
  const accounts = database.prepare(`
    SELECT id, profile_dir, encrypted_auth_json, provider_account_id,
      credential_state, is_active, last_refresh_at, rate_limit_json
    FROM accounts
    WHERE platform = 'codex'
    ORDER BY id ASC
  `).all();
  const decrypted = accounts.map((account) => ({
    ...account,
    authFingerprint: fingerprint(vault.decryptUtf8(account.encrypted_auth_json))
  }));
  const active = decrypted.find((account) => account.is_active === 1) ?? null;
  const globalAuthPath = path.join(codexHome, "auth.json");
  const globalFingerprint = fs.existsSync(globalAuthPath)
    ? fingerprint(fs.readFileSync(globalAuthPath, "utf8"))
    : null;
  const switchSummary = database.prepare(`
    SELECT
      SUM(CASE WHEN status = 'committed' THEN 1 ELSE 0 END) AS committed,
      SUM(CASE WHEN status IN ('failed', 'rolled_back') THEN 1 ELSE 0 END) AS failed
    FROM switch_events
  `).get();
  const transactionSummary = database.prepare(`
    SELECT
      SUM(CASE WHEN status = 'committed' THEN 1 ELSE 0 END) AS committed,
      SUM(CASE WHEN status = 'rolled_back' THEN 1 ELSE 0 END) AS rolled_back,
      SUM(CASE WHEN status = 'recovery_required' THEN 1 ELSE 0 END) AS recovery_required,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM switch_transactions
  `).get();
  const latestTransaction = database.prepare(`
    SELECT status, phase, error_code
    FROM switch_transactions
    ORDER BY created_at DESC
    LIMIT 1
  `).get();
  const latestEvent = database.prepare(`
    SELECT status
    FROM switch_events
    ORDER BY started_at DESC
    LIMIT 1
  `).get();
  const plaintextCount = decrypted.filter((account) => fs.existsSync(path.join(account.profile_dir, "auth.json"))).length;

  writeReport(reportPath, {
    databaseReady: true,
    accountCount: decrypted.length,
    readyCount: decrypted.filter((account) => account.credential_state === "ready").length,
    activeCount: decrypted.filter((account) => account.is_active === 1).length,
    activeOrdinal: active ? decrypted.findIndex((account) => account.id === active.id) + 1 : 0,
    identitiesDistinct: new Set(decrypted.map((account) => account.provider_account_id || account.authFingerprint)).size === decrypted.length,
    globalMatchesActive: Boolean(active && globalFingerprint && active.authFingerprint === globalFingerprint),
    freshQuotaCount: decrypted.filter((account) => account.rate_limit_json && Number(account.last_refresh_at ?? 0) >= startedAt).length,
    committedSwitchCount: Number(switchSummary?.committed ?? 0),
    failedSwitchCount: Number(switchSummary?.failed ?? 0),
    committedTransactionCount: Number(transactionSummary?.committed ?? 0),
    rolledBackTransactionCount: Number(transactionSummary?.rolled_back ?? 0),
    recoveryRequiredTransactionCount: Number(transactionSummary?.recovery_required ?? 0),
    failedTransactionCount: Number(transactionSummary?.failed ?? 0),
    latestTransactionStatus: latestTransaction?.status ?? null,
    latestTransactionPhase: latestTransaction?.phase ?? null,
    latestTransactionErrorCode: latestTransaction?.error_code ?? null,
    latestSwitchEventStatus: latestEvent?.status ?? null,
    managedPlaintextCount: plaintextCount,
    vaultDegraded: vault.isDegraded()
  });
} catch (error) {
  const reportPath = readArg("--report");
  if (reportPath) writeReport(reportPath, {
    databaseReady: false,
    probeFailed: true,
    errorStage: currentStage,
    errorClass: classifyProbeError(error)
  });
  process.exitCode = 1;
} finally {
  database?.close();
  app.exit(process.exitCode ?? 0);
}
