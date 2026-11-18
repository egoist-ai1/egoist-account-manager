import { EventEmitter } from "node:events";
import type { Worker, WorkerOptions } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverCodexRuntime } from "../../src/main/services/nativeDiscoveryService";
import { initializeProbeIsolation } from "../../src/main/services/probeIsolationService";

class FakeWorker extends EventEmitter {
  terminate = vi.fn(async () => 0);
}
afterEach(() => { initializeProbeIsolation({}); vi.unstubAllEnvs(); });

describe("asynchronous native discovery", () => {
  it("runs bounded commands outside main and validates the typed reply", async () => {
    initializeProbeIsolation({});
    const worker = new FakeWorker();
    const factory = vi.fn((_url: URL, _options: WorkerOptions) => worker as unknown as Worker);
    const pending = discoverCodexRuntime({ workerFactory: factory, timeoutMs: 1000, commandTimeoutMs: 500 });
    expect(factory.mock.calls[0][0].pathname).toContain("nativeDiscoveryWorker.js");
    expect(factory.mock.calls[0][1]).toMatchObject({ execArgv: [], workerData: { commandTimeoutMs: 500 } });
    const result = { codexPath: "fixture/codex.exe", codexDesktopPath: null, codexAppUserModelId: "fixture" };
    worker.emit("message", { result });
    expect(await pending).toEqual(result);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed replies and never accepts a partial runtime", async () => {
    initializeProbeIsolation({});
    const worker = new FakeWorker();
    const pending = discoverCodexRuntime({ workerFactory: () => worker as unknown as Worker });
    const rejected = expect(pending).rejects.toThrow("Invalid native discovery result");
    worker.emit("message", { result: { codexPath: null } });
    await rejected;
  });

  it("terminates a hung worker at the overall deadline", async () => {
    initializeProbeIsolation({});
    const worker = new FakeWorker();
    await expect(discoverCodexRuntime({ workerFactory: () => worker as unknown as Worker, timeoutMs: 15 })).rejects.toThrow("timed out");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("cancels without native process inspection and blocks incomplete probe policy before factory invocation", async () => {
    initializeProbeIsolation({});
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker as unknown as Worker);
    const controller = new AbortController();
    const pending = discoverCodexRuntime({ workerFactory: factory, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    vi.stubEnv("CAM_BACKGROUND_PROBE", "1");
    vi.resetModules();
    const fresh = await import("../../src/main/services/nativeDiscoveryService");
    const blockedFactory = vi.fn(() => worker as unknown as Worker);
    expect(() => fresh.discoverCodexRuntime({ workerFactory: blockedFactory })).toThrow("CAM_PROBE_TOKEN");
    expect(blockedFactory).not.toHaveBeenCalled();
  });
});
