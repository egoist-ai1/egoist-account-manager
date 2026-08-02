import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(path.resolve("src/renderer/App.tsx"), "utf8");
const overviewSource = fs.readFileSync(path.resolve("src/renderer/components/v3/OverviewPage.tsx"), "utf8");
const styles = fs.readFileSync(path.resolve("src/renderer/v309.css"), "utf8");
const mainSource = fs.readFileSync(path.resolve("src/main/main.ts"), "utf8");

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

  it("shows an accessible queued in-app notice without Windows toast", () => {
    expect(appSource).toContain("onAppNotification");
    expect(appSource).toContain('className={`process-notice is-${notice.tone}`}');
    expect(appSource).toContain("playNotificationSound");
    expect(appSource).toContain('aria-live={notice.tone === "error" ? "assertive" : "polite"}');
    expect(styles).toContain(".process-notice-progress");
    expect(styles).toContain(".process-notice-stack");
    expect(mainSource).not.toContain("new Notification(");
    expect(mainSource).not.toContain("toastXml");
  });
});
