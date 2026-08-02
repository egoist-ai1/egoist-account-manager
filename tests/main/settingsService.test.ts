import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountStore } from "../../src/main/db";
import { SettingsService } from "../../src/main/services/settingsService";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-settings-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("SettingsService", () => {
  it("persists settings with safe defaults and selectable language", () => {
    const store = new AccountStore(tempDir());
    const service = new SettingsService(store);

    expect(service.get().language).toBe("ru");
    service.update({ privacyMode: true, autoRefreshIntervalMs: 180000, language: "en" });

    expect(service.get()).toMatchObject({
      language: "en",
      privacyMode: true,
      autoRefreshIntervalMs: 180000,
      desktopClosePolicy: "exact-tree-fallback",
      smartSwitchMode: "suggest",
      smartSwitchThresholdPercent: 10,
      desktopNotifications: true,
      trayEnabled: false,
      autostartEnabled: false
    });
    service.update({
      smartSwitchMode: "auto",
      smartSwitchThresholdPercent: 15,
      desktopNotifications: false,
      trayEnabled: true,
      autostartEnabled: true,
      autoRefreshIntervalMs: 0
    });

    expect(service.get()).toMatchObject({
      smartSwitchMode: "suggest",
      smartSwitchThresholdPercent: 15,
      desktopNotifications: false,
      trayEnabled: true,
      autostartEnabled: true,
      autoRefreshIntervalMs: 0
    });
    store.close();
  });

  it("migrates legacy one- and five-minute refresh settings to the three-minute cadence", () => {
    const store = new AccountStore(tempDir());
    try {
      store.setSetting("appSettings", JSON.stringify({ autoRefreshIntervalMs: 60_000 }));
      expect(new SettingsService(store).get().autoRefreshIntervalMs).toBe(180_000);
      store.setSetting("appSettings", JSON.stringify({ autoRefreshIntervalMs: 300_000 }));
      expect(new SettingsService(store).get().autoRefreshIntervalMs).toBe(180_000);
    } finally {
      store.close();
    }
  });
});
