import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountStore } from "../../src/main/db";
import { SwitchTransactionService } from "../../src/main/services/switchTransactionService";

const iterationCount = 1000;
const batchSize = 100;
const batchCount = iterationCount / batchSize;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-switch-soak-"));
const artifactDir = path.join(process.cwd(), "artifacts", "3.0", "verification");
const samples: number[] = [];
let emittedPhases = 0;
let store: AccountStore;
let service: SwitchTransactionService;
let heapBefore = 0;
let resourcesBefore: string[] = [];
let startedAt = 0;

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0;
}

function resourceHistogram(resources: string[]): Record<string, number> {
  return resources.reduce<Record<string, number>>((counts, resource) => {
    counts[resource] = (counts[resource] ?? 0) + 1;
    return counts;
  }, {});
}

beforeAll(() => {
  store = new AccountStore(tempDir);
  service = new SwitchTransactionService(store, () => {
    emittedPhases += 1;
  });
  heapBefore = process.memoryUsage().heapUsed;
  resourcesBefore = process.getActiveResourcesInfo();
  startedAt = performance.now();
});

afterAll(() => {
  try {
    const totalMs = performance.now() - startedAt;
    const sorted = samples.slice().sort((left, right) => left - right);
    const heapAfter = process.memoryUsage().heapUsed;
    const resourcesAfter = process.getActiveResourcesInfo();
    const runnerOwnedResources = new Set(["Timeout", "Immediate", "SimpleWriteWrap"]);
    const persistentResourcesBefore = resourcesBefore.filter((resource) => !runnerOwnedResources.has(resource));
    const persistentResourcesAfter = resourcesAfter.filter((resource) => !runnerOwnedResources.has(resource));
    const beforeHistogram = resourceHistogram(resourcesBefore);
    const afterHistogram = resourceHistogram(resourcesAfter);
    const resourceDeltaByType = Object.fromEntries(
      Array.from(new Set([...Object.keys(beforeHistogram), ...Object.keys(afterHistogram)]))
        .sort()
        .map((resource) => [resource, (afterHistogram[resource] ?? 0) - (beforeHistogram[resource] ?? 0)])
    );
    const metrics = {
      schema: "one.egoist.codex-account-manager.switch-soak.v1",
      generatedAt: new Date().toISOString(),
      iterations: iterationCount,
      batches: batchCount,
      emittedPhases,
      totalMs: Number(totalMs.toFixed(3)),
      medianMs: Number(percentile(sorted, 0.5).toFixed(3)),
      p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
      p99Ms: Number(percentile(sorted, 0.99).toFixed(3)),
      maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)),
      heapDeltaBytes: heapAfter - heapBefore,
      activeResourceDelta: resourcesAfter.length - resourcesBefore.length,
      persistentResourceDelta: persistentResourcesAfter.length - persistentResourcesBefore.length,
      resourceDeltaByType,
      terminalTransactionsSampled: service.list(30).length,
      platform: process.platform,
      arch: process.arch,
      node: process.version
    };
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, "switch-soak.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

    expect(samples).toHaveLength(iterationCount);
    expect(service.reconcileInterrupted()).toEqual([]);
    expect(service.list(30)).toHaveLength(30);
    expect(service.list(30).every((transaction) => transaction.status === "committed")).toBe(true);
    expect(emittedPhases).toBe(iterationCount * 9);
    expect(metrics.p95Ms).toBeLessThan(250);
    // GitHub-hosted Windows runners can be heavily contended. Per-transition
    // latency remains the primary regression signal; this ceiling catches a
    // genuine stall without making the release gate runner-speed dependent.
    expect(metrics.totalMs).toBeLessThan(120_000);
    expect(metrics.heapDeltaBytes).toBeLessThan(96 * 1024 * 1024);
    // Each observed batch can add Vitest watchdog/reporter handles; exclude
    // runner-owned timers/writes while retaining the persistent resource leak gate.
    expect(metrics.persistentResourceDelta).toBeLessThanOrEqual(2);
  } finally {
    store?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe.sequential("3.0 synthetic switch soak", () => {
  for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
    it(`commits journaled switch batch ${batchIndex + 1} of ${batchCount}`, async () => {
      const firstIndex = batchIndex * batchSize;
      for (let offset = 0; offset < batchSize; offset += 1) {
        const index = firstIndex + offset;
        const cycleStartedAt = performance.now();
        const targetAccountId = index % 2 === 0 ? "synthetic-a" : "synthetic-b";
        const previousAccountId = index % 2 === 0 ? "synthetic-b" : "synthetic-a";
        const prepared = await service.prepare({
          platform: "codex",
          targetAccountId,
          previousAccountId,
          targetFingerprint: `target-${index % 2}`,
          previousFingerprint: `previous-${index % 2}`,
          validatePrevious: () => [],
          validateTarget: () => []
        });
        service.begin(prepared.transaction.id, targetAccountId);
        service.advanceById(prepared.transaction.id, "activating", { backupPath: `sealed:${index}` });
        service.advanceById(prepared.transaction.id, "launching");
        service.advanceById(prepared.transaction.id, "verifying");
        service.advanceById(prepared.transaction.id, "committed");
        samples.push(performance.now() - cycleStartedAt);
      }
      expect(samples).toHaveLength((batchIndex + 1) * batchSize);
      expect(service.reconcileInterrupted()).toEqual([]);
      expect(service.list(1)[0]?.status).toBe("committed");
    }, 30_000);
  }
});
