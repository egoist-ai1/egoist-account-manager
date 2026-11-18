import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import pngToIco from "png-to-ico";

const root = path.resolve(import.meta.dirname, "..");
const source = await fs.readFile(path.join(root, "assets/brand/kvesser-mark.svg"), "utf8");
const browser = await chromium.launch({ channel: process.env.CAM_PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined), headless: true });
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const icons = [];
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${source}`);
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    const file = path.join(root, `assets/brand/kvesser-mark-${size}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    if (size <= 256) icons.push(file);
  }
} finally {
  await browser.close();
}
await fs.mkdir(path.join(root, "build"), { recursive: true });
// Small entries use DIB for native compatibility; large entries use PNG to
// avoid adding hundreds of kilobytes to every executable for the same mark.
const dib = await pngToIco(icons.filter((file) => /-(16|24|32|48|64)\.png$/.test(file)));
const entries = [];
for (let index = 0; index < dib.readUInt16LE(4); index++) {
  const entry = Buffer.from(dib.subarray(6 + index * 16, 22 + index * 16));
  const offset = entry.readUInt32LE(12);
  entries.push({ entry, bytes: dib.subarray(offset, offset + entry.readUInt32LE(8)) });
}
for (const size of [128, 256]) {
  const bytes = await fs.readFile(path.join(root, `assets/brand/kvesser-mark-${size}.png`));
  const entry = Buffer.alloc(16); entry[0] = entry[1] = size === 256 ? 0 : size;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(bytes.length, 8);
  entries.push({ entry, bytes });
}
const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = 6 + entries.length * 16;
for (const item of entries) { item.entry.writeUInt32LE(offset, 12); offset += item.bytes.length; }
const ico = Buffer.concat([header, ...entries.map((item) => item.entry), ...entries.map((item) => item.bytes)]);
for (const output of ["assets/icon.ico", "build/icon.ico"]) await fs.writeFile(path.join(root, output), ico);
for (const output of ["assets/icon.png", "assets/logo.png", "public/logo.png", "src/renderer/assets/app-avatar-mark.png", "src/renderer/assets/logo.png"]) {
  await fs.copyFile(path.join(root, "assets/brand/kvesser-mark-512.png"), path.join(root, output));
}
console.log("Kvesser SVG exported to 8 native sizes, multi-size ICO and application marks.");

