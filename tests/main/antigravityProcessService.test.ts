import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAntigravityWindowsRestartScript,
  cleanAntigravitySessionCache,
  launchAntigravity,
  quiesceAntigravity,
  resolveAntigravityExecutablePath,
  restartAntigravityIntegration
} from "../../src/main/services/antigravityProcessService.js";

describe("antigravityProcessService", () => {
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
