const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage } = require("electron");

const outputDir = process.env.CAM_TRAY_TEST_OUTPUT || path.join(process.cwd(), "test-results", "live-tray-native");
const userDataDir = process.env.CAM_USER_DATA_DIR || path.join(outputDir, "electron-user-data");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const samples = ["0", "<1", "1", "9", "10", "20", "25", "64", "66", "99", "100", "—", "~", "!"];
const themes = ["dark", "light"];

app.whenReady().then(async () => {
  const { LIVE_TRAY_REPRESENTATIONS, renderLiveTrayBitmap } = await import("../dist/shared/liveTray.js");
  fs.mkdirSync(outputDir, { recursive: true });
  const results = themes.flatMap((theme) => samples.map((label) => {
    const numeric = label === "<1" ? 0.5 : /^\d+$/.test(label) ? Number(label) : null;
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
      const bitmap = Buffer.from(renderLiveTrayBitmap(snapshot, representation.pixelSize, "codex", theme));
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
      const fileLabel = label === "—" ? "unknown" : label === "<1" ? "under-one" : label;
      fs.writeFileSync(path.join(outputDir, `${theme}-${fileLabel}-${representation.pixelSize}px.png`), preview);
      const decoded = nativeImage.createFromBuffer(preview).toBitmap();
      const hasTransparentPixels = decoded.some((alpha, index) => index % 4 === 3 && alpha === 0);
      const hasAntialiasedPixels = decoded.some((alpha, index) => index % 4 === 3 && alpha > 0 && alpha < 255);
      return { ...representation, pngBytes: preview.length, hasTransparentPixels, hasAntialiasedPixels };
    });
    return { label, theme, empty: image.isEmpty(), size: image.getSize(), scaleFactors: image.getScaleFactors(), representations };
  }));
  const expectedScales = LIVE_TRAY_REPRESENTATIONS.map((representation) => representation.scaleFactor);
  const passed = results.every((item) =>
    !item.empty
    && item.size.width === 16
    && item.size.height === 16
    && expectedScales.every((scale) => item.scaleFactors.includes(scale))
    && item.representations.every((representation) => representation.hasTransparentPixels && representation.hasAntialiasedPixels)
  );
  process.stdout.write(`${JSON.stringify({ passed, results }, null, 2)}\n`);
  app.exit(passed ? 0 : 1);
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
