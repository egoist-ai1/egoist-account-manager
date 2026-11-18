import fs from "node:fs";
import path from "node:path";
import { execFile, spawn, spawnSync } from "node:child_process";

import { assertManagedPath } from "../paths.js";
import { resolveAntigravityPaths, type AntigravityPathInput } from "./antigravityPaths.js";
import { assertProbeOperationAllowed } from "./probeIsolationService.js";

export interface AntigravityRestartInput {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exePath?: string | null;
  forceRelaunch?: boolean;
  requireQuiescent?: boolean;
}

export interface AntigravityRestartResult {
  supported: boolean;
  attempted: boolean;
  restarted: boolean;
  exePath: string | null;
  reason: string;
  pid?: number;
  creationTime?: string;
  windowObserved?: boolean;
}

export interface AntigravityQuiesceResult {
  supported: boolean;
  attempted: boolean;
  wasRunning: boolean;
  quiesced: boolean;
  reason: string;
  exePath?: string;
  target?: AntigravityProcessTarget;
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
    const secondaryUserDir = path.dirname(path.dirname(path.dirname(paths.secondaryStateDbPath)));
    targets.push(
      path.join(secondaryUserDir, "lockfile"),
      path.join(secondaryUserDir, "DevToolsActivePort"),
      path.join(secondaryUserDir, "SingletonLock")
    );
  }

  for (const target of targets) {
    try {
      if (fs.existsSync(target)) {
        fs.unlinkSync(assertManagedPath(path.dirname(target), target));
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

function antigravityExecutableCandidates(input: AntigravityRestartInput): string[] {
  const localAppData = input.env?.LOCALAPPDATA ?? process.env.LOCALAPPDATA;
  return [
    ...(input.exePath ? [input.exePath] : []),
    ...(localAppData ? [
      path.join(localAppData, "Programs", "antigravity", "Antigravity.exe"),
      path.join(localAppData, "Programs", "Antigravity IDE", "Antigravity IDE.exe")
    ] : [])
  ];
}

function buildAntigravityWindowsStopScript(exePaths: string[]): string {
  if (exePaths.length === 0) throw new Error("Cannot identify the Antigravity installation safely.");
  return `
$ErrorActionPreference = 'Stop'
$targetExePaths = @(${exePaths.map(quotePowerShellSingle).join(", ")})
$allProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop)
$ambiguous = @($allProcesses | Where-Object { $_.Name -in @('Antigravity.exe', 'Antigravity IDE.exe') -and -not $_.ExecutablePath })
if ($ambiguous.Count -gt 0) { throw 'Cannot verify the executable path of an Antigravity process.' }
$ownedProcesses = @{}
$allProcesses | Where-Object { $_.ExecutablePath -and $targetExePaths -contains $_.ExecutablePath } | ForEach-Object { $ownedProcesses[$_.ProcessId] = $_ }
do {
  $added = $false
  foreach ($candidate in $allProcesses) {
    if ($ownedProcesses.ContainsKey($candidate.ParentProcessId) -and -not $ownedProcesses.ContainsKey($candidate.ProcessId)) {
      $ownedProcesses[$candidate.ProcessId] = $candidate
      $added = $true
    }
  }
} while ($added)
foreach ($ownedProcess in @($ownedProcesses.Values)) {
  $currentProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $ownedProcess.ProcessId) -ErrorAction Stop
  if ($currentProcess -and $currentProcess.CreationDate -eq $ownedProcess.CreationDate) {
    Stop-Process -Id $ownedProcess.ProcessId -Force -ErrorAction Stop
  }
}
`;
}

export function buildAntigravityWindowsRestartScript(exePath: string): string {
  return `${buildAntigravityWindowsStopScript([exePath])}
$exePath = ${quotePowerShellSingle(exePath)}
Start-Sleep -Milliseconds 350
Start-Process -FilePath $exePath -WindowStyle Hidden
`;
}

function inspectAntigravityRunning(): boolean {
  const result = spawnSync("tasklist.exe", ["/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || "Antigravity process detection failed.");
  return /^"Antigravity(?: IDE)?\.exe",/im.test(result.stdout ?? "");
}

export function isAntigravityRunning(input: AntigravityRestartInput = {}): boolean {
  if ((input.platform ?? process.platform) !== "win32") return false;
  try {
    assertProbeOperationAllowed("host-discovery");
    return inspectAntigravityRunning();
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
      supported: false,
      attempted: false,
      wasRunning: false,
      quiesced: false,
      reason: "Native process actions require an explicit test adapter."
    };
  }

  let running: boolean;
  try {
    assertProbeOperationAllowed("desktop-process-control");
    running = inspectAntigravityRunning();
  } catch (error) {
    return {
      supported: true, attempted: false, wasRunning: false, quiesced: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
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
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      buildAntigravityWindowsStopScript(antigravityExecutableCandidates(input))
    ], {
      encoding: "utf8",
      windowsHide: true,
      timeout: input.timeoutMs ?? 5_000
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr?.trim() || "Antigravity process stop failed.");

    const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
    const timeout = Date.now() + (input.timeoutMs ?? 3_000);
    while (Date.now() < timeout) {
      Atomics.wait(sleepBuf, 0, 0, 150);
      if (!inspectAntigravityRunning()) {
        return {
          supported: true,
          attempted: true,
          wasRunning: true,
          quiesced: true,
          reason: "Antigravity process tree terminated to release SQLite state locks and in-memory session."
        };
      }
    }

    const stillRunning = inspectAntigravityRunning();
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
      supported: false,
      attempted: false,
      restarted: false,
      exePath: null,
      reason: "Native process actions require an explicit test adapter."
    };
  }

  assertProbeOperationAllowed("desktop-process-control");
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
    const stopped = quiesceAntigravity(input);
    if (!stopped.quiesced) {
      return {
        supported: stopped.supported, attempted: stopped.attempted, restarted: false,
        exePath: resolveAntigravityExecutablePath(input), reason: stopped.reason
      };
    }
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
      supported: false,
      attempted: false,
      restarted: false,
      exePath: null,
      reason: "Native process actions require an explicit test adapter."
    };
  }

  assertProbeOperationAllowed("desktop-process-control");
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


export interface AntigravityRuntimeProcess {
  pid: number;
  parentPid: number;
  creationTime: string;
  executablePath: string;
  commandLine: string;
  name?: string;
  mainWindowHandle?: number;
}

export interface AntigravityRuntimeListener {
  port: number;
  pid: number;
  localAddress: string;
}

export interface AntigravityRuntimeNativeSnapshot {
  processes: AntigravityRuntimeProcess[];
  listeners: AntigravityRuntimeListener[];
}

export interface AntigravityRuntimeBinding {
  port: number;
  csrf: string;
  runtimePid: number;
  runtimeCreationTime: string;
  idePid: number;
  ideCreationTime: string;
  profilePath: string;
}

export interface AntigravityRuntimeInspectionInput extends AntigravityPathInput, AntigravityRestartInput {
  readNativeSnapshot?: () => Promise<AntigravityRuntimeNativeSnapshot>;
  expectedIde?: { pid: number; creationTime: string };
}

function readRuntimeNativeSnapshot(paths: string[]): Promise<AntigravityRuntimeNativeSnapshot> {
  assertProbeOperationAllowed("host-discovery");
  const script = `${processInventoryScript(paths, "runtime")}
$byPid = @{}
foreach ($row in $inventoryRows) { $byPid[$row.pid] = $row }
$runtimeProcesses = @{}
$serverPids = @()
foreach ($server in @($inventoryRows | Where-Object { $_.name -like 'language_server*.exe' -and $_.commandLine })) {
  $current = $server
  $tree = @{}
  while ($current -and -not $tree.ContainsKey($current.pid)) {
    $tree[$current.pid] = $current
    if ($current.executablePath -in $exePaths -and $current.commandLine -and $current.commandLine -notmatch '(?:^|\\s)--type(?:=|\\s)') {
      $serverPids += $server.pid
      foreach ($branch in $tree.Values) { $runtimeProcesses[$branch.pid] = $branch }
      break
    }
    $current = $byPid[$current.parentPid]
  }
}
$runtimeListeners = @()
if ($serverPids.Count -gt 0) {
  $runtimeListeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {
    $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -in $serverPids
  } | ForEach-Object {
    [pscustomobject]@{ port = [int]$_.LocalPort; pid = [int]$_.OwningProcess; localAddress = [string]$_.LocalAddress }
  })
}
[pscustomobject]@{ processes = @($runtimeProcesses.Values); listeners = $runtimeListeners } | ConvertTo-Json -Depth 4 -Compress
`;
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(new Error("Antigravity runtime ownership could not be inspected"));
      try {
        const parsed = JSON.parse(stdout) as AntigravityRuntimeNativeSnapshot;
        if (!Array.isArray(parsed.processes) || !Array.isArray(parsed.listeners)) throw new Error("Invalid native process snapshot");
        resolve(parsed);
      } catch {
        reject(new Error("Antigravity native process snapshot is unavailable"));
      }
    });
  });
}

