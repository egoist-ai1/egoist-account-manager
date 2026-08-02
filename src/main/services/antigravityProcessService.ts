import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface AntigravityRestartInput {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exePath?: string | null;
}

export interface AntigravityRestartResult {
  supported: boolean;
  attempted: boolean;
  restarted: boolean;
  exePath: string | null;
  reason: string;
}

export function resolveAntigravityExecutablePath(input: AntigravityRestartInput = {}): string | null {
  if ((input.platform ?? process.platform) !== "win32") return null;
  if (input.exePath && fs.existsSync(input.exePath)) return input.exePath;
  const localAppData = input.env?.LOCALAPPDATA ?? process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const candidate = path.join(localAppData, "Programs", "antigravity", "Antigravity.exe");
  return fs.existsSync(candidate) ? candidate : null;
}

function quotePowerShellSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildAntigravityWindowsRestartScript(exePath: string): string {
  return `
$ErrorActionPreference = 'Stop'
$exePath = ${quotePowerShellSingle(exePath)}
Get-Process -Name 'Antigravity','language_server' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 350
Start-Process -FilePath $exePath
`;
}

export function restartAntigravityIntegration(input: AntigravityRestartInput = {}): AntigravityRestartResult {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") {
    return {
      supported: false,
      attempted: false,
      restarted: false,
      exePath: null,
      reason: "Antigravity restart is currently wired for Windows only."
    };
  }

  const exePath = resolveAntigravityExecutablePath(input);
  if (!exePath) {
    return {
      supported: false,
      attempted: false,
      restarted: false,
      exePath: null,
      reason: "Antigravity.exe was not found in the standard local installation path."
    };
  }

  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    buildAntigravityWindowsRestartScript(exePath)
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024
  });

  if (result.error) {
    return {
      supported: true,
      attempted: true,
      restarted: false,
      exePath,
      reason: result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      supported: true,
      attempted: true,
      restarted: false,
      exePath,
      reason: result.stderr?.trim() || "PowerShell restart command failed."
    };
  }

  return {
    supported: true,
    attempted: true,
    restarted: true,
    exePath,
    reason: "Antigravity restarted so the Hub can reload OS Credential Manager state."
  };
}
