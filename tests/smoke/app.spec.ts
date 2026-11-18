import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { appVersion } from "../../src/shared/releaseNotes";

test.describe.configure({ timeout: 60_000 });

async function launchIsolated(executablePath?: string) {
  const token = randomUUID();
  const root = path.join(process.env.CAM_TEST_WORK_DIR ?? os.tmpdir(), `egoist-probe-${token}`);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, ".egoist-probe-root.json"), JSON.stringify({ schemaVersion: 1, purpose: "egoist-isolated-probe", token }));
  const dirs = Object.fromEntries(["userData", "home", "appData", "localAppData", "codex"].map((name) => [name, path.join(root, name)]));
  Object.values(dirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ["."] }),
    env: {
      ...process.env, CODEX_HOME: dirs.codex, USERPROFILE: dirs.home, HOME: dirs.home,
      APPDATA: dirs.appData, LOCALAPPDATA: dirs.localAppData, CAM_USER_DATA_DIR: dirs.userData,
      CAM_PROBE_MODE: "isolated", CAM_PROBE_ROOT: root, CAM_PROBE_TOKEN: token,
      CAM_ALLOW_MULTIPLE_INSTANCE: "1", CAM_BACKGROUND_PROBE: "1",
      CAM_DISABLE_AUTO_UPDATE: "1", CAM_DISABLE_EXTERNAL_OPEN: "1", ELECTRON_IS_DEV: "0"
    }
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page, root, dirs };
}

async function dismissNotes(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Что нового" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Понятно" }).click();
}

async function closeIsolated(app: ElectronApplication, root: string) {
  for (const page of app.windows()) {
    await page.evaluate(() => window.cam?.updateSettings({ trayEnabled: false })).catch(() => undefined);
  }
  await app.close();
  const allowedParent = path.resolve(process.env.CAM_TEST_WORK_DIR ?? os.tmpdir());
  if (path.dirname(path.resolve(root)) !== allowedParent || !path.basename(root).startsWith("egoist-probe-") || !fs.existsSync(path.join(root, ".egoist-probe-root.json"))) throw new Error("Refusing to remove an unowned smoke directory");
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

async function seedNativeProfiles(app: ElectronApplication, count: number) {
  await app.evaluate(({ app }, fixtureCount) => {
    // Playwright's VM has no dynamic-import callback. Use Electron's own Node
    // loader so SQLite is loaded with the same ABI as the running application.
    const pathModule = process.getBuiltinModule("node:path");
    const requireFixture = process.getBuiltinModule("node:module").createRequire(pathModule.join(app.getAppPath(), "package.json"));
    const { AccountStore } = requireFixture("./dist/main/db.js") as typeof import("../../src/main/db");
    const store = new AccountStore(app.getPath("userData"));
    const now = Math.floor(Date.now() / 1000);
    try {
      for (let index = 0; index < fixtureCount; index++) {
        store.upsert({ id: `native-fixture-${index}`, label: `Native Profile ${String(index + 1).padStart(3, "0")}`, email: `native-fixture+${index}@privacy.example`, platform: index % 4 === 3 ? "antigravity" : "codex", planType: "plus", profileDir: pathModule.join(app.getPath("userData"), "profiles", `native-fixture-${index}`), encryptedAuthJson: "sealed-placeholder-with-no-credentials", authMode: "chatgpt", credentialState: "ready", status: "active", rateLimits: { limitId: "codex", limitName: null, primary: { usedPercent: index === 0 ? 99.6 : 48, windowDurationMins: 300, resetsAt: now + 3_600 }, secondary: { usedPercent: 48, windowDurationMins: 10_080, resetsAt: now + 86_400 }, credits: null, planType: "plus", rateLimitReachedType: null, capturedAt: now, source: "synthetic-read-only-fixture" } });
      }
      store.setActive("native-fixture-0");
      store.setRuntimeVerification("native-fixture-0", { profileApplied: true, credentials: "material_consistent", credentialMethod: "synthetic fixture", launch: "process_started", runtime: "unsupported", runtimeSource: null, observedEmail: null, observedAt: now, runtimePid: null, message: "Synthetic runtime is unconfirmed" });
    } finally { store.close(); }
  }, count);
}

for (const count of [1, 10, 100, 200]) {
  test(`compiled renderer safely displays ${count} synthetic profiles`, async () => {
    const { app, page, root, dirs } = await launchIsolated();
    try {
      await dismissNotes(page);
      await page.evaluate(() => window.cam!.updateSettings({ autoRefreshIntervalMs: 0, trayRefreshIntervalMs: 0, smartSwitchMode: "off", trayEnabled: false, notificationSoundEnabled: false }));
      await seedNativeProfiles(app, count);
      await page.evaluate(() => { window.localStorage.setItem("cam.accountSort", "name"); }); await page.reload();
      await expect(page.locator(".profile-table tbody tr")).toHaveCount(count);
      for (const [width, height] of [[860, 560], [1080, 780], [1460, 900]]) {
        await app.evaluate(({ BrowserWindow }, size) => { BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("index.html"))!.setContentSize(size.width, size.height); }, { width, height });
        const rows = page.locator(".profile-table tbody tr"); await rows.first().focus(); await page.keyboard.press("End"); await expect(rows.last()).toBeFocused(); await page.keyboard.press("Home"); await expect(rows.first()).toBeFocused();
        if (count === 100 && process.env.CAM_TEST_WORK_DIR) { const target = path.join(process.env.CAM_TEST_WORK_DIR, "ui-screens"); fs.mkdirSync(target, { recursive: true }); await page.screenshot({ path: path.join(target, `native-profiles-${count}-${width}x${height}.png`) }); }
        await page.keyboard.press("Enter"); const dialog = page.getByRole("dialog", { name: "Подробности профиля" }); await expect(dialog).toContainText("Аккаунт работающей IDE не подтверждён");
        if (count === 100 && width === 1460 && process.env.CAM_TEST_WORK_DIR) await page.screenshot({ path: path.join(process.env.CAM_TEST_WORK_DIR, "ui-screens", "native-inspector-1460x900.png") });
        await page.keyboard.press("Escape"); await expect(rows.first()).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      await page.getByLabel("Основные разделы").getByRole("button", { name: "Настройки", exact: true }).click(); await page.getByRole("switch", { name: "Режим приватности" }).click(); await page.getByRole("radio", { name: "EN", exact: true }).click();
      await page.getByLabel("Main sections").getByRole("button", { name: "Profiles", exact: true }).click(); await expect(page.getByRole("table", { name: "Profiles" })).toBeVisible(); expect(await page.locator("body").innerHTML()).not.toContain("native-fixture+0@privacy.example");
      expect(fs.existsSync(path.join(dirs.codex, "auth.json"))).toBe(false);
    } finally { await closeIsolated(app, root); }
  });
}

test("isolated hidden desktop initializes current services and navigation", async () => {
  const { app, page, root, dirs } = await launchIsolated();
  try {
    await dismissNotes(page);
    const diagnostics = await page.evaluate(() => window.cam!.getDiagnostics());
    expect(diagnostics.startupError).toBeNull();
    expect(path.resolve(diagnostics.activeCodexHome)).toBe(path.resolve(dirs.codex));
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => !window.isVisible()))).toBe(true);
    const nav = page.getByLabel("Основные разделы");
    for (const name of ["Профили", "Обзор", "Журнал", "Настройки"]) {
      await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => window.cam!.listAccounts())).toEqual([]);
    expect(fs.existsSync(path.join(dirs.codex, "auth.json"))).toBe(false);
    await page.getByRole("button", { name: "Журнал аудита переключений", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Журнал аудита переключений" })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally { await closeIsolated(app, root); }
});

