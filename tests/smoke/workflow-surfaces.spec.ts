import { expect, test } from "@playwright/test";
import { installRendererFixture } from "./rendererFixture";

for (const [width, height] of [[860, 560], [1080, 780], [1460, 900]]) {
  test(`overview, settings and audit remain reachable at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: "reduce" });
    await installRendererFixture(page, { count: 10 });
    const nav = page.getByLabel("Основные разделы"); await nav.getByRole("button", { name: "Обзор", exact: true }).click();
    await expect(page.locator(".overview-selected-profile")).toHaveCount(1); await expect(page.locator(".overview-connect")).toHaveCount(1);
    await expect(page.locator(".overview-quotas .overview-quota")).toHaveCount(2);
    expect(await page.locator(".overview-selected-profile, .overview-connect").evaluateAll((panels) => panels.every((panel) => panel.scrollWidth <= panel.clientWidth + 1))).toBe(true);
    await nav.getByRole("button", { name: "Настройки", exact: true }).click();
    const sections = page.getByRole("tablist", { name: "Разделы настроек" });
    await expect(sections.getByRole("tab")).toHaveCount(4);
    for (const [title, control] of [
      ["Основные", "Режим приватности"],
      ["Лимиты и панель задач", "Живой индикатор лимитов"],
      ["Переключение", "Подтверждать переключение"],
      ["Диагностика", "Экспорт отчёта"]
    ]) {
      const section = sections.getByRole("tab", { name: title, exact: true });
      await section.click();
      await expect(section).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel")).toHaveCount(1);
      const panel = page.getByRole("tabpanel", { name: title, exact: true });
      await expect(panel.getByRole("heading", { name: title, exact: true })).toBeVisible();
      const setting = panel.getByRole(title === "Диагностика" ? "button" : "switch", { name: control, exact: true });
      await setting.scrollIntoViewIfNeeded();
      await expect(setting).toBeInViewport();
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
    await page.getByRole("button", { name: "Журнал аудита переключений", exact: true }).click();
    const audit = page.getByRole("dialog", { name: "Журнал аудита переключений" }); await expect(audit).toBeVisible();
    expect(await audit.locator(".audit-drawer-panel").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    for (let index = 0; index < 10; index++) { await page.keyboard.press("Tab"); expect(await audit.evaluate((node) => node.contains(document.activeElement))).toBe(true); }
    await page.keyboard.press("Escape"); await expect(audit).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("official onboarding exposes methods without invoking authentication or local import", async ({ page }) => {
  await installRendererFixture(page, { count: 1 });
  await page.locator(".topbar").getByRole("button", { name: "Добавить профиль", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Добавление аккаунта" });
  for (const name of [/Код устройства/, /Браузерный вход/, /OpenAI API key/, /Enterprise access token/]) await expect(dialog.getByRole("button", { name })).toBeVisible();
  await expect(dialog.getByLabel("Секрет", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape"); await page.getByLabel("Фильтр провайдера").selectOption("antigravity"); await page.locator(".topbar").getByRole("button", { name: "Добавить профиль", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Добавить Antigravity" });
  await expect(dialog.getByRole("button", { name: /^Войти через Google/ })).toBeVisible();
  await expect(dialog).toContainText("Обнаружение профиля не подтверждает аккаунт работающей IDE");
  await expect(dialog.getByLabel("Токен или JSON", { exact: true })).toBeHidden();
  for (const method of ["startLogin", "startAntigravityGoogleOAuth", "importCurrentAntigravityAccount", "importAntigravityCredentials"]) expect(await page.evaluate((name) => window.egoistFixture.calls[name] ?? 0, method)).toBe(0);
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
});

test("unknown quotas stay unknown across table, cards, overview and tray; initial render has no privileged effects", async ({ page }) => {
  await installRendererFixture(page, { count: 1, unknown: true });
  await expect(page.locator(".table-quota strong")).toHaveText("—");
  await page.getByRole("button", { name: "Карточки", exact: true }).click(); await expect(page.locator(".profile-card")).not.toContainText("100%"); await expect(page.locator(".profile-card")).toContainText("—");
  await page.getByLabel("Основные разделы").getByRole("button", { name: "Обзор", exact: true }).click(); await expect(page.locator(".overview-quota strong")).toHaveText("—");
  for (const method of ["setAntigravityGodMode", "getAntigravityGodMode", "regenerateFingerprint", "startLogin", "refreshAccount"]) expect(await page.evaluate((name) => window.egoistFixture.calls[name] ?? 0, method)).toBe(0);
  for (const surface of ["tray", "tray-hover"]) {
    await page.goto(`/?surface=${surface}`); const view = page.locator(surface === "tray" ? ".tray-live" : ".tray-hover"); await expect(view).toBeVisible();
    await expect(view.locator(".tray-live-value strong, .tray-hover-value strong")).toHaveText("—"); await expect(view).not.toContainText("100%");
  }
});
