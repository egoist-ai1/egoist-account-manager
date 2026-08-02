import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { DiagnosticsService } from "../services/diagnosticsService.js";

export function registerHealthIpc(service: DiagnosticsService, assertTrustedSender?: (event: IpcMainInvokeEvent) => void): void {
  ipcMain.handle("health:get", (event) => {
    assertTrustedSender?.(event);
    return service.getHealth();
  });
}
