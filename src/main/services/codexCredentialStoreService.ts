import fs from "node:fs";
import path from "node:path";
import type { CodexCredentialStoreDiagnostics } from "../../shared/types.js";

function readConfiguredMode(configPath: string): CodexCredentialStoreDiagnostics["configuredMode"] {
  if (!fs.existsSync(configPath)) return "unspecified";
  const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) break;
    const match = trimmed.match(
      /^cli_auth_credentials_store\s*=\s*["'](file|keyring|auto|ephemeral)["']\s*(?:#.*)?$/
    );
    if (match) return match[1] as "file" | "keyring" | "auto" | "ephemeral";
    if (/^cli_auth_credentials_store\s*=/.test(trimmed)) return "invalid";
  }
  return "unspecified";
}

export function inspectCodexCredentialStore(codexHome: string): CodexCredentialStoreDiagnostics {
  const configPath = path.join(codexHome, "config.toml");
  const authJsonPresent = fs.existsSync(path.join(codexHome, "auth.json"));
  let configuredMode: CodexCredentialStoreDiagnostics["configuredMode"];
  try {
    configuredMode = readConfiguredMode(configPath);
  } catch (error) {
    return {
      configuredMode: "invalid",
      effectiveStore: "unknown",
      authJsonPresent,
      managerCompatible: false,
      message: `Codex credential-store configuration could not be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  if (configuredMode === "keyring") {
    return {
      configuredMode,
      effectiveStore: "keyring",
      authJsonPresent,
      managerCompatible: false,
      message: "Codex uses the OS keyring. File-bundle switching is disabled; the global setting was not changed."
    };
  }
  if (configuredMode === "ephemeral") {
    return {
      configuredMode,
      effectiveStore: "unknown",
      authJsonPresent,
      managerCompatible: false,
      message: "Codex uses ephemeral credentials. Nothing durable is available to import or switch."
    };
  }
  if (configuredMode === "auto") {
    return {
      configuredMode,
      effectiveStore: "unknown",
      authJsonPresent,
      managerCompatible: false,
      message: "Codex is in auto credential-store mode. auth.json does not prove whether Windows Codex selected the file store or OS keyring."
    };
  }
  if (configuredMode === "invalid") {
    return {
      configuredMode,
      effectiveStore: "unknown",
      authJsonPresent,
      managerCompatible: false,
      message: "cli_auth_credentials_store has an unsupported value in the global Codex config."
    };
  }
  return {
    configuredMode,
    effectiveStore: "file",
    authJsonPresent,
    managerCompatible: true,
    message: "Codex uses file-based auth.json credentials compatible with atomic profile switching."
  };
}
