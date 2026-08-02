import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { appVersion } from "../../src/shared/releaseNotes";

const packagedPlaywrightEnabled = process.env.CAM_PACKAGED_PLAYWRIGHT === "1";

function tempUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cam-smoke-"));
}

function createAntigravityProfile(appData: string): void {
  const userDataDir = path.join(appData, "Antigravity IDE");
  const storageDir = path.join(userDataDir, "User", "globalStorage");
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(path.join(storageDir, "storage.json"), JSON.stringify({ account: { email: "ag-smoke@example.com" } }), "utf8");
  fs.writeFileSync(path.join(userDataDir, "machineid"), "machine-smoke", "utf8");
}

async function expectServicesReady(page: Page) {
  const diagnostics = await page.evaluate(() => window.cam!.getDiagnostics());
  expect(diagnostics.startupError).toBeNull();
  await expect.poll(async () => page.evaluate(() => window.cam!.listAccounts().then((accounts) => accounts.length))).toBeGreaterThanOrEqual(0);
}

async function closeReleaseNotesIfVisible(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Что нового" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "Понятно" }).click();
  }
}

async function closeTestApp(app: ElectronApplication) {
  for (const page of app.windows()) {
    await page.evaluate(() => window.cam?.updateSettings({ trayEnabled: false })).catch(() => undefined);
  }
  await app.close();
}

