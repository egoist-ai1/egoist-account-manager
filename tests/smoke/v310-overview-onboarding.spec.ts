import { expect, test } from "@playwright/test";

async function ready(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  const notes = page.getByRole("dialog", { name: "Что нового" });
  if (await notes.isVisible().catch(() => false)) await notes.getByRole("button", { name: "Понятно" }).click();
  await expect(page.locator(".overview-command-grid")).toBeVisible();
}

test("3.1 overview fits the default viewport without vertical scrolling or clipped cards", async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);

  const geometry = await page.locator(".content-overview").evaluate((content) => {
    const page = content.querySelector(".overview-v306")!;
    const panels = Array.from(content.querySelectorAll(".overview-continuation, .overview-operation"));
    return {
      contentFits: content.scrollHeight <= content.clientHeight + 1,
      pageFits: page.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom + 1,
      pageFills: Math.abs(
        page.getBoundingClientRect().bottom
        - (content.getBoundingClientRect().bottom - Number.parseFloat(getComputedStyle(content).paddingBottom))
      ) <= 2,
      panelsFit: panels.every((panel) => panel.scrollHeight <= panel.clientHeight + 1),
      finalChildrenFit: panels.every((panel) => {
        const finalChild = panel.lastElementChild;
        return Boolean(finalChild && finalChild.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom + 1);
      })
    };
  });
  expect(geometry).toMatchObject({ contentFits: true, pageFits: true, pageFills: true, panelsFit: true, finalChildrenFit: true });
});

test("3.1 add-account wizard exposes only official Codex sign-in methods", async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  await page.getByRole("button", { name: "Добавить Codex" }).first().click();

  const dialog = page.getByRole("dialog", { name: "Добавление аккаунта" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("ОФИЦИАЛЬНАЯ АВТОРИЗАЦИЯ")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Текущий Codex/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Выбрать auth.json/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Код устройства/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Браузерный вход/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /OpenAI API key/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Enterprise access token/ })).toBeVisible();

  const layout = await dialog.locator(".workflow-modal").evaluate((modal) => ({
    verticalFits: modal.scrollHeight <= modal.clientHeight + 1,
    horizontalFits: modal.scrollWidth <= modal.clientWidth + 1
  }));
  expect(layout).toEqual({ verticalFits: true, horizontalFits: true });
});
