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
  const brandLayout = await page.locator(".rail-brand").evaluate((brand) => {
    const title = brand.querySelector("h1");
    const meta = brand.querySelector(".rail-brand-meta");
    if (!title || !meta) return null;
    const titleRect = title.getBoundingClientRect();
    const metaRect = meta.getBoundingClientRect();
    return {
      title: title.textContent,
      fitsWidth: title.scrollWidth <= title.clientWidth + 1,
      insideMeta: titleRect.left >= metaRect.left - 1 && titleRect.right <= metaRect.right + 1
    };
  });
  expect(brandLayout).toEqual({ title: "Egoist Account Manager", fitsWidth: true, insideMeta: true });
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
    await page.evaluate(() => {
      const profiles = [
        ["atlas", "atlas@example.com", "Pro X20", 92, 78],
        ["nova", "nova@example.com", "Pro X5", 81, 64],
        ["forge", "forge@example.com", "Pro", 74, 58],
        ["lumen", "lumen@example.com", "Plus", 68, 51],
        ["orbit", "orbit@example.com", "Plus", 57, 44],
        ["pulse", "pulse@example.com", "Go", 49, 37],
        ["vertex", "vertex@example.com", "Plus", 35, 29],
        ["ember", "ember@example.com", "Pro", 24, 18],
        ["reserve", "reserve@example.com", "Plus", 12, 8]
      ] as const;
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".profile-grid .profile-card")).slice(0, profiles.length);
      cards.forEach((card, index) => {
        const [label, email, plan, first, second] = profiles[index];
        const labelNode = card.querySelector<HTMLElement>(".account-label");
        const emailNode = card.querySelector<HTMLElement>(".email");
        const planNode = card.querySelector<HTMLElement>(".plan-badge span:last-child");
        if (labelNode) labelNode.textContent = label;
        if (emailNode) emailNode.textContent = email;
        if (planNode) planNode.textContent = plan;
        const values = card.querySelectorAll<HTMLElement>(".limit-line strong");
        const bars = card.querySelectorAll<HTMLElement>(".limit-meter .bar span");
        if (values[0]) values[0].textContent = `${first}%`;
        if (values[1]) values[1].textContent = `${second}%`;
        if (bars[0]) bars[0].style.width = `${first}%`;
        if (bars[1]) bars[1].style.width = `${second}%`;
      });
      const count = document.querySelector<HTMLElement>(".account-panel-intro .badge.compact");
      const summary = document.querySelector<HTMLElement>(".account-panel-intro p");
      const railCount = document.querySelector<HTMLElement>(".platform-tile.codex strong");
      if (count) count.textContent = String(profiles.length);
      if (summary) summary.textContent = "9 с сохранённым входом · 2 требуют внимания";
      if (railCount) railCount.textContent = String(profiles.length);
    });
    await page.screenshot({ path: testInfo.outputPath("accounts-3x3.png"), fullPage: true });
  }

  const overflowLayout = await page.evaluate(() => {
    const grid = document.querySelector(".profile-grid");
    const main = document.querySelector(".profile-main");
    const originals = grid ? Array.from(grid.querySelectorAll(".profile-card")) : [];
    if (!grid || !main || originals.length === 0) return null;
    for (let index = originals.length; index < 12; index += 1) {
      const clone = originals[index % originals.length].cloneNode(true) as HTMLElement;
      clone.setAttribute("data-layout-clone", String(index));
      grid.appendChild(clone);
    }
    main.scrollTop = main.scrollHeight;
    return {
      count: grid.querySelectorAll(".profile-card").length,
      scrollable: main.scrollHeight > main.clientHeight,
      reachedBottom: main.scrollTop > 0 && Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop) <= 1,
      horizontalOverflow: Math.max(0, main.scrollWidth - main.clientWidth)
    };
  });
  expect(overflowLayout).toEqual({ count: 12, scrollable: true, reachedBottom: true, horizontalOverflow: 0 });

  await page.locator('[data-layout-clone]').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await expect(page.locator(".panel-title-row .badge.compact")).not.toContainText("/");
  await page.getByRole("button", { name: "Список" }).click();
  await expect(page.locator(".account-compact-row")).toHaveCount(2);
  await expect(page.locator(".account-compact-row").first().getByText("вход сохранён")).toBeVisible();
  const accountAction = page.locator(".account-compact-row").filter({ has: page.getByRole("button", { name: "Переключить" }) }).getByRole("button", { name: "Переключить" }).first();
  await expect(accountAction).toBeVisible();
  await expect(accountAction).toBeEnabled();
  expect(await accountAction.evaluate((button) => getComputedStyle(button).cursor)).toBe("pointer");
  await page.getByLabel("Сортировка аккаунтов").selectOption("subscription");
  expect(await page.evaluate(() => window.localStorage.getItem("cam.accountSort"))).toBe("subscription");
  await page.getByLabel("Импорт и экспорт").click();
  await page.getByRole("button", { name: "Импорт", exact: true }).click();
  const importDialog = page.getByRole("dialog", { name: "Импорт аккаунтов" });
  await expect(importDialog.getByLabel("Пароль импорта")).toBeVisible();
  await importDialog.getByRole("button", { name: "Отмена" }).click();
  if (process.env.CAM_CAPTURE_VISUALS === "1") {
    await page.screenshot({ path: testInfo.outputPath("accounts-list.png"), fullPage: true });
  }
  await page.getByRole("button", { name: "Карточки" }).click();
  await expect(page.locator(".profile-card")).toHaveCount(2);
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

  await nav.getByText("Настройки", { exact: true }).click();
  const settingsSurface = await page.evaluate(() => {
    const content = document.querySelector(".content-settings");
    const pageNode = document.querySelector(".settings-v303");
    if (!content || !pageNode) return null;
    return {
      horizontalOverflow: Math.max(0, content.scrollWidth - content.clientWidth),
      overflowY: getComputedStyle(content).overflowY,
      topInside: pageNode.getBoundingClientRect().top >= content.getBoundingClientRect().top - 1
    };
  });
  expect(settingsSurface).toEqual({ horizontalOverflow: 0, overflowY: "auto", topInside: true });
  if (process.env.CAM_CAPTURE_VISUALS === "1") {
    await page.screenshot({ path: testInfo.outputPath("settings.png"), fullPage: true });
  }
});
