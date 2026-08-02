import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAntigravityProfileStatus, importAntigravityFromIde } from "../../src/main/services/antigravityProfileService";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-ag-profile-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("antigravity profile service", () => {
  it("reports a detected IDE profile without exposing file contents", () => {
    const appData = tempDir();
    const userDataDir = path.join(appData, "Antigravity IDE");
    const storageDir = path.join(userDataDir, "User", "globalStorage");
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(path.join(storageDir, "state.vscdb"), "secret-token-like-content", "utf8");
    fs.writeFileSync(path.join(storageDir, "storage.json"), "{\"refresh_token\":\"secret\"}", "utf8");
    fs.writeFileSync(path.join(userDataDir, "machineid"), "machine-secret", "utf8");

    const status = getAntigravityProfileStatus({
      platform: "win32",
      appData,
      home: path.dirname(appData)
    });

    expect(status.detected).toBe(true);
    expect(status.capabilities.diagnostics.supported).toBe(true);
    expect(status.capabilities.importFromIde.supported).toBe(true);
    expect(status.capabilities.importFromIde.reason).toBeNull();
    expect(status.capabilities.switchAccount.supported).toBe(true);
    expect(status.capabilities.switchAccount.reason).toContain("Credential Manager");
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(JSON.stringify(status)).not.toContain("refresh_token");
  });

  it("returns a typed unsupported import result instead of creating a fake account", () => {
    const appData = tempDir();
    const result = importAntigravityFromIde({
      platform: "win32",
      appData,
      home: path.dirname(appData)
    });

    expect(result.imported).toBe(false);
    expect(result.account).toBeNull();
    expect(result.reason).toContain("Локальный профиль Antigravity не найден");
  });
});
