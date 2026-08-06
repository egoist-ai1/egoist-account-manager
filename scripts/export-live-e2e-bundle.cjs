const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
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

const userDataDir = readArg("--user-data");
if (userDataDir) app.setPath("userData", path.resolve(userDataDir));

app.whenReady().then(async () => {
  const allowedRoot = readArg("--allowed-root");
  const bundlePath = readArg("--bundle");
  const passphrasePath = readArg("--passphrase-file");
  const reportPath = readArg("--report");
  const runtimeRoot = readArg("--runtime-root");
  if (!userDataDir || !allowedRoot || !bundlePath || !passphrasePath || !reportPath || !runtimeRoot) {
    throw new Error("Backend export arguments are incomplete");
  }
  for (const target of [userDataDir, bundlePath, passphrasePath, reportPath]) {
    if (!isInside(allowedRoot, target)) throw new Error("Backend export escaped the live E2E artifact root");
  }

  const [{ AccountStore }, { Vault }, { AccountManager }] = await Promise.all([
    import(pathToFileURL(path.join(runtimeRoot, "db.js")).href),
    import(pathToFileURL(path.join(runtimeRoot, "security.js")).href),
    import(pathToFileURL(path.join(runtimeRoot, "accountManager.js")).href)
  ]);
  const store = new AccountStore(userDataDir);
  let exitCode = 1;
  try {
    const accounts = store.list().filter((account) => account.platform === "codex");
    if (accounts.length < 2 || accounts.some((account) => account.isActive || account.credentialState !== "ready")) {
      throw new Error("Filtered export database violated the inactive ready-profile boundary");
    }
    const vault = new Vault(userDataDir);
    const manager = new AccountManager(store, vault, userDataDir, null);
    const passphrase = fs.readFileSync(passphrasePath, "utf8").trim();
    const result = await manager.exportAccounts(bundlePath, passphrase);
    const passed = result.exportedCount === accounts.length && result.exportedCount >= 2 && fs.statSync(bundlePath).size > 512;
    const vaultDegraded = vault.isDegraded();
    writeReport(reportPath, {
      passed,
      exportedCount: result.exportedCount,
      activeProfilesExported: 0,
      encryptedTransfer: true,
      vaultDegraded
    });
    exitCode = passed && !vaultDegraded ? 0 : 1;
  } finally {
    store.close();
  }
  app.exit(exitCode);
}).catch(() => {
  const reportPath = readArg("--report");
  if (reportPath) writeReport(reportPath, { passed: false, error: "Backend export failed" });
  app.exit(1);
});
