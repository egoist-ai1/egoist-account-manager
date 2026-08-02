const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage } = require("electron");

const samples = ["0", "1", "9", "10", "25", "64", "99", "100", "—", "~", "!"];

app.whenReady().then(async () => {
  const { LIVE_TRAY_REPRESENTATIONS, renderLiveTrayBitmap } = await import("../dist/shared/liveTray.js");
  const outputDir = path.join(process.cwd(), "test-results", "live-tray-native");
  fs.mkdirSync(outputDir, { recursive: true });
  const results = samples.map((label) => {
    const numeric = /^\d+$/.test(label) ? Number(label) : null;
    const state = label === "!"
      ? "error"
      : label === "~"
        ? "stale"
        : label === "—"
          ? "unknown"
          : numeric !== null && numeric <= 10
            ? "critical"
            : "fresh";
    const snapshot = {
      state,
      accountId: "fixture",
      accountLabel: "Fixture",
      remainingPercent: numeric,
      fiveHourRemaining: numeric,
      weeklyRemaining: numeric,
      activeWindowType: "weekly",
      activeWindowResetAt: null,
      iconText: label,
      tooltip: "Fixture",
      updatedAt: 1
    };
    const image = nativeImage.createEmpty();
    const representations = LIVE_TRAY_REPRESENTATIONS.map((representation) => {
      const bitmap = Buffer.from(renderLiveTrayBitmap(snapshot, representation.pixelSize));
      image.addRepresentation({
        width: representation.pixelSize,
        height: representation.pixelSize,
        scaleFactor: representation.scaleFactor,
        buffer: bitmap
      });
      const preview = nativeImage.createFromBitmap(bitmap, {
        width: representation.pixelSize,
        height: representation.pixelSize,
        scaleFactor: 1
      }).toPNG();
      fs.writeFileSync(path.join(outputDir, `${label === "—" ? "unknown" : label}-${representation.pixelSize}px.png`), preview);
      return { ...representation, pngBytes: preview.length };
    });
    return { label, empty: image.isEmpty(), size: image.getSize(), scaleFactors: image.getScaleFactors(), representations };
  });
  const expectedScales = LIVE_TRAY_REPRESENTATIONS.map((representation) => representation.scaleFactor);
  const passed = results.every((item) =>
    !item.empty
    && item.size.width === 16
    && item.size.height === 16
    && expectedScales.every((scale) => item.scaleFactors.includes(scale))
    && item.representations.every((representation) => representation.pngBytes > 100)
  );
  process.stdout.write(`${JSON.stringify({ passed, results }, null, 2)}\n`);
  app.exit(passed ? 0 : 1);
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
