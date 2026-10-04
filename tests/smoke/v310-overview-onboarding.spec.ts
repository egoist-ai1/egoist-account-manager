import { expect, test } from "@playwright/test";

async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  const notes = page.getByRole("dialog", { name: "Что нового" });
  await expect(notes).toBeVisible();
  await notes.getByRole("button", { name: "Понятно" }).click();
  await expect(page.locator(".overview-page")).toBeVisible();
}

test("default overview fits its viewport and provider panels do not clip content", async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  const geometry = await page.locator(".content-overview").evaluate((content) => ({
    widthFits: content.scrollWidth <= content.clientWidth + 1,
    pageInside: content.querySelector(".overview-page")!.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom + 1,
    cardsFit: Array.from(content.querySelectorAll(".dual-command-card, .clean-quota-card"))
      .every((panel) => panel.scrollHeight <= panel.clientHeight + 1 && panel.scrollWidth <= panel.clientWidth + 1)
  }));
  expect(geometry).toEqual({ widthFits: true, pageInside: true, cardsFit: true });
});

test("add-account wizard exposes supported official methods without invoking login", async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await ready(page);
  await page.getByRole("button", { name: "Добавить Codex", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Добавление аккаунта" });
  await expect(dialog).toBeVisible();
  for (const name of [/Код устройства/, /Браузерный вход/, /OpenAI API key/, /Enterprise access token/]) {
    await expect(dialog.getByRole("button", { name })).toBeVisible();
  }
  await expect(dialog.getByRole("button", { name: /Выбрать auth.json/ })).toHaveCount(0);
  const geometry = await dialog.locator(".workflow-modal").evaluate((modal) => ({
    widthFits: modal.scrollWidth <= modal.clientWidth + 1,
    heightFits: modal.scrollHeight <= modal.clientHeight + 1
  }));
  expect(geometry).toEqual({ widthFits: true, heightFits: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Antigravity platform opens its current account and Google onboarding surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await ready(page);
  const platform = page.getByRole("button", { name: /Antigravity: / });
  await expect(platform).toHaveAttribute("aria-disabled", "false");
  await platform.click();
  await expect(platform).toHaveClass(/is-active/);
  await expect(page.getByRole("heading", { name: /Аккаунты Antigravity/ })).toBeVisible();
  await page.getByRole("button", { name: "Добавить Antigravity", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Добавить Antigravity" });
  await expect(dialog.getByRole("button", { name: /^Войти через Google/ })).toBeVisible();
  await expect(dialog.getByLabel("Refresh token", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Access token", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
