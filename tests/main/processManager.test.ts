import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildOpenAiDesktopRestartScript,
  getOpenAiDesktopCandidates,
  pickCodexPathFromWhereOutput
} from "../../src/main/processManager";

describe("processManager", () => {
  it("prefers the Windows npm cmd shim over the extensionless shim from where.exe", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-codex-path-"));
    const extensionless = path.join(dir, "codex");
    const cmd = path.join(dir, "codex.cmd");
    const appxExe = path.join(dir, "WindowsApps", "OpenAI.Codex_1", "app", "resources", "codex.exe");
    fs.mkdirSync(path.dirname(appxExe), { recursive: true });
    fs.writeFileSync(extensionless, "");
    fs.writeFileSync(cmd, "");
    fs.writeFileSync(appxExe, "");
    const output = [
      extensionless,
      cmd,
      appxExe
    ].join("\r\n");

    try {
      expect(pickCodexPathFromWhereOutput(output)).toBe(cmd);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers the current ChatGPT desktop executable while retaining legacy Codex compatibility", () => {
    const candidates = getOpenAiDesktopCandidates("C:\\Program Files\\WindowsApps\\OpenAI.Codex_1");

    expect(candidates).toEqual([
      path.join("C:\\Program Files\\WindowsApps\\OpenAI.Codex_1", "app", "ChatGPT.exe"),
      path.join("C:\\Program Files\\WindowsApps\\OpenAI.Codex_1", "app", "Codex.exe")
    ]);
  });

  it("builds a serialized graceful restart for both current and legacy desktop process names", () => {
    const script = buildOpenAiDesktopRestartScript({
      desktopPath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app\\ChatGPT.exe",
      appUserModelId: "OpenAI.Codex_abc!App",
      logPath: "C:\\Temp\\restart.log"
    });

    expect(script).toContain("ChatGPT.exe");
    expect(script).toContain("Codex.exe");
    expect(script).toContain("CloseMainWindow()");
    expect(script).toContain("EgoistCodexAccountManagerOpenAiRestart");
    expect(script).toContain("*\\app\\ChatGPT.exe");
    expect(script).toContain("*\\app\\Codex.exe");
    expect(script).toContain("shell:AppsFolder\\");
    expect(script).toContain("Wait-OpenAiWindow 15");
    expect(script).not.toContain("taskkill.exe");
    expect(script).not.toContain("Stop-Process");
    expect(script).not.toContain("/IM");
  });

  it.runIf(process.platform === "win32")("produces a PowerShell script that parses without syntax errors", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-restart-script-"));
    const scriptPath = path.join(dir, "restart.ps1");
    fs.writeFileSync(scriptPath, buildOpenAiDesktopRestartScript({
      desktopPath: null,
      appUserModelId: null,
      logPath: path.join(dir, "restart.log")
    }), "utf8");

    try {
      const quotedPath = scriptPath.replace(/'/g, "''");
      const command = `$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${quotedPath}', [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }`;
      const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
      expect(result.status, result.stderr || result.stdout).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
