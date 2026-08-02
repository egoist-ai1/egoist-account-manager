import { describe, expect, it } from "vitest";
import { LIVE_TRAY_REPRESENTATIONS, buildLiveTraySnapshot, renderLiveTrayBitmap } from "../../src/shared/liveTray";
import type { ManagedAccount } from "../../src/shared/types";

function account(input: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    id: "active",
    platform: "codex",
    label: "Primary profile",
    email: "primary@example.com",
    authMode: "chatgpt",
    providerAccountId: null,
    workspaceAccountId: null,
    workspaceLabel: null,
    authFingerprint: "fingerprint",
    credentialState: "ready",
    lastAuthenticatedAt: 1_000,
    expiresAt: null,
    version: 1,
    planType: "plus",
    profileDir: "profile",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: 1,
    lastRefreshAt: 1_000,
    lastRefreshErrorAt: null,
    lastRefreshError: null,
    subscriptionEndsAt: null,
    status: "active",
    statusReason: null,
    primaryUsedPercent: 25,
    primaryResetsAt: null,
    primaryWindowDurationMins: 300,
    secondaryUsedPercent: 40,
    secondaryResetsAt: null,
    secondaryWindowDurationMins: 10_080,
    fiveHourUsedPercent: 25,
    fiveHourResetsAt: null,
    weeklyUsedPercent: 40,
    weeklyResetsAt: null,
    notes: null,
    ...input
  };
}

