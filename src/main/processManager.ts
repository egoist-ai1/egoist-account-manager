import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function vbsString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function firstExisting(paths: Array<string | null | undefined>): string | null {
  for (const candidate of paths) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep trying the next candidate.
    }
  }
  return null;
}

function codexCommandPriority(candidate: string): number {
  const normalized = candidate.toLowerCase();
  const extension = path.extname(normalized);
  if (process.platform === "win32") {
    if (extension === ".cmd" || extension === ".bat") return 0;
    if (extension === ".exe" && !normalized.includes("\\windowsapps\\")) return 1;
    if (extension === ".exe") return 2;
    if (extension === ".ps1") return 3;
    return 99;
  }
  return extension ? 0 : 1;
}

export function pickCodexPathFromWhereOutput(output: string): string | null {
  const candidates = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => codexCommandPriority(a) - codexCommandPriority(b));
  return firstExisting(candidates);
}

function findFromWhere(): string | null {
  const result = spawnSync("where.exe", ["codex"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  return pickCodexPathFromWhereOutput(result.stdout);
}

function findFromAppxPackage(): string | null {
  const command = "(Get-AppxPackage OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty InstallLocation)";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) return null;
  const installLocation = result.stdout.trim();
  if (!installLocation) return null;
  return firstExisting([
    path.join(installLocation, "app", "resources", "codex.exe"),
    path.join(installLocation, "app", "resources", "codex")
  ]);
}

export function getOpenAiDesktopCandidates(installLocation: string): string[] {
  return [
    path.join(installLocation, "app", "ChatGPT.exe"),
    path.join(installLocation, "app", "Codex.exe")
  ];
}

function findDesktopFromAppxPackage(): string | null {
  const command =
    "(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('OpenAI.Codex','OpenAI.ChatGPT') } | Select-Object -First 1 -ExpandProperty InstallLocation)";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) return null;
  const installLocation = result.stdout.trim();
  if (!installLocation) return null;
  return firstExisting(getOpenAiDesktopCandidates(installLocation));
}

function findDesktopFromKnownLocations(): string | null {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  return firstExisting([
    path.join(localAppData, "Programs", "ChatGPT", "ChatGPT.exe"),
    path.join(localAppData, "OpenAI", "ChatGPT", "ChatGPT.exe"),
    path.join(localAppData, "ChatGPT", "ChatGPT.exe"),
    path.join(localAppData, "Programs", "Codex", "Codex.exe"),
    path.join(localAppData, "OpenAI", "Codex", "Codex.exe"),
    path.join(localAppData, "Codex", "Codex.exe"),
    path.join(programFiles, "ChatGPT", "ChatGPT.exe"),
    path.join(programFiles, "OpenAI", "ChatGPT", "ChatGPT.exe"),
    path.join(programFiles, "Codex", "Codex.exe"),
    path.join(programFiles, "OpenAI", "Codex", "Codex.exe"),
    path.join(programFilesX86, "ChatGPT", "ChatGPT.exe"),
    path.join(programFilesX86, "OpenAI", "ChatGPT", "ChatGPT.exe"),
    path.join(programFilesX86, "Codex", "Codex.exe"),
    path.join(programFilesX86, "OpenAI", "Codex", "Codex.exe")
  ]);
}

function findFromRunningProcesses(): string | null {
  const command =
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'codex.exe' -and $_.CommandLine -match 'resources\\\\codex(\\.exe)?' } | Select-Object -First 1 -ExpandProperty ExecutablePath";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) return null;
  return firstExisting([result.stdout.trim()]);
}

function findDesktopFromRunningProcesses(): string | null {
  const command =
    "Get-CimInstance Win32_Process | Where-Object { ($_.Name -ieq 'ChatGPT.exe' -or $_.Name -ieq 'Codex.exe') -and $_.ExecutablePath -match '\\\\app\\\\(ChatGPT|Codex)\\.exe$' -and $_.CommandLine -notmatch '(^|\\s)--type=' } | Select-Object -First 1 -ExpandProperty ExecutablePath";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) return null;
  return firstExisting([result.stdout.trim()]);
}

export function resolveCodexPath(): string | null {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return (
    firstExisting([
      path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe"),
      path.join(os.homedir(), "AppData", "Local", "OpenAI", "Codex", "bin", "codex.exe")
    ]) ??
    findFromWhere() ??
    findFromAppxPackage() ??
    findFromRunningProcesses()
  );
}

