import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { appVersion } from "../../src/shared/releaseNotes";

test.describe.configure({ timeout: 60_000 });

async function launchIsolated(executablePath?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cam-smoke-"));
  const dirs = Object.fromEntries(["userData", "home", "appData", "localAppData", "codex"].map((name) => [name, path.join(root, name)]));
  Object.values(dirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: ["."] }),
    env: {
      ...process.env, CODEX_HOME: dirs.codex, USERPROFILE: dirs.home, HOME: dirs.home,
      APPDATA: dirs.appData, LOCALAPPDATA: dirs.localAppData, CAM_USER_DATA_DIR: dirs.userData,
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
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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
    for (const name of ["Обзор", "Аккаунты", "Настройки"]) {
      await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => window.cam!.listAccounts())).toEqual([]);
    expect(fs.existsSync(path.join(dirs.codex, "auth.json"))).toBe(false);
    await page.getByRole("button", { name: "Аудит", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Журнал аудита переключений" })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally { await closeIsolated(app, root); }
});

test("release notes lead to accounts and keyboard commands expose Antigravity", async () => {
  const { app, page, root } = await launchIsolated();
  try {
    const notes = page.getByRole("dialog", { name: "Что нового" });
    await expect(notes).toBeVisible();
    await notes.getByRole("button", { name: "Аккаунты", exact: true }).click();
    await expect(notes).toBeHidden();
    await expect(page.locator(".rail-nav .is-active")).toHaveAttribute("aria-label", "Аккаунты");
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
    const settings = page.locator(".settings-v4-unified");
    await expect(settings.getByRole("heading", { name: "Конфигурация и среда" })).toBeVisible();
    await expect(settings.locator(".settings-card-unified")).toHaveCount(4);
    await settings.getByRole("radiogroup", { name: "Интервал автообновления" }).getByRole("radio", { name: "Выкл", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.cam!.getSettings())).toMatchObject({ autoRefreshIntervalMs: 0 });
    await settings.getByRole("switch", { name: "Режим приватности" }).click();
    await expect.poll(() => page.evaluate(() => window.cam!.getSettings())).toMatchObject({ privacyMode: true });
    await settings.getByRole("radio", { name: "EN", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "Configuration & Runtime" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.cam!.getSettings())).toMatchObject({ language: "en" });
  } finally { await closeIsolated(app, root); }
});

test("onboarding exposes official methods without starting authentication", async () => {
  const { app, page, root, dirs } = await launchIsolated();
  try {
    await dismissNotes(page);
    await page.getByRole("button", { name: "Добавить Codex", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Добавление аккаунта" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /OpenAI API key/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Браузерный вход/ })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(fs.existsSync(path.join(dirs.codex, "auth.json"))).toBe(false);
    await page.keyboard.press("Control+K");
    await page.getByLabel("Поиск команды").fill("antigravity");
    await page.getByRole("button", { name: /Показать профили Antigravity/ }).click();
    await expect(page.getByRole("heading", { name: /Аккаунты Antigravity/ })).toBeVisible();
  } finally { await closeIsolated(app, root); }
});

test("packaged shell initializes the same isolated services", async () => {
  test.skip(process.env.CAM_PACKAGED_PLAYWRIGHT !== "1", "Production Electron disables inspection; exact package is covered by verify:startup.");
  const executablePath = path.join(process.cwd(), "release", "win-unpacked", "Account Manager EGO.exe");
  expect(fs.existsSync(executablePath)).toBe(true);
  const { app, page, root } = await launchIsolated(executablePath);
  try {
    await dismissNotes(page);
    expect(await page.evaluate(() => window.cam!.getAppInfo())).toMatchObject({ version: appVersion });
    expect(await page.evaluate(() => window.cam!.getDiagnostics())).toMatchObject({ startupError: null });
  } finally { await closeIsolated(app, root); }
});
