import { describe, expect, it, vi } from "vitest";
import { RefreshPriority, RefreshSchedulerService } from "../../src/main/services/refreshSchedulerService";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe("RefreshSchedulerService", () => {
  it("deduplicates matching credential generations and limits independent probes to two", async () => {
    const scheduler = new RefreshSchedulerService();
    const first = deferred<number>();
    const second = deferred<number>();
    const run = vi.fn(() => first.promise);
    const firstResult = scheduler.schedule("codex:a", run, { generation: "credentials:1" });
    const repeated = scheduler.schedule("codex:a", run, { generation: "credentials:1" });
    const secondResult = scheduler.schedule("antigravity:b", () => second.promise);
    const thirdRun = vi.fn(async () => 3);
    const thirdResult = scheduler.schedule("codex:c", thirdRun);
    await vi.waitFor(() => expect(scheduler.getStats()).toEqual({ active: 2, queued: 1, paused: false }));
    expect(firstResult).toBe(repeated);
    expect(run).toHaveBeenCalledTimes(1);
    expect(thirdRun).not.toHaveBeenCalled();
    first.resolve(1);
    expect(await firstResult).toBe(1);
    expect(await thirdResult).toBe(3);
    second.resolve(2);
    expect(await secondResult).toBe(2);
    await scheduler.whenIdle();
    expect(scheduler.getStats().active).toBe(0);
  });

  it("prioritizes manual and active requests and preserves FIFO among equal priorities", async () => {
    const scheduler = new RefreshSchedulerService(1);
    const release = scheduler.pause();
    const order: string[] = [];
    const queue = (key: string, priority: number) => scheduler.schedule(key, async () => { order.push(key); return key; }, { priority });
    const results = [queue("fleet-a", RefreshPriority.fleet), queue("fleet-b", RefreshPriority.fleet),
      queue("active", RefreshPriority.active), queue("manual", RefreshPriority.manual)];
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    release();
    await Promise.all(results);
    expect(order).toEqual(["manual", "active", "fleet-a", "fleet-b"]);
  });

  it("upgrades an already queued request's priority", async () => {
    const scheduler = new RefreshSchedulerService(1);
    const release = scheduler.pause();
    const order: string[] = [];
    const a = scheduler.schedule("a", async () => { order.push("a"); });
    const b = scheduler.schedule("b", async () => { order.push("b"); });
    expect(scheduler.schedule("b", async () => undefined, { priority: RefreshPriority.manual })).toBe(b);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["b", "a"]);
  });

  it("cancels a stale generation and does not publish its late result", async () => {
    const scheduler = new RefreshSchedulerService(1);
    const old = deferred<number>();
    let oldSignal: AbortSignal | undefined;
    const stale = scheduler.schedule("a", (signal) => { oldSignal = signal; return old.promise; }, { generation: "old" });
    const rejected = expect(stale).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(oldSignal).toBeDefined());
    const currentRun = vi.fn(async () => 2);
    const current = scheduler.schedule("a", currentRun, { generation: "new" });
    await rejected;
    expect(oldSignal!.aborted).toBe(true);
    expect(currentRun).not.toHaveBeenCalled();
    old.resolve(1);
    expect(await current).toBe(2);
    await scheduler.whenIdle();
  });

  it("disposes queued work without executing it", async () => {
    const scheduler = new RefreshSchedulerService();
    scheduler.pause();
    const run = vi.fn(async () => 1);
    const result = scheduler.schedule("a", run);
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    scheduler.dispose();
    await rejected;
    await scheduler.whenIdle();
    expect(run).not.toHaveBeenCalled();
    await expect(scheduler.schedule("b", run)).rejects.toThrow("disposed");
  });

  it("releases capacity when a probe fails", async () => {
    const scheduler = new RefreshSchedulerService(1);
    const failure = scheduler.schedule("a", async () => { throw new Error("offline"); });
    const success = scheduler.schedule("b", async () => "fresh");
    await expect(failure).rejects.toThrow("offline");
    expect(await success).toBe("fresh");
    await scheduler.whenIdle();
    expect(scheduler.getStats().queued).toBe(0);
  });
});
