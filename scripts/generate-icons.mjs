import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectDir = path.resolve(import.meta.dirname, "..");
const sourcePng = path.join(projectDir, "assets", "icon-3.0.6.png");
const outputPng = path.join(projectDir, "assets", "icon.png");
const outputIco = path.join(projectDir, "assets", "icon.ico");
const buildIco = path.join(projectDir, "build", "icon.ico");

const pythonScript = `
import os
from PIL import Image

src = r"${sourcePng.replace(/\\/g, "\\\\")}"
out_png = r"${outputPng.replace(/\\/g, "\\\\")}"
out_ico = r"${outputIco.replace(/\\/g, "\\\\")}"
build_ico = r"${buildIco.replace(/\\/g, "\\\\")}"

img = Image.open(src).convert('RGBA')
icon_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
icon_512.save(out_png, 'PNG', optimize=True)

ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
img.save(out_ico, format='ICO', sizes=ico_sizes)
img.save(build_ico, format='ICO', sizes=ico_sizes)
print('Pillow icon generation complete')
`;

const res = spawnSync("uv", ["run", "--with", "pillow", "python", "-c", pythonScript], {
  cwd: projectDir,
  encoding: "utf8",
  windowsHide: true
});

if (res.error || res.status !== 0) {
  throw new Error(res.error?.message ?? res.stderr.trim() ?? `Icon build failed with status ${res.status}`);
}

for (const destination of [
  path.join(projectDir, "assets", "logo.png"),
  path.join(projectDir, "public", "logo.png"),
  path.join(projectDir, "src", "renderer", "assets", "app-avatar-mark.png"),
  path.join(projectDir, "src", "renderer", "assets", "logo.png")
]) {
  fs.copyFileSync(outputPng, destination);
}

console.log(`Generated application icons from master ${path.relative(projectDir, sourcePng)}.`);

