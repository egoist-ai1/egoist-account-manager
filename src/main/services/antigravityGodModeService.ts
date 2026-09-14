import fs from "node:fs";
import path from "node:path";
import { resolveAntigravityPaths, type AntigravityPathInput } from "./antigravityPaths.js";

export interface AntigravityGodModeStatus {
  enabled: boolean;
  settingsPath: string;
  details: {
    workspaceTrustDisabled: boolean;
    chatAlwaysConfirmDisabled: boolean;
    terminalConfirmNever: boolean;
    telemetryOff: boolean;
  };
}

export interface AntigravityGodModeSetResult {
  enabled: boolean;
  settingsPath: string;
  updatedKeys: string[];
}

function resolveSettingsPath(input: AntigravityPathInput = {}): string {
  const paths = resolveAntigravityPaths(input);
  return path.join(paths.userDataDir, "User", "settings.json");
}

function parseSettingsJson(content: string): Record<string, unknown> {
  // Strip single-line comments // ... before parsing
  const clean = content.replace(/\/\/.*$/gm, "").trim();
  if (!clean) return {};
  try {
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function getAntigravityGodModeStatus(input: AntigravityPathInput = {}): AntigravityGodModeStatus {
  const settingsPath = resolveSettingsPath(input);
  if (!fs.existsSync(settingsPath)) {
    return {
      enabled: false,
      settingsPath,
      details: {
        workspaceTrustDisabled: false,
        chatAlwaysConfirmDisabled: false,
        terminalConfirmNever: false,
        telemetryOff: false
      }
    };
  }

  try {
    const content = fs.readFileSync(settingsPath, "utf8");
    const settings = parseSettingsJson(content);

    const workspaceTrustDisabled = settings["security.workspace.trust.enabled"] === false;
    const chatAlwaysConfirmDisabled = settings["chat.editing.alwaysConfirm"] === false;
    const terminalConfirmNever = settings["terminal.integrated.confirmOnExit"] === "never";
    const telemetryOff = settings["telemetry.telemetryLevel"] === "off";

    const enabled = workspaceTrustDisabled && chatAlwaysConfirmDisabled && telemetryOff;

    return {
      enabled,
      settingsPath,
      details: {
        workspaceTrustDisabled,
        chatAlwaysConfirmDisabled,
        terminalConfirmNever,
        telemetryOff
      }
    };
  } catch {
    return {
      enabled: false,
      settingsPath,
      details: {
        workspaceTrustDisabled: false,
        chatAlwaysConfirmDisabled: false,
        terminalConfirmNever: false,
        telemetryOff: false
      }
    };
  }
}

export function setAntigravityGodMode(
  enabled: boolean,
  input: AntigravityPathInput = {}
): AntigravityGodModeSetResult {
  const settingsPath = resolveSettingsPath(input);
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  const existingContent = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf8") : "{}";
  const settings = parseSettingsJson(existingContent);
  const updatedKeys: string[] = [];

  if (enabled) {
    settings["security.workspace.trust.enabled"] = false;
    settings["chat.editing.alwaysConfirm"] = false;
    settings["terminal.integrated.confirmOnExit"] = "never";
    settings["telemetry.telemetryLevel"] = "off";
    updatedKeys.push(
      "security.workspace.trust.enabled",
      "chat.editing.alwaysConfirm",
      "terminal.integrated.confirmOnExit",
      "telemetry.telemetryLevel"
    );
  } else {
    delete settings["security.workspace.trust.enabled"];
    delete settings["chat.editing.alwaysConfirm"];
    delete settings["terminal.integrated.confirmOnExit"];
    settings["telemetry.telemetryLevel"] = "all";
    updatedKeys.push(
      "security.workspace.trust.enabled",
      "chat.editing.alwaysConfirm",
      "terminal.integrated.confirmOnExit",
      "telemetry.telemetryLevel"
    );
  }

  const tmpPath = `${settingsPath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, settingsPath);

  return {
    enabled,
    settingsPath,
    updatedKeys
  };
}
