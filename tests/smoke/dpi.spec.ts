import { expect, test } from "@playwright/test";
import { installRendererFixture } from "./rendererFixture";

// Browser deviceScaleFactor emulation verifies layout/rasterization separately
// from native Windows display settings. It is not a Windows DPI certification.
for (const ratio of [1, 1.5, 2]) {
  test.describe(`browser DPI emulation ${ratio * 100}%`, () => {
    test.use({ deviceScaleFactor: ratio });
    for (const [width, height] of [[860, 560], [1080, 780], [1460, 900]]) {
      test(`table and inspector stay reachable at ${width}x${height}`, async ({ page }) => {
        await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: "reduce" });
        await installRendererFixture(page, { count: 200, privacyMode: true });
        expect(await page.evaluate(() => window.devicePixelRatio)).toBe(ratio);
        const rows = page.locator(".profile-table tbody tr"); await expect(rows).toHaveCount(200);
        await rows.first().focus(); await page.keyboard.press("End"); await expect(rows.last()).toBeFocused();
        await expect(rows.last().getByRole("button", { name: /Подробности/ })).toBeInViewport();
        await page.keyboard.press("Enter"); const dialog = page.getByRole("dialog", { name: "Подробности профиля" }); await expect(dialog).toBeVisible();
        expect(await dialog.locator(".profile-details-dialog").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        expect(await page.locator("body").innerHTML()).not.toContain("hidden-address+199@privacy.example");
        await page.keyboard.press("Escape"); await expect(rows.last()).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    }
  });
}