function commandArgument(commandLine: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:=|\\s+)(?:"([^"\\r\\n]+)"|'([^'\\r\\n]+)'|([^\\s]+))`, "i").exec(commandLine)?.slice(1).find(Boolean) ?? null;
}

export async function inspectAntigravityRuntimeBinding(input: AntigravityRuntimeInspectionInput = {}): Promise<AntigravityRuntimeBinding | null> {
  if ((input.platform ?? process.platform) !== "win32") return null;
  if (!input.readNativeSnapshot && (process.env.VITEST || process.env.NODE_ENV === "test")) return null;
  try {
    if (!input.readNativeSnapshot) assertProbeOperationAllowed("host-discovery");
    const candidates = (input.target
      ? antigravityInstallations(input).filter((candidate) =>
        candidate.target === input.target && (!input.exePath || sameWindowsPath(candidate.exePath, input.exePath))
      ).map((candidate) => candidate.exePath)
      : antigravityExecutableCandidates(input)).map(windowsPathKey);
    if (!candidates.length) return null;
    const snapshot = await (input.readNativeSnapshot?.() ?? readRuntimeNativeSnapshot(candidates));
    const expectedProfile = resolveAntigravityPaths(input).userDataDir;
    if (input.target === "hub" && !usesHostHubProfile(input, expectedProfile)) return null;
    const processes = new Map(snapshot.processes.map((process) => [process.pid, process]));
    const found: AntigravityRuntimeBinding[] = [];
    for (const listener of snapshot.listeners) {
      if (listener.localAddress !== "127.0.0.1" || !Number.isInteger(listener.port) || listener.port < 1 || listener.port > 65535) continue;
      const server = processes.get(listener.pid);
      if (!server || !/language_server.*\.exe$/i.test(path.win32.basename(server.executablePath))) continue;
      const csrf = commandArgument(server.commandLine, "--csrf_token");
      if (!csrf || !/^[a-zA-Z0-9_-]{16,256}$/.test(csrf)) continue;
      const declaredPort = Number(commandArgument(server.commandLine, "--https_server_port"));
      if (declaredPort > 0 && declaredPort !== listener.port) continue;
      let current: AntigravityRuntimeProcess | undefined = server;
      const visited = new Set<number>();
      while (current && !visited.has(current.pid)) {
        visited.add(current.pid);
        if (current.executablePath && current.commandLine && candidates.includes(windowsPathKey(current.executablePath))) {
          const expectedIde = input.expectedIde;
          const matchesLaunch = !expectedIde
            || (current.pid === expectedIde.pid && current.creationTime === expectedIde.creationTime);
          const isBrowserProcess = !commandArgument(current.commandLine, "--type");
          const profile = boundAntigravityProfile(current, server, expectedProfile, input.target);
          const serverTime = Date.parse(server.creationTime);
          const ideTime = Date.parse(current.creationTime);
          if (matchesLaunch && isBrowserProcess && profile
            && Number.isFinite(serverTime) && Number.isFinite(ideTime) && serverTime >= ideTime) {
            found.push({ port: listener.port, csrf, runtimePid: server.pid, runtimeCreationTime: server.creationTime, idePid: current.pid, ideCreationTime: current.creationTime, profilePath: profile });
            break;
          }
          // Electron может передать --user-data-dir и дочернему renderer. Сверяем его
          // профиль перед тем, как идти дальше к родителю с ожидаемым PID.
          const selectedProfile = commandArgument(current.commandLine, "--user-data-dir");
          if (selectedProfile && (!path.win32.isAbsolute(selectedProfile) || !sameWindowsPath(selectedProfile, expectedProfile))) break;
          if (isBrowserProcess) break;
        }
        const parent = processes.get(current.parentPid);
        if (parent && (!Number.isFinite(Date.parse(parent.creationTime)) || !Number.isFinite(Date.parse(current.creationTime)) || Date.parse(parent.creationTime) > Date.parse(current.creationTime))) break;
        current = parent;
      }
    }
    return found.length === 1 ? found[0] : null;
  } catch {
    return null;
  }
}

