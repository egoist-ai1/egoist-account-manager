import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { updateSettingsInputSchema } from "../../shared/ipcSchemas.js";
import type { AppSettings } from "../../shared/types.js";
import type { SettingsService } from "../services/settingsService.js";

export function registerSettingsIpc(
  service: SettingsService,
  onUpdate?: (settings: AppSettings) => void,
  assertTrustedSender?: (event: IpcMainInvokeEvent) => void
): void {
  ipcMain.handle("settings:get", (event) => {
    assertTrustedSender?.(event);
    return service.get();
  });
  ipcMain.handle("settings:update", (event, input) => {
    assertTrustedSender?.(event);
    const settings = service.update(updateSettingsInputSchema.parse(input));
    onUpdate?.(settings);
    return settings;
  });
}
