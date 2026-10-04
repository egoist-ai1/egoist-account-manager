import { expect, test } from "@playwright/test";

test("live tray popover renders a complete compact quota surface", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 372, height: 302 });
  await page.goto("/?surface=tray");
  const popover = page.locator(".tray-live");
  await expect(popover).toBeVisible();
  await expect(popover.getByText("Codex", { exact: true })).toBeVisible();
  await expect(popover.locator(".tray-live-identity strong")).toHaveText("основной");
  await expect(popover.locator(".tray-live-value")).toContainText("66");
  await expect(popover.getByText(/^Сброс /)).toBeVisible();
  await expect(popover.getByRole("button", { name: "Обновить лимит" })).toBeEnabled();
  await expect(popover.getByRole("button", { name: "Менеджер" })).toBeVisible();
  const layout = await popover.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
  expect(layout.scrollHeight).toBe(layout.clientHeight);
  await page.screenshot({ path: testInfo.outputPath("live-tray-popover.png") });
});

test("live tray popover respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 372, height: 302 });
  await page.goto("/?surface=tray");
  const animation = await page.locator(".tray-live").evaluate((element) => getComputedStyle(element).animationName);
  expect(animation).toBe("none");
});

test("passive tray hover surface is translucent, complete and action-free", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 252, height: 144 });
  await page.goto("/?surface=tray-hover");
  const hover = page.locator(".tray-hover");
  await expect(hover).toBeVisible();
  await expect(hover.getByText("Codex", { exact: true })).toBeVisible();
  await expect(hover.getByText("основной", { exact: true })).toBeVisible();
  await expect(hover.getByRole("region", { name: "Текущий лимит" })).toBeVisible();
  await expect(hover.getByText(/^Сброс /)).toBeVisible();
  await expect(hover.getByText("5 часов", { exact: true })).toHaveCount(0);
  await expect(hover.getByText("Неделя", { exact: true })).toHaveCount(0);
  await expect(hover.getByRole("button")).toHaveCount(0);
  const metrics = await hover.evaluate((element) => {
    const style = getComputedStyle(element);
    const surfaces = [document.documentElement, document.body, document.querySelector("#root")]
      .filter((surface): surface is Element => Boolean(surface))
      .map((surface) => getComputedStyle(surface).backgroundColor);
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      background: style.backgroundImage,
      backdropFilter: style.backdropFilter,
      surfaces,
      pointerEvents: style.pointerEvents
    };
  });
  expect(metrics.scrollWidth).toBe(metrics.clientWidth);
  expect(metrics.scrollHeight).toBe(metrics.clientHeight);
  expect(metrics.background).toContain("rgba");
  expect(metrics.surfaces).toEqual(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
  expect(metrics.backdropFilter).toBe("none");
  expect(metrics.pointerEvents).toBe("none");
  await page.screenshot({ path: testInfo.outputPath("tray-hover.png"), omitBackground: true });
});

test("passive tray hover surface respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 252, height: 144 });
  await page.goto("/?surface=tray-hover");
  const animation = await page.locator(".tray-hover").evaluate((element) => getComputedStyle(element).animationName);
  expect(animation).toBe("none");
});
