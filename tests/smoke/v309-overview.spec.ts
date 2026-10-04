import { expect, test } from "@playwright/test";

for (const viewport of [{ name: "wide", width: 1460, height: 900 }, { name: "compact", width: 1080, height: 780 }]) {
  test(`current dual-provider overview has readable reachable quotas — ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const notes = page.getByRole("dialog", { name: "Что нового" });
    await expect(notes).toBeVisible();
    await notes.getByRole("button", { name: "Понятно" }).click();
    await expect(page.locator(".dual-command-card")).toHaveCount(2);
    await expect(page.locator(".clean-quota-card.is-codex")).toHaveCount(2);
    const geometry = await page.locator(".clean-quota-card").evaluateAll((cards) => cards.map((card) => {
      const rect = card.getBoundingClientRect();
      const children = [".clean-quota-header", ".clean-quota-big-number", ".clean-quota-progress", ".clean-quota-footer"]
        .map((selector) => card.querySelector(selector)!.getBoundingClientRect());
      return {
        widthFits: card.scrollWidth <= card.clientWidth + 1,
        heightFits: card.scrollHeight <= card.clientHeight + 1,
        inside: children.every((child) => child.left >= rect.left - 1 && child.right <= rect.right + 1 && child.bottom <= rect.bottom + 1),
        separated: children.slice(1).every((child, index) => child.top >= children[index].bottom - 1)
      };
    }));
    expect(geometry.every((card) => Object.values(card).every(Boolean))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Аудит", exact: true }).click();
    const audit = page.getByRole("dialog", { name: "Журнал аудита переключений" });
    await expect(audit).toBeVisible();
    await expect(audit.getByText("Подтверждено", { exact: true }).first()).toBeVisible();
    await audit.getByRole("button", { name: "Закрыть журнал" }).click();
    await expect(audit).toBeHidden();
  });
}