function boundAntigravityProfile(
  owner: AntigravityRuntimeProcess,
  server: AntigravityRuntimeProcess,
  expectedProfile: string,
  target?: AntigravityProcessTarget
): string | null {
  const profile = commandArgument(owner.commandLine, "--user-data-dir");
  if (profile && (!path.win32.isAbsolute(profile) || !sameWindowsPath(profile, expectedProfile))) return null;
  const installDir = path.win32.dirname(owner.executablePath);
  if (target === "hub") {
    const bundledServer = path.win32.join(installDir, "resources", "bin", "language_server.exe");
    return sameWindowsPath(bundledServer, server.executablePath)
      && /(?:^|\s)--standalone(?=\s|$)/.test(server.commandLine)
      && commandArgument(server.commandLine, "--app_data_dir") === "antigravity"
      ? expectedProfile : null;
  }
  const relative = path.win32.relative(installDir, server.executablePath);
  return profile && relative && relative !== ".." && !relative.startsWith("..\\") && !path.win32.isAbsolute(relative)
    ? profile : null;
}


export interface AntigravityAsyncProcessAdapter {
  run(command: string, args: string[], timeoutMs: number): Promise<string>;
  launch(exePath: string, args: string[]): Promise<number>;
}

export interface AntigravityAsyncProcessInput extends AntigravityRestartInput, AntigravityPathInput {
  timeoutMs?: number;
  processAdapter?: AntigravityAsyncProcessAdapter;
}

