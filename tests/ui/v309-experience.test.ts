import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(path.resolve("src/renderer/App.tsx"), "utf8");
const overviewSource = fs.readFileSync(path.resolve("src/renderer/components/v3/OverviewPage.tsx"), "utf8");
const styles = fs.readFileSync(path.resolve("src/renderer/v309.css"), "utf8");

describe("3.0.9 continuation and notification experience", () => {
  it("replaces the ambiguous reserve with a truthful continuation route", () => {
    expect(overviewSource).toContain("ПЛАН ПРОДОЛЖЕНИЯ");
    expect(overviewSource).toContain("rankSwitchCandidates");
    expect(overviewSource).not.toContain("УМНЫЙ РЕЗЕРВ");
    expect(overviewSource).toContain('candidate.remainingPercent === null ? "—"');
    expect(styles).toContain(".handoff-lane");
    expect(styles).toContain(".continuation-queue");
  });

  it("separates quota titles, values and reset details", () => {
    expect(overviewSource).toContain('className="quota-card-head"');
    expect(overviewSource).toContain('className="quota-card-visual"');
    expect(overviewSource).toContain('className="quota-meter"');
    expect(styles).toMatch(/\.quota-card-visual\s*\{[\s\S]*?grid-template-columns:\s*68px minmax\(0, 1fr\)/);
  });

  it("shows an accessible branded three-stage in-app notice", () => {
    expect(appSource).toContain("buildSwitchProcessNotice");
    expect(appSource).toContain('className={`process-notice is-${processNotice.tone}`}');
    expect(appSource).toContain("ПЕРЕЗАПУСК · 2 ИЗ 3");
    expect(styles).toContain(".process-notice-progress");
  });
});
