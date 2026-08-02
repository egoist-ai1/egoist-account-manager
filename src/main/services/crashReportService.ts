import fs from "node:fs";
import path from "node:path";
import { appVersion } from "../../shared/releaseNotes.js";
import { redactSensitiveText } from "../../shared/redaction.js";

export function sanitizeCrashText(value: unknown): string {
  return redactSensitiveText(value).slice(0, 16_000);
}

export interface CrashReportRecord {
  format: "one.egoist.codex-account-manager.crash-report";
  appVersion: string;
  kind: string;
  generatedAt: string;
  message: string;
}

export function buildCrashReport(kind: string, error: unknown): CrashReportRecord {
  return {
    format: "one.egoist.codex-account-manager.crash-report",
    appVersion,
    kind,
    generatedAt: new Date().toISOString(),
    message: sanitizeCrashText(error)
  };
}

export function getCrashReportsDir(appDataDir: string): string {
  return path.join(appDataDir, "crash-reports");
}

export function writeCrashReport(appDataDir: string, kind: string, error: unknown): string {
  const dir = getCrashReportsDir(appDataDir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dir, `crash-${stamp}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(buildCrashReport(kind, error), null, 2)}\n`, "utf8");
  return filePath;
}
