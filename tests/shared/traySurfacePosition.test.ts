import { describe, expect, it } from "vitest";
import { calculateTraySurfacePosition } from "../../src/shared/traySurfacePosition";

const popup = { width: 252, height: 144 };

describe("tray surface positioning", () => {
  it.each([
    ["bottom", { x: 1870, y: 1040, width: 24, height: 24 }, { x: 0, y: 0, width: 1920, height: 1040 }, { x: 1642, y: 886 }],
    ["top", { x: 1870, y: 0, width: 24, height: 24 }, { x: 0, y: 40, width: 1920, height: 1040 }, { x: 1642, y: 48 }],
    ["left", { x: 0, y: 980, width: 24, height: 24 }, { x: 40, y: 0, width: 1880, height: 1080 }, { x: 48, y: 860 }],
    ["right", { x: 1880, y: 980, width: 40, height: 24 }, { x: 0, y: 0, width: 1880, height: 1080 }, { x: 1618, y: 860 }]
  ])("keeps the hover surface inside a %s taskbar work area", (_edge, tray, workArea, expected) => {
    expect(calculateTraySurfacePosition(tray, popup, workArea)).toEqual(expected);
  });

  it("clamps correctly on a negative-coordinate secondary display", () => {
    const point = calculateTraySurfacePosition(
      { x: -48, y: 1040, width: 24, height: 24 },
      popup,
      { x: -1920, y: 0, width: 1920, height: 1040 }
    );
    expect(point.x).toBeGreaterThanOrEqual(-1912);
    expect(point.x + popup.width).toBeLessThanOrEqual(-8);
    expect(point.y).toBe(886);
  });
});