test("release notes lead to accounts and keyboard commands expose Antigravity", async () => {
  const { app, page, root } = await launchIsolated();
  try {
    const notes = page.getByRole("dialog", { name: "Что нового" });
    await expect(notes).toBeVisible();
    await notes.getByRole("button", { name: "Профили", exact: true }).click();
    await expect(notes).toBeHidden();
    await expect(page.locator(".rail-nav .is-active")).toHaveAttribute("aria-label", "Профили");
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Командный центр" })).toBeVisible();
    await page.getByLabel("Поиск команды").fill("antigravity");
    await expect(page.getByRole("button", { name: /Показать профили Antigravity/ })).toBeEnabled();
    await page.keyboard.press("Escape");
  } finally { await closeIsolated(app, root); }
});

test("current settings persist polling, privacy and language through IPC", async () => {
  const { app, page, root } = await launchIsolated();
  try {
    await dismissNotes(page);
    await page.getByLabel("Основные разделы").getByRole("button", { name: "Настройки", exact: true }).click();
    const settings = page.getByRole("region", { name: "Настройки", exact: true });
    await expect(settings.getByRole("heading", { name: "Настройки приложения" })).toBeVisible();
    const sections = settings.getByRole("tablist", { name: "Разделы настроек" });
    await expect(sections.getByRole("tab")).toHaveCount(4);
    await sections.getByRole("tab", { name: "Лимиты и панель задач" }).click();
    const limits = settings.getByRole("tabpanel", { name: "Лимиты и панель задач" });
    await limits.getByRole("radiogroup", { name: "Интервал автообновления" }).getByRole("radio", { name: "Выкл", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.cam!.getSettings())).toMatchObject({ autoRefreshIntervalMs: 0 });
    await sections.getByRole("tab", { name: "Основные" }).click();
    const general = settings.getByRole("tabpanel", { name: "Основные" });
    await general.getByRole("switch", { name: "Режим приватности" }).click();
    await expect.poll(() => page.evaluate(() => window.cam!.getSettings())).toMatchObject({ privacyMode: true });
    await general.getByRole("radio", { name: "EN", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Application preferences" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.cam!.getSettings())).toMatchObject({ language: "en" });
  } finally { await closeIsolated(app, root); }
});

test("onboarding exposes official methods without starting authentication", async () => {
  const { app, page, root, dirs } = await launchIsolated();
  try {
    await dismissNotes(page);
    await page.locator(".topbar").getByRole("button", { name: "Добавить профиль", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Добавление аккаунта" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /OpenAI API key/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Браузерный вход/ })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(fs.existsSync(path.join(dirs.codex, "auth.json"))).toBe(false);
    await page.keyboard.press("Control+K");
    await page.getByLabel("Поиск команды").fill("antigravity");
    await page.getByRole("button", { name: /Показать профили Antigravity/ }).click();
    await expect(page.getByLabel("Фильтр провайдера")).toHaveValue("antigravity");
    await expect(page.getByRole("table", { name: "Профили" })).toBeVisible();
  } finally { await closeIsolated(app, root); }
});

test("packaged shell initializes the same isolated services", async () => {
  test.skip(process.env.CAM_PACKAGED_PLAYWRIGHT !== "1", "Production Electron disables inspection; exact package is covered by verify:startup.");
  const executablePath = path.join(process.cwd(), "release", appVersion, "win-unpacked", "Kvesser.exe");
  expect(fs.existsSync(executablePath)).toBe(true);
  const { app, page, root } = await launchIsolated(executablePath);
  try {
    await dismissNotes(page);
    expect(await page.evaluate(() => window.cam!.getAppInfo())).toMatchObject({ version: appVersion });
    expect(await page.evaluate(() => window.cam!.getDiagnostics())).toMatchObject({ startupError: null });
  } finally { await closeIsolated(app, root); }
});