function classifyNativeProcessError(error: unknown, stderr?: string): Error {
  const nativeError = error as NodeJS.ErrnoException;
  const combined = `${nativeError.message ?? ""} ${stderr ?? ""}`;
  if (combined.includes("ANTIGRAVITY_PROCESS_IDENTITY_CHANGED")) {
    return new Error("Antigravity process ownership changed");
  }
  if (combined.includes("ANTIGRAVITY_PROCESS_HAS_WINDOW")) {
    return new Error("Antigravity still has an open window; finish saving your work and close it before switching");
  }
  if (nativeError.code === "EACCES" || /access(?:\s+is)?\s+denied|отказано в доступе/i.test(combined)) {
    return new Error("Antigravity process access is denied");
  }
  if (nativeError.code === "ETIMEDOUT" || (error as { killed?: boolean }).killed || /timed?\s*out/i.test(combined)) {
    return new Error("Antigravity process operation timed out");
  }
  return new Error("Antigravity native process operation failed");
}

const nativeAsyncProcessAdapter: AntigravityAsyncProcessAdapter = {
  run(command, args, timeoutMs) {
    return new Promise((resolve, reject) => {
      execFile(command, args, { encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(classifyNativeProcessError(error, typeof stderr === "string" ? stderr : undefined));
        else resolve(stdout);
      });
    });
  },
  launch(exePath, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(exePath, args, {
        cwd: path.dirname(exePath),
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });
      child.once("error", () => reject(new Error("Antigravity process could not be started")));
      child.once("spawn", () => {
        child.unref();
        if (!child.pid) reject(new Error("Antigravity spawn returned no process ID"));
        else resolve(child.pid);
      });
    });
  }
};

function processInventoryScript(paths: string[], mode: "lifecycle" | "runtime"): string {
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$exePaths = @(${paths.map(quotePowerShellSingle).join(", ")})
$installPrefixes = @($exePaths | ForEach-Object { [IO.Path]::GetDirectoryName($_).TrimEnd('\\') + '\\' })
$processes = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,ExecutablePath,Name -ErrorAction Stop)
$processFilter = "Name = 'Antigravity.exe' OR Name = 'Antigravity IDE.exe'"
if ($${mode === "runtime"}) { $processFilter += " OR Name LIKE 'language_server%.exe'" }
$details = @{}
Get-CimInstance Win32_Process -Filter $processFilter -Property ProcessId,CommandLine,CreationDate,ExecutablePath -ErrorAction Stop | ForEach-Object {
  $details[$_.ProcessId] = $_
}
$inventoryRows = @($processes | ForEach-Object {
  $commandLine = $null
  $windowHandle = 0
  $exe = [string]$_.ExecutablePath
  $knownExe = $exe -in $exePaths
  $possibleLanguageServer = $${mode === "runtime"} -and $_.Name -like 'language_server*.exe' -and @($installPrefixes | Where-Object {
    $exe.StartsWith($_, [StringComparison]::OrdinalIgnoreCase)
  }).Count -gt 0
  if ($knownExe -or $possibleLanguageServer) {
    $detail = $details[$_.ProcessId]
    if ($detail -and $detail.CreationDate -eq $_.CreationDate -and $detail.ExecutablePath -eq $_.ExecutablePath) {
      $commandLine = [string]$detail.CommandLine
    }
  }
  if ($knownExe -and $${mode === "lifecycle"}) {
    try {
      $process = Get-Process -Id $_.ProcessId -ErrorAction Stop
      try { $windowHandle = [int64]$process.MainWindowHandle } finally { $process.Dispose() }
    } catch {}
  }
  [pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; creationTime = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }); executablePath = $exe; commandLine = [string]$commandLine; name = [string]$_.Name; mainWindowHandle = $windowHandle }
})
`;
}

async function readProcessInventory(
  adapter: AntigravityAsyncProcessAdapter,
  timeoutMs: number,
  installations: AntigravitySwitchTarget[]
): Promise<AntigravityRuntimeProcess[]> {
  const script = `${processInventoryScript(installations.map((item) => item.exePath), "lifecycle")}
