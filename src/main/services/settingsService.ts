import type { AppSettings } from "../../shared/types.js";
import type { AccountStore } from "../db.js";

const defaultSettings: AppSettings = {
  language: "ru",
  autoRefreshIntervalMs: 180_000,
  privacyMode: false,
  confirmSwitch: true,
  desktopClosePolicy: "exact-tree-fallback",
  smartSwitchMode: "suggest",
  smartSwitchThresholdPercent: 10,
  desktopNotifications: true,
  trayEnabled: false,
  autostartEnabled: false
};

export class SettingsService {
  constructor(private readonly store: AccountStore) {}

  get(): AppSettings {
    const raw = this.store.getSetting("appSettings");
    if (!raw) return defaultSettings;
    try {
      const parsed = JSON.parse(raw) as Omit<Partial<AppSettings>, "autoRefreshIntervalMs"> & {
        autoRefreshIntervalMs?: number;
      };
      const settings = { ...defaultSettings, ...parsed };
      // Keep existing users on the new three-minute cadence. Quota polling no
      // longer forces a credential refresh, so this interval does not create
      // token-rotation churn.
      if (settings.autoRefreshIntervalMs === 60_000 || settings.autoRefreshIntervalMs === 300_000) {
        settings.autoRefreshIntervalMs = 180_000;
      }
      if (![0, 180_000, 600_000, 900_000].includes(settings.autoRefreshIntervalMs)) {
        settings.autoRefreshIntervalMs = defaultSettings.autoRefreshIntervalMs;
      }
      // "auto" existed in 1.9.x. Preserve the intent to receive help, but never
      // switch accounts without a direct user command.
      return (settings.smartSwitchMode === "auto" ? { ...settings, smartSwitchMode: "suggest" } : settings) as AppSettings;
    } catch {
      return defaultSettings;
    }
  }

  update(input: Partial<AppSettings>): AppSettings {
    const next: AppSettings = { ...this.get(), ...input };
    this.store.setSetting("appSettings", JSON.stringify(next));
    return next;
  }
}
