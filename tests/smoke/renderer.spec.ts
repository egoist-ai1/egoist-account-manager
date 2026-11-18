import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { installRendererFixture } from "./rendererFixture";

for (const [count, width, height] of [[1, 860, 560], [10, 1080, 780], [100, 1460, 900], [200, 860, 560]]) {
  test(`dense table remains usable for ${count} profiles at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installRendererFixture(page, { count });
    const table = page.getByRole("table", { name: "Профили" });
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(count);
    await expect(table.locator("thead th")).toHaveText(["Профиль", "Остаток", "Свежесть", "Состояние", "Действия"]);
    const row = table.locator("tbody tr").first();
    await row.focus();
    await page.keyboard.press("End");
    await expect(table.locator("tbody tr").last()).toBeFocused();
    await expect(table.locator("tbody tr").last().getByRole("button", { name: /Подробности/ })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const metrics = await table.locator(".bar").first().evaluate((node) => getComputedStyle(node).height);
    expect(metrics).toBe("7px");
    if (process.env.CAM_TEST_WORK_DIR) {
      const target = path.join(process.env.CAM_TEST_WORK_DIR, "ui-screens"); fs.mkdirSync(target, { recursive: true });
      await page.screenshot({ path: path.join(target, `profiles-${count}-${width}x${height}.png`) });
    }
  });
}

test("row keyboard selection preserves focus through updates; Enter only opens details", async ({ page }) => {
  await installRendererFixture(page);
  const rows = page.locator(".profile-table tbody tr");
  await rows.first().focus(); await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => { window.egoistFixture.accounts = window.egoistFixture.accounts.map((account) => ({ ...account })); window.egoistFixture.emitAccounts(); });
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Подробности профиля" });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.egoistFixture.calls.prepareSwitch ?? 0)).toBe(0);
  for (let index = 0; index < 18; index++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Home"); await expect(rows.first()).toBeFocused();
});

test("nested switch confirmation traps focus and returns to the inspector action", async ({ page }) => {
  await installRendererFixture(page, { count: 1, deferPrepareSwitch: true }); await page.locator(".profile-table tbody tr").focus(); await page.keyboard.press("Enter");
  const inspector = page.getByRole("dialog", { name: "Подробности профиля" }); const action = inspector.getByRole("button", { name: "Активировать аккаунт", exact: true });
  await action.click();
  await expect(action).toBeDisabled();
  await page.evaluate(() => window.egoistFixture.resumePrepareSwitch?.());
  const confirm = page.getByRole("dialog", { name: "Переключить профиль" }); await expect(confirm).toBeVisible();
  await page.keyboard.press("Tab"); expect(await confirm.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await expect(confirm).toBeHidden(); await expect(inspector).toBeVisible(); await expect(action).toBeFocused();
  expect(await page.evaluate(() => window.egoistFixture.calls.switchAccount ?? 0)).toBe(0);
});

test("journal restores only an eligible current snapshot after explicit confirmation", async ({ page }) => {
  await installRendererFixture(page, { count: 1 });
  await page.evaluate(() => {
    const now = Math.floor(Date.now() / 1000); const state = window.egoistFixture;
    state.transactions = [{ id: "latest", platform: "codex", targetAccountId: "fixture-0", previousAccountId: null, status: "committed", phase: "committed", targetFingerprint: null, previousFingerprint: null, backupPath: "owned/snapshot", errorCode: null, errorMessage: null, createdAt: now, updatedAt: now, completedAt: now, version: 1, verification: state.accounts[0].runtimeVerification }];
    state.history = [{ id: "snapshot-event", accountId: "fixture-0", previousAccountId: null, accountLabel: "Profile 001", accountEmail: "hidden-address+0@privacy.example", startedAt: now, completedAt: now, status: "completed", error: null, backupPath: "owned/snapshot" }]; state.emitAccounts();
  });
  await page.getByLabel("Основные разделы").getByRole("button", { name: "Журнал", exact: true }).click();
  await page.getByRole("button", { name: "Восстановить снимок", exact: true }).first().click(); const confirm = page.getByRole("dialog", { name: "Восстановить снимок" });
  await expect(confirm).toContainText("Дата снимка"); await expect(confirm).toContainText("IDE будет закрыта"); expect(await page.evaluate(() => window.egoistFixture.calls.rollbackSwitch ?? 0)).toBe(0);
  await confirm.getByRole("button", { name: "Восстановить", exact: true }).click(); await expect.poll(() => page.evaluate(() => window.egoistFixture.calls.rollbackSwitch ?? 0)).toBe(1);
  await expect(page.getByRole("button", { name: "Восстановить снимок", exact: true })).toHaveCount(0);
});

test("provider filter and search keep the table usable", async ({ page }) => {
  await installRendererFixture(page, { count: 200 });
  await page.getByLabel("Фильтр провайдера").selectOption("antigravity"); await expect(page.locator(".profile-table tbody tr")).toHaveCount(50);
  await page.getByLabel("Фильтр провайдера").selectOption("all"); await page.getByLabel("Поиск профиля").fill("Profile 200"); await expect(page.locator(".profile-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Поиск профиля").fill("does-not-exist"); await expect(page.locator(".profile-table-scroll .empty")).toBeVisible();
});

test("status and sort controls combine, and automatic view follows the window width", async ({ page }) => {
  await page.setViewportSize({ width: 1060, height: 740 });
  await installRendererFixture(page, { count: 8 });
  const rows = page.locator(".profile-table tbody tr");
  await expect(rows).toHaveCount(8);
  await page.evaluate(() => document.fonts.ready);
  const settings = await page.locator(".rail-nav button").last().boundingBox();
  const commands = await page.getByRole("button", { name: "Команды", exact: true }).boundingBox();
  expect(settings && commands && settings.x + settings.width < commands.x).toBe(true);
  const status = page.getByLabel("Фильтр по статусу");
  await status.selectOption("selected");
  await expect(rows).toHaveCount(1);
  await page.getByLabel("Фильтр провайдера").selectOption("antigravity");
  await expect(rows).toHaveCount(0);
  await page.getByRole("button", { name: "Сбросить фильтры" }).click();
  await expect(rows).toHaveCount(8);
  await page.getByLabel("Сортировка аккаунтов").selectOption("name");
  await expect(rows.first()).toContainText("Profile 001");
  await expect(rows.last()).toContainText("Profile 008");

  await page.setViewportSize({ width: 690, height: 740 });
  await expect(page.locator(".profile-card")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Авто", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(690);
  await page.getByRole("button", { name: "Таблица", exact: true }).click();
  await expect(rows).toHaveCount(8);
  await page.getByRole("button", { name: "Авто", exact: true }).click();
  await expect(page.locator(".profile-card")).toHaveCount(8);
});

test("unknown and fractional quota remain honest; all scopes appear in details", async ({ page }) => {
  await installRendererFixture(page, { count: 1 });
  const row = page.locator(".profile-table tbody tr");
  await expect(row).toContainText("<1%");
  await expect(row).toContainText("Аккаунт работающей IDE не подтверждён");
  await row.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Подробности профиля" });
  await expect(dialog).toContainText("fixture-model-a");
  await expect(dialog.locator(".inspector-quota-window")).toHaveCount(3);
  await expect(dialog).toContainText("Автоматическое переключение заблокировано");
  await dialog.getByRole("button", { name: "Проверить снова" }).click();
  expect(await page.evaluate(() => window.egoistFixture.calls.verifyRuntimeAccount)).toBe(1);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { window.egoistFixture.accounts = window.egoistFixture.accounts.map((account) => ({ ...account, quotaSnapshot: null, fiveHourUsedPercent: null, weeklyUsedPercent: null })); window.egoistFixture.emitAccounts(); });
  await expect(row.locator(".table-quota strong")).toHaveText(["—"]);
  await expect(row.getByRole("button", { name: "Применить снова" })).toBeEnabled();
});

test("explicit reapply remains available for an unconfirmed runtime", async ({ page }) => {
  await installRendererFixture(page, { count: 1 });
  await page.getByRole("button", { name: "Применить снова", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Переключить профиль" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Переключить", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.egoistFixture.calls.switchAccount ?? 0)).toBe(1);
  await expect(page.locator(".profile-table tbody tr")).toContainText("Аккаунт работающей IDE не подтверждён");
});

test("privacy removes private emails and local paths from visible text and DOM attributes", async ({ page }) => {
  await installRendererFixture(page, { privacyMode: true, count: 4 });
  const secrets = ["hidden-address+0@privacy.example", "C:\\isolated-fixture"];
  const assertPrivacy = async () => { const html = await page.locator("body").innerHTML(); for (const secret of secrets) expect(html).not.toContain(secret); };
  await expect(page.locator(".profile-table")).toBeVisible(); await assertPrivacy();
  await page.locator(".profile-table tbody tr").first().focus(); await page.keyboard.press("Enter"); await assertPrivacy();
  await page.keyboard.press("Escape");
  await page.getByLabel("Основные разделы").getByRole("button", { name: "Обзор", exact: true }).click(); await assertPrivacy();
  await expect(page.locator(".overview-profile-identity h3")).toHaveText("Profile 001");
  await page.getByLabel("Основные разделы").getByRole("button", { name: "Настройки", exact: true }).click(); await assertPrivacy();
});

test("settings radios support arrow keys and every core English surface", async ({ page }) => {
  await installRendererFixture(page, { count: 2 });
  const nav = page.getByLabel("Основные разделы");
  await nav.getByRole("button", { name: "Настройки", exact: true }).click();
  const ru = page.getByRole("radio", { name: "RU", exact: true });
  await ru.focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "EN", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "Application preferences" })).toBeVisible();
  const groups = page.getByRole("radiogroup");
  for (const group of await groups.all()) await expect(group.locator("[role=radio][tabindex='0']")).toHaveCount(1);
  await page.getByLabel("Main sections").getByRole("button", { name: "Profiles", exact: true }).click();
  await expect(page.getByRole("table", { name: "Profiles" })).toBeVisible();
  await page.locator(".topbar").getByRole("button", { name: "Add profile", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add account" })).toContainText("Browser sign-in");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Command center" })).toContainText("Show Antigravity profiles");
  await page.keyboard.press("Escape");
  await page.getByLabel("Main sections").getByRole("button", { name: "Journal", exact: true }).click();
  await expect(page.getByText("No operations yet", { exact: true })).toBeVisible();
});

test("import is previewed with conflicts skipped before apply", async ({ page }) => {
  await installRendererFixture(page, { count: 1 });
  await page.getByLabel("Импорт и экспорт").click(); await page.getByRole("button", { name: "Импорт", exact: true }).click();
  const password = page.getByRole("dialog", { name: "Импорт профилей" });
  await password.getByLabel("Пароль импорта").fill("test-passphrase"); await password.getByRole("button", { name: "Проверить импорт" }).click();
  const preview = page.getByRole("dialog", { name: "Предварительный импорт" });
  await expect(preview).toContainText("Пропустить"); await expect(preview).toContainText("Новых профилей");
  expect(await page.evaluate(() => window.egoistFixture.calls.applyImport ?? 0)).toBe(0);
  await preview.getByRole("button", { name: "Импортировать 1" }).click();
  await expect(preview).toBeHidden();
  expect(await page.evaluate(() => window.egoistFixture.calls.applyImport)).toBe(1);
});

test("hiding pending sign-in resumes the same attempt and clears secret inputs", async ({ page }) => {
  await installRendererFixture(page, { count: 1 });
  const add = page.locator(".topbar").getByRole("button", { name: "Добавить профиль", exact: true });
  await add.click(); let dialog = page.getByRole("dialog", { name: "Добавление аккаунта" });
  await dialog.getByRole("button", { name: /OpenAI API key/ }).click(); await dialog.getByLabel("Секрет", { exact: true }).fill("synthetic-key-never-sent");
  await page.keyboard.press("Escape"); await add.click();
  await dialog.getByRole("button", { name: /OpenAI API key/ }).click(); await expect(dialog.getByLabel("Секрет", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: /Код устройства/ }).click(); await expect(dialog).toContainText("TEST-CODE");
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Продолжить вход" }).click(); dialog = page.getByRole("dialog", { name: "Добавление аккаунта" });
  await expect(dialog).toContainText("TEST-CODE"); expect(await page.evaluate(() => window.egoistFixture.calls.startLogin)).toBe(1);
});

test("freshness ages without network refresh and hidden windows stop the common clock", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const originalSet = window.setInterval.bind(window); const originalClear = window.clearInterval.bind(window);
    const active = new Set<number>(); Object.assign(window, { fixtureIntervals: active });
    window.setInterval = ((handler: TimerHandler, timeout?: number) => { const id = originalSet(handler, timeout); if (timeout === 15_000) active.add(id); return id; }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => { if (id !== undefined) active.delete(id); originalClear(id); }) as typeof window.clearInterval;
  });
  await installRendererFixture(page, { count: 2 });
  await expect(page.locator(".table-freshness").first()).toHaveText("Свежий");
  const counts = await page.evaluate(() => ({ ...window.egoistFixture.calls }));
  await page.clock.fastForward(16 * 60_000);
  await expect(page.locator(".table-freshness").first()).toHaveText("Устарел");
  expect(await page.evaluate(() => window.egoistFixture.calls.refreshAccount ?? 0)).toBe(counts.refreshAccount ?? 0);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(await page.evaluate(() => window.fixtureIntervals.size)).toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(await page.evaluate(() => window.fixtureIntervals.size)).toBe(1);
});

test("cards share the inspector and reduced motion stops decorative animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await installRendererFixture(page, { count: 2 });
  await page.getByRole("button", { name: "Карточки", exact: true }).click();
  const card = page.locator(".profile-card").first(); await card.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Подробности профиля" })).toBeVisible();
  expect(await page.locator(".profile-details-dialog").evaluate((node) => parseFloat(getComputedStyle(node).animationDuration))).toBeLessThanOrEqual(0.001);
});

test("tray uses fractional quota, runtime evidence and retains data on refresh failure", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await installRendererFixture(page, { count: 1, surface: "tray" });
  await expect(page.getByRole("dialog", { name: "Квессер · Codex" })).toContainText("<1%");
  await expect(page.locator(".tray-runtime-message")).toHaveText("Аккаунт работающей IDE не подтверждён");
  await page.evaluate(() => { window.egoistFixture.failRefresh = true; });
  await page.getByRole("button", { name: "Обновить лимит", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Сбой обновления"); await expect(page.locator(".tray-live-value")).toContainText("<1%");
  expect(errors).toEqual([]);
});
