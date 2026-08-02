import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, describe, expect, it } from "vitest";
import { AccountStore } from "../../src/main/db";
import { SwitchTransactionService } from "../../src/main/services/switchTransactionService";

const iterationCount = 1000;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-switch-soak-"));

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0;
}

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("3.0 synthetic switch soak", () => {
  it("commits 1000 journaled switch state machines without a leak or stranded transaction", async () => {
    const artifactDir = path.join(process.cwd(), "artifacts", "3.0", "verification");
    const store = new AccountStore(tempDir);
    let emittedPhases = 0;
    const service = new SwitchTransactionService(store, () => {
      emittedPhases += 1;
    });
    const samples: number[] = [];
    const heapBefore = process.memoryUsage().heapUsed;
    const resourcesBefore = process.getActiveResourcesInfo();
    const startedAt = performance.now();

    try {
      for (let index = 0; index < iterationCount; index += 1) {
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

      const totalMs = performance.now() - startedAt;
      const sorted = samples.slice().sort((left, right) => left - right);
      const heapAfter = process.memoryUsage().heapUsed;
      const resourcesAfter = process.getActiveResourcesInfo();
      const metrics = {
        schema: "one.egoist.codex-account-manager.switch-soak.v1",
        generatedAt: new Date().toISOString(),
        iterations: iterationCount,
        emittedPhases,
        totalMs: Number(totalMs.toFixed(3)),
        medianMs: Number(percentile(sorted, 0.5).toFixed(3)),
        p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
        p99Ms: Number(percentile(sorted, 0.99).toFixed(3)),
        maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)),
        heapDeltaBytes: heapAfter - heapBefore,
        activeResourceDelta: resourcesAfter.length - resourcesBefore.length,
        terminalTransactionsSampled: service.list(30).length,
        platform: process.platform,
        arch: process.arch,
        node: process.version
      };
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(path.join(artifactDir, "switch-soak.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

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
      expect(metrics.activeResourceDelta).toBeLessThanOrEqual(2);
    } finally {
      store.close();
    }
  }, 150_000);
});
