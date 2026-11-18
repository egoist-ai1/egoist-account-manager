import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile, spawn, spawnSync } from "node:child_process";

vi.mock("node:child_process", () => ({ execFile: vi.fn(), spawn: vi.fn(), spawnSync: vi.fn() }));
import {
  buildAntigravityWindowsRestartScript,
  cleanAntigravitySessionCache,
  inspectAntigravityRuntimeBinding,
  launchAntigravity,
  launchAntigravityAsync,
  quiesceAntigravityAsync,
  isAntigravityRunning,
  quiesceAntigravity,
  resolveAntigravityExecutablePath,
  resolveAntigravitySwitchTarget,
  restartAntigravityIntegration
} from "../../src/main/services/antigravityProcessService.js";
import type { AntigravityAsyncProcessAdapter, AntigravityRuntimeProcess } from "../../src/main/services/antigravityProcessService.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

const fixtureExe = "C:\\Fixture\\Programs\\Antigravity\\Antigravity.exe";
const fixtureAppData = "C:\\Fixture\\Roaming";
const fixtureCreated = "2026-10-06T10:00:00.0000000Z";

function fixtureProcess(overrides: Partial<AntigravityRuntimeProcess> = {}): AntigravityRuntimeProcess {
  return { pid: 100, parentPid: 1, creationTime: fixtureCreated, executablePath: fixtureExe,
    name: "Antigravity.exe", commandLine: `"${fixtureExe}"`, ...overrides };
}

function quiesceFixture(adapter: AntigravityAsyncProcessAdapter) {
  return quiesceAntigravityAsync({ platform: "win32", exePath: fixtureExe, appData: fixtureAppData,
    home: "C:\\Fixture", timeoutMs: 900, processAdapter: adapter });
}

