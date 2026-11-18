import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { AppApi, AppNotificationPayload } from "../../src/shared/types";
import { installRendererFixture } from "./rendererFixture";

interface InteractionProbe {
  holdRefresh: boolean;
  releaseRefresh(): void;
  emitNotice(notice: AppNotificationPayload): void;
  setHidden(hidden: boolean): void;
  animationState(): { created: number; running: number; disconnected: number; documentRunning: number };
  metrics(): { rafIntervals: number[]; longTasks: number[]; longTasksSupported: boolean; inputToDom: Array<{ attribute: string; input: string; milliseconds: number }> };
}

declare global { interface Window { kvesserInteractions: InteractionProbe } }

const viewports = [{ width: 860, height: 560 }, { width: 1080, height: 780 }, { width: 1460, height: 900 }];
const counts = [1, 10, 100, 200];
const rows = (page: Page) => page.locator(".profile-table tbody tr[data-profile-id]");
const navigation = (page: Page) => page.getByLabel("Основные разделы").locator(".rail-nav");
const inspector = (page: Page) => page.getByRole("dialog", { name: "Подробности профиля", exact: true });
const palette = (page: Page) => page.getByRole("dialog", { name: "Командный центр", exact: true });

async function installInteractionProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners = new Set<(notice: AppNotificationPayload) => void>();
    const refreshWaiters: Array<() => void> = [];
    const animations: Animation[] = [];
    const rafIntervals: number[] = [];
    const longTasks: number[] = [];
    const inputToDom: Array<{ attribute: string; input: string; milliseconds: number }> = [];
    let latestInput: { at: number; type: string } | null = null;
    let previousFrame: number | null = null;
    const longTasksSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
    const nativeAnimate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = nativeAnimate.call(this, keyframes, options);
      if (animations.length < 2048) animations.push(animation);
      return animation;
    };
    const running = (animation: Animation) => animation.playState === "running" || animation.pending;
    const probe: InteractionProbe = {
      holdRefresh: false,
      releaseRefresh() { this.holdRefresh = false; refreshWaiters.splice(0).forEach((resolve) => resolve()); },
      emitNotice(notice) { listeners.forEach((listener) => listener(notice)); },
      setHidden(hidden) {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
      },
      animationState() {
        const active = animations.filter(running);
        return {
          created: animations.length,
          running: active.length,
          disconnected: active.filter((animation) => {
            const target = (animation.effect as KeyframeEffect | null)?.target;
            return target instanceof Element && !target.isConnected;
          }).length,
          documentRunning: document.getAnimations().filter(running).length
        };
      },
      metrics: () => ({ rafIntervals: [...rafIntervals], longTasks: [...longTasks], longTasksSupported, inputToDom: [...inputToDom] })
    };
    window.kvesserInteractions = probe;
    let bridge: AppApi | undefined;
    Object.defineProperty(window, "cam", {
      configurable: true,
      get: () => bridge,
      set(value: AppApi) {
        bridge = new Proxy(value, { get(target, property) {
          if (property === "onAppNotification") return (listener: (notice: AppNotificationPayload) => void) => {
            listeners.add(listener);
            const unsubscribe = target.onAppNotification(listener);
            return () => { listeners.delete(listener); unsubscribe(); };
          };
          if (property === "refreshAllAccounts") return async () => {
            const result = await target.refreshAllAccounts();
            if (probe.holdRefresh) await new Promise<void>((resolve) => refreshWaiters.push(resolve));
            return result;
          };
          return Reflect.get(target, property);
        } });
      }
    });
    const frame = (at: number) => {
      if (previousFrame !== null && rafIntervals.length < 4096) rafIntervals.push(at - previousFrame);
      previousFrame = at;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    if (longTasksSupported) new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) if (longTasks.length < 512) longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
    for (const event of ["keydown", "pointerdown"]) document.addEventListener(event, () => {
      latestInput = { at: performance.now(), type: event };
    }, true);
    new MutationObserver((mutations) => {
      if (!latestInput) return;
      const milliseconds = performance.now() - latestInput.at;
      if (milliseconds > 1000) return;
      for (const mutation of mutations) {
        if (mutation.type !== "attributes" || !mutation.attributeName || inputToDom.length >= 512) continue;
        inputToDom.push({ attribute: mutation.attributeName, input: latestInput.type, milliseconds });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["aria-selected", "aria-current"] });
  });
}

