import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { performAntigravityHygiene } from "../../src/main/services/antigravityHygieneService.js";

describe("antigravityHygieneService", () => {
  it("cleans lockfiles and ephemeral cache files, reporting freed bytes", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-hygiene-test-"));
    const appData = path.join(tempDir, "appdata");
    const userHome = path.join(tempDir, "userhome");
    const ideDir = path.join(appData, "Antigravity IDE");

    // 1. Create lock files
    fs.mkdirSync(ideDir, { recursive: true });
    const lockfile = path.join(ideDir, "lockfile");
    const singletonLock = path.join(ideDir, "SingletonLock");
    fs.writeFileSync(lockfile, "locked", "utf8");
    fs.writeFileSync(singletonLock, "123", "utf8");

    // 2. Create GPU cache files
    const gpuCacheDir = path.join(ideDir, "GPUCache");
    fs.mkdirSync(gpuCacheDir, { recursive: true });
    fs.writeFileSync(path.join(gpuCacheDir, "data_0"), "gpu data buffer 12345678", "utf8");

    // 3. Create crash dump
    const crashDir = path.join(userHome, ".gemini", "antigravity", "crashes");
    fs.mkdirSync(crashDir, { recursive: true });
    fs.writeFileSync(path.join(crashDir, "crash_01.dmp"), "dmp payload", "utf8");

    const result = performAntigravityHygiene({
      appData,
      home: userHome,
      platform: "win32"
    });

    expect(result.cleanedLocks.length).toBeGreaterThanOrEqual(2);
    expect(result.cleanedCaches.length).toBeGreaterThanOrEqual(1);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(lockfile)).toBe(false);
    expect(fs.existsSync(singletonLock)).toBe(false);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
