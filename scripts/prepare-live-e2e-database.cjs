const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function isInside(parentDir, targetPath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(targetPath));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function writeReport(reportPath, value) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

app.whenReady().then(async () => {
  const sourcePath = readArg("--source");
  const targetPath = readArg("--target");
  const targetUserData = readArg("--target-user-data");
  const allowedRoot = readArg("--allowed-root");
  const reportPath = readArg("--report");
  if (!sourcePath || !targetPath || !targetUserData || !allowedRoot || !reportPath) {
    throw new Error("Database preparation arguments are incomplete");
  }
  if (!isInside(allowedRoot, targetPath) || !isInside(allowedRoot, targetUserData) || !isInside(allowedRoot, reportPath)) {
    throw new Error("Database preparation escaped the live E2E artifact root");
  }

  const Database = require("better-sqlite3");
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  let target = null;
  try {
    source.pragma("query_only = ON");
    const candidates = source.prepare(`
      SELECT id
      FROM accounts
      WHERE platform = 'codex'
        AND is_active = 0
        AND archived = 0
        AND credential_state = 'ready'
        AND COALESCE(auth_mode, 'chatgpt') = 'chatgpt'
      ORDER BY
        CASE WHEN COALESCE(last_authenticated_at, 0) > 0 THEN 0 ELSE 1 END ASC,
        COALESCE(last_authenticated_at, 0) DESC,
        COALESCE(last_refresh_at, 0) DESC,
        updated_at DESC,
        CASE lower(plan_type)
          WHEN 'pro_x20' THEN 60 WHEN 'pro x20' THEN 60
          WHEN 'pro_x5' THEN 50 WHEN 'pro x5' THEN 50
          WHEN 'pro' THEN 40 WHEN 'plus' THEN 30
          WHEN 'go' THEN 20 WHEN 'free' THEN 10 ELSE 0
        END DESC,
        id ASC
      LIMIT 12
    `).all();
    if (candidates.length < 2) throw new Error("Two ready non-active Codex profiles are unavailable");

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
    await source.backup(targetPath);
    target = new Database(targetPath);
    target.pragma("foreign_keys = OFF");
    const ids = candidates.map((candidate) => candidate.id);
    const placeholders = ids.map(() => "?").join(", ");
    const tables = target.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    for (const { name } of tables) {
      if (name === "accounts") continue;
      const columns = target.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all().map((column) => column.name);
      if (columns.includes("account_id")) {
        target.prepare(`DELETE FROM ${JSON.stringify(name)} WHERE account_id NOT IN (${placeholders})`).run(...ids);
      }
      if (name === "switch_events" || name === "switch_transactions") {
        target.prepare(`DELETE FROM ${JSON.stringify(name)}`).run();
      }
    }
    target.prepare(`DELETE FROM accounts WHERE id NOT IN (${placeholders})`).run(...ids);
    const updateProfile = target.prepare("UPDATE accounts SET is_active = 0, profile_dir = ? WHERE id = ?");
    for (const id of ids) updateProfile.run(path.join(targetUserData, "profiles", id), id);
    target.pragma("wal_checkpoint(TRUNCATE)");
    const integrity = target.pragma("integrity_check", { simple: true });
    const selectedActive = target.prepare("SELECT count(*) AS count FROM accounts WHERE is_active = 1").get().count;
    const selectedCount = target.prepare("SELECT count(*) AS count FROM accounts").get().count;
    writeReport(reportPath, {
      passed: integrity === "ok" && selectedCount >= 2 && selectedActive === 0,
      selectedCount,
      activeProfilesSelected: selectedActive,
      selectionPolicy: "most-recently-authenticated-inactive-ready",
      sourceDatabaseUnmodified: true,
      integrity
    });
    app.exit(integrity === "ok" && selectedCount >= 2 && selectedActive === 0 ? 0 : 1);
  } finally {
    target?.close();
    source.close();
  }
}).catch((error) => {
  const reportPath = readArg("--report");
  if (reportPath) writeReport(reportPath, {
    passed: false,
    error: error instanceof Error ? error.message : "Database preparation failed"
  });
  app.exit(1);
});
