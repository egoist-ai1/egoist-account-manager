import { expect, test } from "@playwright/test";
import type { AccountPlatform, AppApi } from "../../src/shared/types";
import { installRendererFixture } from "./rendererFixture";

test("live tray fits its native 310x192 surface and preserves privacy", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 310, height: 192 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await installRendererFixture(page, { count: 1, privacyMode: true, surface: "tray" });
  const popover = page.locator(".tray-live"); await expect(popover).toBeVisible();
  await expect(popover.locator(".tray-live-identity strong")).toHaveText("Выбранный профиль"); await expect(popover.locator(".tray-live-value strong")).toHaveText("<1%");
  await expect(popover.getByRole("button", { name: "Квессер", exact: true })).toBeVisible();
  await expect(popover.getByRole("button", { name: "Обновить лимит" })).toBeEnabled();
  await expect(popover.locator(".tray-runtime-message")).toHaveText("Аккаунт работающей IDE не подтверждён");
  expect(await page.locator("body").innerHTML()).not.toContain("hidden-address+0@privacy.example");
  expect(await popover.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
  expect(await popover.locator(".tray-live-limit > i").evaluate((node) => getComputedStyle(node).height)).toBe("7px");
  await page.screenshot({ path: testInfo.outputPath("live-tray-popover.png") });
});

test("live tray respects reduced motion and exposes refresh failure without losing the snapshot", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await installRendererFixture(page, { count: 1, surface: "tray" });
  expect(await page.locator(".tray-live").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.evaluate(() => { window.egoistFixture.failRefresh = true; }); await page.getByRole("button", { name: "Обновить лимит" }).click();
  await expect(page.getByRole("alert")).toContainText("Снимок сохранён"); await expect(page.locator(".tray-live-value strong")).toHaveText("<1%");
});

test("passive tray hover fits its native 310x142 surface, masks identity and stays action-free", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 310, height: 142 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await installRendererFixture(page, { count: 1, privacyMode: true, surface: "tray-hover" });
  const hover = page.locator(".tray-hover"); await expect(hover).toBeVisible();
  await expect(hover.getByText("Выбранный профиль", { exact: true })).toBeVisible(); await expect(hover.getByRole("region", { name: "Текущий лимит" })).toBeVisible();
  await expect(hover.getByRole("button")).toHaveCount(0); expect(await page.locator("body").innerHTML()).not.toContain("hidden-address+0@privacy.example");
  const metrics = await hover.evaluate((element) => ({
    fits: element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
    ancestors: [document.documentElement, document.body, document.querySelector("#root")!].map((node) => getComputedStyle(node).backgroundColor),
    backdropFilter: getComputedStyle(element).backdropFilter, pointerEvents: getComputedStyle(element).pointerEvents,
    barHeight: getComputedStyle(element.querySelector(".tray-progress-track")!).height
  }));
  expect(metrics.fits).toBe(true); expect(metrics.ancestors).toEqual(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
  expect(metrics.backdropFilter).toBe("none"); expect(metrics.pointerEvents).toBe("none"); expect(metrics.barHeight).toBe("7px");
  await page.screenshot({ path: testInfo.outputPath("tray-hover.png"), omitBackground: true });
});

test("passive tray hover respects reduced motion in English", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await installRendererFixture(page, { count: 1, language: "en", surface: "tray-hover" });
  const hover = page.locator(".tray-hover"); await expect(hover).toContainText("IDE account is unconfirmed");
  expect(await hover.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});

declare global {
  interface Window {
    trayRace: {
      emitPlatform(platform: AccountPlatform): void;
      resolveInitialPlatform(): void;
      pauseNextAccounts: boolean;
      accountsPaused: boolean;
      resolveAccounts(): void;
      failSettings: boolean;
    };
  }
}

