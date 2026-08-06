import { spawn } from "node:child_process";
import type {
  DesktopClosePolicy,
  DesktopLifecycleDiagnostics,
  DesktopQuiesceResult,
  OpenAiDesktopIdentity
} from "../../shared/types.js";

const supportedPackageNames = new Set(["OpenAI.Codex", "OpenAI.ChatGPT"]);
export interface WindowsDesktopPackageSnapshot {
  name: string;
  packageFullName: string;
  packageFamilyName: string;
  version: string;
  installLocation: string;
  executablePath: string | null;
}

export interface WindowsStartAppSnapshot {
  name: string;
  appId: string;
}

export interface WindowsProcessSnapshot {
  pid: number;
  parentPid: number;
  creationDate: string;
  executablePath: string | null;
  processName: string;
  commandLine: string | null;
  mainWindowHandle?: number;
}

export interface WindowsDesktopSnapshot {
  packages: WindowsDesktopPackageSnapshot[];
  startApps: WindowsStartAppSnapshot[];
  processes: WindowsProcessSnapshot[];
}

export interface WindowsDesktopLifecycleAdapter {
  readonly platform: NodeJS.Platform;
  snapshot(): Promise<WindowsDesktopSnapshot>;
  requestGracefulClose(process: WindowsProcessSnapshot): Promise<"accepted" | "refused" | "vanished" | "mismatch">;
  terminateExact(process: WindowsProcessSnapshot): Promise<"terminated" | "vanished" | "mismatch" | "refused">;
  launch(identity: OpenAiDesktopIdentity): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface WindowsDesktopLifecycleOptions {
  preferredPackageName?: "OpenAI.Codex" | "OpenAI.ChatGPT";
  controllerPid?: number;
  gracefulTimeoutMs?: number;
  forceTimeoutMs?: number;
  pollIntervalMs?: number;
  launchReadinessTimeoutMs?: number;
  readinessStableSamples?: number;
}

interface ResolvedDesktopSnapshot {
  selected: OpenAiDesktopIdentity | null;
  candidates: OpenAiDesktopIdentity[];
  selectionReason: string | null;
  ambiguity: string | null;
  roots: WindowsProcessSnapshot[];
  tree: WindowsProcessSnapshot[];
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function processIdentityKey(process: WindowsProcessSnapshot): string {
  return [
    process.pid,
    normalized(process.creationDate),
    normalized(process.executablePath),
    normalized(process.processName)
  ].join("|");
}

function isRootProcess(process: WindowsProcessSnapshot, identity: OpenAiDesktopIdentity): boolean {
  if (!identity.executablePath || !process.executablePath) return false;
  if (normalized(process.executablePath) !== normalized(identity.executablePath)) return false;
  return !/(^|\s)--type(?:=|\s)/i.test(process.commandLine ?? "");
}

function isInsideInstallRoot(
  process: WindowsProcessSnapshot,
  identity: OpenAiDesktopIdentity
): boolean {
  const installRoot = normalized(identity.installLocation).replace(/\//g, "\\").replace(/\\+$/, "");
  const executablePath = normalized(process.executablePath).replace(/\//g, "\\");
  return Boolean(
    installRoot
    && executablePath
    && (executablePath === installRoot || executablePath.startsWith(`${installRoot}\\`))
  );
}

function hasSelectedPackageAncestor(
  processes: WindowsProcessSnapshot[],
  controllerPid: number,
  identity: OpenAiDesktopIdentity
): boolean {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const visited = new Set<number>();
  let current = byPid.get(controllerPid);
  while (current && !visited.has(current.pid)) {
    visited.add(current.pid);
    if (current.pid !== controllerPid && isInsideInstallRoot(current, identity)) return true;
    current = byPid.get(current.parentPid);
  }
  return false;
}

function descendantsOf(
  roots: WindowsProcessSnapshot[],
  processes: WindowsProcessSnapshot[],
  identity: OpenAiDesktopIdentity
): WindowsProcessSnapshot[] {
  const packageProcesses = processes.filter((process) => isInsideInstallRoot(process, identity));
  const selected = new Map<number, WindowsProcessSnapshot>();
  const pending = roots.map((root) => root.pid);
  roots.forEach((root) => selected.set(root.pid, root));
  while (pending.length > 0) {
    const parentPid = pending.shift();
    for (const process of packageProcesses) {
      if (process.parentPid !== parentPid || selected.has(process.pid)) continue;
      selected.set(process.pid, process);
      pending.push(process.pid);
    }
  }
  return [...selected.values()];
}

function appUserModelIdFor(
  packageFamilyName: string,
  startApps: WindowsStartAppSnapshot[]
): string | null {
  const familyPrefix = `${packageFamilyName.toLowerCase()}!`;
  const exact = startApps.filter((app) => app.appId.toLowerCase().startsWith(familyPrefix));
  if (exact.length === 1) return exact[0].appId;
  const appEntry = exact.find((app) => app.appId.toLowerCase().endsWith("!app"));
  return appEntry?.appId ?? null;
}

function identityFromPackage(
  packageSnapshot: WindowsDesktopPackageSnapshot,
  startApps: WindowsStartAppSnapshot[]
): OpenAiDesktopIdentity {
  return {
    product: packageSnapshot.name === "OpenAI.Codex" ? "codex" : "chatgpt",
    packageName: packageSnapshot.name,
    packageFullName: packageSnapshot.packageFullName,
    packageFamilyName: packageSnapshot.packageFamilyName,
    version: packageSnapshot.version,
    installLocation: packageSnapshot.installLocation,
    executablePath: packageSnapshot.executablePath,
    appUserModelId: appUserModelIdFor(packageSnapshot.packageFamilyName, startApps)
  };
}

export function resolveWindowsDesktopSnapshot(
  snapshot: WindowsDesktopSnapshot,
  options: Pick<WindowsDesktopLifecycleOptions, "preferredPackageName"> = {}
): ResolvedDesktopSnapshot {
  const candidates = snapshot.packages
    .filter((candidate) => supportedPackageNames.has(candidate.name))
    .map((candidate) => identityFromPackage(candidate, snapshot.startApps))
    .sort((left, right) => left.packageFullName.localeCompare(right.packageFullName));
  if (candidates.length === 0) {
    return {
      selected: null,
      candidates,
      selectionReason: null,
      ambiguity: null,
      roots: [],
      tree: []
    };
  }

  const preferredPackageName = options.preferredPackageName ?? "OpenAI.Codex";
  const preferred = candidates.filter((candidate) => candidate.packageName === preferredPackageName);
  let selected: OpenAiDesktopIdentity | null = null;
  let selectionReason: string | null = null;
  let ambiguity: string | null = null;
  if (preferred.length === 1) {
    selected = preferred[0];
    selectionReason = `Explicit package policy selected ${preferredPackageName}.`;
  } else if (preferred.length > 1) {
    ambiguity = `Multiple installed ${preferredPackageName} packages require an explicit package version.`;
  } else if (candidates.length === 1) {
    selected = candidates[0];
    selectionReason = `Only one supported OpenAI desktop package is installed.`;
  } else {
    ambiguity = "Multiple OpenAI desktop packages are installed and none matches the configured package policy.";
  }

  const roots = selected
    ? snapshot.processes.filter((process) => isRootProcess(process, selected))
    : [];
  return {
    selected,
    candidates,
    selectionReason,
    ambiguity,
    roots,
    tree: selected ? descendantsOf(roots, snapshot.processes, selected) : []
  };
}

export interface DesktopLaunchReadiness {
  identity: OpenAiDesktopIdentity;
  rootPid: number;
  visibleWindowHandle: number;
  capturedProcessCount: number;
  readyAt: number;
}

export class DesktopLaunchError extends Error {
  readonly name = "DesktopLaunchError";

  constructor(message: string, readonly identity: OpenAiDesktopIdentity) {
    super(message);
  }
}

function aliveCapturedProcesses(
  captured: WindowsProcessSnapshot[],
  current: WindowsProcessSnapshot[]
): WindowsProcessSnapshot[] {
  const identities = new Map(current.map((process) => [processIdentityKey(process), process]));
  return captured.filter((process) => identities.has(processIdentityKey(process)));
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseSnapshot(value: unknown): WindowsDesktopSnapshot {
  const record = (value ?? {}) as {
    packages?: WindowsDesktopPackageSnapshot | WindowsDesktopPackageSnapshot[];
    startApps?: WindowsStartAppSnapshot | WindowsStartAppSnapshot[];
    processes?: WindowsProcessSnapshot | WindowsProcessSnapshot[];
  };
  return {
    packages: toArray(record.packages),
    startApps: toArray(record.startApps),
    processes: toArray(record.processes)
      .map((process) => ({
        ...process,
        pid: Number(process.pid),
        parentPid: Number(process.parentPid),
        mainWindowHandle: Number(process.mainWindowHandle) || 0
      }))
      .filter((process) => Number.isInteger(process.pid) && process.pid > 0)
  };
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function runPowerShell(script: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodePowerShell(script)
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout.trim());
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Windows desktop lifecycle probe timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 1_000_000) {
        child.kill();
        finish(new Error("Windows desktop lifecycle probe exceeded the output limit"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64_000) stderr += chunk;
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (code === 0) finish();
      else finish(new Error(stderr.trim() || `PowerShell lifecycle command exited with code ${code}`));
    });
  });
}

function decodeBase64PowerShell(value: string): string {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value, "utf8").toString("base64")}'))`;
}

