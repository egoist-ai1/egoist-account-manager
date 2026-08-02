import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { getAntigravityDiagnostics, resolveAntigravityPaths } from "../../src/main/services/antigravityPaths";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-paths-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("resolveAntigravityPaths", () => {
  it("resolves Windows Antigravity IDE paths from APPDATA", () => {
    const paths = resolveAntigravityPaths({
      platform: "win32",
      appData: "C:\\Users\\User\\AppData\\Roaming",
      home: "C:\\Users\\User"
    });

    expect(paths.userDataDir).toBe(path.join("C:\\Users\\User\\AppData\\Roaming", "Antigravity IDE"));
    expect(paths.profileKind).toBe("unknown");
    expect(paths.globalStorageDir).toBe(path.join(paths.userDataDir, "User", "globalStorage"));
    expect(paths.stateDbPath).toBe(path.join(paths.globalStorageDir, "state.vscdb"));
    expect(paths.storageJsonPath).toBe(path.join(paths.globalStorageDir, "storage.json"));
    expect(paths.machineIdPath).toBe(path.join(paths.userDataDir, "machineid"));
  });

  it("uses a Windows roaming fallback without APPDATA", () => {
    const paths = resolveAntigravityPaths({
      platform: "win32",
      home: "C:\\Users\\User"
    });

    expect(paths.userDataDir).toBe(path.join("C:\\Users\\User", "AppData", "Roaming", "Antigravity IDE"));
  });

  it("does not create directories while resolving paths", () => {
    const paths = resolveAntigravityPaths({
      platform: "linux",
      home: "/tmp/cam-antigravity-path-test"
    });

    expect(paths.userDataDir).toBe(path.join("/tmp/cam-antigravity-path-test", ".config", "Antigravity IDE"));
  });

  it("detects the current Antigravity Hub layout without requiring state.vscdb", () => {
    const home = tempDir();
    const appData = path.join(home, "AppData", "Roaming");
    const hubData = path.join(appData, "Antigravity");
    const geminiData = path.join(home, ".gemini", "antigravity");
    fs.mkdirSync(hubData, { recursive: true });
    fs.mkdirSync(geminiData, { recursive: true });
    fs.writeFileSync(path.join(hubData, "app_storage.json"), "{}", "utf8");
    fs.writeFileSync(path.join(geminiData, "installation_id"), "install-id", "utf8");

    const paths = resolveAntigravityPaths({
      platform: "win32",
      appData,
      home
    });
    const diagnostics = getAntigravityDiagnostics({
      platform: "win32",
      appData,
      home
    });

    expect(paths.profileKind).toBe("hub");
    expect(paths.userDataDir).toBe(hubData);
    expect(paths.storageJsonPath).toBe(path.join(hubData, "app_storage.json"));
    expect(paths.machineIdPath).toBe(path.join(geminiData, "installation_id"));
    expect(diagnostics.stateDbExists).toBe(false);
    expect(diagnostics.geminiDataDirExists).toBe(true);
    expect(diagnostics.appStorageExists).toBe(true);
    expect(diagnostics.installationIdExists).toBe(true);
  });
});
