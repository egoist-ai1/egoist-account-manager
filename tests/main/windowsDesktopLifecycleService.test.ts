import { describe, expect, it } from "vitest";
import {
  WindowsDesktopLifecycleService,
  resolveWindowsDesktopSnapshot,
  type WindowsDesktopLifecycleAdapter,
  type WindowsDesktopPackageSnapshot,
  type WindowsDesktopSnapshot,
  type WindowsProcessSnapshot
} from "../../src/main/services/windowsDesktopLifecycleService";

function desktopPackage(
  name: "OpenAI.Codex" | "OpenAI.ChatGPT",
  suffix = "1.0.0.0_x64__test"
): WindowsDesktopPackageSnapshot {
  const product = name === "OpenAI.Codex" ? "Codex" : "ChatGPT";
  const family = `${name}_test`;
  const installLocation = `C:\\Program Files\\WindowsApps\\${name}_${suffix}`;
  return {
    name,
    packageFullName: `${name}_${suffix}`,
    packageFamilyName: family,
    version: suffix.split("_")[0],
    installLocation,
    executablePath: `${installLocation}\\app\\${product}.exe`
  };
}

function desktopProcess(
  pid: number,
  parentPid: number,
  creationDate: string,
  executablePath: string,
  commandLine = `"${executablePath}"`,
  processName?: string
): WindowsProcessSnapshot {
  return {
    pid,
    parentPid,
    creationDate,
    executablePath,
    processName: processName ?? (executablePath.toLowerCase().endsWith("chatgpt.exe") ? "ChatGPT.exe" : "Codex.exe"),
    commandLine
  };
}

function snapshot(
  packages: WindowsDesktopPackageSnapshot[],
  processes: WindowsProcessSnapshot[] = []
): WindowsDesktopSnapshot {
  return {
    packages,
    startApps: packages.map((candidate) => ({
      name: candidate.name === "OpenAI.Codex" ? "Codex" : "ChatGPT",
      appId: `${candidate.packageFamilyName}!App`
    })),
    processes
  };
}

class FakeAdapter implements WindowsDesktopLifecycleAdapter {
  readonly platform = "win32" as const;
  closeResult: "accepted" | "refused" | "vanished" | "mismatch" = "accepted";
  terminateResult: "terminated" | "vanished" | "mismatch" | "refused" = "terminated";
  closeCalls: WindowsProcessSnapshot[] = [];
  terminateCalls: WindowsProcessSnapshot[] = [];
  launchCalls: string[] = [];
  afterClose?: () => void;
  afterLaunch?: () => void;

  constructor(public current: WindowsDesktopSnapshot) {}

  async snapshot(): Promise<WindowsDesktopSnapshot> {
    return structuredClone(this.current);
  }

  async requestGracefulClose(process: WindowsProcessSnapshot) {
    this.closeCalls.push(process);
    this.afterClose?.();
    return this.closeResult;
  }

  async terminateExact(process: WindowsProcessSnapshot) {
    this.terminateCalls.push(process);
    if (this.terminateResult === "terminated") {
      this.current.processes = this.current.processes.filter((candidate) =>
        candidate.pid !== process.pid || candidate.creationDate !== process.creationDate
      );
    }
    return this.terminateResult;
  }

  async launch(identity: { packageFullName: string }): Promise<void> {
    this.launchCalls.push(identity.packageFullName);
    this.afterLaunch?.();
  }

  async sleep(): Promise<void> {}
}

