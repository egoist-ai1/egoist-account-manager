import { describe, expect, it } from "vitest";
import {
  DesktopNotificationService,
  buildAuthNotification,
  buildQuotaNotification,
  buildSwitchNotification,
  buildUpdateNotification,
  createWindowsToastXml
} from "../../src/main/services/desktopNotificationService";
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

describe("DesktopNotificationService", () => {
  it("publishes only meaningful switch milestones and sounds only on completion", () => {
    expect(buildSwitchNotification(transaction("preparing"), "reserve", false)).toBeNull();
    expect(buildSwitchNotification(transaction("quiescing"), "reserve", false)).toMatchObject({
      title: "Смена аккаунта · 1 из 3",
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
    const service = new DesktopNotificationService();
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
      body: "main: лимит 5 часов. Следующий профиль: reserve."
    });
  });

  it("builds escaped branded Windows XML with progress and sound policy", () => {
    const payload = buildSwitchNotification(transaction("committed"), "A&B <profile>", false)!;
    const xml = createWindowsToastXml(payload, "C:/Program Files/Codex Manager/icon.png");

    expect(xml).toContain("ToastGeneric");
    expect(xml).toContain("appLogoOverride");
    expect(xml).toContain('placement="attribution"');
    expect(xml).toContain('content="Открыть менеджер"');
    expect(xml).toContain("A&amp;B &lt;profile&gt;");
    expect(xml).toContain('<audio src="ms-winsoundevent:Notification.Default"/>');
    expect(xml).not.toContain("A&B <profile>");
  });

  it("announces a verified GitHub release without claiming silent installation", () => {
    expect(buildUpdateNotification("3.2.0", false)).toMatchObject({
      key: "release:3.2.0",
      title: "Доступен Codex Manager 3.2.0",
      tone: "progress",
      silent: false
    });
    expect(buildUpdateNotification("3.2.0", false).body).toContain("GitHub Release");
  });
});
