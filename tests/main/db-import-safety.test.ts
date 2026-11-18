import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AccountStore, type AccountExportRecord } from "../../src/main/db";
import type { SwitchVerificationEvidence } from "../../src/shared/types";
const dirs: string[] = [];
function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-import-safety-")); dirs.push(dir); return { dir, store: new AccountStore(dir) }; }
function record(dir: string, id: string, platform: "codex" | "antigravity" = "codex"): AccountExportRecord {
  return { id, platform, label: id, email: `${id}@example.com`, planType: "unknown", profileDir: path.join(dir, "profiles", id), encryptedAuthJson: `sealed-${id}`, isActive: false, createdAt: 1, updatedAt: 1, lastUsedAt: null, lastRefreshAt: null, subscriptionEndsAt: null, status: "unknown", statusReason: null, rateLimitJson: null, notes: null,
    antigravity: platform === "antigravity" ? { googleProjectId: "project", fingerprintId: null, lastQuotaRefreshAt: null, forbidden: false, ideStateDetected: false } : null };
}
function evidence(): SwitchVerificationEvidence { return { profileApplied: true, credentials: "online_verified", credentialMethod: "fixture", launch: "process_started", runtime: "verified", runtimeSource: "fixture", observedEmail: "one@example.com", observedAt: 1, runtimePid: 10, runtimeCreationTime: "2026-01-01T00:00:00Z", message: "Verified" }; }
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe("atomic portable import and durable evidence", () => {
  it("rejects duplicate existing IDs without overwriting credentials or changing active state", () => {
    const { dir, store } = fixture();
    try {
      store.importPortable(record(dir, "one")); store.setActive("one");
      expect(() => store.importPortableBatch([record(dir, "new"), { ...record(dir, "one"), encryptedAuthJson: "malicious-replacement" }])).toThrow(/conflicts/);
      expect(store.get("new")).toBeNull(); expect(store.get("one")).toMatchObject({ encryptedAuthJson: "sealed-one", isActive: true });
      expect(fs.existsSync(path.join(dir, "profiles"))).toBe(false);
    } finally { store.close(); }
  });
  it("rolls back earlier accounts when the last Antigravity detail insertion fails", () => {
    const { dir, store } = fixture();
    const db = new Database(path.join(dir, "accounts.sqlite"));
    try {
      db.exec("CREATE TRIGGER reject_bad_detail BEFORE INSERT ON antigravity_account_details WHEN NEW.account_id = 'bad' BEGIN SELECT RAISE(ABORT, 'detail failure'); END;");
      expect(() => store.importPortableBatch([record(dir, "good"), record(dir, "bad", "antigravity")])).toThrow(/detail failure/);
      expect(store.list()).toEqual([]);
    } finally { db.close(); store.close(); }
  });
  it.each(["../foreign", "..\\foreign", "C:\\outside", "NUL"])('rejects unsafe managed IDs %s before any insert', (id) => {
    const { dir, store } = fixture();
    try { expect(() => store.importPortableBatch([record(dir, id)])).toThrow(/profile id|owned/); expect(store.list()).toEqual([]); } finally { store.close(); }
  });
  it("blocks a provider after recovery_required while allowing the other provider", () => {
    const { dir, store } = fixture();
    try {
      store.createSwitchTransaction({ id: "tx-recovery", platform: "codex", targetAccountId: "one", previousAccountId: null, targetFingerprint: null, previousFingerprint: null });
      store.updateSwitchTransaction("tx-recovery", { status: "recovery_required", phase: "recovery_required", backupPath: "sealed-backup" });
      expect(store.getRecoveryRequired("codex")?.id).toBe("tx-recovery");
      expect(() => store.importPortableBatch([record(dir, "one")])).toThrow(/recovery/);
      expect(() => store.createSwitchTransaction({ id: "blocked", platform: "codex", targetAccountId: "one", previousAccountId: null, targetFingerprint: null, previousFingerprint: null })).toThrow(/recovery/);
      expect(store.importPortable(record(dir, "ag", "antigravity")).platform).toBe("antigravity");
    } finally { store.close(); }
  });
  it("stores separate runtime proof and invalidates it after credential or selection changes", () => {
    const { dir, store } = fixture();
    try {
      store.importPortableBatch([record(dir, "one"), record(dir, "two")]); store.setActive("one");
      store.createSwitchTransaction({ id: "proof", platform: "codex", targetAccountId: "one", previousAccountId: null, targetFingerprint: null, previousFingerprint: null });
      store.setSwitchVerification("proof", evidence());
      expect(store.get("one")?.runtimeVerification?.runtime).toBe("verified");
      store.updateEncryptedAuthJson("one", "rotated-sealed"); expect(store.get("one")?.runtimeVerification).toBeNull();
      store.setSwitchVerification("proof", evidence()); store.setActive("two");
      expect(store.get("one")?.runtimeVerification).toBeNull(); expect(store.get("two")?.runtimeVerification).toBeNull();
    } finally { store.close(); }
  });
  it("preserves exact windows, floating precision and all snapshot scopes", () => {
    const { dir, store } = fixture();
    try {
      store.importPortable(record(dir, "one"));
      const limits = { limitId: "quota", limitName: null, primary: { usedPercent: 99.6, resetsAt: 2000000000, windowDurationMins: 45 }, secondary: { usedPercent: 10, resetsAt: 2000000001, windowDurationMins: null }, credits: null, planType: null, rateLimitReachedType: null, source: "codex_app_server" as const, fetchedAt: 1900000000 };
      const mapped = store.setRateLimits("one", limits, "active", null);
      expect(mapped.primaryUsedPercent).toBe(99.6); expect(mapped.primaryWindowDurationMins).toBe(45); expect(mapped.fiveHourUsedPercent).toBeNull(); expect(mapped.weeklyUsedPercent).toBeNull(); expect(mapped.quotaSnapshot).toEqual(limits);
    } finally { store.close(); }
  });
  it("atomically clears successful identity evidence on a locally observed credential replacement", () => {
    const { dir, store } = fixture();
    try {
      store.importPortable({ ...record(dir, "observed", "antigravity"), credentialState: "ready", lastAuthenticatedAt: 100 });
      store.setActive("observed");
      store.setRuntimeVerification("observed", evidence());
      const before = store.get("observed")!;
      const updated = store.updateObservedAuthMaterial("observed", "sealed-local-rotation");
      expect(updated).toMatchObject({
        encryptedAuthJson: "sealed-local-rotation", credentialState: "needs_review",
        lastAuthenticatedAt: null, runtimeVerification: null, status: "unknown",
        version: before.version + 1, isActive: true
      });
      store.createSwitchTransaction({
        id: "observed-recovery", platform: "antigravity", targetAccountId: "observed",
        previousAccountId: null, targetFingerprint: null, previousFingerprint: null
      });
      store.updateSwitchTransaction("observed-recovery", { status: "recovery_required", phase: "recovery_required" });
      expect(() => store.updateObservedAuthMaterial("observed", "blocked-material")).toThrow(/recovery/i);
      expect(store.get("observed")!.encryptedAuthJson).toBe("sealed-local-rotation");
    } finally { store.close(); }
  });

  it("marks explicitly verified credentials ready without clearing an independent quota failure", () => {
    const { dir, store } = fixture();
    try {
      store.importPortable({ ...record(dir, "verified", "antigravity"), credentialState: "needs_review" });
      store.updateObservedAuthMaterial("verified", "sealed-material");
      const local = store.get("verified")!;
      const verified = store.markCredentialVerified("verified");
      expect(verified).toMatchObject({ credentialState: "ready", status: "unknown", statusReason: null, version: local.version });
      expect(verified.lastAuthenticatedAt).toBeGreaterThan(0);
      store.setCredentialState("verified", "needs_review", "Independent quota error");
      store.recordRateLimitFailure("verified", "Independent quota error");
      expect(store.markCredentialVerified("verified")).toMatchObject({
        credentialState: "ready", lastRefreshError: "Independent quota error",
        status: "error", statusReason: "Independent quota error"
      });
      store.createSwitchTransaction({
        id: "verified-recovery", platform: "antigravity", targetAccountId: "verified",
        previousAccountId: null, targetFingerprint: null, previousFingerprint: null
      });
      store.updateSwitchTransaction("verified-recovery", { status: "recovery_required", phase: "recovery_required" });
      expect(() => store.markCredentialVerified("verified")).toThrow(/recovery/i);
    } finally { store.close(); }
  });

  it("orders same-second switch writes by insertion so rollback selects the latest actual transaction", () => {
    const { store } = fixture();
    try {
      const first = store.createSwitchTransaction({
        id: "z-earlier-write", platform: "codex", targetAccountId: "earlier",
        previousAccountId: null, targetFingerprint: null, previousFingerprint: null,
        now: 1_800_000_000
      });
      store.updateSwitchTransaction(first.id, { status: "committed", phase: "committed" }, first.version);
      const second = store.createSwitchTransaction({
        id: "a-latest-write", platform: "codex", targetAccountId: "latest",
        previousAccountId: "earlier", targetFingerprint: null, previousFingerprint: null,
        now: 1_800_000_000
      });
      store.updateSwitchTransaction(second.id, { status: "committed", phase: "committed" }, second.version);
      expect(store.listSwitchTransactions().map(transaction => transaction.id)).toEqual([second.id, first.id]);
      expect(store.listSwitchTransactions(1)[0].id).toBe(second.id);
      store.updateSwitchTransaction(first.id, { status: "recovery_required", phase: "recovery_required" });
      store.updateSwitchTransaction(second.id, { status: "recovery_required", phase: "recovery_required" });
      expect(store.getRecoveryRequired("codex")?.id).toBe(first.id);
    } finally { store.close(); }
  });

});
