import { expect, test, type Page } from "@playwright/test";

async function syntheticBridge(page: Page, options: { count?: number; unknownQuota?: boolean; privacy?: boolean } = {}) {
  await page.addInitScript((options) => {
    const now = Math.floor(Date.now() / 1000);
    const accounts = Array.from({ length: options.count ?? 1 }, (_, index) => ({
      id: `synthetic-${index}`, platform: "codex", label: `Synthetic ${index}`, email: `profile-${index}@example.com`,
      authMode: "chatgpt", providerAccountId: `provider-${index}`, workspaceAccountId: null, workspaceLabel: null,
      authFingerprint: `fingerprint-${index}`, credentialState: "ready", lastAuthenticatedAt: now, expiresAt: null,
      version: 1, planType: "plus", profileDir: "synthetic-private-path", isActive: index === 0, createdAt: now,
      updatedAt: now, lastUsedAt: now, lastRefreshAt: options.unknownQuota ? null : now, subscriptionEndsAt: null,
      status: "active", statusReason: null, primaryUsedPercent: options.unknownQuota ? null : 25,
      secondaryUsedPercent: options.unknownQuota ? null : 40, primaryResetsAt: options.unknownQuota ? null : now + 3600,
      secondaryResetsAt: options.unknownQuota ? null : now + 86400, primaryWindowDurationMins: 300,
      secondaryWindowDurationMins: 10080, fiveHourUsedPercent: options.unknownQuota ? null : 25,
      weeklyUsedPercent: options.unknownQuota ? null : 40, fiveHourResetsAt: options.unknownQuota ? null : now + 3600,
      weeklyResetsAt: options.unknownQuota ? null : now + 86400, tags: [], credits: null, quotaGroups: [],
      lastQuotaRefreshError: null, lastQuotaRefreshErrorAt: null
    }));
    let settings = {
      language: "ru", autoRefreshIntervalMs: 0, trayRefreshIntervalMs: 0, privacyMode: options.privacy ?? false,
      confirmSwitch: true, desktopClosePolicy: "exact-tree-fallback", smartSwitchMode: "off",
      smartSwitchThresholdPercent: 10, notificationSoundEnabled: false, trayEnabled: false, autostartEnabled: false
    };
    const calls: string[] = [];
    Object.assign(window, { smokeCalls: calls });
    const methods: Record<string, (...args: unknown[]) => unknown> = {
      listAccounts: async () => accounts,
      refreshAllAccounts: async () => accounts,
      getDiagnostics: async () => ({ codexPath: null, activeCodexHome: "synthetic-private-path", appDataDir: "synthetic-private-path", workspacePath: "synthetic-private-path", startupError: null }),
      getSettings: async () => settings,
      updateSettings: async (input) => { settings = { ...settings, ...(input as object) }; return settings; },
      getAppInfo: async () => ({ name: "Account Manager EGO", version: "synthetic", publisher: "Synthetic", vaultDegraded: false }),
      getAntigravityGodMode: async () => ({ enabled: false, details: {} }),
      setAntigravityGodMode: async () => { calls.push("setAntigravityGodMode"); return { enabled: true }; },
      getAntigravityProfileStatus: async () => ({ detected: false }),
      getWorkspaceBinding: async () => null,
      listSwitchTransactions: async () => [],
      getSwitchHistory: async () => [],
      getLimitHistory: async () => []
    };
    window.cam = new Proxy(methods, {
      get(target, name: string) {
        if (name.startsWith("on")) return () => () => undefined;
        if (target[name]) return target[name];
        return async () => { calls.push(name); return null; };
      }
    }) as unknown as NonNullable<typeof window.cam>;
  }, options);
}

async function ready(page: Page, suffix = "") {
  await page.goto("/" + suffix);
  const notes = page.getByRole("dialog", { name: "Что нового" });
  if (await notes.isVisible()) await notes.getByRole("button", { name: "Понятно" }).click();
  await expect(page.locator(".overview-page")).toBeVisible();
}