[pscustomobject]@{ processes = $inventoryRows } | ConvertTo-Json -Depth 3 -Compress
`;
  const stdout = await adapter.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], timeoutMs);
  const parsed = JSON.parse(stdout) as { processes?: AntigravityRuntimeProcess[] };
  if (!Array.isArray(parsed.processes)) throw new Error("Antigravity process inventory is invalid");
  return parsed.processes;
}

type AntigravityProcessTarget = NonNullable<AntigravityPathInput["target"]>;

export interface AntigravitySwitchTarget {
  target: AntigravityProcessTarget;
  exePath: string;
}

function windowsPathKey(value: string): string {
  return path.win32.resolve(value).toLowerCase();
}

function sameWindowsPath(left: string, right: string): boolean {
  return windowsPathKey(left) === windowsPathKey(right);
}

function isLegacyIdeInstallation(exePath: string): boolean {
  try {
    const metadata = path.join(path.dirname(exePath), "resources", "app", "extensions", "antigravity", "package.json");
    const extension = JSON.parse(fs.readFileSync(metadata, "utf8")) as { name?: string; publisher?: string };
    return extension.name === "antigravity" && extension.publisher === "google";
  } catch {
    return false;
  }
}

function antigravityInstallations(input: AntigravityAsyncProcessInput): AntigravitySwitchTarget[] {
  const [antigravityExe, ideExe] = antigravityExecutableCandidates({ ...input, exePath: null });
  const installations: AntigravitySwitchTarget[] = [];
  if (ideExe) installations.push({ target: "ide", exePath: ideExe });
  if (antigravityExe) {
    const target = isLegacyIdeInstallation(antigravityExe) ? "ide" : "hub";
    installations.push({ target, exePath: antigravityExe });
  }
  if (input.exePath && !installations.some((candidate) => sameWindowsPath(candidate.exePath, input.exePath!))) {
    // Известный exe, выбранный вызывающей стороной или сохранённый в снимке восстановления.
    installations.unshift({ target: input.target ?? "ide", exePath: input.exePath });
  }
  return installations;
}

function installationIsAvailable(exePath: string): boolean {
  return fs.statSync(exePath, { throwIfNoEntry: false })?.isFile() ?? false;
}

function runningAntigravityInstallation(
  rows: AntigravityRuntimeProcess[],
  installations: AntigravitySwitchTarget[]
): AntigravitySwitchTarget | null {
  let running: AntigravitySwitchTarget | null = null;
  for (const row of rows) {
    const candidate = row.executablePath && installations.find((item) => sameWindowsPath(item.exePath, row.executablePath));
    if (!candidate) {
      if (/^(Antigravity|Antigravity IDE)\.exe$/i.test(row.name ?? path.win32.basename(row.executablePath))) {
        throw new Error("Antigravity executable path is unavailable or unrecognized");
      }
      continue;
    }
    if (running && !sameWindowsPath(running.exePath, candidate.exePath)) {
      throw new Error("Antigravity Hub and IDE or multiple Antigravity installations are running; close the other application before switching");
    }
    running = candidate;
  }
  return running;
}

function selectInstalledAntigravity(
  installations: AntigravitySwitchTarget[],
  target?: AntigravityProcessTarget,
  exePath?: string | null
): AntigravitySwitchTarget {
  const selected = installations.find((item) =>
    (!target || item.target === target) && (!exePath || sameWindowsPath(item.exePath, exePath)) && installationIsAvailable(item.exePath)
  );
  if (!selected) throw new Error("The selected Antigravity executable was not found");
  return selected;
}

function requireSelectedInstallation(
  running: AntigravitySwitchTarget,
  input: AntigravityAsyncProcessInput
): void {
  if ((input.target && input.target !== running.target) || (input.exePath && !sameWindowsPath(input.exePath, running.exePath))) {
    throw new Error("A different Antigravity application is running; close it before switching");
  }
}

function processInspectionAvailable(input: AntigravityAsyncProcessInput): boolean {
  return (input.platform ?? process.platform) === "win32"
    && (input.processAdapter !== undefined || !(process.env.VITEST || process.env.NODE_ENV === "test"));
}

export async function resolveAntigravitySwitchTarget(
  input: AntigravityAsyncProcessInput = {}
): Promise<AntigravitySwitchTarget> {
  if (!processInspectionAvailable(input)) throw new Error("Antigravity native process inspection is unavailable");
  if (!input.processAdapter) assertProbeOperationAllowed("host-discovery");
  const adapter = input.processAdapter ?? nativeAsyncProcessAdapter;
  const installations = antigravityInstallations(input);
  const rows = await readProcessInventory(adapter, input.timeoutMs ?? 5_000, installations);
  const running = runningAntigravityInstallation(rows, installations);
  if (running) return selectInstalledAntigravity(installations, running.target, running.exePath);
  const preferred = installations.filter((candidate) => candidate.target === input.target);
  return selectInstalledAntigravity(
    [...preferred, ...installations.filter((candidate) => candidate.target !== input.target)],
    undefined,
    input.exePath
  );
}

function validProcessIdentity(row: AntigravityRuntimeProcess): boolean {
  return Boolean(row.executablePath) && Number.isFinite(Date.parse(row.creationTime)) && Number.isInteger(row.pid) && row.pid > 0;
}

function usesHostHubProfile(input: AntigravityAsyncProcessInput, userDataDir: string): boolean {
  const appData = input.env?.APPDATA ?? process.env.APPDATA;
  return Boolean(appData && sameWindowsPath(userDataDir, path.win32.join(appData, "Antigravity")));
}

function selectedProfile(input: AntigravityAsyncProcessInput, target: AntigravityProcessTarget): string {
  const profile = resolveAntigravityPaths({ ...input, target }).userDataDir;
  if (target === "hub" && !usesHostHubProfile(input, profile)) {
    throw new Error("Antigravity Hub can only be restarted for the current Windows user profile");
  }
  return profile;
}

function isInsideInstallation(row: AntigravityRuntimeProcess, installation: AntigravitySwitchTarget): boolean {
  const relative = path.win32.relative(path.win32.dirname(installation.exePath), row.executablePath);
  return relative !== "" && relative !== ".." && !relative.startsWith("..\\") && !path.win32.isAbsolute(relative);
}

function ownedAntigravityProcesses(
  rows: AntigravityRuntimeProcess[],
  installation: AntigravitySwitchTarget,
  userDataDir: string,
  captured?: Map<number, AntigravityRuntimeProcess>
): AntigravityRuntimeProcess[] {
  const owned = new Map<number, AntigravityRuntimeProcess>();
  const appProcesses = rows.filter((row) => row.executablePath && sameWindowsPath(row.executablePath, installation.exePath));
  const orphanedServers = rows.filter((row) =>
    /^language_server.*\.exe$/i.test(path.win32.basename(row.executablePath)) && isInsideInstallation(row, installation)
  );
  for (const root of appProcesses) {
    if (!validProcessIdentity(root)) throw new Error("Antigravity process creation time is unavailable");
    if (!root.commandLine) throw new Error("Antigravity profile ownership could not be read");
    const selectedProfile = commandArgument(root.commandLine, "--user-data-dir");
    if (selectedProfile && (!path.win32.isAbsolute(selectedProfile) || !sameWindowsPath(selectedProfile, userDataDir))) {
      throw new Error("Another Antigravity profile is running; scoped quiesce is unavailable");
    }
  }
  if (captured) {
    for (const row of rows) {
      const original = captured.get(row.pid);
      if (!original) continue;
      if (!validProcessIdentity(row) || row.creationTime !== original.creationTime || !sameWindowsPath(row.executablePath, original.executablePath)) {
        throw new Error("Antigravity process ownership changed");
      }
      owned.set(row.pid, row);
    }
  } else {
    for (const row of appProcesses) owned.set(row.pid, row);
  }
  let added = true;
  while (added) {
    added = false;
    for (const row of rows) {
      const parent = owned.get(row.parentPid);
      if (!parent || owned.has(row.pid)) continue;
      if (!row.executablePath) throw new Error("Antigravity descendant executable path is unavailable");
      if (!isInsideInstallation(row, installation)) continue;
      if (!validProcessIdentity(row) || Date.parse(row.creationTime) < Date.parse(parent.creationTime)) {
        throw new Error("Antigravity descendant ownership changed");
      }
      owned.set(row.pid, row);
      added = true;
    }
  }
  for (const row of [...appProcesses, ...orphanedServers]) {
    if (owned.has(row.pid)) continue;
    if (captured) throw new Error("A new Antigravity process appeared during shutdown; retry switching");
    if (!validProcessIdentity(row)) throw new Error("Antigravity language server ownership is unavailable");
    owned.set(row.pid, row);
  }
  if (captured) {
    for (const row of owned.values()) captured.set(row.pid, row);
  }
  return [...owned.values()];
}

function guardedProcessAction(row: AntigravityRuntimeProcess, action: string): string {
  return `
