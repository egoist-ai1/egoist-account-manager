import { describe, expect, it } from "vitest";
import {
  InAppNotificationService,
  buildAuthNotification,
  buildQuotaNotification,
  buildSwitchNotification,
  buildUpdateNotification
} from "../../src/main/services/inAppNotificationService";
import type { AuthEvent, SwitchTransaction } from "../../src/shared/types";

function transaction(phase: SwitchTransaction["phase"]): SwitchTransaction {
  const terminal = ["committed", "rolled_back", "aborted", "failed", "recovery_required"].includes(phase);
  return {
    id: "tx-1",
    platform: "codex",
    targetAccountId: "target",
    previousAccountId: "previous",
    status: terminal ? phase as SwitchTransaction["status"] : "running",
    phase,
    targetFingerprint: null,
    previousFingerprint: null,
    backupPath: null,
    errorCode: null,
    errorMessage: null,
    createdAt: 10,
    updatedAt: 12,
    completedAt: terminal ? 12 : null,
    version: 1
  };
}

describe("InAppNotificationService", () => {
  it("publishes only meaningful switch milestones and sounds only on completion", () => {
    expect(buildSwitchNotification(transaction("preparing"), "reserve", false)).toBeNull();
    expect(buildSwitchNotification(transaction("quiescing"), "reserve", false)).toMatchObject({
      title: "Сессия защищена · 1 из 3",
      silent: true,
      progress: { value: 1 / 3 }
    });
    expect(buildSwitchNotification(transaction("verifying"), "reserve", false)).toMatchObject({
      title: "Codex перезапущен · 2 из 3",
      silent: true
    });
    expect(buildSwitchNotification(transaction("committed"), "reserve", false)).toMatchObject({
      title: "Аккаунт активирован · 3 из 3",
      body: "reserve подтверждён и готов к работе.",
      silent: false,
      tone: "success"
    });
  });

  it("deduplicates repeated transaction events", () => {
    const service = new InAppNotificationService();
    const payload = buildSwitchNotification(transaction("committed"), "reserve", false);

    expect(service.take(payload)).not.toBeNull();
    expect(service.take(payload)).toBeNull();
  });

  it("reports saved login and quota threshold without exposing raw errors", () => {
    const auth: AuthEvent = {
      loginId: "login-1",
      profileId: "profile-1",
      success: false,
      error: "secret provider response"
    };
    expect(buildAuthNotification(auth, false).body).not.toContain("secret provider response");
    expect(buildQuotaNotification({
      accountId: "active",
      accountLabel: "main",
      windowId: "5h",
      windowType: "5h",
      remainingPercent: 3,
      resetAt: 1234,
      recommendedAccountId: "reserve",
      recommendedAccountLabel: "reserve"
    }, false)).toMatchObject({
      title: "Лимит 5 часов: осталось 3%",
      body: "main. Следующий проверенный профиль: reserve."
    });
  });

  it("keeps sound policy and progress inside a channel-neutral payload", () => {
    const payload = buildSwitchNotification(transaction("committed"), "A&B <profile>", false)!;
    expect(payload).toMatchObject({
      tone: "success",
      silent: false,
      progress: { value: 1, status: "Готово" }
    });
    expect(payload.createdAt).toBeGreaterThan(0);
    expect(payload.body).toContain("A&B <profile>");
  });

  it("announces an official repository listing without claiming artifact verification or silent installation", () => {
    expect(buildUpdateNotification("3.2.0", false)).toMatchObject({
      key: "release:3.2.0",
      title: "Доступен Codex Manager 3.2.0",
      tone: "progress",
      silent: false
    });
    expect(buildUpdateNotification("3.2.0", false).body).toContain("GitHub");
    expect(buildUpdateNotification("3.2.0", false).body).not.toContain("проверенн");
  });
});
