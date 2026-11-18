import { describe, expect, it } from "vitest";
import { LIVE_TRAY_REPRESENTATIONS, buildLiveTraySnapshot, buildDualLiveTraySnapshot, renderLiveTrayBitmap } from "../../src/shared/liveTray";
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
    expect(snapshot.tooltip).toContain("Квессер");
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
    expect(snapshot.tooltip).toContain("Выбранный профиль");
    expect(snapshot.tooltip).not.toContain("Primary profile");
    expect(snapshot.tooltip).toContain("Квессер");
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

  it("renders percentage strokes with smooth edges and a transparent background at every DPI", () => {
    const snapshot = buildLiveTraySnapshot([account({ fiveHourUsedPercent: 80 })], { now: 1_100 });
    const empty = buildLiveTraySnapshot([], { now: 1_100 });
    for (const { pixelSize } of LIVE_TRAY_REPRESENTATIONS) {
      const bitmap = renderLiveTrayBitmap(snapshot, pixelSize);
      const alphas = bitmap.filter((_, channel) => channel % 4 === 3);
      const visible = alphas.filter((alpha) => alpha > 0);
      const emptyVisible = renderLiveTrayBitmap(empty, pixelSize).filter((alpha, channel) => channel % 4 === 3 && alpha > 0);
      expect(visible.length).toBeLessThan(alphas.length * 0.48);
      expect(visible.length).toBeGreaterThan(emptyVisible.length * 2);
      expect(new Set(visible).size).toBeGreaterThan(5);
      expect(alphas.slice(0, pixelSize).every((alpha) => alpha === 0)).toBe(true);
      expect(alphas.slice(-pixelSize).every((alpha) => alpha === 0)).toBe(true);
    }
  });

  it("uses opposite grayscale ink on light and dark taskbars and reserves red for critical quota", () => {
    const fresh = buildLiveTraySnapshot([account()], { now: 1_100 });
    const critical = buildLiveTraySnapshot([account({ fiveHourUsedPercent: 100 })], { now: 1_100 });
    for (const theme of ["dark", "light"] as const) {
      const freshBitmap = renderLiveTrayBitmap(fresh, 32, "codex", theme);
      const criticalBitmap = renderLiveTrayBitmap(critical, 32, "codex", theme);
      const freshOffset = freshBitmap.findIndex((alpha, channel) => channel % 4 === 3 && alpha === 255) - 3;
      const criticalOffset = criticalBitmap.findIndex((alpha, channel) => channel % 4 === 3 && alpha === 255) - 3;
      const [blue, green, red] = freshBitmap.slice(freshOffset, freshOffset + 3);
      expect(blue).toBe(red);
      expect(green).toBe(red);
      expect(theme === "dark" ? red : 255 - red).toBeGreaterThan(200);
      expect(criticalBitmap[criticalOffset + 2] - criticalBitmap[criticalOffset]).toBeGreaterThan(50);
    }
  });

  it("reports an empty active state without inventing a percentage", () => {
    expect(buildLiveTraySnapshot([], { now: 1_100 })).toMatchObject({ state: "empty", accountId: null, remainingPercent: null, iconText: "—" });
  });

  it("builds dual live tray snapshot when both Codex and Antigravity are active", () => {
    const codexAcc = account({ id: "codex-1", platform: "codex", label: "Codex Plus", fiveHourUsedPercent: 20, weeklyUsedPercent: 20, primaryUsedPercent: 20, secondaryUsedPercent: 20 });
    const agAcc = account({ id: "ag-1", platform: "antigravity", label: "AG Pro", fiveHourUsedPercent: 10, weeklyUsedPercent: 10, primaryUsedPercent: 10, secondaryUsedPercent: 10 });
    const dual = buildDualLiveTraySnapshot([codexAcc, agAcc], { now: 1_100 });
    expect(dual.codex).toMatchObject({ accountId: "codex-1", platform: "codex", remainingPercent: 80 });
    expect(dual.antigravity).toMatchObject({ accountId: "ag-1", platform: "antigravity", remainingPercent: 90 });
    expect(dual.primary.accountId).toBe("codex-1");
  });

  it("uses the Egoist palette for both providers", () => {
    const snapshot = buildLiveTraySnapshot([account()], { now: 1_100 });
    const codexBitmap = renderLiveTrayBitmap(snapshot, 32, "codex");
    const agBitmap = renderLiveTrayBitmap(snapshot, 32, "antigravity");
    expect(codexBitmap).toHaveLength(32 * 32 * 4);
    expect(agBitmap).toHaveLength(32 * 32 * 4);
    expect(Buffer.from(codexBitmap).toString("hex")).toBe(Buffer.from(agBitmap).toString("hex"));
  });

  it("keeps a positive fraction visible and waits for a new observation after reset", () => {
    const current = account({ primaryUsedPercent: 99.6, fiveHourUsedPercent: 99.6, primaryResetsAt: 1_150, fiveHourResetsAt: 1_150 });
    expect(buildLiveTraySnapshot([current], { now: 1_100 })).toMatchObject({ state: "critical", iconText: "<1" });
    expect(buildLiveTraySnapshot([current], { now: 1_100 }).tooltip).toContain("<1%");
    expect(buildLiveTraySnapshot([current], { now: 1_160 })).toMatchObject({ state: "stale", iconText: "~" });
  });

  it("discloses an unconfirmed runtime while showing the selected profile quota", () => {
    const snapshot = buildLiveTraySnapshot([account()], { now: 1_100 });
    expect(snapshot.tooltip).toContain("Аккаунт работающей IDE не подтверждён");
    expect(snapshot.tooltip).not.toContain("Активный профиль");
    expect(snapshot.remainingPercent).toBe(60);
  });

  it("does not show ordinary-usage denial as a usable quota percentage", () => {
    const snapshot = buildLiveTraySnapshot([account({ quotaSnapshot: {
      limitId: "codex", limitName: "Codex", primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_500 },
      secondary: null, credits: null, planType: "plus", rateLimitReachedType: null, capturedAt: 1_000, ordinaryUsageAllowed: false
    } })], { now: 1_100 });
    expect(snapshot).toMatchObject({ state: "error", iconText: "!", remainingPercent: 80 });
    expect(snapshot.tooltip).toContain("использование недоступно");
  });

  it("does not substitute another provider when a platform-specific tray is empty", () => {
    expect(buildLiveTraySnapshot([account({ platform: "antigravity" })], { now: 1_100 }, "codex"))
      .toMatchObject({ state: "empty", accountId: null });
  });

  it("uses the same usable model group as readiness while preserving every observed window", () => {
    const snapshot = buildLiveTraySnapshot([account({ platform: "antigravity", quotaSnapshot: {
      limitId: "exhausted", limitName: "Exhausted", primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_500 },
      secondary: null, credits: null, planType: "unknown", rateLimitReachedType: null, capturedAt: 1_000,
      buckets: [
        { limitId: "exhausted", limitName: "Exhausted", modelId: "model-a", primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_500 }, secondary: null },
        { limitId: "available", limitName: "Available", modelId: "model-b", primary: { usedPercent: 20.5, windowDurationMins: 60, resetsAt: 1_500 }, secondary: null }
      ]
    } })], { now: 1_100 });
    expect(snapshot).toMatchObject({ state: "fresh", remainingPercent: 79.5, activeWindowType: "rolling", iconText: "80" });
    expect(snapshot.tooltip).toContain("1 ч");
    expect(snapshot.tooltip).toContain("model-b");
  });
});
