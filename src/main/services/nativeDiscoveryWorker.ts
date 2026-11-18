import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
import { assertProbeOperationAllowed } from "./probeIsolationService.js";

if (!parentPort) throw new Error("Native discovery requires a worker thread");
try {
  assertProbeOperationAllowed("host-discovery");
  const commandTimeoutMs = Number(workerData.commandTimeoutMs);
  if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) throw new Error("Invalid native command timeout");
  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = ((command: string, args: string[], options: childProcess.SpawnSyncOptions = {}) => originalSpawnSync(command, args, {
    ...options,
    timeout: Math.min(options.timeout && options.timeout > 0 ? options.timeout : commandTimeoutMs, commandTimeoutMs),
    killSignal: "SIGKILL",
    windowsHide: true
  })) as typeof childProcess.spawnSync;
  syncBuiltinESMExports();
  const manager = await import("../processManager.js");
  parentPort.postMessage({ result: {
    codexPath: manager.resolveCodexPath(),
    codexDesktopPath: manager.resolveCodexDesktopPath(),
    codexAppUserModelId: process.platform === "win32" ? manager.getCodexAppUserModelId() : null
  } });
} catch {
  parentPort.postMessage({ error: "Native discovery failed" });
}
