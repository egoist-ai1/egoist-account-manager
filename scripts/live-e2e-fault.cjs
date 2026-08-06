const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { app } = require("electron");

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

function invalidateTokens(value) {
  let mutations = 0;
  const visit = (current) => {
    if (!current || typeof current !== "object") return;
    for (const [key, item] of Object.entries(current)) {
      if (item && typeof item === "object") {
        visit(item);
        continue;
      }
      const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
      if (typeof item === "string" && ["accesstoken", "refreshtoken", "idtoken"].includes(normalized)) {
        current[key] = `invalid-live-e2e-${normalized}`;
        mutations += 1;
      }
    }
  };
  visit(value);
  return mutations;
}

const appDataDir = readArg("--app-data");
if (appDataDir) app.setPath("userData", path.resolve(appDataDir));

app.whenReady().then(async () => {
  const operation = readArg("--operation");
  const runtimeRoot = readArg("--runtime-root");
  const reportPath = readArg("--report");
  if (!appDataDir || !runtimeRoot || !reportPath || !["arm-invalid-auth", "restore-auth"].includes(operation)) {
    throw new Error("Fault helper arguments are invalid");
  }
  const backupPath = path.join(appDataDir, "live-e2e-fault-backup.json");
  const requireFromRuntime = createRequire(path.join(runtimeRoot, "package.json"));
  const Database = requireFromRuntime("better-sqlite3");
  const { Vault } = await import(pathToFileURL(path.join(runtimeRoot, "security.js")).href);
  const database = new Database(path.join(appDataDir, "accounts.sqlite"), { fileMustExist: true });
  try {
    if (operation === "arm-invalid-auth") {
      if (fs.existsSync(backupPath)) throw new Error("A fault backup already exists");
      const target = database.prepare(`
        SELECT id, encrypted_auth_json
        FROM accounts
        WHERE platform = 'codex' AND is_active = 0 AND credential_state = 'ready'
        ORDER BY id ASC
        LIMIT 1
      `).get();
      if (!target) throw new Error("No inactive target is available");
      const vault = new Vault(appDataDir);
      const parsed = JSON.parse(vault.decryptUtf8(target.encrypted_auth_json));
      const mutationCount = invalidateTokens(parsed);
      if (mutationCount < 1) throw new Error("No supported auth token was found");
      fs.writeFileSync(backupPath, JSON.stringify({ id: target.id, encryptedAuthJson: target.encrypted_auth_json }), { encoding: "utf8", mode: 0o600 });
      database.prepare("UPDATE accounts SET encrypted_auth_json = ?, updated_at = ? WHERE id = ?")
        .run(vault.encryptUtf8(JSON.stringify(parsed)), Math.floor(Date.now() / 1000), target.id);
      writeReport(reportPath, { passed: true, operation, mutationCount, inactiveTargetMutated: true });
    } else {
      const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
      const result = database.prepare("UPDATE accounts SET encrypted_auth_json = ?, updated_at = ? WHERE id = ?")
        .run(backup.encryptedAuthJson, Math.floor(Date.now() / 1000), backup.id);
      fs.rmSync(backupPath, { force: true });
      writeReport(reportPath, { passed: result.changes === 1, operation, restoredCount: result.changes, backupRemoved: !fs.existsSync(backupPath) });
      if (result.changes !== 1) process.exitCode = 1;
    }
  } finally {
    database.close();
  }
  app.exit(process.exitCode ?? 0);
}).catch(() => {
  const reportPath = readArg("--report");
  if (reportPath) writeReport(reportPath, { passed: false, operation: readArg("--operation"), errorClass: "fault-helper-failed" });
  app.exit(1);
});