async function boot(page: Page, count: number): Promise<void> {
  await installInteractionProbe(page);
  await installRendererFixture(page, { count, privacyMode: true });
  await expect(rows(page)).toHaveCount(count);
  await expect(navigation(page).locator('[aria-current="page"]')).toHaveAttribute("aria-label", "Профили");
}

async function expectSettled(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.kvesserInteractions.animationState().running)).toBe(0);
  expect(await page.evaluate(() => window.kvesserInteractions.animationState().disconnected)).toBe(0);
  await expect.poll(() => page.locator(".content").evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
}

async function reverseNavigation(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const name of ["Обзор", "Настройки", "Журнал", "Обзор", "Профили"]) {
      const button = document.querySelector<HTMLButtonElement>(`.rail-nav button[aria-label="${name}"]`);
      if (!button) throw new Error(`Navigation button absent: ${name}`);
      button.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });
  await expect(navigation(page).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(navigation(page).locator('[aria-current="page"]')).toHaveAttribute("aria-label", "Профили");
  await expect(page.getByRole("table", { name: "Профили", exact: true })).toBeVisible();
}

async function expectFixtureOnly(page: Page): Promise<void> {
  const calls = await page.evaluate(() => window.egoistFixture.calls);
  for (const method of ["switchAccount", "prepareSwitch", "startLogin", "startAntigravityGoogleOAuth", "openExternal", "openDeviceLogin", "applyImport", "rollbackSwitch"]) expect(calls[method] ?? 0, method).toBe(0);
  await expect(page.locator("body")).not.toContainText("hidden-address+");
  expect(await page.locator("body").innerHTML()).not.toContain("C:\\isolated-fixture");
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function attachBrowserMetrics(page: Page, count: number): Promise<void> {
  const metrics = await page.evaluate(() => window.kvesserInteractions.metrics());
  const input = metrics.inputToDom.map((sample) => sample.milliseconds);
  const report = {
    method: "headless browser proxies; rAF callback cadence and input-to-ARIA-mutation; not native FPS, paint latency, CPU or RAM",
    surface: "Vite source renderer with synthetic fixture",
    browserVersion: page.context().browser()?.version() ?? null,
    document: await page.evaluate(() => ({ dpr: window.devicePixelRatio, visibility: document.visibilityState, reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches })),
    viewport: page.viewportSize(), profiles: count,
    raf: { samples: metrics.rafIntervals.length, p50Ms: percentile(metrics.rafIntervals, .5), p95Ms: percentile(metrics.rafIntervals, .95), over50Ms: metrics.rafIntervals.filter((value) => value > 50).length },
    inputToDom: { samples: input.length, p50Ms: percentile(input, .5), p95Ms: percentile(input, .95) },
    longTasks: { supported: metrics.longTasksSupported, count: metrics.longTasks.length, totalMs: metrics.longTasks.reduce((sum, value) => sum + value, 0) },
    raw: metrics
  };
  const body = JSON.stringify(report, null, 2);
  const work = process.env.CAM_TEST_WORK_DIR;
  if (work) {
    if (!path.isAbsolute(work)) throw new Error("CAM_TEST_WORK_DIR must be an absolute task work path");
    const directory = path.join(work, "rc2-interaction-proxies");
    fs.mkdirSync(directory, { recursive: true });
    const viewport = page.viewportSize()!;
    fs.writeFileSync(path.join(directory, `${count}-${viewport.width}x${viewport.height}.json`), body, "utf8");
  }
  await test.info().attach("browser-interaction-proxies.json", { body: Buffer.from(body), contentType: "application/json" });
}

for (const viewport of viewports) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const count of counts) test(`RC2 matrix: ${count} profiles keep navigation, selection and inspector coherent`, async ({ page }) => {
      await boot(page, count);
      await reverseNavigation(page);
      await expectSettled(page);
      const last = rows(page).last();
      const id = `fixture-${count - 1}`;
      await rows(page).first().focus();
      await page.keyboard.press("ArrowDown");
      await expect(rows(page).nth(Math.min(1, count - 1))).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(rows(page).first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(last).toBeFocused();
      await expect(last).toHaveAttribute("aria-selected", "true");
      const scroller = page.locator(".profile-table-scroll");
      const scrollBefore = await scroller.evaluate((node) => ({ top: node.scrollTop, height: node.clientHeight }));
      const rowHeight = await last.evaluate((node) => node.getBoundingClientRect().height);
      const scrollTolerance = Math.max(8, rowHeight, scrollBefore.height * .2);
      await navigation(page).getByRole("button", { name: "Настройки", exact: true }).click();
      await expect(page.getByRole("table", { name: "Профили", exact: true })).toHaveCount(0);
      await navigation(page).getByRole("button", { name: "Профили", exact: true }).click();
      await expect(last).toHaveAttribute("aria-selected", "true");
      await expect.poll(async () => Math.abs(await scroller.evaluate((node) => node.scrollTop) - scrollBefore.top), {
        message: "Returning to Profiles restores the selected row's scroll position"
      }).toBeLessThanOrEqual(scrollTolerance);
      await expect(last).toBeInViewport({ ratio: .8 });
      await last.focus();
      await page.keyboard.press("Enter");
      await expect(inspector(page)).toBeVisible();
      await expect(inspector(page)).toContainText(`Profile ${String(count).padStart(3, "0")}`);
      expect(await inspector(page).evaluate((node) => node.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Tab");
      expect(await inspector(page).evaluate((node) => node.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(inspector(page)).toHaveCount(0);
      await expect(last).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(inspector(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(last).toBeFocused();
      await expectSettled(page);

      const previousReads = await page.evaluate(() => window.egoistFixture.calls.listAccounts);
      await page.evaluate(() => {
        window.egoistFixture.accounts = window.egoistFixture.accounts.slice().reverse().map((account) => ({ ...account, updatedAt: account.updatedAt + 1 }));
        window.egoistFixture.emitAccounts();
      });
      await expect.poll(() => page.evaluate(() => window.egoistFixture.calls.listAccounts)).toBeGreaterThan(previousReads);
      const selected = page.locator(`.profile-table tr[data-profile-id="${id}"]`);
      await expect(selected).toHaveAttribute("aria-selected", "true");
      await page.getByLabel("Поиск профиля", { exact: true }).fill(`Profile ${String(count).padStart(3, "0")}`);
      await expect(rows(page)).toHaveCount(1);
      await expect(selected).toHaveAttribute("aria-selected", "true");
      await page.getByLabel("Поиск профиля", { exact: true }).fill("no-matching-profile");
      await expect(rows(page)).toHaveCount(0);
      await page.getByLabel("Поиск профиля", { exact: true }).fill("");
      await expect(rows(page)).toHaveCount(count);
      await expect(selected).toHaveAttribute("aria-selected", "true");
      const platform = (count - 1) % 4 === 3 ? "antigravity" : "codex";
      await page.getByLabel("Фильтр провайдера", { exact: true }).selectOption(platform);
      await expect(selected).toHaveAttribute("aria-selected", "true");
      await page.getByLabel("Фильтр провайдера", { exact: true }).selectOption("all");
      await expect(selected).toHaveAttribute("aria-selected", "true");
      await selected.focus();
      await page.keyboard.press("Home");
      await expect(rows(page).first()).toBeFocused();
      await expect(rows(page).filter({ has: page.locator('button[aria-busy="true"]') })).toHaveCount(0);
      await expect(page.locator('.profile-table tbody tr[aria-selected="true"]')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await expect(page.locator('[data-profile-id="fixture-0"]')).toContainText("Аккаунт работающей IDE не подтверждён");
      await expectFixtureOnly(page);
      await expectSettled(page);
      await attachBrowserMetrics(page, count);
    });

    test("RC2 commands: arrows and Home/End select enabled commands; busy Enter cannot run", async ({ page }) => {
      await boot(page, 100);
      const trigger = page.locator(".command-trigger");
      await trigger.click();
      const dialog = palette(page);
      const search = dialog.getByLabel("Поиск команды", { exact: true });
      await expect(search).toBeFocused();
      const enabled = dialog.locator(".command-row:not(:disabled)");
      await search.press("ArrowDown");
      await expect(enabled.first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(enabled.last()).toBeFocused();
      await page.keyboard.press("Home");
      await expect(enabled.first()).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(search).toBeFocused();
      await search.press("ArrowUp");
      await expect(enabled.last()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await page.evaluate(() => { window.kvesserInteractions.holdRefresh = true; });
      try {
        await trigger.click();
        await search.fill("Обновить все лимиты");
        await search.press("Enter");
        await expect.poll(() => page.evaluate(() => window.egoistFixture.calls.refreshAllAccounts ?? 0)).toBe(1);
        await trigger.click();
        await search.fill("Открыть обзор");
        await expect(dialog.locator(".command-row")).toHaveCount(1);
        await expect(dialog.locator(".command-row")).toBeDisabled();
        await search.press("Enter");
        await expect(dialog).toBeVisible();
        await expect(navigation(page).locator('[aria-current="page"]')).toHaveAttribute("aria-label", "Профили");
        expect(await page.evaluate(() => window.egoistFixture.calls.refreshAllAccounts)).toBe(1);
      } finally {
        await page.evaluate(() => window.kvesserInteractions.releaseRefresh());
      }
      await expect(dialog.locator(".command-row")).toBeEnabled();
      await search.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(navigation(page).locator('[aria-current="page"]')).toHaveAttribute("aria-label", "Обзор");
      await expectFixtureOnly(page);
    });

    test("RC2 motion: hiding or reduced motion cancels in-flight transitions and skips replacements", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await boot(page, 100);
      await expectSettled(page);
      const running = await page.evaluate(async () => {
        document.querySelector<HTMLButtonElement>('.rail-nav button[aria-label="Настройки"]')!.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return window.kvesserInteractions.animationState().running;
      });
      expect(running, "The test must interrupt an actual WAAPI transition").toBeGreaterThan(0);
      await page.evaluate(() => window.kvesserInteractions.setHidden(true));
      await expect(page.locator("html")).toHaveAttribute("data-motion-paused", "true");
      await expect.poll(() => page.evaluate(() => window.kvesserInteractions.animationState().running)).toBe(0);
      const beforeHidden = await page.evaluate(() => window.kvesserInteractions.animationState().created);
      await reverseNavigation(page);
      expect(await page.evaluate(() => window.kvesserInteractions.animationState().created)).toBe(beforeHidden);
      await page.evaluate(() => window.kvesserInteractions.setHidden(false));
      await expect(page.locator("html")).not.toHaveAttribute("data-motion-paused", "true");
      await page.evaluate(async () => {
        document.querySelector<HTMLButtonElement>('.rail-nav button[aria-label="Обзор"]')!.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(() => page.evaluate(() => window.kvesserInteractions.animationState().documentRunning)).toBe(0);
      const beforeReduced = await page.evaluate(() => window.kvesserInteractions.animationState().created);
      await reverseNavigation(page);
      await rows(page).first().focus();
      await page.keyboard.press("Enter");
      await expect(inspector(page)).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.kvesserInteractions.animationState().documentRunning)).toBe(0);
      expect(await page.evaluate(() => window.kvesserInteractions.animationState().created)).toBe(beforeReduced);
      await page.keyboard.press("Escape");
      await expect(rows(page).first()).toBeFocused();
      await expectSettled(page);
      await expectFixtureOnly(page);
    });

    test("RC2 progress: phase data controls percentages; elapsed time cannot complete a task", async ({ page }) => {
      await boot(page, 100);
      await page.clock.install();
      const emit = async (value: number, status: string) => page.evaluate(({ value, status }) => {
        window.kvesserInteractions.emitNotice({ key: "rc2-phase", title: "Проверка профиля", body: "Синтетическое событие без доступа к провайдеру", tone: "progress", silent: true, timeoutType: "never", createdAt: Date.now(), progress: { value, label: "Подготовка профиля", status } });
      }, { value, status });
      await emit(.25, "Подготовка");
      const progress = page.getByRole("progressbar", { name: "Подготовка профиля", exact: true });
      await expect(progress).toHaveAttribute("aria-valuenow", "25");
      await expect(progress).toContainText("Подготовка");
      await expect(progress.locator("em")).toHaveCSS("animation-name", "none");
      await expect(progress).toHaveCSS("animation-name", "none");
      expect(await progress.locator("em").evaluate((node) => (node as HTMLElement).style.width)).toBe("25%");
      await page.clock.fastForward(9_000);
      await expect(progress).toHaveAttribute("aria-valuenow", "25");
      expect(await progress.locator("em").evaluate((node) => (node as HTMLElement).style.width)).toBe("25%");
      await emit(.85, "Проверка runtime");
      await expect(progress).toHaveCount(1);
      await expect(progress).toHaveAttribute("aria-valuenow", "85");
      await expect(progress).toContainText("Проверка runtime");
      await page.clock.fastForward(9_000);
      await expect(progress).toHaveAttribute("aria-valuenow", "85");
      await emit(1, "Завершено по событию");
      await expect(progress).toHaveAttribute("aria-valuenow", "100");
      await expect(progress).toContainText("Завершено по событию");
      await expectFixtureOnly(page);
    });
  });
}
