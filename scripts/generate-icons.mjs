import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pngToIco from "png-to-ico";

const projectDir = path.resolve(import.meta.dirname, "..");
const sourcePng = path.join(projectDir, "assets", "icon-3.0.6.png");
const outputPng = path.join(projectDir, "assets", "icon.png");
const outputIco = path.join(projectDir, "assets", "icon.ico");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-icon-"));
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

try {
  const pngPaths = sizes.map((size) => {
    const output = path.join(tempDir, `icon-${size}.png`);
    const render = spawnSync("magick.exe", [
      "-background", "none",
      sourcePng,
      "-filter", "LanczosSharp",
      "-resize", `${size}x${size}`,
      "-strip",
      `PNG32:${output}`
    ], { encoding: "utf8", windowsHide: true });
    if (render.error || render.status !== 0) {
      throw new Error(render.error?.message ?? render.stderr.trim() ?? `ImageMagick exited with ${render.status}`);
    }
    return output;
  });

  fs.copyFileSync(pngPaths.at(-1), outputPng);
  fs.writeFileSync(outputIco, await pngToIco(pngPaths.filter((file) => !file.endsWith("512.png") && !file.endsWith("1024.png"))));

  for (const destination of [
    path.join(projectDir, "assets", "logo.png"),
    path.join(projectDir, "public", "logo.png"),
    path.join(projectDir, "src", "renderer", "assets", "app-avatar-mark.png"),
    path.join(projectDir, "src", "renderer", "assets", "logo.png")
  ]) {
    fs.copyFileSync(outputPng, destination);
  }

  console.log(`Generated application icons from ImageGen master ${path.relative(projectDir, sourcePng)}.`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
