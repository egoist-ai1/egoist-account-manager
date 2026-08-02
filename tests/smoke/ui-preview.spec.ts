import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1460, height: 900 } });

test("3.0.10 помещает 3×3 аккаунта и открывает полный инспектор без клиппинга", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const releaseDialog = page.getByRole("dialog", { name: "Что нового" });
  if (await releaseDialog.isVisible().catch(() => false)) {
    await releaseDialog.getByRole("button", { name: "Понятно" }).click();
  }

  const nav = page.getByLabel("Основные разделы");
  await nav.getByText("Аккаунты", { exact: true }).click();
  await expect(page.locator(".profile-card")).toHaveCount(2);

  const cardLayout = await page.evaluate(() => {
    const grid = document.querySelector(".profile-grid");
    const main = document.querySelector(".profile-main");
    const originals = grid ? Array.from(grid.querySelectorAll(".profile-card")) : [];
    if (!grid || !main || originals.length === 0) return null;
    for (let index = originals.length; index < 9; index += 1) {
      const clone = originals[index % originals.length].cloneNode(true) as HTMLElement;
      clone.setAttribute("data-layout-clone", String(index));
      grid.appendChild(clone);
    }
    const mainRect = main.getBoundingClientRect();
    const cards = Array.from(grid.querySelectorAll(".profile-card")).slice(0, 9);
    const rects = cards.map((card) => card.getBoundingClientRect());
    return {
      count: cards.length,
      fullyVisible: rects.filter((rect) => (
        rect.top >= mainRect.top - 1
        && rect.bottom <= mainRect.bottom + 1
        && rect.left >= mainRect.left - 1
        && rect.right <= mainRect.right + 1
      )).length,
      maximumBottom: Math.max(...rects.map((rect) => rect.bottom)),
      surfaceBottom: mainRect.bottom,
      horizontalOverflow: Math.max(0, main.scrollWidth - main.clientWidth)
    };
  });
  expect(cardLayout).not.toBeNull();
  expect(cardLayout!.count).toBe(9);
  expect(cardLayout!.fullyVisible).toBe(9);
  expect(cardLayout!.maximumBottom).toBeLessThanOrEqual(cardLayout!.surfaceBottom + 1);
  expect(cardLayout!.horizontalOverflow).toBe(0);
  if (process.env.CAM_CAPTURE_VISUALS === "1") {
    await page.screenshot({ path: testInfo.outputPath("accounts-3x3.png"), fullPage: true });
  }

  await page.locator('[data-layout-clone]').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await page.getByRole("button", { name: "Подробнее о профиле" }).first().click();
  const inspector = page.getByRole("dialog", { name: "Подробности профиля" });
  await expect(inspector).toBeVisible();
  await expect(inspector.locator(".inspector-action-grid .button")).toHaveCount(6);
  await expect(inspector.getByRole("button", { name: "Удалить профиль" })).toBeVisible();
  await expect(inspector.locator(".inspector-more")).toHaveCount(0);
  const inspectTrigger = page.getByRole("button", { name: "Подробнее о профиле" }).first();
  const inspectorLayout = await inspector.evaluate((element) => {
    const panel = element.querySelector(".profile-details-dialog");
    const content = element.querySelector(".inspector");
    if (!panel || !content) return null;
    return {
      panelFits: panel.scrollHeight <= panel.clientHeight + 1,
      contentFits: content.scrollHeight <= content.clientHeight + 1,
      panelOverflow: getComputedStyle(panel).overflow
    };
  });
  expect(inspectorLayout).toEqual({ panelFits: true, contentFits: true, panelOverflow: "hidden" });
  if (process.env.CAM_CAPTURE_VISUALS === "1") {
    await page.screenshot({ path: testInfo.outputPath("profile-inspector.png"), fullPage: true });
  }
  await page.keyboard.press("Escape");
  await expect(inspector).toBeHidden();
  await expect(inspectTrigger).toBeFocused();

  await nav.getByText("Активность", { exact: true }).click();
  const routeTypography = await page.locator(".switch-stage").evaluateAll((stages) => stages.map((stage) => {
    const title = stage.querySelector("strong");
    const detail = stage.querySelector("small");
    const stageRect = stage.getBoundingClientRect();
    const titleRect = title?.getBoundingClientRect();
    const detailRect = detail?.getBoundingClientRect();
    return {
      titleInside: Boolean(titleRect && titleRect.right <= stageRect.right + 1 && titleRect.bottom <= stageRect.bottom + 1),
      detailInside: Boolean(detailRect && detailRect.right <= stageRect.right + 1 && detailRect.bottom <= stageRect.bottom + 1),
      detailFontSize: detail ? Number.parseFloat(getComputedStyle(detail).fontSize) : 0
    };
  }));
  expect(routeTypography).toHaveLength(4);
  expect(routeTypography.every((stage) => stage.titleInside && stage.detailInside)).toBe(true);
  expect(routeTypography.every((stage) => stage.detailFontSize >= 10)).toBe(true);
  const activityTextFloor = await page.locator(
    ".activity-route .transaction-state, .activity-filters button span, .timeline-status, .timeline-details b, .timeline-details code"
  ).evaluateAll((elements) => elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (element.textContent?.trim().length ?? 0) > 0;
  }).map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
  expect(activityTextFloor.length).toBeGreaterThan(0);
  expect(Math.min(...activityTextFloor)).toBeGreaterThanOrEqual(10);
  if (process.env.CAM_CAPTURE_VISUALS === "1") {
    await page.screenshot({ path: testInfo.outputPath("activity-route.png"), fullPage: true });
  }
});
