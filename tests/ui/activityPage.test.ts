import { describe, expect, it } from "vitest";
import type { ManagedAccount, SwitchHistoryItem, SwitchTransaction, SwitchTransactionPhase, SwitchTransactionStatus } from "../../src/shared/types";
import { matchesActivityFilter, rollbackEventFor, verificationSummary } from "../../src/renderer/components/v3/ActivityPage";

function transaction(status: SwitchTransactionStatus, phase: SwitchTransactionPhase): SwitchTransaction {
  return {
    id: "transaction-test",
    platform: "codex",
    targetAccountId: "target",
    previousAccountId: "previous",
    status,
    phase,
    targetFingerprint: null,
    previousFingerprint: null,
    backupPath: null,
    errorCode: null,
    errorMessage: null,
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
    version: 1
  };
}

describe("ActivityPage verification summary", () => {
  it("describes completed outcomes instead of repeating a technical phase", () => {
    expect(verificationSummary(transaction("committed", "committed"), false)).toBe("Аккаунт работающей IDE не подтверждён");
    expect(verificationSummary(transaction("committed", "committed"), true)).toBe("Running IDE account is unconfirmed");
    expect(verificationSummary(transaction("rolled_back", "rolled_back"), false)).toBe("Предыдущая сессия восстановлена");
    expect(verificationSummary(transaction("recovery_required", "recovery_required"), false)).toBe("Требуется восстановление");
  });

  it("only reports runtime proof when its evidence is verified", () => {
    const tx = transaction("committed", "committed");
    tx.verification = { profileApplied: true, credentials: "online_verified", credentialMethod: "official provider", launch: "process_started", runtime: "verified", runtimeSource: "bound_runtime_email", observedEmail: "profile@example.com", observedAt: 2, runtimePid: 123, message: "Runtime email confirmed" };
    expect(verificationSummary(tx, false)).toBe("Email работающей IDE подтверждён");
    tx.verification.runtime = "unsupported";
    expect(verificationSummary(tx, true)).toBe("Running IDE account is unconfirmed");
  });

  it("keeps the current phase for operations in progress", () => {
    expect(verificationSummary(transaction("running", "verifying"), false)).toBe("Проверка аккаунта");
    expect(verificationSummary(transaction("running", "verifying"), true)).toBe("Verify identity");
  });
});

describe("journal snapshot eligibility", () => {
  const tx = { ...transaction("committed", "committed"), backupPath: "owned/snapshot" };
  const event: SwitchHistoryItem = { id: "event", accountId: "target", accountLabel: null, accountEmail: null, previousAccountId: "previous", startedAt: 1, completedAt: 2, status: "completed", error: null, backupPath: "owned/snapshot" };
  const selected = [{ id: "target", isActive: true }] as ManagedAccount[];
  it("requires matching event and current selected target", () => {
    expect(rollbackEventFor(tx, [tx], [event], selected)?.id).toBe("event");
    expect(rollbackEventFor(tx, [tx], [{ ...event, backupPath: "other/snapshot" }], selected)).toBeNull();
    expect(rollbackEventFor(tx, [tx], [event], [])).toBeNull();
  });
  it("blocks older snapshots even after a later transaction was rolled back", () => {
    const later = { ...tx, id: "later", status: "rolled_back" as const, phase: "rolled_back" as const, createdAt: 3 };
    expect(rollbackEventFor(tx, [tx, later], [event], selected)).toBeNull();
  });
  it("exposes recovery for the latest written provider transaction", () => {
    const recovery = { ...tx, status: "recovery_required" as const, phase: "recovery_required" as const };
    expect(rollbackEventFor(recovery, [recovery], [event], [])?.id).toBe("event");
  });
});

describe("journal category classification", () => {
  it("includes cancellation in the labelled rollback and cancellation category", () => {
    const aborted = transaction("aborted", "aborted");
    const restored = transaction("rolled_back", "rolled_back");
    expect([aborted, restored, transaction("committed", "committed")].filter((item) => matchesActivityFilter(item, "rollback"))).toEqual([aborted, restored]);
    expect(matchesActivityFilter(aborted, "error")).toBe(false);
    expect(matchesActivityFilter(aborted, "success")).toBe(false);
  });
});
