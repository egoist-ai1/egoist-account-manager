import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertProbeOperationAllowed } from "./probeIsolationService.js";

export interface WindowsShortcutIconOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  productName: string;
  sourceIcoPath: string;
  version: string;
  executablePath?: string;
  log?: (message: string, error?: unknown) => void;
}

export interface ShortcutRefreshCommandOptions {
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
}

export type ShortcutRefreshCommandRunner = (script: string, options: ShortcutRefreshCommandOptions) => Promise<void>;

export interface WindowsShortcutIconAsyncOptions extends WindowsShortcutIconOptions {
  executablePath: string;
  iconDirectory?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  runner?: ShortcutRefreshCommandRunner;
}

export interface WindowsShortcutIconTargets {
  iconDir: string;
  stableIconPath: string;
  versionedIconPath: string;
  shortcuts: string[];
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function copyIfDifferent(sourceBytes: Buffer, targetPath: string): boolean {
  if (fs.existsSync(targetPath)) {
    const currentBytes = fs.readFileSync(targetPath);
    if (currentBytes.equals(sourceBytes)) return false;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, sourceBytes);
  return true;
}

export function getWindowsShortcutIconTargets(options: Pick<WindowsShortcutIconOptions, "env" | "productName" | "version">): WindowsShortcutIconTargets | null {
  const localAppData = options.env.LOCALAPPDATA;
  const roamingAppData = options.env.APPDATA;
  const userProfile = options.env.USERPROFILE;
  if (!localAppData || !roamingAppData) return null;

  const iconDir = path.join(localAppData, options.productName);
  const startMenuDir = path.join(roamingAppData, "Microsoft", "Windows", "Start Menu", "Programs");
  const shortcuts = [
    path.join(startMenuDir, `${options.productName}.lnk`),
    path.join(startMenuDir, options.productName, `${options.productName}.lnk`),
    path.join(roamingAppData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar", `${options.productName}.lnk`)
  ];
  if (userProfile) shortcuts.push(path.join(userProfile, "Desktop", `${options.productName}.lnk`));

  return {
    iconDir,
    stableIconPath: path.join(iconDir, "icon.ico"),
    versionedIconPath: path.join(iconDir, `icon-${options.version}.ico`),
    shortcuts
  };
}

export function buildShortcutRefreshScript(shortcuts: string[], iconPath: string, executablePath = process.execPath): string {
  const linkList = shortcuts.map(quotePowerShell).join(", ");
  const quotedIcon = quotePowerShell(`${iconPath},0`);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$links = @(${linkList})`,
    `$icon = ${quotedIcon}`,
    `$executable = ${quotePowerShell(executablePath)}`,
    "$shell = New-Object -ComObject WScript.Shell",
    "foreach ($link in $links) {",
    "  if (Test-Path -LiteralPath $link) {",
    "    $shortcut = $shell.CreateShortcut($link)",
    "    if ([String]::Equals($shortcut.TargetPath, $executable, [StringComparison]::OrdinalIgnoreCase) -and $shortcut.IconLocation -ne $icon) {",
    "      $shortcut.IconLocation = $icon",
    "      $shortcut.Save()",
    "    }",
    "  }",
    "}"
  ].join("\n");
}

export function syncWindowsShortcutIcon(options: WindowsShortcutIconOptions): void {
  if (options.platform !== "win32") return;
  assertProbeOperationAllowed("desktop-integration");
  const targets = getWindowsShortcutIconTargets(options);
  if (!targets) return;

  try {
    const sourceBytes = fs.readFileSync(options.sourceIcoPath);
    const stableChanged = copyIfDifferent(sourceBytes, targets.stableIconPath);
    const versionedChanged = copyIfDifferent(sourceBytes, targets.versionedIconPath);
    const existingShortcuts = targets.shortcuts.filter((shortcut) => fs.existsSync(shortcut));
    if (existingShortcuts.length === 0) return;

    const script = buildShortcutRefreshScript(existingShortcuts, targets.versionedIconPath, options.executablePath);
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true
    });
    if (result.error || result.status !== 0) {
      options.log?.("Failed to refresh Windows shortcut icon links", new Error(`Shortcut refresh helper failed (exit ${result.status ?? "unknown"})`));
    }

    if (stableChanged || versionedChanged) {
      options.log?.(`Windows shortcut icon synced: ${targets.versionedIconPath}`);
    }
  } catch (error) {
    options.log?.("Failed to sync Windows shortcut icon", error);
  }
}

async function copyIfDifferentAsync(sourceBytes: Buffer, targetPath: string): Promise<boolean> {
  try {
    if ((await fs.promises.readFile(targetPath)).equals(sourceBytes)) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, sourceBytes);
  return true;
}

const runShortcutRefreshCommand: ShortcutRefreshCommandRunner = (script, options) => new Promise((resolve, reject) => {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    timeout: options.timeoutMs,
    signal: options.signal,
    killSignal: "SIGKILL",
    windowsHide: true,
    maxBuffer: 64 * 1024
  }, (error) => {
    if (error) {
      const failure = new Error("Shortcut refresh helper failed or timed out");
      if (error.name === "AbortError") failure.name = "AbortError";
      reject(failure);
    } else resolve();
  });
});

/** Best-effort integration after shell readiness; no synchronous filesystem or native helper. */
export async function syncWindowsShortcutIconAsync(options: WindowsShortcutIconAsyncOptions): Promise<void> {
  if (options.platform !== "win32") return;
  assertProbeOperationAllowed("desktop-integration");
  const original = getWindowsShortcutIconTargets(options);
  if (!original || options.signal?.aborted) return;
  try {
    if (!path.isAbsolute(options.executablePath)) throw new Error("Shortcut refresh requires an absolute executable path");
    const timeoutMs = Math.min(options.timeoutMs ?? 5_000, 5_000);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Shortcut refresh requires a finite positive timeout");
    const targets = options.iconDirectory ? {
      ...original, iconDir: options.iconDirectory,
      stableIconPath: path.join(options.iconDirectory, "icon.ico"),
      versionedIconPath: path.join(options.iconDirectory, `icon-${options.version}.ico`)
    } : original;
    if (!path.isAbsolute(targets.iconDir)) throw new Error("Shortcut icon directory must be absolute");
    const sourceBytes = await fs.promises.readFile(options.sourceIcoPath);
    if (options.signal?.aborted) return;
    const stableChanged = await copyIfDifferentAsync(sourceBytes, targets.stableIconPath);
    const versionedChanged = await copyIfDifferentAsync(sourceBytes, targets.versionedIconPath);
    const existingShortcuts: string[] = [];
    for (const shortcut of targets.shortcuts) {
      try {
        if ((await fs.promises.stat(shortcut)).isFile()) existingShortcuts.push(shortcut);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (options.signal?.aborted) return;
    if (existingShortcuts.length > 0) {
      await (options.runner ?? runShortcutRefreshCommand)(
        buildShortcutRefreshScript(existingShortcuts, targets.versionedIconPath, options.executablePath),
        { env: options.env, signal: options.signal, timeoutMs }
      );
    }
    if (stableChanged || versionedChanged) options.log?.("Windows shortcut icon cache synced");
  } catch (error) {
    options.log?.("Failed to sync Windows shortcut icon", error);
  }
}
