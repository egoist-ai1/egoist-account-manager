import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";

vi.mock("node:child_process", () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
import {
  buildAntigravityWindowsRestartScript,
  cleanAntigravitySessionCache,
  launchAntigravity,
  isAntigravityRunning,
  quiesceAntigravity,
  resolveAntigravityExecutablePath,
  restartAntigravityIntegration
} from "../../src/main/services/antigravityProcessService.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

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
});
