import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const exe = path.resolve(pkg.build.directories.output, 'win-unpacked', 'resources', 'KvesserQuotaWidget.exe');
const base = process.env.CAM_TEST_WORK_DIR ?? os.tmpdir();
if (!path.isAbsolute(base)) throw new Error('CAM_TEST_WORK_DIR must be an absolute path');
mkdirSync(base, { recursive: true });
const directory = mkdtempSync(path.join(base, 'kvesser-taskbar-check-'));
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function preview(dpi, codex, antigravity, theme, name) {
  const output = path.join(directory, name + '.png');
  const result = spawnSync(exe, ['--preview', output, String(dpi), codex, antigravity, theme], {
    windowsHide: true,
    timeout: 15_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Quota widget preview failed (${result.status})`);
  const png = readFileSync(output);
  if (png.length < 150 || !png.subarray(0, 8).equals(signature)) throw new Error('Invalid preview PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width < height * 1.8) throw new Error('Expected two horizontal quota groups');
  return { width, height, png };
}

try {
  const baseline = preview(96, '34%', '9%', 'dark', 'normal-critical');
  const threshold = preview(96, '34%', '10%', 'dark', 'normal-threshold');
  if (baseline.png.equals(threshold.png)) throw new Error('Threshold preview did not change');
  const missing = preview(120, '—', '<1%', 'light', 'missing-very-low');
  const scaled = preview(192, '34%', '9%', 'dark', 'scaled');
  if (scaled.width < baseline.width * 1.8 || scaled.height < baseline.height * 1.8) {
    throw new Error('Quota widget failed to scale at 200% DPI');
  }
  console.log(`Quota widget previews passed at 100%, 125% and 200% (${baseline.width}x${baseline.height}, ${missing.width}x${missing.height}, ${scaled.width}x${scaled.height})`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