test("tray follows current platform and profile when older reads finish late", async ({ page }) => {
  await page.setViewportSize({ width: 310, height: 192 });
  await page.addInitScript(() => {
    let releasePlatform = () => {};
    let releaseAccounts = () => {};
    let onPlatformChange: ((platform: AccountPlatform) => void) | undefined;
    const initialPlatform = new Promise<AccountPlatform>((resolve) => { releasePlatform = () => resolve("codex"); });
    window.trayRace = {
      emitPlatform: (platform) => onPlatformChange?.(platform),
      resolveInitialPlatform: () => releasePlatform(),
      pauseNextAccounts: false,
      accountsPaused: false,
      resolveAccounts: () => releaseAccounts(),
      failSettings: false
    };
    const race = window.trayRace;
    const wrapApi = (api: AppApi) => {
      const wrapped: AppApi = new Proxy(api, {
        get(target, method, receiver) {
          if (method === "getTrayPlatform") return () => initialPlatform;
          if (method === "onTrayPlatform") return (callback: typeof onPlatformChange) => {
            onPlatformChange = callback;
            return () => { onPlatformChange = undefined; };
          };
          if (method === "getSettings") return () => race.failSettings
            ? Promise.reject(new Error("Synthetic settings failure"))
            : target.getSettings();
          if (method === "listAccounts") return async () => {
            const accounts = await target.listAccounts();
            if (race.pauseNextAccounts) {
              race.pauseNextAccounts = false;
              race.accountsPaused = true;
              await new Promise<void>((resolve) => { releaseAccounts = resolve; });
            }
            return accounts;
          };
          return Reflect.get(target, method, receiver);
        }
      });
      Object.defineProperty(window, "cam", { configurable: true, value: wrapped });
    };
    if (window.cam) wrapApi(window.cam);
    else Object.defineProperty(window, "cam", { configurable: true, set: wrapApi });
  });

  await installRendererFixture(page, { count: 4, surface: "tray" });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(dialog).not.toContainText("Profile 001");

  const longLabel = "Профиль нового аккаунта ".repeat(25).trim();
  await page.evaluate((label) => {
    const fixture = window.egoistFixture;
    fixture.accounts = fixture.accounts.map((account) => account.platform === "antigravity"
      ? { ...account, label, isActive: true }
      : account);
    fixture.emitAccounts();
    window.trayRace.emitPlatform("antigravity");
    window.trayRace.resolveInitialPlatform();
  }, longLabel);

  await expect(dialog).toHaveAccessibleName("Квессер · Antigravity");
  const identity = dialog.locator(".tray-live-identity strong");
  await expect(identity).toHaveText(longLabel);
  await expect(identity).toHaveAttribute("title", longLabel);
  expect(await identity.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);

  await page.evaluate(() => {
    window.trayRace.pauseNextAccounts = true;
    window.egoistFixture.emitAccounts();
  });
  await expect.poll(() => page.evaluate(() => window.trayRace.accountsPaused)).toBe(true);
  await page.evaluate(() => {
    const fixture = window.egoistFixture;
    fixture.accounts = fixture.accounts.map((account) => account.platform === "antigravity"
      ? { ...account, label: "Новый" }
      : account);
    fixture.emitAccounts();
  });
  await expect(identity).toHaveText("Новый");
  await page.evaluate(async () => {
    window.trayRace.resolveAccounts();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(identity).toHaveText("Новый");

  await page.evaluate(() => {
    window.trayRace.failSettings = true;
    window.egoistFixture.emitAccounts();
  });
  await expect(dialog.getByRole("status")).toHaveText("Сбой обновления");
  await expect(identity).toHaveText("Выбранный профиль");
  await expect(identity).not.toHaveAttribute("title");

  await page.evaluate(() => {
    window.trayRace.failSettings = false;
    window.egoistFixture.emitAccounts();
    window.trayRace.emitPlatform("codex");
  });
  await expect(dialog).toHaveAccessibleName("Квессер · Codex");
  await expect(identity).toHaveText("Profile 001");
  await expect(dialog.locator(".tray-live-value strong")).toHaveText("<1%");
});
