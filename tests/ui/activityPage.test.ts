import { describe, expect, it } from "vitest";
import type { SwitchTransaction, SwitchTransactionPhase, SwitchTransactionStatus } from "../../src/shared/types";
import { verificationSummary } from "../../src/renderer/components/v3/ActivityPage";

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
    expect(verificationSummary(transaction("committed", "committed"), false)).toBe("Все проверки завершены");
    expect(verificationSummary(transaction("committed", "committed"), true)).toBe("All checks completed");
    expect(verificationSummary(transaction("rolled_back", "rolled_back"), false)).toBe("Предыдущая сессия восстановлена");
    expect(verificationSummary(transaction("recovery_required", "recovery_required"), false)).toBe("Требуется восстановление");
  });

  it("keeps the current phase for operations in progress", () => {
    expect(verificationSummary(transaction("running", "verifying"), false)).toBe("Проверка аккаунта");
    expect(verificationSummary(transaction("running", "verifying"), true)).toBe("Verify identity");
  });
});