export function resolveCodexDesktopPath(): string | null {
  return findDesktopFromRunningProcesses() ?? findDesktopFromAppxPackage() ?? findDesktopFromKnownLocations();
}

export async function stopCodexProcesses(): Promise<void> {
  // Do not use taskkill by image name here. The official Codex Desktop renderer
  // and its backend share the same Codex/codex image names as the CLI. Killing
  // them by name interrupts conversations and leaves the Store application in
  // its crash-recovery screen. Auth writes are atomic; active sessions are left
  // untouched and future sessions observe the selected auth.json.
}

function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function getVisibleOpenAiDesktopWindowCount(): number {
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count"
  ], {
    encoding: "utf8",
    windowsHide: true
  });
  return Number(result.stdout.trim()) || 0;
}

async function waitForVisibleOpenAiDesktopWindow(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getVisibleOpenAiDesktopWindowCount() > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return getVisibleOpenAiDesktopWindowCount() > 0;
}

export function getCodexAppUserModelId(): string | null {
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "(Get-StartApps | Where-Object { $_.Name -in @('ChatGPT','Codex') -or $_.AppID -like 'OpenAI.Codex*!App' -or $_.AppID -like 'OpenAI.ChatGPT*!App' } | Select-Object -First 1 -ExpandProperty AppID)"
  ], {
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

async function launchViaAppUserModelId(): Promise<void> {
  const appId = getCodexAppUserModelId();
  if (!appId) return;
  const child = spawn("explorer.exe", [`shell:AppsFolder\\${appId}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  await waitForProcessExit(child, 1500);
}

export async function launchCodexApp(_codexPath: string, _workspacePath: string): Promise<void> {
  const desktopPath = resolveCodexDesktopPath();
  if (desktopPath) {
    const child = spawn(desktopPath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    if (await waitForVisibleOpenAiDesktopWindow(8000)) return;
  }

  await launchViaAppUserModelId();
  if (await waitForVisibleOpenAiDesktopWindow(8000)) return;

  throw new Error("Codex launch command completed, but no visible Codex window appeared.");
}

export interface ScheduledRestart {
  launcherPath: string;
  launcherLogPath: string;
  scriptPath: string;
  logPath: string;
}

export interface OpenAiDesktopRestartScriptOptions {
  desktopPath: string | null;
  appUserModelId: string | null;
  logPath: string;
}

export function buildOpenAiDesktopRestartScript(options: OpenAiDesktopRestartScriptOptions): string {
  const { desktopPath, appUserModelId, logPath } = options;
  return `
$ErrorActionPreference = 'Continue'
$desktop = ${desktopPath ? psQuote(desktopPath) : "$null"}
$appId = ${appUserModelId ? psQuote(appUserModelId) : "$null"}
$logPath = ${psQuote(logPath)}
$mutex = $null
$hasMutex = $false

function Write-RunnerLog([string]$Message) {
  try {
    $dir = Split-Path -Parent $logPath
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -LiteralPath $logPath -Value ("[{0}] {1}" -f (Get-Date).ToString("o"), $Message)
  } catch {}
}

function Get-OpenAiDesktopRoots {
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -ieq 'ChatGPT.exe' -or $_.Name -ieq 'Codex.exe') -and
    ($_.ExecutablePath -like '*\\app\\ChatGPT.exe' -or $_.ExecutablePath -like '*\\app\\Codex.exe') -and
    $_.CommandLine -notmatch '(^|\\s)--type='
  })
}

function Wait-RootExit([int[]]$ProcessIds, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $remaining = @($ProcessIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($remaining.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Resolve-OpenAiDesktop([string]$KnownDesktop) {
  if ($KnownDesktop -and (Test-Path -LiteralPath $KnownDesktop)) { return $KnownDesktop }
  try {
    $pkg = Get-AppxPackage -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -in @('OpenAI.Codex', 'OpenAI.ChatGPT') } |
      Select-Object -First 1
    if ($pkg -and $pkg.InstallLocation) {
      foreach ($fileName in @('ChatGPT.exe', 'Codex.exe')) {
        $candidate = Join-Path $pkg.InstallLocation ("app\\" + $fileName)
        if (Test-Path -LiteralPath $candidate) { return $candidate }
      }
    }
  } catch {}
  return $null
}

function Resolve-OpenAiAppId([string]$KnownAppId) {
  if ($KnownAppId) { return $KnownAppId }
  try {
    return (Get-StartApps | Where-Object {
      $_.Name -in @('ChatGPT', 'Codex') -or
      $_.AppID -like 'OpenAI.Codex*!App' -or
      $_.AppID -like 'OpenAI.ChatGPT*!App'
    } | Select-Object -First 1 -ExpandProperty AppID)
  } catch {
    return $null
  }
}

function Wait-OpenAiWindow([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $visible = @(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 }).Count
    if ($visible -gt 0) { return $true }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return $false
}

try {
  $mutex = [System.Threading.Mutex]::new($false, 'Local\\EgoistCodexAccountManagerOpenAiRestart')
  $hasMutex = $mutex.WaitOne(0)
  if (-not $hasMutex) {
    Write-RunnerLog 'A restart is already running; duplicate request ignored.'
    return
  }

  $desktop = Resolve-OpenAiDesktop $desktop
  $appId = Resolve-OpenAiAppId $appId
  Write-RunnerLog ("Restart started. Desktop={0} AppID={1}" -f $desktop, $appId)

  Start-Sleep -Milliseconds 250
  $roots = @(Get-OpenAiDesktopRoots)
  $rootIds = @($roots | ForEach-Object { [int]$_.ProcessId })
  if ($rootIds.Count -gt 0) {
    foreach ($processId in $rootIds) {
      try {
        $process = Get-Process -Id $processId -ErrorAction Stop
        $requested = $process.CloseMainWindow()
        Write-RunnerLog ("Graceful close requested for PID={0}; accepted={1}" -f $processId, $requested)
      } catch {
        Write-RunnerLog ("Graceful close request failed for PID={0}: {1}" -f $processId, $_.Exception.Message)
      }
    }

    if (-not (Wait-RootExit $rootIds 10)) {
      Write-RunnerLog 'Main window did not close within 10 seconds; restart aborted without force-killing processes.'
      return
    }
    Start-Sleep -Milliseconds 500
  }

  if ($appId) {
    Write-RunnerLog 'Starting ChatGPT/Codex through the registered Microsoft Store AppID.'
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('shell:AppsFolder\\' + $appId)
    if (Wait-OpenAiWindow 15) {
      Write-RunnerLog 'Restart completed; a visible ChatGPT/Codex window was detected.'
      return
    }
    Write-RunnerLog 'Store activation returned without a visible window; trying the desktop executable fallback.'
  }

  if ($desktop -and (Test-Path -LiteralPath $desktop)) {
    Start-Process -FilePath $desktop
    if (Wait-OpenAiWindow 15) {
      Write-RunnerLog 'Restart completed through the desktop executable fallback.'
      return
    }
  }

  Write-RunnerLog 'Restart could not open a visible ChatGPT/Codex window.'
} catch {
  Write-RunnerLog ("Restart runner failed: " + $_.Exception.Message)
} finally {
  if ($hasMutex -and $mutex) {
    try { $mutex.ReleaseMutex() } catch {}
  }
  if ($mutex) { $mutex.Dispose() }
}
`.trimStart();
}

export function scheduleOpenAiDesktopRestart(desktopPath: string | null, appUserModelId: string | null, runnerDir: string): ScheduledRestart {
  const scriptsDir = path.join(runnerDir, "scripts");
  const logsDir = path.join(runnerDir, "logs");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const launcherPath = path.join(scriptsDir, "restart-openai-desktop.vbs");
  const launcherLogPath = path.join(logsDir, "restart-launcher.log");
  const scriptPath = path.join(scriptsDir, "restart-openai-desktop.ps1");
  const logPath = path.join(logsDir, "restart-runner.log");
  const script = buildOpenAiDesktopRestartScript({ desktopPath, appUserModelId, logPath });

  fs.writeFileSync(scriptPath, `\uFEFF${script.trimStart()}`, "utf8");

  const launcher = [
    "On Error Resume Next",
    "Dim shell, fso, logFile, command",
    "Set shell = CreateObject(\"WScript.Shell\")",
    "Set fso = CreateObject(\"Scripting.FileSystemObject\")",
    `Set logFile = fso.OpenTextFile(${vbsString(launcherLogPath)}, 8, True)`,
    `logFile.WriteLine Now & " launcher started"`,
    "logFile.Close",
    `command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & ${vbsString(scriptPath)} & Chr(34)`,
    "shell.Run command, 0, False"
  ].join("\r\n");
  fs.writeFileSync(launcherPath, `\uFEFF${launcher}`, "utf16le");

  const child = spawn("wscript.exe", [launcherPath], {
    cwd: runnerDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();

  return { launcherPath, launcherLogPath, scriptPath, logPath };
}

export const scheduleCodexRestart = scheduleOpenAiDesktopRestart;