$liveProcess = Get-Process -Id ${row.pid} -ErrorAction SilentlyContinue
if ($liveProcess) {
  try {
    $null = $liveProcess.Handle
    $currentOwnedProcess = Get-CimInstance Win32_Process -Filter 'ProcessId = ${row.pid}' -ErrorAction Stop
    if ($currentOwnedProcess -and -not $liveProcess.HasExited) {
      if ($currentOwnedProcess.ExecutablePath -ne ${quotePowerShellSingle(row.executablePath)} -or -not $currentOwnedProcess.CreationDate -or $currentOwnedProcess.CreationDate.ToUniversalTime().ToString('o') -ne ${quotePowerShellSingle(row.creationTime)}) {
        throw 'ANTIGRAVITY_PROCESS_IDENTITY_CHANGED'
      }
      if ($liveProcess.Path -ne $currentOwnedProcess.ExecutablePath -or [math]::Abs($liveProcess.StartTime.ToUniversalTime().Ticks - $currentOwnedProcess.CreationDate.ToUniversalTime().Ticks) -gt 9) {
        throw 'ANTIGRAVITY_PROCESS_IDENTITY_CHANGED'
      }
      if (-not $liveProcess.HasExited) { ${action} }
    }
  } catch [System.InvalidOperationException] {
    if (-not $liveProcess.HasExited) { throw }
  } finally {
    $liveProcess.Dispose()
  }
}
`;
}

function changeOwnedProcesses(
  adapter: AntigravityAsyncProcessAdapter,
  rows: AntigravityRuntimeProcess[],
  timeoutMs: number,
  action: string
): Promise<string> {
  const script = "$ErrorActionPreference = 'Stop'\n" + rows.map((row) => guardedProcessAction(row, action)).join("\n");
  return adapter.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], timeoutMs);
}

async function waitForAntigravityExit(
  inspect: () => Promise<AntigravityRuntimeProcess[]>,
  waitMs: number
): Promise<AntigravityRuntimeProcess[]> {
  const deadline = Date.now() + waitMs;
  do {
    const remaining = await inspect();
    if (!remaining.length || Date.now() >= deadline) return remaining;
    await new Promise((resolve) => setTimeout(resolve, Math.min(150, deadline - Date.now())));
  } while (true);
}

export async function quiesceAntigravityAsync(input: AntigravityAsyncProcessInput = {}): Promise<AntigravityQuiesceResult> {
  const unsupported = { supported: false, attempted: false, wasRunning: false, quiesced: false, reason: "Antigravity native quiesce is unavailable" };
  if (!processInspectionAvailable(input)) return unsupported;
  const adapter = input.processAdapter ?? nativeAsyncProcessAdapter;
  const timeoutMs = Math.min(20_000, Math.max(500, input.timeoutMs ?? 5_000));
  let wasRunning = false;
  let attempted = false;
  let selected: AntigravitySwitchTarget | undefined;
  try {
    if (!input.processAdapter) assertProbeOperationAllowed("desktop-process-control");
    const installations = antigravityInstallations(input);
    const inventory = await readProcessInventory(adapter, timeoutMs, installations);
    const running = runningAntigravityInstallation(inventory, installations);
    if (running) requireSelectedInstallation(running, input);
    const installation = running ?? selectInstalledAntigravity(installations, input.target, input.exePath);
    selected = installation;
    const profile = selectedProfile(input, installation.target);
    const initial = ownedAntigravityProcesses(inventory, installation, profile);
    wasRunning = initial.length > 0;
    if (!wasRunning) return { supported: true, attempted: false, wasRunning, quiesced: true, ...installation, reason: "Antigravity was not running" };

    if (initial.some((row) => row.pid === process.pid)) throw new Error("Antigravity cannot be stopped by a manager running inside its process tree");
    const roots = initial.filter((row) => sameWindowsPath(row.executablePath, installation.exePath)
      && !commandArgument(row.commandLine, "--type"));
    const captured = new Map(initial.map((row) => [row.pid, row]));
    const inspect = async () => {
      const current = await readProcessInventory(adapter, timeoutMs, installations);
      const currentInstallation = runningAntigravityInstallation(current, installations);
      if (currentInstallation) requireSelectedInstallation(currentInstallation, installation);
      return ownedAntigravityProcesses(current, installation, profile, captured);
    };
    attempted = true;
    if (roots.length) await changeOwnedProcesses(adapter, roots, timeoutMs, "[void]$liveProcess.CloseMainWindow()");
    let remaining = await waitForAntigravityExit(inspect, roots.length ? Math.min(2_500, timeoutMs) : 0);
    if (remaining.some((row) => (row.mainWindowHandle ?? 0) > 0)) {
      throw new Error("Antigravity still has an open window; finish saving your work and close it before switching");
    }
    if (remaining.length) {
      await changeOwnedProcesses(adapter, [...remaining].reverse(), timeoutMs,
        "if ($liveProcess.MainWindowHandle -ne 0) { throw 'ANTIGRAVITY_PROCESS_HAS_WINDOW' }; Stop-Process -InputObject $liveProcess -Force -ErrorAction Stop");
      remaining = await waitForAntigravityExit(inspect, timeoutMs);
    }
    const quiesced = remaining.length === 0;
    return { supported: true, attempted, wasRunning, quiesced, ...installation,
      reason: quiesced ? "Antigravity's owned process tree stopped" : "Antigravity did not stop before timeout" };
  } catch (error) {
    return { supported: true, attempted, wasRunning, quiesced: false, ...selected,
      reason: error instanceof Error ? error.message : "Antigravity quiesce failed" };
  }
}

export async function launchAntigravityAsync(input: AntigravityAsyncProcessInput = {}): Promise<AntigravityRestartResult> {
  const unsupported = { supported: false, attempted: false, restarted: false, exePath: null, reason: "Antigravity native launch is unavailable" };
  if (!processInspectionAvailable(input)) return unsupported;
  const adapter = input.processAdapter ?? nativeAsyncProcessAdapter;
  const timeoutMs = Math.min(20_000, Math.max(500, input.timeoutMs ?? 15_000));
  const inspectionTimeoutMs = Math.min(5_000, timeoutMs);
  let exePath: string | null = null;
  let attempted = false;
  try {
    if (!input.processAdapter) assertProbeOperationAllowed("desktop-process-control");
    const installations = antigravityInstallations(input);
    const rows = await readProcessInventory(adapter, inspectionTimeoutMs, installations);
    const running = runningAntigravityInstallation(rows, installations);
    if (running) requireSelectedInstallation(running, input);
    const selected = selectInstalledAntigravity(installations, running?.target ?? input.target, running?.exePath ?? input.exePath);
    exePath = selected.exePath;
    const profile = selectedProfile(input, selected.target);
    const existing = ownedAntigravityProcesses(rows, selected, profile);
    if (existing.length && input.requireQuiescent) {
      throw new Error("Antigravity restarted during profile activation; the new account could not be launched safely");
    }
    const runningWindow = existing.find((row) => sameWindowsPath(row.executablePath, selected.exePath) && (row.mainWindowHandle ?? 0) > 0);
    if (runningWindow && !input.forceRelaunch) {
      return { supported: true, attempted: false, restarted: true, exePath, pid: runningWindow.pid,
        creationTime: runningWindow.creationTime, windowObserved: true, reason: "Antigravity is already running" };
    }
    if (existing.length) {
      if (!input.forceRelaunch) throw new Error("Antigravity is running without a confirmed application window");
      const stopped = await quiesceAntigravityAsync({ ...input, ...selected });
      if (!stopped.quiesced) return { supported: stopped.supported, attempted: stopped.attempted, restarted: false, exePath, reason: stopped.reason };
    }
    const startedAt = Date.now();
    attempted = true;
    const pid = await adapter.launch(exePath, selected.target === "ide" ? ["--user-data-dir", profile] : []);
    if (!Number.isInteger(pid) || pid < 1) throw new Error("Antigravity spawn returned an invalid process ID");
    const deadline = Date.now() + timeoutMs;
    let creationTime: string | undefined;
    let windowHandle: number | undefined;
    do {
      const inventory = await readProcessInventory(adapter, inspectionTimeoutMs, installations);
      const current = runningAntigravityInstallation(inventory, installations);
      if (current) requireSelectedInstallation(current, selected);
      const root = inventory.find((row) => row.pid === pid);
      if (!root && creationTime) throw new Error("Antigravity exited before its application window was ready");
      if (root) {
        const rootProfile = commandArgument(root.commandLine, "--user-data-dir");
        if (!validProcessIdentity(root) || !root.commandLine || !sameWindowsPath(root.executablePath, exePath)
          || Date.parse(root.creationTime) < startedAt - 1_000 || creationTime && creationTime !== root.creationTime
          || (selected.target === "ide" || rootProfile) && (!rootProfile || !path.win32.isAbsolute(rootProfile) || !sameWindowsPath(rootProfile, profile))) {
          throw new Error("The newly launched Antigravity process did not match the selected installation and profile");
        }
        creationTime = root.creationTime;
        if (root.mainWindowHandle && root.mainWindowHandle === windowHandle) {
          return { supported: true, attempted, restarted: true, exePath, pid, creationTime, windowObserved: true,
            reason: "Antigravity's newly launched window was observed" };
        }
        windowHandle = root.mainWindowHandle;
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(150, deadline - Date.now())));
    } while (Date.now() < deadline);
    return { supported: true, attempted, restarted: false, exePath, reason: "Antigravity window did not appear before timeout" };
  } catch (error) {
    return { supported: true, attempted, restarted: false, exePath, reason: error instanceof Error ? error.message : "Antigravity launch failed" };
  }
}