describe("WindowsDesktopLifecycleService", () => {
  it.runIf(process.platform === "win32")("discovers the installed Windows desktop package without mutating it", async () => {
    const diagnostics = await new WindowsDesktopLifecycleService().getDiagnostics();

    expect(diagnostics.status).not.toBe("error");
    expect(diagnostics.candidates.every((candidate) =>
      candidate.packageName === "OpenAI.Codex" || candidate.packageName === "OpenAI.ChatGPT"
    )).toBe(true);
  });

  it("uses an explicit Codex package policy when Codex and classic ChatGPT coexist", () => {
    const codex = desktopPackage("OpenAI.Codex");
    const chatgpt = desktopPackage("OpenAI.ChatGPT");

    const resolved = resolveWindowsDesktopSnapshot(snapshot([chatgpt, codex]));

    expect(resolved.selected?.packageFullName).toBe(codex.packageFullName);
    expect(resolved.selectionReason).toContain("Explicit package policy");
    expect(resolved.candidates).toHaveLength(2);
  });

  it("reports ambiguity instead of selecting the first matching package version", () => {
    const resolved = resolveWindowsDesktopSnapshot(snapshot([
      desktopPackage("OpenAI.Codex", "1.0.0.0_x64__test"),
      desktopPackage("OpenAI.Codex", "2.0.0.0_x64__test")
    ]));

    expect(resolved.selected).toBeNull();
    expect(resolved.ambiguity).toContain("explicit package version");
  });

  it("captures and gracefully closes only the exact root and its descendants", async () => {
    const codex = desktopPackage("OpenAI.Codex");
    const root = desktopProcess(100, 1, "2026-07-30T12:00:00.000Z", codex.executablePath!);
    const renderer = desktopProcess(101, 100, "2026-07-30T12:00:01.000Z", codex.executablePath!, `"${codex.executablePath}" --type=renderer`);
    const appServer = desktopProcess(102, 100, "2026-07-30T12:00:02.000Z", `${codex.installLocation}\\app\\resources\\codex.exe`);
    const unrelated = desktopProcess(200, 1, "2026-07-30T12:00:03.000Z", "C:\\Other\\Codex.exe");
    const adapter = new FakeAdapter(snapshot([codex], [root, renderer, appServer, unrelated]));
    adapter.afterClose = () => {
      adapter.current.processes = [unrelated];
    };
    const service = new WindowsDesktopLifecycleService(adapter, { gracefulTimeoutMs: 0 });

    const result = await service.quiesce("graceful-only");

    expect(result).toMatchObject({
      status: "quiesced",
      capturedProcessCount: 3,
      remainingProcessCount: 0,
      usedExactTreeFallback: false
    });
    expect(adapter.closeCalls.map((process) => process.pid)).toEqual([100]);
    expect(adapter.terminateCalls).toEqual([]);
    expect(adapter.current.processes.map((process) => process.pid)).toEqual([200]);
  });

  it("captures package helper executables but excludes descendants outside the selected install", () => {
    const codex = desktopPackage("OpenAI.Codex");
    const root = desktopProcess(250, 1, "2026-07-30T12:05:00.000Z", codex.executablePath!);
    const appServer = desktopProcess(
      251,
      250,
      "2026-07-30T12:05:01.000Z",
      `${codex.installLocation}\\app\\resources\\codex.exe`
    );
    const codeModeHost = desktopProcess(
      252,
      251,
      "2026-07-30T12:05:02.000Z",
      `${codex.installLocation}\\app\\resources\\codex-code-mode-host.exe`,
      `"${codex.installLocation}\\app\\resources\\codex-code-mode-host.exe"`,
      "codex-code-mode-host.exe"
    );
    const externalChild = desktopProcess(
      253,
      252,
      "2026-07-30T12:05:03.000Z",
      "C:\\Windows\\System32\\conhost.exe",
      "conhost.exe",
      "conhost.exe"
    );

    const resolved = resolveWindowsDesktopSnapshot(snapshot([
      codex
    ], [root, appServer, codeModeHost, externalChild]));

    expect(resolved.tree.map((process) => process.pid)).toEqual([250, 251, 252]);
  });

  it("blocks before closing Codex when Manager is hosted inside the selected package ancestry", async () => {
    const codex = desktopPackage("OpenAI.Codex");
    const root = desktopProcess(270, 1, "2026-07-30T12:06:00.000Z", codex.executablePath!);
    const codeModeHost = desktopProcess(
      271,
      270,
      "2026-07-30T12:06:01.000Z",
      `${codex.installLocation}\\app\\resources\\codex-code-mode-host.exe`,
      `"${codex.installLocation}\\app\\resources\\codex-code-mode-host.exe"`,
      "codex-code-mode-host.exe"
    );
    const manager = desktopProcess(
      900,
      271,
      "2026-07-30T12:06:02.000Z",
      "C:\\Users\\test\\AppData\\Local\\Programs\\codex-account-manager\\Codex Account Manager.exe",
      "\"C:\\Users\\test\\AppData\\Local\\Programs\\codex-account-manager\\Codex Account Manager.exe\"",
      "Codex Account Manager.exe"
    );
    const adapter = new FakeAdapter(snapshot([codex], [root, codeModeHost, manager]));
    const service = new WindowsDesktopLifecycleService(adapter, {
      controllerPid: manager.pid,
      gracefulTimeoutMs: 0
    });

    const result = await service.quiesce("exact-tree-fallback");

    expect(result).toMatchObject({
      status: "blocked",
      capturedProcessCount: 2,
      remainingProcessCount: 2,
      gracefulCloseAccepted: false,
      usedExactTreeFallback: false
    });
    expect(result.message).toContain("Windows Start menu");
    expect(adapter.closeCalls).toEqual([]);
    expect(adapter.terminateCalls).toEqual([]);
  });

  it("blocks a graceful-only switch when the exact tree does not exit", async () => {
    const codex = desktopPackage("OpenAI.Codex");
    const root = desktopProcess(300, 1, "2026-07-30T12:10:00.000Z", codex.executablePath!);
    const adapter = new FakeAdapter(snapshot([codex], [root]));
    adapter.closeResult = "refused";
    const service = new WindowsDesktopLifecycleService(adapter, { gracefulTimeoutMs: 0 });

    const result = await service.quiesce("graceful-only");

    expect(result).toMatchObject({
      status: "blocked",
      capturedProcessCount: 1,
      remainingProcessCount: 1,
      gracefulCloseAccepted: false
    });
    expect(adapter.terminateCalls).toEqual([]);
  });

  it("treats a reused PID with a different creation time as a vanished captured process", async () => {
    const codex = desktopPackage("OpenAI.Codex");
    const root = desktopProcess(400, 1, "2026-07-30T12:20:00.000Z", codex.executablePath!);
    const adapter = new FakeAdapter(snapshot([codex], [root]));
    adapter.afterClose = () => {
      adapter.current.processes = [
        desktopProcess(400, 1, "2026-07-30T12:21:00.000Z", "C:\\Other\\Codex.exe")
      ];
    };
    const service = new WindowsDesktopLifecycleService(adapter, { gracefulTimeoutMs: 0 });

    const result = await service.quiesce("graceful-only");

    expect(result.status).toBe("quiesced");
    expect(result.remainingProcessCount).toBe(0);
  });

  it("force-closes only still-matching recorded processes and refuses a reused descendant PID", async () => {
    const codex = desktopPackage("OpenAI.Codex");
    const root = desktopProcess(500, 1, "2026-07-30T12:30:00.000Z", codex.executablePath!);
    const helper = desktopProcess(501, 500, "2026-07-30T12:30:01.000Z", codex.executablePath!, `"${codex.executablePath}" --type=utility`);
    const adapter = new FakeAdapter(snapshot([codex], [root, helper]));
    adapter.closeResult = "refused";
    adapter.afterClose = () => {
      adapter.current.processes = [
        root,
        desktopProcess(501, 1, "2026-07-30T12:31:00.000Z", "C:\\Other\\Codex.exe")
      ];
    };
    const service = new WindowsDesktopLifecycleService(adapter, {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0
    });

    const result = await service.quiesce("exact-tree-fallback");

    expect(result).toMatchObject({
      status: "quiesced",
      usedExactTreeFallback: true,
      remainingProcessCount: 0
    });
    expect(adapter.terminateCalls.map((process) => process.pid)).toEqual([500]);
    expect(adapter.current.processes.map((process) => process.pid)).toEqual([501]);
  });

  it("launches the same package identity and waits for a stable exact visible root", async () => {
    const codex = desktopPackage("OpenAI.Codex");
    const root = {
      ...desktopProcess(600, 1, "2026-07-30T12:40:00.000Z", codex.executablePath!),
      mainWindowHandle: 12345
    };
    const adapter = new FakeAdapter(snapshot([codex]));
    adapter.afterLaunch = () => {
      adapter.current.processes = [root];
    };
    const service = new WindowsDesktopLifecycleService(adapter, {
      launchReadinessTimeoutMs: 100,
      readinessStableSamples: 2,
      pollIntervalMs: 0
    });

    const readiness = await service.launchAndWaitReady();

    expect(readiness).toMatchObject({
      rootPid: 600,
      visibleWindowHandle: 12345,
      capturedProcessCount: 1
    });
    expect(readiness.identity.packageFullName).toBe(codex.packageFullName);
    expect(adapter.launchCalls).toEqual([codex.packageFullName]);
  });

  it("fails readiness when launch returns without an exact visible window", async () => {
    const codex = desktopPackage("OpenAI.Codex");
    const adapter = new FakeAdapter(snapshot([codex]));
    const service = new WindowsDesktopLifecycleService(adapter, {
      launchReadinessTimeoutMs: 0,
      readinessStableSamples: 1
    });

    await expect(service.launchAndWaitReady()).rejects.toThrow("stable visible window");
  });
});
