import { describe, expect, it } from "vitest";

import { buildAuditEventView, buildSwitchAuditEventView } from "../../src/shared/auditEvent";
import type { SwitchHistoryItem } from "../../src/shared/types";

function switchEvent(input: Partial<SwitchHistoryItem>): SwitchHistoryItem {
  return {
    id: input.id ?? "sw_1",
    accountId: input.accountId ?? "acc_1234567890abcdef",
    accountLabel: input.accountLabel ?? null,
    accountEmail: input.accountEmail ?? null,
    previousAccountId: input.previousAccountId ?? null,
    startedAt: input.startedAt ?? 1_800_000_000,
    completedAt: input.completedAt ?? null,
    status: input.status ?? "completed",
    error: input.error ?? null,
    backupPath: input.backupPath ?? null
  };
}

describe("audit event view formatter", () => {
  it("formats switch history without exposing full account ids or secrets", () => {
    const view = buildSwitchAuditEventView(switchEvent({
      status: "failed",
      error: "Authorization: Bearer sk-proj-secret-token-value for accountId=acc_1234567890abcdef"
    }));

    expect(view).toMatchObject({
      kind: "switch",
      title: "Переключение аккаунта",
      subject: "acc_...cdef",
      statusLabel: "ошибка",
      tone: "failed",
      timestamp: 1_800_000_000
    });
    expect(view.detail).toContain("[скрыто]");
    expect(view.detail).not.toContain("sk-proj-secret-token-value");
    expect(view.detail).not.toContain("acc_1234567890abcdef");
  });

  it("formats generic refresh/auth/import events with provider context", () => {
    expect(buildAuditEventView({
      kind: "refresh",
      provider: "codex",
      accountLabel: "основной",
      status: "completed",
      timestamp: 1_800_000_100
    })).toEqual({
      kind: "refresh",
      title: "Обновление лимитов",
      subject: "Codex · основной",
      statusLabel: "готово",
      tone: "completed",
      timestamp: 1_800_000_100,
      detail: null
    });

    expect(buildAuditEventView({
      kind: "auth",
      provider: "antigravity",
      accountEmail: "user@example.com",
      status: "needs_reauth",
      timestamp: 1_800_000_200,
      detail: "refreshToken=refresh-secret-token-value"
    })).toMatchObject({
      kind: "auth",
      title: "Проверка входа",
      subject: "Antigravity · u***@example.com",
      statusLabel: "нужен вход",
      tone: "warning"
    });
  });
});
