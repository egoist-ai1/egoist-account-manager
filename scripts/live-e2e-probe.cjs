const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function writeFailureReport() {
  const reportPath = readArg("--report");
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ databaseReady: false, probeFailed: true }, null, 2)}\n`, "utf8");
}

const appDataIndex = process.argv.indexOf("--app-data");
if (appDataIndex >= 0 && process.argv[appDataIndex + 1]) {
  app.setPath("userData", require("node:path").resolve(process.argv[appDataIndex + 1]));
}

app.whenReady()
  .then(() => import("./live-e2e-probe.mjs"))
  .catch(() => {
    writeFailureReport();
    app.exit(1);
  });