test("запускает приложение и показывает русскую навигацию", async () => {
  const userDataDir = tempUserData();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, CAM_ALLOW_MULTIPLE_INSTANCE: "1", CAM_USER_DATA_DIR: userDataDir, ELECTRON_IS_DEV: "0" }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await closeReleaseNotesIfVisible(page);
    const nav = page.getByLabel("Основные разделы");

    await expect(nav.getByText("Аккаунты", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByText("Данные", { exact: true })).toHaveCount(0);
    await expect(nav.getByText("Настройки", { exact: true })).toBeVisible();
    await expectServicesReady(page);

    await nav.getByText("Аккаунты", { exact: true }).click();
    await page.waitForTimeout(250);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const accountPanelMotion = await page.locator(".workbench-panel").evaluate((element) => {
      const style = getComputedStyle(element);
      return { opacity: style.opacity, delay: style.animationDelay, animation: style.animationName };
    });
    expect(accountPanelMotion).toEqual({ opacity: "1", delay: "0s", animation: "none" });
  } finally {
    await closeTestApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("3.0.10 сохраняет естественный поток, читаемость и вместимость 9 аккаунтов", async () => {
  const userDataDir = tempUserData();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, CAM_ALLOW_MULTIPLE_INSTANCE: "1", CAM_USER_DATA_DIR: userDataDir, ELECTRON_IS_DEV: "0" }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await closeReleaseNotesIfVisible(page);

    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      availableWidth: window.screen.availWidth,
      availableHeight: window.screen.availHeight
    }));
    expect(viewport.width).toBeGreaterThanOrEqual(Math.min(1400, viewport.availableWidth - 40));
    expect(viewport.height).toBeGreaterThanOrEqual(Math.min(860, viewport.availableHeight - 80));
    expect(viewport.width).toBeLessThanOrEqual(1460);
    expect(viewport.height).toBeLessThanOrEqual(900);
    const wideViewport = viewport.width >= 1400 && viewport.height >= 860;

    const nav = page.getByLabel("Основные разделы");
    await nav.getByText("Настройки", { exact: true }).click();
    await page.locator(".settings-advanced > summary").click();
    await page.locator(".settings-runtime-details > summary").click();

    const settingsLayout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, height: box.height };
      };
      const content = document.querySelector(".content-settings");
      const settings = rect(".settings-v303");
      const advanced = rect(".settings-advanced");
      const runtime = rect(".settings-runtime-details");
      const runtimeBody = rect(".settings-runtime-body");
      if (!content || !settings || !advanced || !runtime || !runtimeBody) return null;
      return {
        contentOverflowY: getComputedStyle(content).overflowY,
        contentScrollHeight: content.scrollHeight,
        contentClientHeight: content.clientHeight,
        settingsRuntimeOverlap: Math.max(0, settings.bottom - runtime.top),
        advancedExpanded: advanced.height > 100,
        runtimeExpanded: runtime.height > runtimeBody.height
      };
    });

    expect(settingsLayout).not.toBeNull();
    expect(settingsLayout!.contentOverflowY).toBe("auto");
    expect(settingsLayout!.contentScrollHeight).toBeGreaterThan(settingsLayout!.contentClientHeight);
    expect(settingsLayout!.settingsRuntimeOverlap).toBeLessThanOrEqual(1);
    expect(settingsLayout!.advancedExpanded).toBe(true);
    expect(settingsLayout!.runtimeExpanded).toBe(true);

    await nav.getByText("Активность", { exact: true }).click();
    const activitySurface = await page.evaluate(() => {
      const pageNode = document.querySelector(".activity-v306");
      const children = pageNode ? Array.from(pageNode.children) : [];
      const rects = children.map((element) => element.getBoundingClientRect());
      const overlap = rects.slice(1).reduce((maximum, rect, index) => (
        Math.max(maximum, rects[index].bottom - rect.top)
      ), 0);
      const content = document.querySelector(".content-activity");
      const journalCopy = document.querySelector(".activity-journal-head p");
      if (!pageNode || !content || !journalCopy) return null;
      return {
        overlap: Math.max(0, overlap),
        horizontalOverflow: Math.max(0, content.scrollWidth - content.clientWidth),
        journalCopyFontSize: Number.parseFloat(getComputedStyle(journalCopy).fontSize)
      };
    });
    expect(activitySurface).not.toBeNull();
    expect(activitySurface!.overlap).toBeLessThanOrEqual(1);
    expect(activitySurface!.horizontalOverflow).toBe(0);
    expect(activitySurface!.journalCopyFontSize).toBeGreaterThanOrEqual(10.5);

    await nav.getByText("Обзор", { exact: true }).click();
    const overviewSurface = await page.evaluate(() => {
      const pageNode = document.querySelector(".overview-v306");
      const content = document.querySelector(".content-overview");
      if (!pageNode || !content) return null;
      const children = Array.from(pageNode.children).map((element) => element.getBoundingClientRect());
      const style = getComputedStyle(pageNode);
      const overlap = children.slice(1).reduce((maximum, rect, index) => (
        Math.max(maximum, children[index].bottom - rect.top)
      ), 0);
      return {
        overlap: Math.max(0, overlap),
        horizontalOverflow: Math.max(0, content.scrollWidth - content.clientWidth),
        inheritedBorder: style.borderTopWidth,
        inheritedBackground: style.backgroundColor
      };
    });
    expect(overviewSurface).toEqual({
      overlap: 0,
      horizontalOverflow: 0,
      inheritedBorder: "0px",
      inheritedBackground: "rgba(0, 0, 0, 0)"
    });

    await nav.getByText("Аккаунты", { exact: true }).click();
    const accountSurface = await page.evaluate(() => {
      const grid = document.querySelector(".profile-grid");
      const main = document.querySelector(".profile-main");
      if (!grid || !main) return null;
      const gridStyle = getComputedStyle(grid);
      const mainStyle = getComputedStyle(main);
      const rowHeight = Number.parseFloat(gridStyle.gridAutoRows.match(/[\d.]+px/)?.[0] ?? "0");
      const gap = Number.parseFloat(gridStyle.rowGap);
      const usableHeight = main.clientHeight
        - Number.parseFloat(mainStyle.paddingTop)
        - Number.parseFloat(mainStyle.paddingBottom);
      const columns = gridStyle.gridTemplateColumns.split(" ").length;
      const rows = Math.floor((usableHeight + gap) / (rowHeight + gap));
      return {
        columns,
        visibleCapacity: columns * rows,
        overflowY: mainStyle.overflowY,
        horizontalOverflow: Math.max(0, main.scrollWidth - main.clientWidth),
        cardTitleFontSize: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--v306-card-title-size") || "13.5")
      };
    });
    expect(accountSurface).not.toBeNull();
    expect(accountSurface!.overflowY).toBe("auto");
    expect(accountSurface!.horizontalOverflow).toBe(0);
    expect(accountSurface!.cardTitleFontSize).toBe(13.5);
    if (wideViewport) {
      expect(accountSurface!.columns).toBe(3);
      expect(accountSurface!.visibleCapacity).toBeGreaterThanOrEqual(9);
    } else {
      expect(accountSurface!.columns).toBeGreaterThanOrEqual(2);
      expect(accountSurface!.visibleCapacity).toBeGreaterThanOrEqual(4);
    }
  } finally {
    await closeTestApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("собранное приложение показывает Cockpit-style подключение Antigravity без раскрытия токенов", async () => {
  const executablePath = path.join(process.cwd(), "release", "win-unpacked", "Codex Account Manager.exe");
  test.skip(!packagedPlaywrightEnabled, "Production Electron blocks Node inspect; use verify:startup + verify:package for the exact release.");
  test.skip(!fs.existsSync(executablePath), "Сначала нужно выполнить pnpm run build или pnpm run build:dir");

  const userDataDir = tempUserData();
  const antigravityAppData = tempUserData();
  const homeDir = tempUserData();
  createAntigravityProfile(antigravityAppData);
  const app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      APPDATA: antigravityAppData,
      USERPROFILE: homeDir,
      CAM_ALLOW_MULTIPLE_INSTANCE: "1",
      CAM_USER_DATA_DIR: userDataDir
    }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await closeReleaseNotesIfVisible(page);
    await expect(page.locator('[aria-label="Основные разделы"]')).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Фильтр платформы").getByText("Antigravity", { exact: true }).click();
    await page.locator('[aria-label="Центр действий"]').getByRole("button", { name: "Добавить Antigravity" }).click();
    const dialog = page.getByRole("dialog", { name: "Добавить Antigravity" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Refresh token")).toHaveCount(0);
    await expect(dialog.getByLabel("Access token")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Войти через Google" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "OAuth Authorization", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "I've authorized, continue" })).toHaveCount(0);
    await expect(dialog.getByText("Remote URL/code", { exact: true })).toHaveCount(0);
    await dialog.getByText("Дополнительные способы").click();
    await expect(dialog.getByPlaceholder(/refresh_token/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Плагин" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Локальная БД" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Antigravity Tools" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cockpit" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Локальный профиль IDE" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Проверить профиль IDE" })).toBeVisible();
    await dialog.getByTitle("Закрыть").click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const importResult = await page.evaluate(() => window.cam!.importAntigravityFromIde());
    expect(importResult.imported).toBe(true);
    expect(JSON.stringify(importResult)).not.toContain("refresh-secret-token-smoke");

    const accounts = await page.evaluate(() => window.cam!.listAccounts());
    const imported = accounts.find((account) => account.email === "ag-smoke@example.com");
    expect(imported?.platform).toBe("antigravity");
    expect(JSON.stringify(imported)).not.toContain("refresh-secret-token-smoke");

    await page.getByRole("button", { name: "Подробнее о профиле" }).click();
    const profileDialog = page.getByRole("dialog", { name: "Подробности профиля" });
    await expect(profileDialog.locator(".inspector-action-grid").getByRole("button", { name: "Обновить" })).toBeEnabled();
    await expect(profileDialog.getByRole("button", { name: "Авторизация" })).toBeEnabled();
    await expect(profileDialog.getByRole("button", { name: "Открыть папку" })).toBeEnabled();
    await expect(profileDialog.getByRole("button", { name: "Удалить профиль" })).toBeEnabled();
    await expect(profileDialog.locator(".inspector-more")).toHaveCount(0);
    await expect(page.getByLabel("Refresh token")).toHaveCount(0);
    await expect(page.getByLabel("Access token")).toHaveCount(0);

    const inspectorLayout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
      };
      const inspector = document.querySelector(".inspector");
      const quickLabel = document.querySelector(".inspector-tag-section .quick-tag-label");
      const quickTags = document.querySelector(".inspector-tag-section .quick-tags");
      const section = rect(".inspector-tag-section");
      const details = rect(".antigravity-compact-details");
      const actions = rect(".inspector-action-grid");
      if (!inspector || !section || !details || !actions) return null;
      return {
        removedQuickTags: !quickLabel && !quickTags,
        detailsOverflow: Math.max(0, details.right - section.right, section.left - details.left),
        actionsOverflow: Math.max(0, actions.right - section.right, section.left - actions.left),
        verticalOverflow: Math.max(0, inspector.scrollHeight - inspector.clientHeight)
      };
    });
    expect(inspectorLayout).not.toBeNull();
    expect(inspectorLayout!.removedQuickTags).toBe(true);
    expect(inspectorLayout!.detailsOverflow).toBeLessThanOrEqual(1);
    expect(inspectorLayout!.actionsOverflow).toBeLessThanOrEqual(1);
    expect(inspectorLayout!.verticalOverflow).toBeLessThanOrEqual(2);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toContain("ag-smoke@example.com");
    expect(bodyText).not.toContain("refresh-secret-token-smoke");

    await page.evaluate((accountId) => window.cam!.switchAccount(accountId), imported!.id);
    const activeAccounts = await page.evaluate(() => window.cam!.listAccounts());
    expect(activeAccounts.find((account) => account.email === "ag-smoke@example.com")?.isActive).toBe(true);
    const history = await page.evaluate(() => window.cam!.getSwitchHistory());
    expect(history[0]).toMatchObject({
      accountId: imported!.id,
      status: "completed"
    });
    expect(JSON.stringify(history)).not.toContain("refresh-secret-token");
  } finally {
    await closeTestApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.rmSync(antigravityAppData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.rmSync(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("показывает интерфейс, если dev-server недоступен", async () => {
  const userDataDir = tempUserData();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, CAM_ALLOW_MULTIPLE_INSTANCE: "1", CAM_USER_DATA_DIR: userDataDir, ELECTRON_IS_DEV: "1" }
  });
  try {
    const page = await app.firstWindow();
    const nav = page.getByLabel("Основные разделы");

    await expect(nav.getByText("Аккаунты", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByText("Данные", { exact: true })).toHaveCount(0);
    await expectServicesReady(page);
  } finally {
    await closeTestApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("показывает рабочую консоль с двумя платформами и центром действий", async () => {
  const userDataDir = tempUserData();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, CAM_ALLOW_MULTIPLE_INSTANCE: "1", CAM_USER_DATA_DIR: userDataDir, ELECTRON_IS_DEV: "0" }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await closeReleaseNotesIfVisible(page);

    await expect(page.getByLabel("Основные разделы")).toBeVisible({ timeout: 15_000 });
    const compactViewport = await page.evaluate(() => window.innerWidth < 1200 || window.innerHeight < 780);
    if (compactViewport) {
      await expect(page.getByLabel("Центр действий")).toBeHidden();
      await expect(page.getByRole("button", { name: /Команды/ })).toBeVisible();
      await expect(page.getByLabel("Фильтр платформы")).toBeHidden();
    } else {
      await expect(page.getByLabel("Центр действий")).toBeVisible();
      await expect(page.getByLabel("Фильтр платформы")).toBeVisible();
      await expect(page.getByLabel("Фильтр платформы").getByText("Codex", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Фильтр платформы").getByText("Antigravity", { exact: true })).toBeVisible();
    }

    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Командный центр" })).toBeVisible();
    await page.getByLabel("Поиск команды").fill("antigravity");
    await expect(page.getByRole("button", { name: /Диагностика Antigravity/ })).toBeVisible();
    await page.getByRole("button", { name: /Показать профили Antigravity/ }).click();
    await expect(page.getByRole("dialog", { name: "Командный центр" })).toBeHidden();

    await expect(page.getByText("Аккаунты Antigravity")).toBeVisible();
    await expect(page.locator(".profile-workbench > .inspector")).toHaveCount(0);
    const viewport = await page.evaluate(() => ({
      pageOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      contentOverflowMode: (() => {
        const content = document.querySelector(".content");
        return content ? getComputedStyle(content).overflowY : null;
      })(),
      profileOverflowMode: (() => {
        const main = document.querySelector(".profile-main");
        return main ? getComputedStyle(main).overflowY : null;
      })()
    }));
    expect(viewport.pageOverflow).toBeLessThanOrEqual(1);
    expect(viewport.contentOverflowMode).toBe("hidden");
    expect(viewport.profileOverflowMode).toBe("auto");
  } finally {
    await closeTestApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("release notes ведут в аккаунты и закрываются без перекрытия интерфейса", async () => {
  const userDataDir = tempUserData();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, CAM_ALLOW_MULTIPLE_INSTANCE: "1", CAM_USER_DATA_DIR: userDataDir, ELECTRON_IS_DEV: "0" }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    const dialog = page.getByRole("dialog", { name: "Что нового" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: "Аккаунты" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: /Аккаунты/ })).toBeVisible();
    await expect(page.locator(".rail-nav .is-active").getByText("Аккаунты")).toBeVisible();
  } finally {
    await closeTestApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("настройки сохраняют реальные значения через IPC", async () => {
  const userDataDir = tempUserData();
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, CAM_ALLOW_MULTIPLE_INSTANCE: "1", CAM_USER_DATA_DIR: userDataDir, ELECTRON_IS_DEV: "0" }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await closeReleaseNotesIfVisible(page);

    await page.getByLabel("Основные разделы").getByText("Настройки", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "Только нужные настройки" })).toBeVisible();

    const settingsPanel = page.locator(".settings-v303");
    await settingsPanel.getByLabel("Интервал автообновления").getByRole("radio", { name: "Выкл" }).click();
    await expect.poll(async () => page.evaluate(() => window.cam!.getSettings())).toMatchObject({
      autoRefreshIntervalMs: 0
    });
    await settingsPanel.getByLabel("Интервал автообновления").getByRole("radio", { name: "3 мин", exact: true }).click();
    const liveTrayToggle = settingsPanel.getByRole("switch", { name: "Живой индикатор лимитов" });
    if (await liveTrayToggle.getAttribute("aria-checked") !== "true") await liveTrayToggle.click();
    await settingsPanel.getByLabel("Интервал живого индикатора").getByRole("radio", { name: "1 мин", exact: true }).click();
    const notificationSound = settingsPanel.getByRole("switch", { name: "Звук уведомлений" });
    await notificationSound.click();
    await notificationSound.click();
    await settingsPanel.locator(".settings-advanced").getByText("Интерфейс и дополнительные параметры").click();
    await expect(settingsPanel.getByText("Уведомления Windows")).toHaveCount(0);
    const suggestions = settingsPanel.getByRole("switch", { name: "Советовать лучший аккаунт" });
    await suggestions.click();
    await suggestions.click();

    await expect.poll(async () => page.evaluate(() => window.cam!.getSettings())).toMatchObject({
      autoRefreshIntervalMs: 180_000,
      trayRefreshIntervalMs: 60_000,
      trayEnabled: true,
      notificationSoundEnabled: true,
      smartSwitchMode: "suggest",
      language: "ru"
    });

    await settingsPanel.locator(".settings-segments.compact").getByRole("radio", { name: "EN" }).click();
    await expect(page.getByRole("heading", { name: "Only what matters" })).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.cam!.getSettings())).toMatchObject({
      language: "en"
    });
  } finally {
    await closeTestApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("собранное приложение запускает реальные сервисы без startupError", async () => {
  const executablePath = path.join(process.cwd(), "release", "win-unpacked", "Codex Account Manager.exe");
  test.skip(!packagedPlaywrightEnabled, "Production Electron blocks Node inspect; use verify:startup + verify:package for the exact release.");
  test.skip(!fs.existsSync(executablePath), "Сначала нужно выполнить pnpm run build или pnpm run build:dir");

  const userDataDir = tempUserData();
  const app = await electron.launch({
    executablePath,
    env: { ...process.env, CAM_ALLOW_MULTIPLE_INSTANCE: "1", CAM_USER_DATA_DIR: userDataDir }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByLabel("Основные разделы").getByText("Аккаунты", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expectServicesReady(page);
    const diagnostics = await page.evaluate(() => window.cam!.getDiagnostics());
    if (diagnostics.codexPath) {
      expect(diagnostics.codexCapabilities?.cliVersion).toContain("codex");
      expect(diagnostics.codexCapabilities?.protocol.compatible).toBe(true);
      expect(diagnostics.codexCapabilities?.protocol.platformOs).toBe("windows");
      expect(diagnostics.codexCapabilities?.loginMethods).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "chatgpt", available: true }),
        expect.objectContaining({ id: "chatgptDeviceCode", available: true }),
        expect.objectContaining({ id: "apiKey", available: true })
      ]));
    }
  } finally {
    await closeTestApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("3.0 packaged shell имеет доступные имена, keyboard focus и управляемый updater", async () => {
  const executablePath = path.join(process.cwd(), "release", "win-unpacked", "Codex Account Manager.exe");
  test.skip(!packagedPlaywrightEnabled, "Production Electron blocks Node inspect; use verify:startup + verify:package for the exact release.");
  test.skip(!fs.existsSync(executablePath), "Сначала нужно выполнить pnpm run build или pnpm run build:dir");

  const userDataDir = tempUserData();
  const app = await electron.launch({
    executablePath,
    env: { ...process.env, CAM_ALLOW_MULTIPLE_INSTANCE: "1", CAM_DISABLE_AUTO_UPDATE: "1", CAM_USER_DATA_DIR: userDataDir }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await closeReleaseNotesIfVisible(page);

    const info = await page.evaluate(() => window.cam!.getAppInfo());
    expect(info.version).toBe(appVersion);

    const expectedNavLabels = ["Обзор", "Аккаунты", "Активность", "Настройки"];
    const keyboardVisited: string[] = [];
    for (let step = 0; step < 40 && keyboardVisited.length < expectedNavLabels.length; step += 1) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLButtonElement) || !element.closest(".rail-nav")) return null;
        const style = getComputedStyle(element);
        return {
          label: element.getAttribute("aria-label") ?? "",
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth
        };
      });
      if (!focus || keyboardVisited.includes(focus.label)) continue;
      expect(focus.outlineStyle).not.toBe("none");
      expect(focus.outlineWidth).not.toBe("0px");
      keyboardVisited.push(focus.label);
      await page.keyboard.press("Enter");
    }
    expect(keyboardVisited).toEqual(expectedNavLabels);

    const unnamedVisibleButtons = await page.locator("button:visible").evaluateAll((buttons) =>
      buttons.filter((button) => ![
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.textContent
      ].some((value) => value?.trim())).length
    );
    expect(unnamedVisibleButtons).toBe(0);

    const update = await page.evaluate(() => window.cam!.checkForUpdates());
    expect(update).toMatchObject({ status: "not_configured", feedUrl: null });
    expect(update.message).toContain("отключены");

    const readiness = await page.evaluate(() => window.cam!.getReleaseReadiness());
    expect(readiness).toMatchObject({
      version: appVersion,
      ready: true,
      signingEnabled: false,
      codeSignatureVerification: false
    });
    expect(readiness.summary).toContain("Релиз готов");
    expect(readiness.artifacts.every((artifact) => artifact.exists)).toBe(true);
    expect(readiness.artifacts.every((artifact) => artifact.checksumListed)).toBe(true);
  } finally {
    await closeTestApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
test("собранное приложение запускает реальный сценарий добавления аккаунта", async () => {
  test.setTimeout(70_000);
  const executablePath = path.join(process.cwd(), "release", "win-unpacked", "Codex Account Manager.exe");
  test.skip(!packagedPlaywrightEnabled, "Production Electron blocks Node inspect; use verify:startup + verify:package for the exact release.");
  test.skip(!fs.existsSync(executablePath), "Сначала нужно выполнить pnpm run build или pnpm run build:dir");

  const userDataDir = tempUserData();
  const app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      CAM_ALLOW_MULTIPLE_INSTANCE: "1",
      CAM_DISABLE_EXTERNAL_OPEN: "1",
      CAM_USER_DATA_DIR: userDataDir
    }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByLabel("Основные разделы").getByText("Аккаунты", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expectServicesReady(page);

    const diagnostics = await page.evaluate(() => window.cam!.getDiagnostics());
    test.skip(!diagnostics.codexPath, "Codex CLI не найден на этой машине");

    let login;
    try {
      login = await page.evaluate(() => window.cam!.startLogin({ type: "chatgptDeviceCode" }));
    } catch (error) {
      test.skip(true, `Внешний device-code endpoint недоступен: ${String(error)}`);
      return;
    }
    expect(login.type).toBe("chatgptDeviceCode");
    expect(login.loginId.length).toBeGreaterThan(0);
    expect(login.verificationUrl).toContain("http");
    expect(login.userCode?.length).toBeGreaterThan(0);
  } finally {
    await closeTestApp(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
