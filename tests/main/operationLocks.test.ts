import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AsyncKeyedLock } from "../../src/main/services/asyncKeyedLock";
import {
  CrossProcessLockError,
  CrossProcessLockService
} from "../../src/main/services/crossProcessLockService";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-operation-lock-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("operation locks", () => {
  it("serializes same-provider work while allowing independent providers", async () => {
    const lock = new AsyncKeyedLock();
    const order: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = lock.runExclusive("provider:codex", async () => {
      order.push("codex-1:start");
      await firstGate;
      order.push("codex-1:end");
    });
    const second = lock.runExclusive("provider:codex", async () => {
      order.push("codex-2");
    });
    const independent = lock.runExclusive("provider:antigravity", async () => {
      order.push("antigravity");
    });
    await independent;
    expect(order).toEqual(["codex-1:start", "antigravity"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["codex-1:start", "antigravity", "codex-1:end", "codex-2"]);
    expect(lock.isLocked("provider:codex")).toBe(false);
  });

  it("rejects a second live process and releases only its own token", async () => {
    const lockPath = path.join(tempDir(), "switch.lock");
    const first = new CrossProcessLockService({
      lockPath,
      pid: 100,
      isOwnerAlive: (record) => record.pid === 100
    });
    const second = new CrossProcessLockService({
      lockPath,
      pid: 200,
      isOwnerAlive: (record) => record.pid === 100
    });
    let checkSecond = async () => undefined;
    await first.runExclusive("switch:first", async () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      checkSecond = async () => {
        await expect(second.runExclusive("switch:second", async () => undefined))
          .rejects.toBeInstanceOf(CrossProcessLockError);
      };
      await checkSecond();
    });
    expect(fs.existsSync(lockPath)).toBe(false);
    await expect(second.runExclusive("switch:second", async () => "ok")).resolves.toBe("ok");
  });

  it("reclaims a stale owner record with one atomic retry", async () => {
    const lockPath = path.join(tempDir(), "switch.lock");
    fs.writeFileSync(lockPath, JSON.stringify({
      format: "one.egoist.codex-account-manager.operation-lock",
      token: "stale",
      pid: 999,
      processStartedAt: 1,
      operation: "stale-switch",
      createdAt: 1
    }), "utf8");
    const service = new CrossProcessLockService({
      lockPath,
      pid: 300,
      isOwnerAlive: () => false
    });

    await expect(service.runExclusive("switch:new", async () => "recovered")).resolves.toBe("recovered");
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
