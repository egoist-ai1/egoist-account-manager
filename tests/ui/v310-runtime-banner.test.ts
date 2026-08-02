import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/renderer/App.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "src/renderer/v310.css"), "utf8");

describe("3.0.10 compact runtime failure state", () => {
  it("keeps optional banners outside the flexible page row", () => {
    expect(styles).toContain(".app-frame {\n  display: flex;");
    expect(styles).toContain(".app-frame > .runtime-state-banner { flex: 0 0 auto; }");
    expect(styles).toContain(".app-frame > .content");
    expect(styles).toContain("flex: 1 1 auto;");
  });

  it("does not expose raw desktop errors in the visible banner", () => {
    expect(appSource).not.toContain("<code title={loadError}>{loadError}</code>");
    expect(appSource).toContain('className="runtime-state-actions"');
    expect(appSource).toContain("openLogsFolder()");
  });
});
