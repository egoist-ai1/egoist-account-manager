import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAntigravityWindowsRestartScript,
  resolveAntigravityExecutablePath,
  restartAntigravityIntegration
} from "../../src/main/services/antigravityProcessService";

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
  });
});
