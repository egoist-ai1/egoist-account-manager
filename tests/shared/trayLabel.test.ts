import { describe, expect, it } from "vitest";
import { buildTrayAccountLabel } from "../../src/shared/trayLabel";

describe("trayLabel", () => {
  it("keeps the full email visible when privacy mode is off", () => {
    const label = buildTrayAccountLabel({
      label: "основной",
      email: "primary@example.com",
      isActive: true
    }, false);

    expect(label).toBe("✓ основной · primary@example.com");
  });

  it("masks email in the tray account picker when privacy mode is on", () => {
    const label = buildTrayAccountLabel({
      label: "резерв",
      email: "backup@example.com",
      isActive: false
    }, true);

    expect(label).toBe("резерв · ba****@example.com");
    expect(label).not.toContain("backup@example.com");
  });
});
