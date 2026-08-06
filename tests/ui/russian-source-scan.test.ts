import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rendererDir = path.resolve("src/renderer");
const forbidden = [
  ">Settings<",
  ">Health<",
  ">Accounts<",
  ">Export<",
  ">Import<",
  ">Delete<",
  ">Refresh<",
  ">Switch<",
  ">Console<",
  ">Vault<",
  ">Limits<",
  ">Table<",
  ">Cards<",
  ">Device Login<",
  ">Auth Import<",
  ">Reauth Selected<",
  ">Profile Vault<",
  ">Device code<",
  "OAuth without browser coupling",
  "Attach existing `auth.json`",
  "No profile selected",
  "control surface",
  "selected profile",
  ">active<"
];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return entry.name.endsWith(".tsx") || entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("renderer source Russian UI", () => {
  it("does not contain common English user-facing labels", () => {
    const hits = files(rendererDir).filter((file) => !file.includes(`${path.sep}i18n${path.sep}`)).flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return forbidden.filter((word) => text.includes(word)).map((word) => `${file}: ${word}`);
    });

    expect(hits).toEqual([]);
  });

  it("contains auth validation actions in the account inspector", () => {
    const appSource = fs.readFileSync(path.join(rendererDir, "App.tsx"), "utf8");

    expect(appSource).toContain("Проверить вход");
    expect(appSource).toContain("Статус входа");
  });

  it("does not render provider quota source strip in the account inspector", () => {
    const appSource = fs.readFileSync(path.join(rendererDir, "App.tsx"), "utf8");

    expect(appSource).not.toContain("Источник лимитов");
    expect(appSource).not.toContain("quota-source-strip");
  });

  it("does not render compact quota source badges in account rows and cards", () => {
    const appSource = fs.readFileSync(path.join(rendererDir, "App.tsx"), "utf8");
    const styles = fs.readFileSync(path.join(rendererDir, "styles.css"), "utf8");

    expect(appSource).not.toContain("QuotaSourceChip");
    expect(appSource).not.toContain("quotaSourceShortLabel");
    expect(styles).not.toContain("quota-source-chip");
  });

  it("does not collapse the side rail into a wide top drawer at the desktop minimum width", () => {
    const styles = fs.readFileSync(path.join(rendererDir, "styles.css"), "utf8");

    expect(styles).not.toContain("width: 100%;\r\n    height: auto;\r\n    grid-template-rows: auto;\r\n    grid-template-columns: 1fr;");
    expect(styles).not.toContain("width: 100%;\n    height: auto;\n    grid-template-rows: auto;\n    grid-template-columns: 1fr;");
    expect(styles).not.toContain("grid-auto-flow: column;");
  });

  it("keeps account quota, status, and selected-profile surfaces compact", () => {
    const appSource = fs.readFileSync(path.join(rendererDir, "App.tsx"), "utf8");
    const styles = fs.readFileSync(path.join(rendererDir, "styles.css"), "utf8");
    const releaseStyles = fs.readFileSync(path.join(rendererDir, "v308.css"), "utf8");
    const polishStyles = fs.readFileSync(path.join(rendererDir, "v310.css"), "utf8");

    expect(appSource).toContain("account-compact-state");
    expect(appSource).toContain("account-compact-quota");
    expect(appSource).toContain("inspector-meta-line");
    expect(appSource).toContain("inspector-profile-row");
    expect(appSource).toContain("inspector-meta-chips");
    expect(appSource).toContain("antigravity-compact-details");
    expect(appSource).toContain("inspector-action-grid");
    expect(appSource).toContain("inspector-limit-grid");
    expect(appSource).toContain("tag-more");
    expect(appSource).not.toContain("quota-source-strip");
    expect(appSource).not.toContain("authValidationTone(authState)");
    expect(styles).toContain(".limit-meter {\n  border: 0;");
    expect(styles).toContain(".limit-meter small {\n  white-space: nowrap;");
    expect(polishStyles).toContain(".account-compact-state {\n  display: flex;");
    expect(polishStyles).toContain(".account-compact-quota {\n  display: grid;");
    expect(styles).toContain(".inspector-profile-row {\n  display: grid;");
    expect(styles).toContain(".inspector-meta-chips {\n  display: flex;");
    expect(styles).toContain(".inspector-meta-chip {\n  display: inline-flex;");
    expect(styles).toContain(".antigravity-compact-details {\n  display: grid;");
    expect(releaseStyles).toContain(".profile-details-dialog .inspector-action-grid {\n  display: grid;");
    expect(releaseStyles).toContain(".profile-details-dialog .inspector-limit-grid {\n  display: grid;");
  });

  it("uses platform logos and hierarchical plan badges in account surfaces", () => {
    const appSource = fs.readFileSync(path.join(rendererDir, "App.tsx"), "utf8");
    const styles = fs.readFileSync(path.join(rendererDir, "styles.css"), "utf8");

    expect(appSource).toContain("AccountPlatformMark");
    expect(appSource).toContain("PlanBadge");
    expect(appSource).toContain('if (key === "pro")');
    expect(appSource).not.toContain('key.includes("20") || key === "pro"');
    expect(appSource).not.toContain("function PlatformBadge");
    expect(styles).toContain(".platform-mark");
    expect(styles).toContain(".plan-free");
    expect(styles).toContain(".plan-go");
    expect(styles).toContain(".plan-plus");
    expect(styles).toContain(".plan-team");
    expect(styles).toContain(".plan-pro");
    expect(styles).toContain(".plan-pro10");
    expect(styles).toContain(".plan-pro20");
  });
});
