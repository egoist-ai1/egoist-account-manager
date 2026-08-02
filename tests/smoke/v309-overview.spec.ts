import { expect, test } from "@playwright/test";

async function closeReleaseNotes(page: import("@playwright/test").Page): Promise<void> {
  const releaseDialog = page.getByRole("dialog", { name: "Что нового" });
  if (await releaseDialog.isVisible().catch(() => false)) {
    await releaseDialog.getByRole("button", { name: "Понятно" }).click();
  }
}

for (const viewport of [
  { name: "wide", width: 1460, height: 900 },
  { name: "compact", width: 1080, height: 780 }
]) {
  test(`3.0.9 обзор сохраняет читаемую геометрию — ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await closeReleaseNotes(page);

    await expect(page.locator(".overview-continuation")).toBeVisible();
    await expect(page.locator(".quota-card")).toHaveCount(2);
    await expect(page.getByText("ПЛАН ПРОДОЛЖЕНИЯ", { exact: true })).toBeVisible();

    const quotaGeometry = await page.locator(".quota-card").evaluateAll((cards) => cards.map((card) => {
      const head = card.querySelector(".quota-card-head")?.getBoundingClientRect();
      const visual = card.querySelector(".quota-card-visual")?.getBoundingClientRect();
      const ring = card.querySelector(".quota-ring")?.getBoundingClientRect();
      const copy = card.querySelector(".quota-copy")?.getBoundingClientRect();
      const meter = card.querySelector(".quota-meter")?.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      return {
        rowsSeparated: Boolean(head && visual && meter && head.bottom <= visual.top + 1 && visual.bottom <= meter.top + 1),
        columnsSeparated: Boolean(ring && copy && ring.right <= copy.left + 1),
        fits: card.scrollWidth <= card.clientWidth + 1 && card.scrollHeight <= card.clientHeight + 1,
        inside: Boolean(head && meter && head.top >= rect.top && meter.bottom <= rect.bottom + 1)
      };
    }));
    expect(quotaGeometry.every((item) => item.rowsSeparated && item.columnsSeparated && item.fits && item.inside)).toBe(true);

    const continuationGeometry = await page.locator(".overview-continuation").evaluate((card) => {
      const lane = card.querySelector(".handoff-lane");
      const queue = card.querySelector(".continuation-queue");
      const footer = card.querySelector(".continuation-foot");
      return {
        noHorizontalOverflow: card.scrollWidth <= card.clientWidth + 1,
        laneFits: Boolean(lane && lane.scrollWidth <= lane.clientWidth + 1),
        queueFits: Boolean(queue && queue.scrollWidth <= queue.clientWidth + 1),
        footerFits: Boolean(footer && footer.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom + 1)
      };
    });
    expect(continuationGeometry).toEqual({ noHorizontalOverflow: true, laneFits: true, queueFits: true, footerFits: true });

    const textFloor = await page.locator(
      ".quota-card-head, .quota-copy, .handoff-lane, .continuation-row, .continuation-foot"
    ).evaluateAll((containers) => containers.flatMap((container) => Array.from(container.querySelectorAll("span, strong, small, b")))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (element.textContent?.trim().length ?? 0) > 0;
      })
      .map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
    expect(textFloor.length).toBeGreaterThan(0);
    expect(Math.min(...textFloor)).toBeGreaterThanOrEqual(7.5);

    if (process.env.CAM_CAPTURE_VISUALS === "1") {
      await page.screenshot({ path: testInfo.outputPath(`overview-${viewport.name}.png`), fullPage: true });
    }
  });
}
