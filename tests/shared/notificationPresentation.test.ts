import { describe, expect, it } from "vitest";
import type { AppNotificationPayload } from "../../src/shared/types";
import { mergeNotification, notificationDeadline } from "../../src/renderer/notificationPresentation";

const notice = (key: string, tone: AppNotificationPayload["tone"], createdAt = 100): AppNotificationPayload => ({
  key, title: key, body: "fixture", tone, createdAt, silent: true, timeoutType: "default",
  ...(tone === "progress" ? { progress: { value: 1 / 3, label: "Switch", status: "Closing IDE" } } : {})
});

describe("operation notifications", () => {
  it("replaces closing progress with a failure while preserving unrelated operations", () => {
    const unrelated = notice("quota:profile:weekly:1", "warning");
    const result = mergeNotification([notice("switch:one:quiescing", "progress"), unrelated], notice("switch:one:failed", "error"));
    expect(result.map((item) => item.key)).toEqual(["switch:one:failed", unrelated.key]);
    expect(result.some((item) => item.progress)).toBe(false);
  });

  it("does not revive terminal progress from a delayed event or replace a newer observation", () => {
    const terminal = [notice("switch:one:failed", "error", 200)];
    expect(mergeNotification(terminal, notice("switch:one:quiescing", "progress", 201))).toBe(terminal);
    expect(mergeNotification(terminal, notice("switch:one:verifying", "progress", 199))).toBe(terminal);
  });

  it("keeps concurrent switches distinct and allows a verified later recovery outcome", () => {
    const result = mergeNotification([notice("switch:one:failed", "error"), notice("switch:two:verifying", "progress")], notice("switch:one:rolled_back", "warning", 101));
    expect(result.map((item) => item.key)).toEqual(["switch:one:rolled_back", "switch:two:verifying"]);
  });

  it("retains active work and attention states until a terminal event or dismissal", () => {
    expect(notificationDeadline(notice("switch:one:quiescing", "progress"))).toBeNull();
    expect(notificationDeadline({ ...notice("switch:one:failed", "error"), timeoutType: "never" })).toBeNull();
    expect(notificationDeadline(notice("switch:one:committed", "success"))).toBe(107_000);
  });
});