function exactProcessGuard(process: WindowsProcessSnapshot): string {
  const creationDate = decodeBase64PowerShell(process.creationDate);
  const executablePath = decodeBase64PowerShell(process.executablePath ?? "");
  const processName = decodeBase64PowerShell(process.processName);
  return `
$expectedCreationDate = ${creationDate}
$expectedExecutablePath = ${executablePath}
$expectedProcessName = ${processName}
$target = Get-CimInstance Win32_Process -Filter "ProcessId = ${process.pid}" -ErrorAction SilentlyContinue
if (-not $target) {
  [PSCustomObject]@{ status = 'vanished' } | ConvertTo-Json -Compress
  exit 0
}
$actualCreationDate = $target.CreationDate.ToUniversalTime().ToString('o')
$actualPath = [string]$target.ExecutablePath
$actualName = [string]$target.Name
if ($actualCreationDate -ine $expectedCreationDate -or $actualPath -ine $expectedExecutablePath -or $actualName -ine $expectedProcessName) {
  [PSCustomObject]@{ status = 'mismatch' } | ConvertTo-Json -Compress
  exit 0
}
`.trim();
}

export function createWindowsDesktopLifecycleAdapter(
  platform: NodeJS.Platform = process.platform
): WindowsDesktopLifecycleAdapter {
  return {
    platform,
    async snapshot() {
      if (platform !== "win32") return { packages: [], startApps: [], processes: [] };
      const output = await runPowerShell(`
$ErrorActionPreference = 'Stop'
$packages = @(Get-AppxPackage -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @('OpenAI.Codex', 'OpenAI.ChatGPT') } |
  ForEach-Object {
    $install = [string]$_.InstallLocation
    $executable = $null
    foreach ($name in @('ChatGPT.exe', 'Codex.exe')) {
      $candidate = Join-Path $install ('app\\' + $name)
      if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $executable = $candidate
        break
      }
    }
    [PSCustomObject]@{
      name = [string]$_.Name
      packageFullName = [string]$_.PackageFullName
      packageFamilyName = [string]$_.PackageFamilyName
      version = [string]$_.Version
      installLocation = $install
      executablePath = $executable
    }
  })
$startApps = @(Get-StartApps -ErrorAction SilentlyContinue |
  Where-Object { $_.AppID -like 'OpenAI.Codex*!*' -or $_.AppID -like 'OpenAI.ChatGPT*!*' } |
  ForEach-Object {
    [PSCustomObject]@{ name = [string]$_.Name; appId = [string]$_.AppID }
  })
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  ForEach-Object {
    $mainWindowHandle = 0
    if ($_.Name -ieq 'ChatGPT.exe' -or $_.Name -ieq 'Codex.exe') {
      try {
        $mainWindowHandle = [int64](Get-Process -Id $_.ProcessId -ErrorAction Stop).MainWindowHandle
      } catch {}
    }
    [PSCustomObject]@{
      pid = [int]$_.ProcessId
      parentPid = [int]$_.ParentProcessId
      creationDate = $_.CreationDate.ToUniversalTime().ToString('o')
      executablePath = [string]$_.ExecutablePath
      processName = [string]$_.Name
      commandLine = [string]$_.CommandLine
      mainWindowHandle = $mainWindowHandle
    }
  })
[PSCustomObject]@{ packages = $packages; startApps = $startApps; processes = $processes } |
  ConvertTo-Json -Compress -Depth 5
`);
      return parseSnapshot(JSON.parse(output || "{}"));
    },
    async requestGracefulClose(process) {
      if (platform !== "win32") return "vanished";
      const output = await runPowerShell(`
$ErrorActionPreference = 'Stop'
${exactProcessGuard(process)}
$accepted = (Get-Process -Id ${process.pid} -ErrorAction Stop).CloseMainWindow()
[PSCustomObject]@{ status = $(if ($accepted) { 'accepted' } else { 'refused' }) } | ConvertTo-Json -Compress
`);
      const status = (JSON.parse(output) as { status?: string }).status;
      return status === "accepted" || status === "refused" || status === "mismatch" || status === "vanished"
        ? status
        : "refused";
    },
    async terminateExact(process) {
      if (platform !== "win32") return "vanished";
      const output = await runPowerShell(`
$ErrorActionPreference = 'Stop'
${exactProcessGuard(process)}
Stop-Process -Id ${process.pid} -Force -ErrorAction Stop
[PSCustomObject]@{ status = 'terminated' } | ConvertTo-Json -Compress
`);
      const status = (JSON.parse(output) as { status?: string }).status;
      return status === "terminated" || status === "vanished" || status === "mismatch"
        ? status
        : "refused";
    },
    async launch(identity) {
      if (platform !== "win32") throw new Error("Windows desktop launch is unavailable on this platform");
      if (identity.appUserModelId) {
        const appId = decodeBase64PowerShell(identity.appUserModelId);
        await runPowerShell(`Start-Process -FilePath 'explorer.exe' -ArgumentList ('shell:AppsFolder\\' + ${appId})`);
        return;
      }
      if (!identity.executablePath) throw new Error("The selected OpenAI desktop package has no launch target");
      const executablePath = decodeBase64PowerShell(identity.executablePath);
      await runPowerShell(`Start-Process -FilePath ${executablePath}`);
    },
    async sleep(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  };
}

export class WindowsDesktopLifecycleService {
  private readonly options: Required<WindowsDesktopLifecycleOptions>;

  constructor(
    private readonly adapter: WindowsDesktopLifecycleAdapter = createWindowsDesktopLifecycleAdapter(),
    options: WindowsDesktopLifecycleOptions = {}
  ) {
    this.options = {
      preferredPackageName: options.preferredPackageName ?? "OpenAI.Codex",
      controllerPid: options.controllerPid ?? process.pid,
      gracefulTimeoutMs: options.gracefulTimeoutMs ?? 2_500,
      forceTimeoutMs: options.forceTimeoutMs ?? 3_000,
      pollIntervalMs: options.pollIntervalMs ?? 400,
      launchReadinessTimeoutMs: options.launchReadinessTimeoutMs ?? 15_000,
      readinessStableSamples: Math.max(1, options.readinessStableSamples ?? 2)
    };
  }

  async getDiagnostics(): Promise<DesktopLifecycleDiagnostics> {
    if (this.adapter.platform !== "win32") {
      return {
        status: "unsupported",
        selected: null,
        candidates: [],
        selectionReason: null,
        runningRootCount: 0,
        capturedProcessCount: 0,
        message: "Exact desktop lifecycle management is available on Windows only."
      };
    }
    try {
      const resolved = resolveWindowsDesktopSnapshot(await this.adapter.snapshot(), this.options);
      if (resolved.ambiguity) {
        return {
          status: "ambiguous",
          selected: null,
          candidates: resolved.candidates,
          selectionReason: null,
          runningRootCount: 0,
          capturedProcessCount: 0,
          message: resolved.ambiguity
        };
      }
      if (!resolved.selected) {
        return {
          status: "not-installed",
          selected: null,
          candidates: [],
          selectionReason: null,
          runningRootCount: 0,
          capturedProcessCount: 0,
          message: "No supported OpenAI Codex or ChatGPT desktop package was found."
        };
      }
      return {
        status: resolved.roots.length > 0 ? "running" : "ready",
        selected: resolved.selected,
        candidates: resolved.candidates,
        selectionReason: resolved.selectionReason,
        runningRootCount: resolved.roots.length,
        capturedProcessCount: resolved.tree.length,
        message: resolved.roots.length > 0
          ? `Captured ${resolved.tree.length} process(es) from ${resolved.roots.length} exact desktop root(s).`
          : "The exact desktop package is installed and is not currently running."
      };
    } catch (error) {
      return {
        status: "error",
        selected: null,
        candidates: [],
        selectionReason: null,
        runningRootCount: 0,
        capturedProcessCount: 0,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async quiesce(policy: DesktopClosePolicy): Promise<DesktopQuiesceResult> {
    if (this.adapter.platform !== "win32") {
      return {
        status: "unsupported",
        identity: null,
        capturedProcessCount: 0,
        remainingProcessCount: 0,
        gracefulCloseAccepted: false,
        usedExactTreeFallback: false,
        message: "No Windows desktop process needs to be quiesced on this platform."
      };
    }
    const initialSnapshot = await this.adapter.snapshot();
    const resolved = resolveWindowsDesktopSnapshot(initialSnapshot, this.options);
    if (resolved.ambiguity) {
      return {
        status: "ambiguous",
        identity: null,
        capturedProcessCount: 0,
        remainingProcessCount: 0,
        gracefulCloseAccepted: false,
        usedExactTreeFallback: false,
        message: resolved.ambiguity
      };
    }
    if (!resolved.selected || resolved.tree.length === 0) {
      return {
        status: "not-running",
        identity: resolved.selected,
        capturedProcessCount: 0,
        remainingProcessCount: 0,
        gracefulCloseAccepted: false,
        usedExactTreeFallback: false,
        message: resolved.selected
          ? "The selected OpenAI desktop package is not running."
          : "No supported OpenAI desktop package is installed."
      };
    }
    if (
      hasSelectedPackageAncestor(
        initialSnapshot.processes,
        this.options.controllerPid,
        resolved.selected
      )
    ) {
      return {
        status: "blocked",
        identity: resolved.selected,
        capturedProcessCount: resolved.tree.length,
        remainingProcessCount: resolved.tree.length,
        gracefulCloseAccepted: false,
        usedExactTreeFallback: false,
        message: "Egoist Account Manager is hosted inside the active Codex process tree. Reopen Manager from the Windows Start menu before switching."
      };
    }

    const captured = resolved.tree;
    const closeResults = await Promise.all(
      resolved.roots.map((root) => this.adapter.requestGracefulClose(root))
    );
    const gracefulCloseAccepted = closeResults.some((result) => result === "accepted");
    let alive = await this.waitForExit(captured, this.options.gracefulTimeoutMs);
    if (alive.length === 0) {
      return {
        status: "quiesced",
        identity: resolved.selected,
        capturedProcessCount: captured.length,
        remainingProcessCount: 0,
        gracefulCloseAccepted,
        usedExactTreeFallback: false,
        message: "The exact OpenAI desktop process tree exited gracefully."
      };
    }
    if (policy === "graceful-only") {
      return {
        status: "blocked",
        identity: resolved.selected,
        capturedProcessCount: captured.length,
        remainingProcessCount: alive.length,
        gracefulCloseAccepted,
        usedExactTreeFallback: false,
        message: `The exact desktop process tree did not exit before the timeout (${alive.length} process(es) remain).`
      };
    }

    const current = await this.adapter.snapshot();
    alive = aliveCapturedProcesses(alive, current.processes);
    for (const process of [...alive].sort((left, right) => right.pid - left.pid)) {
      await this.adapter.terminateExact(process);
    }
    alive = await this.waitForExit(captured, this.options.forceTimeoutMs);
    return {
      status: alive.length === 0 ? "quiesced" : "blocked",
      identity: resolved.selected,
      capturedProcessCount: captured.length,
      remainingProcessCount: alive.length,
      gracefulCloseAccepted,
      usedExactTreeFallback: true,
      message: alive.length === 0
        ? "The recorded process tree was terminated after exact identity revalidation."
        : `The exact desktop process tree is still running (${alive.length} process(es) remain).`
    };
  }

  async launch(identity?: OpenAiDesktopIdentity | null): Promise<OpenAiDesktopIdentity> {
    const resolved = resolveWindowsDesktopSnapshot(await this.adapter.snapshot(), this.options);
    if (resolved.ambiguity) throw new Error(resolved.ambiguity);
    const target = identity
      ? resolved.candidates.find((candidate) => candidate.packageFullName === identity.packageFullName)
      : resolved.selected;
    if (!target) throw new Error("The exact OpenAI desktop package is no longer installed");
    await this.adapter.launch(target);
    return target;
  }

  async launchAndWaitReady(
    identity?: OpenAiDesktopIdentity | null
  ): Promise<DesktopLaunchReadiness> {
    const target = await this.launch(identity);
    const deadline = Date.now() + this.options.launchReadinessTimeoutMs;
    let previousRootKey: string | null = null;
    let stableSamples = 0;
    do {
      const resolved = resolveWindowsDesktopSnapshot(await this.adapter.snapshot(), this.options);
      if (resolved.ambiguity) throw new DesktopLaunchError(resolved.ambiguity, target);
      const selectedMatches = resolved.selected?.packageFullName === target.packageFullName;
      const visibleRoot = selectedMatches
        ? resolved.roots.find((root) => (root.mainWindowHandle ?? 0) > 0)
        : null;
      if (visibleRoot) {
        const key = processIdentityKey(visibleRoot);
        stableSamples = key === previousRootKey ? stableSamples + 1 : 1;
        previousRootKey = key;
        if (stableSamples >= this.options.readinessStableSamples) {
          return {
            identity: target,
            rootPid: visibleRoot.pid,
            visibleWindowHandle: visibleRoot.mainWindowHandle ?? 0,
            capturedProcessCount: resolved.tree.length,
            readyAt: Date.now()
          };
        }
      } else {
        previousRootKey = null;
        stableSamples = 0;
      }
      if (Date.now() >= deadline) break;
      await this.adapter.sleep(Math.min(this.options.pollIntervalMs, Math.max(1, deadline - Date.now())));
    } while (Date.now() <= deadline);
    throw new DesktopLaunchError(
      `The exact desktop package ${target.packageFullName} did not expose a stable visible window before the readiness timeout.`,
      target
    );
  }

  private async waitForExit(
    captured: WindowsProcessSnapshot[],
    timeoutMs: number
  ): Promise<WindowsProcessSnapshot[]> {
    const deadline = Date.now() + timeoutMs;
    let alive = captured;
    do {
      const current = await this.adapter.snapshot();
      alive = aliveCapturedProcesses(captured, current.processes);
      if (alive.length === 0) return [];
      if (Date.now() >= deadline) return alive;
      await this.adapter.sleep(Math.min(this.options.pollIntervalMs, Math.max(1, deadline - Date.now())));
    } while (Date.now() <= deadline);
    return alive;
  }
}
