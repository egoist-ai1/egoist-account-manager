import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAntigravityGodModeStatus,
  setAntigravityGodMode
} from "../../src/main/services/antigravityGodModeService.js";

describe("antigravityGodModeService", () => {
  it("returns enabled: false when settings.json does not exist", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-godmode-test-"));
    const status = getAntigravityGodModeStatus({
      appData: tempDir,
      platform: "win32"
    });

    expect(status.enabled).toBe(false);
    expect(status.details.chatAlwaysConfirmDisabled).toBe(false);
    expect(status.details.telemetryOff).toBe(false);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("enables God Mode and preserves existing custom settings", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-godmode-test-"));
    const settingsDir = path.join(tempDir, "Antigravity IDE", "User");
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({ "editor.fontSize": 14, "workbench.colorTheme": "Dark" }, null, 2));

    const setResult = setAntigravityGodMode(true, {
      appData: tempDir,
      platform: "win32"
    });

    expect(setResult.enabled).toBe(true);

    const status = getAntigravityGodModeStatus({
      appData: tempDir,
      platform: "win32"
    });

    expect(status.enabled).toBe(true);
    expect(status.details.workspaceTrustDisabled).toBe(true);
    expect(status.details.chatAlwaysConfirmDisabled).toBe(true);
    expect(status.details.terminalConfirmNever).toBe(true);
    expect(status.details.telemetryOff).toBe(true);

    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(saved["editor.fontSize"]).toBe(14);
    expect(saved["workbench.colorTheme"]).toBe("Dark");
    expect(saved["chat.editing.alwaysConfirm"]).toBe(false);
    expect(saved["telemetry.telemetryLevel"]).toBe("off");

    // Test disabling God Mode restores telemetry and removes suppressions
    const disableResult = setAntigravityGodMode(false, {
      appData: tempDir,
      platform: "win32"
    });
    expect(disableResult.enabled).toBe(false);

    const statusDisabled = getAntigravityGodModeStatus({
      appData: tempDir,
      platform: "win32"
    });
    expect(statusDisabled.enabled).toBe(false);

    const savedDisabled = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(savedDisabled["editor.fontSize"]).toBe(14);
    expect(savedDisabled["chat.editing.alwaysConfirm"]).toBeUndefined();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
