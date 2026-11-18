import { Worker, type WorkerOptions } from "node:worker_threads";
import { assertProbeOperationAllowed } from "./probeIsolationService.js";

export interface CodexRuntimeDiscovery {
  codexPath: string | null;
  codexDesktopPath: string | null;
  codexAppUserModelId: string | null;
}

export interface NativeDiscoveryOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  commandTimeoutMs?: number;
  workerFactory?: (url: URL, options: WorkerOptions) => Worker;
}

export function discoverCodexRuntime(options: NativeDiscoveryOptions = {}): Promise<CodexRuntimeDiscovery> {
  assertProbeOperationAllowed("host-discovery");
  if (options.signal?.aborted) return Promise.reject(options.signal.reason);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const commandTimeoutMs = Math.min(options.commandTimeoutMs ?? 2_000, timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0) {
    return Promise.reject(new Error("Native discovery requires finite positive timeouts"));
  }
  return new Promise((resolve, reject) => {
    const factory = options.workerFactory ?? ((url, workerOptions) => new Worker(url, workerOptions));
    const worker = factory(new URL("./nativeDiscoveryWorker.js", import.meta.url), { workerData: { commandTimeoutMs }, execArgv: [] });
    let settled = false;
    const finish = (error?: Error, result?: CodexRuntimeDiscovery) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      void worker.terminate().catch(() => undefined);
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => {
      const error = new Error("Native discovery cancelled");
      error.name = "AbortError";
      finish(error);
    };
    const timer = setTimeout(() => finish(new Error("Native discovery timed out")), timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (message: unknown) => {
      if (typeof message !== "object" || !message || !("result" in message)) {
        finish(new Error("Native discovery worker failed"));
        return;
      }
      const result = message.result as Partial<CodexRuntimeDiscovery>;
      if (!result || typeof result !== "object" || [result.codexPath, result.codexDesktopPath, result.codexAppUserModelId].some((value) => value !== null && typeof value !== "string")) {
        finish(new Error("Invalid native discovery result"));
        return;
      }
      finish(undefined, result as CodexRuntimeDiscovery);
    });
    worker.on("error", () => finish(new Error("Native discovery worker could not run")));
    worker.on("exit", (code) => { if (!settled) finish(new Error(`Native discovery worker exited before replying (${code})`)); });
  });
}
