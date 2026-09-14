import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateAntigravityHardwarePersona,
  injectAntigravitySecondaryPersona
} from "../../src/main/services/antigravityHardwarePersonaService.js";

describe("antigravityHardwarePersonaService", () => {
  it("generates deterministic hardware persona from a seed", () => {
    const persona1 = generateAntigravityHardwarePersona("test-account-seed-1");
    const persona2 = generateAntigravityHardwarePersona("test-account-seed-1");
    const personaDifferent = generateAntigravityHardwarePersona("test-account-seed-2");

    expect(persona1.telemetryMachineId).toBe(persona2.telemetryMachineId);
    expect(persona1.telemetryMacMachineId).toBe(persona2.telemetryMacMachineId);
    expect(persona1.devDeviceId).toBe(persona2.devDeviceId);
    expect(persona1.sqmId).toBe(persona2.sqmId);
    expect(persona1.serviceMachineId).toBe(persona2.serviceMachineId);
    expect(persona1.machineId).toBe(persona2.machineId);
    expect(persona1.installationId).toBe(persona2.installationId);
    expect(persona1.crashReporterId).toBe(persona2.crashReporterId);
    expect(persona1.fingerprintPrefix).toBe(persona2.fingerprintPrefix);

    expect(persona1.telemetryMachineId).not.toBe(personaDifferent.telemetryMachineId);
  });

  it("generates correctly formatted 64-char hex and UUID identifiers", () => {
    const persona = generateAntigravityHardwarePersona();

    expect(persona.telemetryMachineId).toMatch(/^[0-9a-f]{64}$/);
    expect(persona.telemetryMacMachineId).toMatch(/^[0-9a-f]{64}$/);
    expect(persona.devDeviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(persona.sqmId).toMatch(/^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i);
    expect(persona.serviceMachineId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(persona.machineId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(persona.installationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(persona.crashReporterId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(persona.fingerprintPrefix).toHaveLength(8);
  });

  it("safely writes installation_id and patches argv.json crash-reporter-id", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-persona-test-"));
    const homeDir = path.join(tempDir, "userhome");
    const appData = path.join(tempDir, "appdata");
    const argvDir = path.join(homeDir, ".antigravity-ide");
    fs.mkdirSync(argvDir, { recursive: true });

    const argvJsonPath = path.join(argvDir, "argv.json");
    fs.writeFileSync(argvJsonPath, JSON.stringify({ "crash-reporter-id": "old-crash-id", other: 123 }, null, 2));

    const persona = generateAntigravityHardwarePersona("seed-xyz");
    const result = injectAntigravitySecondaryPersona(persona, {
      home: homeDir,
      appData,
      platform: "win32"
    });

    expect(result.injectedInstallationId).toBe(true);
    expect(result.injectedArgvCrashId).toBe(true);

    const writtenInstallId = fs.readFileSync(result.paths.installationIdPath, "utf8");
    expect(writtenInstallId.trim()).toBe(persona.installationId);

    const updatedArgv = JSON.parse(fs.readFileSync(argvJsonPath, "utf8"));
    expect(updatedArgv["crash-reporter-id"]).toBe(persona.crashReporterId);
    expect(updatedArgv.other).toBe(123);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
