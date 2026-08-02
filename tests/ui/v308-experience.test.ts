import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(path.resolve("src/renderer/App.tsx"), "utf8");
const activitySource = fs.readFileSync(path.resolve("src/renderer/components/v3/ActivityPage.tsx"), "utf8");
const overviewSource = fs.readFileSync(path.resolve("src/renderer/components/v3/OverviewPage.tsx"), "utf8");
const styles = fs.readFileSync(path.resolve("src/renderer/v308.css"), "utf8");

describe("3.0.8 authorization and control-room experience", () => {
  it("offers an explicit copy action and a typed device-code handoff", () => {
    expect(appSource).toContain("Скопировать код устройства");
    expect(appSource).toContain("onCopyDeviceCode");
    expect(appSource).toContain("onOpenDeviceLogin");
    expect(styles).toMatch(/\.device-code-panel\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
  });

  it("keeps repair as a compact key action without a clipped text label", () => {
    expect(appSource).toContain('className={`icon-btn ${needsRepair ? "repair-action" : ""}`}');
    expect(appSource).not.toContain('<span>Починить</span>');
    expect(styles).toContain("grid-template-columns: 34px 34px 34px minmax(116px, 1fr)");
  });

  it("shows every profile action without a hidden additional-actions disclosure", () => {
    expect(appSource).toContain('className="inspector-action-grid"');
    expect(appSource).toContain("Все действия доступны сразу");
    expect(appSource).not.toContain('<details className="inspector-more">');
    expect(styles).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
  });

  it("explains all four switch safety stages without connector lines", () => {
    expect(activitySource).toContain("Четыре этапа не дают Codex запуститься");
    expect(activitySource).toContain("Резервная копия и замена auth");
    expect(activitySource).toContain('<div className="switch-stage-copy">');
    expect(activitySource).not.toContain('<span className="switch-stage-copy">');
    expect(styles).toMatch(/\.switch-stage::before,[\s\S]*?display:\s*none;/);
  });

  it("fills the overview with reserve and readiness information", () => {
    expect(overviewSource).toContain("continuation-queue");
    expect(overviewSource).toContain("overview-operation-signals");
    expect(overviewSource).toContain("Ближайший сброс");
    expect(styles).toContain("grid-template-rows: auto auto minmax(250px, 1fr)");
  });
});