test("initial rendering never enables Antigravity privileged preferences", async ({ page }) => {
  await syntheticBridge(page);
  await ready(page);
  expect(await page.evaluate(() => (window as unknown as { smokeCalls: string[] }).smokeCalls)).not.toContain("setAntigravityGodMode");
});

test("unknown quotas remain unknown across overview, account list and tray", async ({ page }) => {
  await syntheticBridge(page, { unknownQuota: true });
  await ready(page);
  await expect(page.locator(".clean-big-num.is-codex, .clean-quota-card.is-codex .clean-big-num")).toHaveText(["-", "-"]);
  expect(await page.locator(".clean-quota-card.is-codex").allTextContents()).toEqual(expect.not.arrayContaining([expect.stringContaining("100%")]));
  await page.getByLabel("Основные разделы").getByRole("button", { name: "Аккаунты", exact: true }).click();
  await expect(page.locator(".profile-card")).toHaveCount(1);
  await expect(page.locator(".profile-card")).not.toContainText("100%");
  await expect(page.locator(".profile-card")).not.toContainText("Не ограничен");
  await page.goto("/?surface=tray");
  await expect(page.locator(".tray-live")).toBeVisible();
  await expect(page.locator(".tray-live")).not.toContainText("100%");
  await expect(page.locator(".tray-live-value strong")).toHaveText("-");
});

for (const viewport of [{ width: 1460, height: 900 }, { width: 1080, height: 780 }]) {
  test(`nine real synthetic profiles remain reachable with settings and audit — ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await syntheticBridge(page, { count: 9 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    const nav = page.getByLabel("Основные разделы");
    await nav.getByRole("button", { name: "Аккаунты", exact: true }).click();
    await expect(page.locator(".profile-card")).toHaveCount(9);
    await page.locator(".profile-card").last().scrollIntoViewIfNeeded();
    await expect(page.locator(".profile-card").last()).toBeInViewport();
    expect(await page.locator(".profile-main").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Список", exact: true }).click();
    await expect(page.locator(".account-compact-row")).toHaveCount(9);
    await page.getByRole("button", { name: "Карточки", exact: true }).click();
    await page.getByRole("button", { name: "Подробнее о профиле" }).first().click();
    const inspector = page.getByRole("dialog", { name: "Подробности профиля" });
    await expect(inspector.getByRole("button", { name: "Удалить профиль" })).toBeVisible();
    expect(await inspector.locator(".profile-details-dialog").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.keyboard.press("Escape");
    await nav.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(page.locator(".settings-card-unified")).toHaveCount(4);
    expect(await page.locator(".content-settings").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.locator(".settings-card-unified").last().scrollIntoViewIfNeeded();
    await expect(page.locator(".settings-card-unified").last()).toBeInViewport();
    await nav.getByRole("button", { name: "Обзор", exact: true }).click();
    await page.getByRole("button", { name: "Аудит", exact: true }).click();
    const audit = page.getByRole("dialog", { name: "Журнал аудита переключений" });
    await expect(audit).toBeVisible();
    expect(await audit.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  });
}

test("privacy masks account email in overview, list and tray surfaces", async ({ page }) => {
  await syntheticBridge(page, { privacy: true });
  await ready(page);
  await expect(page.locator("body")).not.toContainText("profile-0@example.com");
  await page.getByLabel("Основные разделы").getByRole("button", { name: "Аккаунты", exact: true }).click();
  await expect(page.locator(".profile-card")).not.toContainText("profile-0@example.com");
  expect(await page.locator(".profile-card [title]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title"))))
    .toEqual(expect.not.arrayContaining([expect.stringContaining("profile-0@example.com")]));
  for (const surface of ["tray", "tray-hover"]) {
    await page.goto("/?surface=" + surface);
    await expect(page.locator(".tray-" + (surface === "tray" ? "live" : "hover"))).toBeVisible();
    await expect(page.locator("body")).not.toContainText("profile-0@example.com");
    expect(await page.locator("[title]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title"))))
      .toEqual(expect.not.arrayContaining([expect.stringContaining("profile-0@example.com")]));
  }
});