describe("antigravityProcessService", () => {
  it.each(["Antigravity.exe", "Antigravity IDE.exe"])("detects the supported process %s", (name) => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: `"${name}","42","Console","1","1,234 K"`, stderr: "" } as never);
    expect(isAntigravityRunning({ platform: "win32" })).toBe(true);
  });

  it("limits restart termination to the exact executable and its descendants", () => {
    const script = buildAntigravityWindowsRestartScript("C:\\Tools\\Antigravity IDE\\Antigravity IDE.exe");
    expect(script).toContain("ExecutablePath");
    expect(script).toContain("ParentProcessId");
    expect(script).toContain("Stop-Process -Id");
    expect(script).not.toContain("Get-Process -Name");
    expect(script).not.toContain("language_server");
    expect(script).toContain("-WindowStyle Hidden");
  });

  it("refuses profile writes when process detection fails", () => {
    vi.stubEnv("VITEST", ""); vi.stubEnv("NODE_ENV", "production");
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: "", stderr: "probe failed" } as never);
    expect(quiesceAntigravity({ platform: "win32" })).toMatchObject({ quiesced: false });
  });

  it("does not relaunch after the exact process stop command fails", () => {
    vi.stubEnv("VITEST", ""); vi.stubEnv("NODE_ENV", "production");
    vi.mocked(spawnSync).mockImplementation((command) => command === "tasklist.exe"
      ? { status: 0, stdout: '"Antigravity IDE.exe","42"', stderr: "" } as never
      : { status: 1, stdout: "", stderr: "access denied" } as never);
    expect(launchAntigravity({ platform: "win32", forceRelaunch: true })).toMatchObject({ restarted: false });
    expect(spawn).not.toHaveBeenCalled();
    const stopCall = vi.mocked(spawnSync).mock.calls.find(([command]) => command === "powershell.exe");
    expect(stopCall?.[1]?.join(" ")).toContain("ExecutablePath");
  });

  it("cleans secondary lock files in the profile root rather than its User directory", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
    cleanAntigravitySessionCache({ platform: "win32", appData: "C:\\Fixture\\Roaming", home: "C:\\Fixture" });
    expect(unlink).toHaveBeenCalledWith(path.join("C:\\Fixture\\Roaming", "Antigravity", "lockfile"));
    expect(unlink).not.toHaveBeenCalledWith(path.join("C:\\Fixture\\Roaming", "Antigravity", "User", "lockfile"));
  });
  it("resolves the standard Windows Antigravity executable path only when it exists", () => {
    const missing = resolveAntigravityExecutablePath({
      platform: "win32",
      env: { LOCALAPPDATA: path.join("C:\\Users\\User", "AppData", "Local") }
    });

    expect(missing).toBeNull();
  });

  it("builds a restart script without embedding account material", () => {
    const script = buildAntigravityWindowsRestartScript("C:\\Users\\User\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe");

    expect(script).toContain("Stop-Process");
    expect(script).toContain("Start-Process");
    expect(script).toContain("Antigravity.exe");
    expect(script).not.toMatch(/token|refresh|authorization/i);
  });

  it("reports unsupported platforms without running a process command", () => {
    expect(restartAntigravityIntegration({ platform: "linux" })).toMatchObject({
      supported: false,
      attempted: false,
      restarted: false
    });
    expect(quiesceAntigravity({ platform: "linux" })).toMatchObject({
      supported: false,
      attempted: false,
      wasRunning: false,
      quiesced: false
    });
    expect(launchAntigravity({ platform: "linux" })).toMatchObject({
      supported: false,
      attempted: false,
      restarted: false
    });
  });

  it("handles quiesce gracefully when Antigravity is not running", () => {
    vi.stubEnv("VITEST", ""); vi.stubEnv("NODE_ENV", "production");
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: "", stderr: "" } as never);
    const result = quiesceAntigravity({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\NonExistentPath" }
    });
    expect(result.supported).toBe(true);
  });

  it("cleans lockfile and temporary session artifacts to prevent infinite onboarding hangs", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-cache-"));
    const userDataDir = path.join(tempRoot, "Antigravity IDE");
    fs.mkdirSync(userDataDir, { recursive: true });

    const lockfile = path.join(userDataDir, "lockfile");
    const devToolsPort = path.join(userDataDir, "DevToolsActivePort");
    const singletonLock = path.join(userDataDir, "SingletonLock");
    fs.writeFileSync(lockfile, "12345");
    fs.writeFileSync(devToolsPort, "9222\n/devtools/browser/123");
    fs.writeFileSync(singletonLock, "lock");

    const result = cleanAntigravitySessionCache({
      platform: "win32",
      appData: tempRoot
    });

    expect(result.cleaned).toContain(lockfile);
    expect(result.cleaned).toContain(devToolsPort);
    expect(result.cleaned).toContain(singletonLock);
    expect(fs.existsSync(lockfile)).toBe(false);
    expect(fs.existsSync(devToolsPort)).toBe(false);
    expect(fs.existsSync(singletonLock)).toBe(false);
    expect(result.errors).toEqual([]);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  it("does not fabricate process success from the test environment", async () => {
    vi.stubEnv("VITEST", "1"); vi.stubEnv("NODE_ENV", "test");
    expect(quiesceAntigravity({ platform: "win32" })).toMatchObject({ quiesced: false, attempted: false });
    expect(launchAntigravity({ platform: "win32" })).toMatchObject({ restarted: false, attempted: false });
    expect(await quiesceAntigravityAsync({ platform: "win32" })).toMatchObject({ quiesced: false, attempted: false });
    expect(await launchAntigravityAsync({ platform: "win32" })).toMatchObject({ restarted: false, attempted: false });
  });

  it("blocks native lifecycle and host discovery at the probe boundary", async () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CAM_PROBE_MODE", "isolated");
    vi.stubEnv("CAM_PROBE_TOKEN", "");
    vi.mocked(execFile).mockClear();
    const input = { platform: "win32" as const, exePath: fixtureExe };
    expect(await quiesceAntigravityAsync(input)).toMatchObject({ quiesced: false, attempted: false });
    expect(await launchAntigravityAsync(input)).toMatchObject({ restarted: false, attempted: false });
    await expect(resolveAntigravitySwitchTarget(input)).rejects.toThrow("CAM_PROBE_TOKEN");
    expect(await inspectAntigravityRuntimeBinding(input)).toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });

  it("quiesces an owned snapshot asynchronously and preserves creation-time checks", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-process-fixture-"));
    try {
      const exePath = path.join(root, "Antigravity.exe"); fs.writeFileSync(exePath, "inert-fixture");
      const userDir = path.join(root, "Antigravity IDE"); fs.mkdirSync(userDir);
      const created = new Date().toISOString(); let stopped = false; let timerProgressed = false;
      const scripts: string[] = [];
      const processAdapter = { launch: vi.fn(async () => 100), run: vi.fn(async (_command: string, args: string[]) => {
        const script = args.at(-1)!; scripts.push(script);
        await new Promise((resolve) => setTimeout(resolve, 15));
        if (script.includes("Stop-Process")) { stopped = true; return ""; }
        return JSON.stringify({ processes: stopped ? [] : [ { pid: 100, parentPid: 1, executablePath: exePath, name: "Antigravity.exe", creationTime: created, commandLine: `"${exePath}" --user-data-dir "${userDir}"` } ] });
      }) };
      const timer = setTimeout(() => { timerProgressed = true; }, 1);
      const result = await quiesceAntigravityAsync({ platform: "win32", exePath, appData: root, home: root, processAdapter }); clearTimeout(timer);
      expect(result).toMatchObject({ quiesced: true, wasRunning: true, attempted: true }); expect(timerProgressed).toBe(true);
      expect(scripts.find((script) => script.includes("Stop-Process"))).toContain(created); expect(scripts.find((script) => script.includes("Stop-Process"))).toContain("ProcessId = 100");
      expect(processAdapter.launch).not.toHaveBeenCalled();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses to stop a foreign explicit profile before any stop call", async () => {
    const exePath = "C:\\Tools\\Antigravity.exe";
    const processAdapter = { launch: vi.fn(async () => 100), run: vi.fn(async () => JSON.stringify({ processes: [{ pid: 100, parentPid: 1, executablePath: exePath, name: "Antigravity.exe", creationTime: new Date().toISOString(), commandLine: `"${exePath}" --user-data-dir "C:\\OtherProfile"` }] })) };
    expect(await quiesceAntigravityAsync({ platform: "win32", exePath, appData: "C:\\Fixture", home: "C:\\Fixture", processAdapter })).toMatchObject({ quiesced: false, attempted: false });
    expect(processAdapter.run).toHaveBeenCalledTimes(1); expect(processAdapter.launch).not.toHaveBeenCalled();
  });

  it("requests graceful window closure before the scoped force fallback", async () => {
    vi.useFakeTimers();
    const scripts: string[] = [];
    let running = true;
    const processAdapter = { launch: vi.fn(async () => 100), run: vi.fn(async (_command: string, args: string[]) => {
      const script = args.at(-1)!;
      scripts.push(script);
      if (script.includes("Stop-Process")) { running = false; return ""; }
      if (script.includes("CloseMainWindow")) return "";
      return JSON.stringify({ processes: running ? [fixtureProcess()] : [] });
    }) };
    const pending = quiesceFixture(processAdapter);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ quiesced: true, attempted: true, wasRunning: true });
    const closeIndex = scripts.findIndex(script => script.includes("CloseMainWindow"));
    const stopIndex = scripts.findIndex(script => script.includes("Stop-Process"));
    expect(closeIndex).toBeGreaterThan(-1);
    expect(stopIndex).toBeGreaterThan(closeIndex);
    expect(scripts[closeIndex]).toContain("ExecutablePath");
    expect(scripts[closeIndex]).toContain(fixtureCreated);
    expect(scripts[stopIndex]).toContain("Stop-Process -InputObject");
    expect(scripts[stopIndex]).toContain("HasExited");
    expect(scripts[stopIndex]).toContain("ExecutablePath");
    expect(scripts[stopIndex]).toContain(fixtureCreated);
    expect(scripts[stopIndex]).not.toContain("Stop-Process -Name");
    expect(processAdapter.launch).not.toHaveBeenCalled();
  });

  it("accepts a process exit during graceful closure without a force call", async () => {
    let running = true;
    const scripts: string[] = [];
    const processAdapter = { launch: vi.fn(async () => 100), run: vi.fn(async (_command: string, args: string[]) => {
      const script = args.at(-1)!;
      scripts.push(script);
      if (script.includes("CloseMainWindow")) { running = false; return ""; }
      return JSON.stringify({ processes: running ? [fixtureProcess()] : [] });
    }) };
    expect(await quiesceFixture(processAdapter)).toMatchObject({ quiesced: true, wasRunning: true });
    expect(scripts.some(script => script.includes("Stop-Process"))).toBe(false);
  });

  it("does not report quiescence when a new Antigravity root appears during window closure", async () => {
    let rows = [fixtureProcess()];
    const scripts: string[] = [];
    const processAdapter = { launch: vi.fn(async () => 100), run: vi.fn(async (_command: string, args: string[]) => {
      const script = args.at(-1)!;
      scripts.push(script);
      if (script.includes("CloseMainWindow")) {
        rows = [fixtureProcess({ pid: 200, creationTime: "2026-10-06T10:00:01.0000000Z" })];
        return "";
      }
      return JSON.stringify({ processes: rows });
    }) };
    expect(await quiesceFixture(processAdapter)).toMatchObject({ quiesced: false });
    expect(scripts.some(script => script.includes("Stop-Process"))).toBe(false);
  });

  it("gives a visible window time to close and preserves its process if it remains open", async () => {
    vi.useFakeTimers();
    const scripts: string[] = [];
    const processAdapter = { launch: vi.fn(async () => 100), run: vi.fn(async (_command: string, args: string[]) => {
      const script = args.at(-1)!;
      scripts.push(script);
      if (script.includes("CloseMainWindow")) return "";
      return JSON.stringify({ processes: [fixtureProcess({ mainWindowHandle: 123 })] });
    }) };
    const started = Date.now();
    const pending = quiesceFixture(processAdapter);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ quiesced: false, reason: expect.stringContaining("open window") });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(scripts.some(script => script.includes("Stop-Process"))).toBe(false);
  });

  it("keeps a captured child owned after its IDE parent exits", async () => {
    vi.useFakeTimers();
    const child = fixtureProcess({ pid: 101, parentPid: 100, name: "language_server_windows_x64.exe",
      executablePath: "C:\\Fixture\\Programs\\Antigravity\\resources\\language_server_windows_x64.exe",
      creationTime: "2026-10-06T10:00:01.0000000Z", commandLine: "fixture-language-server" });
    let rows = [fixtureProcess(), child];
    const scripts: string[] = [];
    const processAdapter = { launch: vi.fn(async () => 100), run: vi.fn(async (_command: string, args: string[]) => {
      const script = args.at(-1)!;
      scripts.push(script);
      if (script.includes("CloseMainWindow")) { rows = [child]; return ""; }
      if (script.includes("Stop-Process")) { rows = []; return ""; }
      return JSON.stringify({ processes: rows });
    }) };
    const pending = quiesceFixture(processAdapter);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ quiesced: true });
    const stop = scripts.find(script => script.includes("Stop-Process"));
    expect(stop).toContain("ProcessId = 101");
    expect(stop).toContain(child.creationTime);
    expect(stop).not.toContain("ProcessId = 100");
  });

  it.each([
    { creationTime: "2026-10-06T10:01:00.0000000Z" },
    { executablePath: "C:\\Windows\\System32\\notepad.exe", name: "notepad.exe" }
  ])("fails closed if a captured PID is reused or its path changes: %j", async (replacement) => {
    let rows = [fixtureProcess()];
    const scripts: string[] = [];
    const processAdapter = { launch: vi.fn(async () => 100), run: vi.fn(async (_command: string, args: string[]) => {
      const script = args.at(-1)!;
      scripts.push(script);
      if (script.includes("CloseMainWindow")) { rows = [fixtureProcess(replacement)]; return ""; }
      return JSON.stringify({ processes: rows });
    }) };
    expect(await quiesceFixture(processAdapter)).toMatchObject({ quiesced: false, reason: expect.stringMatching(/ownership changed/i) });
    expect(scripts.some(script => script.includes("Stop-Process"))).toBe(false);
  });

  it.each([
    fixtureProcess({ executablePath: "" }),
    fixtureProcess({ creationTime: "" }),
    fixtureProcess({ pid: 101, parentPid: 100, executablePath: "", name: "unknown-child.exe" })
  ])("refuses unknown ownership before either close or kill", async (unknown) => {
    const rows = unknown.parentPid === 100 ? [fixtureProcess(), unknown] : [unknown];
    const processAdapter = { launch: vi.fn(async () => 100), run: vi.fn(async () => JSON.stringify({ processes: rows })) };
    expect(await quiesceFixture(processAdapter)).toMatchObject({ quiesced: false, attempted: false });
    expect(processAdapter.run).toHaveBeenCalledTimes(1);
  });

  it("times out if a verified process persists after close and scoped stop", async () => {
    vi.useFakeTimers();
    const scripts: string[] = [];
    const processAdapter = { launch: vi.fn(async () => 100), run: vi.fn(async (_command: string, args: string[]) => {
      const script = args.at(-1)!;
      scripts.push(script);
      if (script.includes("CloseMainWindow") || script.includes("Stop-Process")) return "";
      return JSON.stringify({ processes: [fixtureProcess()] });
    }) };
    const pending = quiesceFixture(processAdapter);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ quiesced: false, attempted: true, reason: expect.stringMatching(/timeout|timed out/i) });
    expect(scripts.some(script => script.includes("Stop-Process"))).toBe(true);
  });

  it("preserves a useful native failure category without exposing stderr or command material", async () => {
    vi.stubEnv("VITEST", ""); vi.stubEnv("NODE_ENV", "production");
    vi.mocked(execFile).mockImplementation((_command, _args, _options, callback) => {
      (callback as (error: Error, stdout: string, stderr: string) => void)(
        Object.assign(new Error("Command failed: private-command-material"), { code: 1 }), "",
        'Access is denied.\n"access_token":"fixture-private-token"\nprivate-command-material');
      return {} as never;
    });
    const result = await quiesceAntigravityAsync({ platform: "win32", exePath: fixtureExe });
    expect(result).toMatchObject({ quiesced: false, reason: expect.stringMatching(/access.*denied/i) });
    expect(result.reason).not.toContain("fixture-private-token");
    expect(result.reason).not.toContain("private-command-material");
  });

  it("verifies a fresh OS process after asynchronous spawn rather than assuming launch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-launch-fixture-"));
    try {
      const exePath = path.join(root, "Antigravity.exe");
      const profile = path.join(root, "Antigravity IDE");
      fs.writeFileSync(exePath, "inert-fixture");
      let launched = false;
      let samples = 0;
      const processAdapter = { launch: vi.fn(async () => { launched = true; return 101; }), run: vi.fn(async () => {
        if (!launched) return JSON.stringify({ processes: [] });
        const actual = fixtureProcess({ pid: 101, executablePath: exePath,
          creationTime: fixtureCreated, commandLine: `"${exePath}" --user-data-dir "${profile}"`,
          mainWindowHandle: ++samples > 1 ? 123 : 0 });
        const unrelated = { ...actual, pid: 102, mainWindowHandle: 555 };
        return JSON.stringify({ processes: [unrelated, actual] });
      }) };
      vi.useFakeTimers();
      vi.setSystemTime(new Date(fixtureCreated));
      const pending = launchAntigravityAsync({ platform: "win32", exePath, appData: root, home: root, processAdapter });
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject({ restarted: true, attempted: true, pid: 101, windowObserved: true });
      expect(samples).toBe(3);
      expect(processAdapter.launch).toHaveBeenCalledExactlyOnceWith(exePath, ["--user-data-dir", profile]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses to relaunch if Antigravity appeared during profile activation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-launch-race-"));
    try {
      const exePath = path.join(root, "Antigravity.exe");
      fs.writeFileSync(exePath, "inert-fixture");
      const processAdapter = { launch: vi.fn(async () => 101), run: vi.fn(async () => JSON.stringify({
        processes: [fixtureProcess({ executablePath: exePath, mainWindowHandle: 123 })]
      })) };
      expect(await launchAntigravityAsync({ platform: "win32", exePath, appData: root, home: root,
        forceRelaunch: true, requireQuiescent: true, processAdapter })).toMatchObject({
        restarted: false, attempted: false, reason: expect.stringContaining("profile activation")
      });
      expect(processAdapter.run).toHaveBeenCalledTimes(1);
      expect(processAdapter.launch).not.toHaveBeenCalled();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("chooses the single running application, blocks both, and honors the preference when stopped", async () => {
    const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-target-"));
    try {
      const hub = path.join(localAppData, "Programs", "antigravity", "Antigravity.exe");
      const ide = path.join(localAppData, "Programs", "Antigravity IDE", "Antigravity IDE.exe");
      for (const exe of [hub, ide]) {
        fs.mkdirSync(path.dirname(exe), { recursive: true });
        fs.writeFileSync(exe, "inert-fixture");
      }
      const hubProcess = fixtureProcess({ executablePath: hub });
      const ideProcess = fixtureProcess({ pid: 200, executablePath: ide, name: "Antigravity IDE.exe" });
      let rows = [ideProcess];
      const processAdapter = { launch: vi.fn(async () => 101), run: vi.fn(async () => JSON.stringify({ processes: rows })) };
      const input = { platform: "win32" as const, target: "hub" as const, appData: fixtureAppData,
        env: { APPDATA: fixtureAppData, LOCALAPPDATA: localAppData }, home: "C:\\Fixture", processAdapter };
      expect(await resolveAntigravitySwitchTarget(input)).toEqual({ target: "ide", exePath: ide });
      expect(await quiesceAntigravityAsync(input)).toMatchObject({ attempted: false, quiesced: false });
      rows = [ideProcess, hubProcess];
      await expect(resolveAntigravitySwitchTarget(input)).rejects.toThrow("are running");
      expect(await launchAntigravityAsync({ ...input, exePath: hub })).toMatchObject({ restarted: false, attempted: false });
      rows = [];
      expect(await resolveAntigravitySwitchTarget(input)).toEqual({ target: "hub", exePath: hub });
      expect(await quiesceAntigravityAsync(input)).toMatchObject({ quiesced: true, wasRunning: false, exePath: hub });
      expect(processAdapter.launch).not.toHaveBeenCalled();
    } finally { fs.rmSync(localAppData, { recursive: true, force: true }); }
  });

  it("binds the Hub runtime to its bundled standalone server, selected port, and exact launched root", async () => {
    const serverPath = path.win32.join(path.win32.dirname(fixtureExe), "resources", "bin", "language_server.exe");
    const owner = fixtureProcess();
    const server = fixtureProcess({ pid: 101, parentPid: owner.pid, executablePath: serverPath,
      name: "language_server.exe", creationTime: "2026-10-06T10:00:01.0000000Z",
      commandLine: "language_server.exe --standalone --app_data_dir antigravity --https_server_port 34567 --csrf_token fixture-csrf-value" });
    const utility = fixtureProcess({ pid: 102, parentPid: owner.pid, commandLine: fixtureExe + " --type=utility" });
    server.parentPid = utility.pid;
    const readNativeSnapshot = async () => ({ processes: [owner, utility, server], listeners: [
      { pid: server.pid, port: 34568, localAddress: "127.0.0.1" },
      { pid: server.pid, port: 34567, localAddress: "127.0.0.1" }
    ] });
    const input = { platform: "win32" as const, target: "hub" as const, exePath: fixtureExe, appData: fixtureAppData,
      home: "C:\\Fixture", env: { APPDATA: fixtureAppData, LOCALAPPDATA: "C:\\Fixture" }, readNativeSnapshot };
    const expectedIde = { pid: owner.pid, creationTime: owner.creationTime };
    expect(await inspectAntigravityRuntimeBinding({ ...input, expectedIde })).toMatchObject({
      port: 34567, idePid: owner.pid, runtimePid: server.pid, profilePath: path.join(fixtureAppData, "Antigravity")
    });
    expect(await inspectAntigravityRuntimeBinding(input)).toMatchObject({ idePid: owner.pid, port: 34567 });
    expect(await inspectAntigravityRuntimeBinding({ ...input, expectedIde: { pid: utility.pid, creationTime: utility.creationTime } })).toBeNull();
    expect(await inspectAntigravityRuntimeBinding({ ...input, expectedIde: { ...expectedIde, creationTime: server.creationTime } })).toBeNull();
    expect(await inspectAntigravityRuntimeBinding({ ...input, appData: "C:\\ForeignProfile", expectedIde })).toBeNull();
    server.commandLine = server.commandLine.replace("--standalone", "");
    expect(await inspectAntigravityRuntimeBinding({ ...input, expectedIde })).toBeNull();
  });

});
