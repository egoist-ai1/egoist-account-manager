import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveAntigravityPaths, type AntigravityPathInput } from "./antigravityPaths.js";

export interface AntigravityHardwarePersona {
  telemetryMachineId: string;    // 64-char hex SHA256 (storage.json)
  telemetryMacMachineId: string; // 64-char hex SHA256 (storage.json)
  devDeviceId: string;           // UUID v4 (storage.json)
  sqmId: string;                 // {GUID} in uppercase (storage.json)
  serviceMachineId: string;      // UUID v4 (state.vscdb: storage.serviceMachineId)
  machineId: string;             // UUID v4 (machineid file)
  installationId: string;        // UUID v4 (.gemini/antigravity/installation_id)
  crashReporterId: string;       // UUID v4 (~/.antigravity-ide/argv.json)
  fingerprintPrefix: string;     // Short prefix (e.g. 8 chars) for UI display
}

function hashToUuid(hex: string): string {
  const clean = hex.padEnd(32, "0").slice(0, 32);
  const part1 = clean.slice(0, 8);
  const part2 = clean.slice(8, 12);
  const part3 = `4${clean.slice(13, 16)}`;
  const v = (parseInt(clean.slice(16, 18), 16) & 0x3f) | 0x80;
  const part4 = `${v.toString(16).padStart(2, "0")}${clean.slice(18, 20)}`;
  const part5 = clean.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`.toLowerCase();
}

/**
 * Generates an isolated Hardware Persona for an Antigravity account.
 * If seed is provided, it is derived deterministically (ensuring persistence across restarts).
 * If no seed is provided, a fresh random persona is generated.
 */
export function generateAntigravityHardwarePersona(seed?: string | null): AntigravityHardwarePersona {
  if (seed && seed.trim()) {
    const s = seed.trim();
    const hMachine = crypto.createHash("sha256").update(`${s}:telemetry.machineId`).digest("hex");
    const hMac = crypto.createHash("sha256").update(`${s}:telemetry.macMachineId`).digest("hex");
    const hDevDevice = crypto.createHash("sha256").update(`${s}:telemetry.devDeviceId`).digest("hex");
    const hSqm = crypto.createHash("sha256").update(`${s}:telemetry.sqmId`).digest("hex");
    const hService = crypto.createHash("sha256").update(`${s}:storage.serviceMachineId`).digest("hex");
    const hMachineId = crypto.createHash("sha256").update(`${s}:machineid`).digest("hex");
    const hInstall = crypto.createHash("sha256").update(`${s}:installation_id`).digest("hex");
    const hCrash = crypto.createHash("sha256").update(`${s}:crash-reporter-id`).digest("hex");

    const devDeviceId = hashToUuid(hDevDevice);
    const serviceMachineId = hashToUuid(hService);
    const machineId = hashToUuid(hMachineId);
    const installationId = hashToUuid(hInstall);
    const crashReporterId = hashToUuid(hCrash);
    const sqmId = `{${hashToUuid(hSqm).toUpperCase()}}`;

    return {
      telemetryMachineId: hMachine,
      telemetryMacMachineId: hMac,
      devDeviceId,
      sqmId,
      serviceMachineId,
      machineId,
      installationId,
      crashReporterId,
      fingerprintPrefix: hMachine.slice(0, 8)
    };
  }

  const hMachine = crypto.randomBytes(32).toString("hex");
  const hMac = crypto.randomBytes(32).toString("hex");
  const devDeviceId = crypto.randomUUID();
  const serviceMachineId = crypto.randomUUID();
  const machineId = crypto.randomUUID();
  const installationId = crypto.randomUUID();
  const crashReporterId = crypto.randomUUID();
  const sqmId = `{${crypto.randomUUID().toUpperCase()}}`;

  return {
    telemetryMachineId: hMachine,
    telemetryMacMachineId: hMac,
    devDeviceId,
    sqmId,
    serviceMachineId,
    machineId,
    installationId,
    crashReporterId,
    fingerprintPrefix: hMachine.slice(0, 8)
  };
}

export interface AntigravityPersonaInjectionResult {
  injectedInstallationId: boolean;
  injectedArgvCrashId: boolean;
  paths: {
    installationIdPath: string;
    argvJsonPath: string | null;
  };
}

/**
 * Safely injects secondary hardware persona artifacts (installation_id and argv.json)
 * that sit outside state.vscdb / storage.json.
 */
export function injectAntigravitySecondaryPersona(
  persona: AntigravityHardwarePersona,
  input: AntigravityPathInput = {}
): AntigravityPersonaInjectionResult {
  const paths = resolveAntigravityPaths(input);
  const home = input.home ?? os.homedir();

  let injectedInstallationId = false;
  try {
    fs.mkdirSync(path.dirname(paths.installationIdPath), { recursive: true });
    fs.writeFileSync(paths.installationIdPath, persona.installationId.trim(), "utf8");
    injectedInstallationId = true;
  } catch {
    // Non-fatal if installation_id directory is locked
  }

  let injectedArgvCrashId = false;
  const argvJsonPath = path.join(home, ".antigravity-ide", "argv.json");
  try {
    if (fs.existsSync(argvJsonPath)) {
      const content = fs.readFileSync(argvJsonPath, "utf8");
      // Safely replace or insert "crash-reporter-id"
      if (content.includes('"crash-reporter-id"')) {
        const updated = content.replace(
          /"crash-reporter-id"\s*:\s*"[^"]*"/,
          `"crash-reporter-id": "${persona.crashReporterId}"`
        );
        fs.writeFileSync(argvJsonPath, updated, "utf8");
        injectedArgvCrashId = true;
      }
    }
  } catch {
    // Non-fatal if argv.json cannot be parsed or updated
  }

  return {
    injectedInstallationId,
    injectedArgvCrashId,
    paths: {
      installationIdPath: paths.installationIdPath,
      argvJsonPath: fs.existsSync(argvJsonPath) ? argvJsonPath : null
    }
  };
}
