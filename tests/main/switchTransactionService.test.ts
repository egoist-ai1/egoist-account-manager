import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountStore } from "../../src/main/db";
import { SwitchTransactionService } from "../../src/main/services/switchTransactionService";

const dirs: string[] = [];

function tempStore(): AccountStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-switch-tx-"));
  dirs.push(dir);
  return new AccountStore(dir);
}

function addAccount(store: AccountStore, id: string) {
  return store.upsert({
    id,
    label: id,
    email: `${id}@example.com`,
    planType: "plus",
    profileDir: `C:\\profiles\\${id}`,
    encryptedAuthJson: `sealed-${id}`,
    authMode: "chatgpt",
    authFingerprint: `${id}-fingerprint`,
    credentialState: "ready"
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("SwitchTransactionService", () => {
  it("prepares a validated dry run and can cancel before auth mutation", async () => {
    const store = tempStore();
    const phases: string[] = [];
    const service = new SwitchTransactionService(store, (transaction) => phases.push(transaction.phase));
    try {
      const prepared = await service.prepare({
        platform: "codex",
        targetAccountId: "target",
        previousAccountId: "previous",
        targetFingerprint: "target-fingerprint",
        previousFingerprint: "previous-fingerprint",
        validatePrevious: () => [],
        validateTarget: () => ["Target quota is stale; auth itself is valid."]
      });

      expect(prepared).toMatchObject({
        canCommit: true,
        warnings: ["Target quota is stale; auth itself is valid."],
        transaction: { status: "pending", phase: "ready", version: 4 }
      });
      expect(phases).toEqual(["preparing", "validating_previous", "validating_target", "ready"]);

      const cancelled = service.cancel(prepared.transaction.id);
      expect(cancelled).toMatchObject({
        status: "aborted",
        phase: "aborted",
        errorCode: "CANCELLED"
      });
      expect(service.reconcileInterrupted()).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("enforces one non-terminal switch transaction", async () => {
    const store = tempStore();
    const service = new SwitchTransactionService(store);
    try {
      const first = await service.prepare({
        platform: "codex",
        targetAccountId: "one",
        previousAccountId: null,
        targetFingerprint: null,
        previousFingerprint: null,
        validatePrevious: () => [],
        validateTarget: () => []
      });

      await expect(service.prepare({
        platform: "antigravity",
        targetAccountId: "two",
        previousAccountId: null,
        targetFingerprint: null,
        previousFingerprint: null,
        validatePrevious: () => [],
        validateTarget: () => []
      })).rejects.toThrow("Another switch transaction is already active");

      service.cancel(first.transaction.id);
      await expect(service.prepare({
        platform: "antigravity",
        targetAccountId: "two",
        previousAccountId: null,
        targetFingerprint: null,
        previousFingerprint: null,
        validatePrevious: () => [],
        validateTarget: () => []
      })).resolves.toMatchObject({ transaction: { targetAccountId: "two", phase: "ready" } });
    } finally {
      store.close();
    }
  });

  it("reconciles interrupted pre-write phases to aborted idempotently", async () => {
    const store = tempStore();
    const service = new SwitchTransactionService(store);
    try {
      const prepared = await service.prepare({
        platform: "codex",
        targetAccountId: "target",
        previousAccountId: "previous",
        targetFingerprint: "target-hash",
        previousFingerprint: "previous-hash",
        validatePrevious: () => [],
        validateTarget: () => []
      });
      service.begin(prepared.transaction.id, "target");

      const firstPass = service.reconcileInterrupted();
      const secondPass = service.reconcileInterrupted();

      expect(firstPass).toHaveLength(1);
      expect(firstPass[0]).toMatchObject({
        status: "aborted",
        phase: "aborted",
        errorCode: "INTERRUPTED_PRE_WRITE"
      });
      expect(secondPass).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("marks interruption after activation as recovery-required and stores hashes only", async () => {
    const store = tempStore();
    const service = new SwitchTransactionService(store);
    try {
      const prepared = await service.prepare({
        platform: "codex",
        targetAccountId: "target",
        previousAccountId: "previous",
        targetFingerprint: "target-hash",
        previousFingerprint: "previous-hash",
        validatePrevious: () => [],
        validateTarget: () => []
      });
      service.begin(prepared.transaction.id, "target");
      service.advanceById(prepared.transaction.id, "activating");

      expect(service.reconcileInterrupted()[0]).toMatchObject({
        status: "recovery_required",
        phase: "recovery_required",
        errorCode: "INTERRUPTED_AFTER_WRITE"
      });
      const serialized = JSON.stringify(service.list());
      expect(serialized).toContain("target-hash");
      expect(serialized).not.toMatch(/sk-[a-z0-9]|eyJ[a-zA-Z0-9_-]+/);
    } finally {
      store.close();
    }
  });

  it("rolls back the active marker when terminal journal persistence fails", () => {
    const store = tempStore();
    try {
      const previous = addAccount(store, "previous");
      const target = addAccount(store, "target");
      store.setActive(previous.id);
      const created = store.createSwitchTransaction({
        id: "atomic-finalization",
        platform: "codex",
        targetAccountId: target.id,
        previousAccountId: previous.id,
        targetFingerprint: target.authFingerprint,
        previousFingerprint: previous.authFingerprint
      });
      const verifying = store.updateSwitchTransaction(created.id, {
        status: "running",
        phase: "verifying"
      }, created.version);

      expect(() => store.finalizeSwitchTransactionWithActiveAccount(
        verifying.id,
        target.id,
        { phase: "constraint-failure" as never },
        verifying.version
      )).toThrow(/CHECK constraint failed/);

      expect(store.get(previous.id)?.isActive).toBe(true);
      expect(store.get(target.id)?.isActive).toBe(false);
      expect(store.getSwitchTransaction(verifying.id)).toMatchObject({
        status: "running",
        phase: "verifying",
        version: verifying.version
      });
    } finally {
      store.close();
    }
  });
});