describe("live tray indicator", () => {
  it("uses the most constrained fresh quota window", () => {
    const snapshot = buildLiveTraySnapshot([account()], { now: 1_100 });
    expect(snapshot).toMatchObject({
      state: "fresh",
      remainingPercent: 60,
      fiveHourRemaining: 75,
      weeklyRemaining: 60,
      activeWindowType: "weekly",
      iconText: "60"
    });
    expect(snapshot.tooltip).toContain("текущий недельный лимит: 60%");
  });

  it("does not duplicate one generic weekly quota into a five-hour window", () => {
    const snapshot = buildLiveTraySnapshot([account({
      primaryUsedPercent: 75,
      primaryResetsAt: 2_000,
      primaryWindowDurationMins: 10_080,
      secondaryUsedPercent: null,
      secondaryResetsAt: null,
      secondaryWindowDurationMins: null,
      fiveHourUsedPercent: null,
      fiveHourResetsAt: null,
      weeklyUsedPercent: null,
      weeklyResetsAt: null
    })], { now: 1_100 });
    expect(snapshot).toMatchObject({
      remainingPercent: 25,
      fiveHourRemaining: null,
      weeklyRemaining: 25,
      activeWindowType: "weekly",
      activeWindowResetAt: 2_000,
      iconText: "25"
    });
  });

  it("prefers the active Codex profile when another platform is active too", () => {
    const snapshot = buildLiveTraySnapshot([
      account({ id: "antigravity", platform: "antigravity", label: "Other platform", fiveHourUsedPercent: 90 }),
      account({ id: "codex-current", label: "Current Codex", weeklyUsedPercent: 35 })
    ], { now: 1_100 });
    expect(snapshot).toMatchObject({ accountId: "codex-current", accountLabel: "Current Codex" });
  });

  it("keeps error, stale and unknown distinct from zero", () => {
    expect(buildLiveTraySnapshot([account({ lastRefreshError: "timeout", lastRefreshErrorAt: 1_100 })], { now: 1_100 })).toMatchObject({ state: "error", iconText: "!" });
    expect(buildLiveTraySnapshot([account()], { now: 2_000, staleAfterSeconds: 300 })).toMatchObject({ state: "stale", iconText: "~" });
    expect(buildLiveTraySnapshot([account({ fiveHourUsedPercent: null, weeklyUsedPercent: null, primaryUsedPercent: null, secondaryUsedPercent: null })], { now: 1_100 })).toMatchObject({ state: "unknown", iconText: "—", remainingPercent: null });
    expect(buildLiveTraySnapshot([account({ fiveHourUsedPercent: 100, weeklyUsedPercent: 50 })], { now: 1_100 })).toMatchObject({ state: "critical", iconText: "0", remainingPercent: 0 });
  });

  it("hides the account label in privacy mode and renders a native bitmap", () => {
    const snapshot = buildLiveTraySnapshot([account()], { now: 1_100, privacyMode: true });
    expect(snapshot.tooltip).toContain("Активный профиль");
    expect(snapshot.tooltip).not.toContain("Primary profile");
    const bitmap = renderLiveTrayBitmap(snapshot);
    expect(bitmap).toHaveLength(32 * 32 * 4);
    expect(bitmap.some((channel) => channel > 0)).toBe(true);
  });

  it("provides pixel-aligned Windows representations for 100-200 percent DPI", () => {
    expect(LIVE_TRAY_REPRESENTATIONS).toEqual([
      { scaleFactor: 1, pixelSize: 16 },
      { scaleFactor: 1.25, pixelSize: 20 },
      { scaleFactor: 1.5, pixelSize: 24 },
      { scaleFactor: 2, pixelSize: 32 }
    ]);
    const snapshot = buildLiveTraySnapshot([account({ fiveHourUsedPercent: 36, weeklyUsedPercent: 20 })], { now: 1_100 });
    for (const representation of LIVE_TRAY_REPRESENTATIONS) {
      const bitmap = renderLiveTrayBitmap(snapshot, representation.pixelSize);
      expect(bitmap).toHaveLength(representation.pixelSize ** 2 * 4);
      expect(bitmap.some((channel) => channel > 0)).toBe(true);
    }
  });

  it("keeps visually confusable exact values distinct at the 16px shell size", () => {
    const render = (value: number) => Buffer.from(renderLiveTrayBitmap({
      state: value <= 10 ? "critical" : "fresh",
      accountId: "fixture",
      accountLabel: "Fixture",
      remainingPercent: value,
      fiveHourRemaining: value,
      weeklyRemaining: value,
      activeWindowType: "weekly",
      activeWindowResetAt: null,
      iconText: String(value),
      tooltip: "",
      updatedAt: 1
    }, 16)).toString("base64");
    for (const [left, right] of [[1, 7], [3, 8], [5, 6], [9, 99], [10, 100]]) {
      expect(render(left)).not.toBe(render(right));
    }
  });

  it("keeps a single critical digit compact and readable at every Windows DPI representation", () => {
    const snapshot: ReturnType<typeof buildLiveTraySnapshot> = {
      state: "critical",
      accountId: "fixture",
      accountLabel: "Fixture",
      remainingPercent: 1,
      fiveHourRemaining: null,
      weeklyRemaining: 1,
      activeWindowType: "weekly",
      activeWindowResetAt: null,
      iconText: "1",
      tooltip: "",
      updatedAt: 1
    };
    for (const { pixelSize } of LIVE_TRAY_REPRESENTATIONS) {
      const bitmap = renderLiveTrayBitmap(snapshot, pixelSize);
      const whitePixels: Array<[number, number]> = [];
      for (let y = 0; y < pixelSize; y += 1) {
        for (let x = 0; x < pixelSize; x += 1) {
          const offset = (y * pixelSize + x) * 4;
          if (bitmap[offset] > 225 && bitmap[offset + 1] > 225 && bitmap[offset + 2] > 225 && bitmap[offset + 3] > 225) {
            whitePixels.push([x, y]);
          }
        }
      }
      const xs = whitePixels.map(([x]) => x);
      const ys = whitePixels.map(([, y]) => y);
      const glyphWidth = Math.max(...xs) - Math.min(...xs) + 1;
      const glyphHeight = Math.max(...ys) - Math.min(...ys) + 1;
      expect(whitePixels.length).toBeGreaterThan(0);
      expect(glyphWidth / pixelSize).toBeGreaterThanOrEqual(0.18);
      expect(glyphWidth / pixelSize).toBeLessThanOrEqual(0.42);
      expect(glyphHeight / pixelSize).toBeGreaterThanOrEqual(0.5);
      expect(glyphHeight / pixelSize).toBeLessThanOrEqual(0.75);
    }
  });

  it("reports an empty active state without inventing a percentage", () => {
    expect(buildLiveTraySnapshot([], { now: 1_100 })).toMatchObject({ state: "empty", accountId: null, remainingPercent: null, iconText: "—" });
  });
});
