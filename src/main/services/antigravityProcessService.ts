import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { resolveAntigravityPaths, type AntigravityPathInput } from "./antigravityPaths.js";

export interface AntigravityRestartInput {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exePath?: string | null;
  forceRelaunch?: boolean;
}

export interface AntigravityRestartResult {
  supported: boolean;
  attempted: boolean;
  restarted: boolean;
  exePath: string | null;
  reason: string;
}

export interface AntigravityQuiesceResult {
  supported: boolean;
  attempted: boolean;
  wasRunning: boolean;
  quiesced: boolean;
  reason: string;
}

export interface AntigravityCleanCacheResult {
  cleaned: string[];
  errors: string[];
}

export function cleanAntigravitySessionCache(
  input: AntigravityPathInput = {}
): AntigravityCleanCacheResult {
  const paths = resolveAntigravityPaths(input);
  const cleaned: string[] = [];
  const errors: string[] = [];

  const targets = [
    path.join(paths.userDataDir, "lockfile"),
    path.join(paths.userDataDir, "DevToolsActivePort"),
    path.join(paths.userDataDir, "SingletonLock"),
    path.join(paths.userDataDir, "SingletonCookie"),
    path.join(paths.userDataDir, "SingletonSocket")
  ];

  if (paths.secondaryStateDbPath) {
    const secondaryUserDir = path.dirname(path.dirname(paths.secondaryStateDbPath));
    targets.push(
      path.join(secondaryUserDir, "lockfile"),
      path.join(secondaryUserDir, "DevToolsActivePort"),
      path.join(secondaryUserDir, "SingletonLock")
    );
  }

  for (const target of targets) {
    try {
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
        cleaned.push(target);
      }
    } catch (err) {
      errors.push(`${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { cleaned, errors };
}

export function resolveAntigravityExecutablePath(input: AntigravityRestartInput = {}): string | null {
  if ((input.platform ?? process.platform) !== "win32") return null;
  if (input.exePath && fs.existsSync(input.exePath)) return input.exePath;
  const localAppData = input.env?.LOCALAPPDATA ?? process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const candidates = [
    path.join(localAppData, "Programs", "antigravity", "Antigravity.exe"),
    path.join(localAppData, "Programs", "Antigravity IDE", "Antigravity IDE.exe")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function quotePowerShellSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildAntigravityWindowsRestartScript(exePath: string): string {
  return `
$ErrorActionPreference = 'Stop'
$exePath = ${quotePowerShellSingle(exePath)}
Get-Process -Name 'Antigravity','Antigravity IDE','language_server' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 350
Start-Process -FilePath $exePath
`;
}

export function isAntigravityRunning(input: AntigravityRestartInput = {}): boolean {
  if ((input.platform ?? process.platform) !== "win32") return false;
  try {
    const result = spawnSync("tasklist.exe", ["/FI", "IMAGENAME eq Antigravity.exe", "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3_000
    });
    return Boolean(result.stdout && result.stdout.toLowerCase().includes("antigravity.exe"));
  } catch {
    return false;
  }
}

export function quiesceAntigravity(input: AntigravityRestartInput & { timeoutMs?: number } = {}): AntigravityQuiesceResult {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") {
    return {
      supported: false,
      attempted: false,
      wasRunning: false,
      quiesced: false,
      reason: "Antigravity quiesce is Windows only."
    };
  }

  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return {
      supported: true,
      attempted: false,
      wasRunning: false,
      quiesced: true,
      reason: "Antigravity quiesce bypassed in test environment."
    };
  }

  const running = isAntigravityRunning(input);
  if (!running) {
    return {
      supported: true,
      attempted: false,
      wasRunning: false,
      quiesced: true,
      reason: "Antigravity was not running."
    };
  }

  try {
    spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-Process -Name 'Antigravity','Antigravity IDE','language_server' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"
    ], {
      windowsHide: true,
      timeout: input.timeoutMs ?? 5_000
    });

    const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
    const timeout = Date.now() + (input.timeoutMs ?? 3_000);
    while (Date.now() < timeout) {
      Atomics.wait(sleepBuf, 0, 0, 150);
      if (!isAntigravityRunning(input)) {
        return {
          supported: true,
          attempted: true,
          wasRunning: true,
          quiesced: true,
          reason: "Antigravity process tree terminated to release SQLite state locks and in-memory session."
        };
      }
    }

    const stillRunning = isAntigravityRunning(input);
    return {
      supported: true,
      attempted: true,
      wasRunning: true,
      quiesced: !stillRunning,
      reason: stillRunning
        ? "Antigravity processes did not stop before timeout."
        : "Antigravity process tree terminated to release SQLite state locks and in-memory session."
    };
  } catch (error) {
    return {
      supported: true,
      attempted: true,
      wasRunning: true,
      quiesced: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

export function launchAntigravity(input: AntigravityRestartInput = {}): AntigravityRestartResult {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") {
    return {
      supported: false,
      attempted: false,
      restarted: false,
      exePath: null,
      reason: "Antigravity launch is Windows only."
    };
  }

  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return {
      supported: true,
      attempted: false,
      restarted: true,
      exePath: "C:\\mock\\Antigravity.exe",
      reason: "Antigravity launch bypassed in test environment."
    };
  }

  if (!input.forceRelaunch && isAntigravityRunning(input)) {
    return {
      supported: true,
      attempted: false,
      restarted: true,
      exePath: resolveAntigravityExecutablePath(input),
      reason: "Antigravity is already running."
    };
  }

  if (input.forceRelaunch && isAntigravityRunning(input)) {
    quiesceAntigravity(input);
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

  try {
    const child = spawn(exePath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return {
      supported: true,
      attempted: true,
      restarted: true,
      exePath,
      reason: "Antigravity launched successfully."
    };
  } catch (error) {
    return {
      supported: true,
      attempted: true,
      restarted: false,
      exePath,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
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

  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return {
      supported: true,
      attempted: false,
      restarted: true,
      exePath: "C:\\mock\\Antigravity.exe",
      reason: "Antigravity restart bypassed in test environment."
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
