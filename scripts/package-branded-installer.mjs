import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));

console.log(`\n======================================================`);
console.log(`Packaging Branded Modern Installer for ${pkg.productName} v${pkg.version}`);
console.log(`======================================================\n`);

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const wpfLib = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF';
const modernInstallerCs = path.resolve('src/installer/ModernInstaller.cs');
const modernInstallerManifest = path.resolve('src/installer/ModernInstaller.manifest');
const modernInstallerExe = path.resolve('src/installer/ModernInstaller.exe');
const brandIcon = path.resolve('assets/icon.ico');
const fontPath = path.resolve('assets/Unbounded.ttf');

console.log('1. Compiling ModernInstaller.exe (WPF C#)...');
const cscResult = spawnSync(csc, [
  '/nologo',
  '/t:winexe',
  `/win32icon:${brandIcon}`,
  `/win32manifest:${modernInstallerManifest}`,
  `/lib:${wpfLib}`,
  '/r:PresentationFramework.dll',
  '/r:PresentationCore.dll',
  '/r:WindowsBase.dll',
  '/r:System.dll',
  '/r:System.Xaml.dll',
  '/r:System.Windows.Forms.dll',
  '/r:System.Drawing.dll',
  `/out:${modernInstallerExe}`,
  modernInstallerCs
], { encoding: 'utf8' });

if (cscResult.status !== 0) {
  throw new Error('Failed to compile ModernInstaller.exe:\n' + (cscResult.stderr || '') + (cscResult.stdout || ''));
}
console.log(`   OK: Compiled ${modernInstallerExe} (${(await fs.stat(modernInstallerExe)).size} bytes)`);

// Check unpacked payload
const payloadDir = path.resolve('release/win-unpacked');
try {
  await fs.access(path.join(payloadDir, 'Account Manager EGO.exe'));
} catch {
  console.log('2. Payload directory release/win-unpacked missing. Generating via electron-builder --dir...');
  spawnSync('pnpm', ['run', 'build:dir'], { stdio: 'inherit' });
}

console.log('2. Configuring NSIS engine...');
const makensis = process.env.MAKENSIS || path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe');
const pluginDir = process.env.NSIS_PLUGIN_DIR || path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis-resources-3.4.1/nsis-resources-3.4.1-2jx2y/plugins/x86-unicode');

await fs.access(makensis);
await fs.access(pluginDir);

const outputSetupExe = path.resolve('release', `Account-Manager-EGO-Setup-${pkg.version}.exe`);
const candidateSetupExe = path.resolve('release', `Account-Manager-EGO-Setup-${pkg.version}.building`);

await fs.rm(candidateSetupExe, { force: true });

console.log('3. Running NSIS solid LZMA compression...');
const nsisCode = await new Promise((resolve, reject) => {
  const child = spawn(makensis, [
    '/V2',
    `/DNSIS_PLUGIN_DIR=${pluginDir}`,
    `/DPRODUCT_VERSION=${pkg.version}`,
    `/DPAYLOAD=${payloadDir}`,
    `/DICON_PATH=${brandIcon}`,
    `/DMODERN_INSTALLER_EXE=${modernInstallerExe}`,
    `/DFONT_PATH=${fontPath}`,
    `/DOUTPUT=${candidateSetupExe}`,
    'src/installer/setup.nsi'
  ], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('close', resolve);
});

if (nsisCode !== 0) {
  throw new Error('NSIS build failed with exit code: ' + nsisCode);
}

await fs.rename(candidateSetupExe, outputSetupExe);
const setupStats = await fs.stat(outputSetupExe);
console.log(`\nSUCCESS: Branded Modern Installer created:`);
console.log(`  Path: ${outputSetupExe}`);
console.log(`  Size: ${setupStats.size.toLocaleString()} bytes`);

// Also check portable
const portableExe = path.resolve('release', `Account-Manager-EGO-${pkg.version}.exe`);
let portableSize = 0;
try {
  portableSize = (await fs.stat(portableExe)).size;
  console.log(`  Portable: ${portableExe} (${portableSize.toLocaleString()} bytes)`);
} catch {}

// Compute SHA256
async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const setupHash = await sha256(outputSetupExe);
console.log(`  SHA256: ${setupHash}`);

const checksumLines = [
  `${setupHash}  Account-Manager-EGO-Setup-${pkg.version}.exe`
];

if (portableSize > 0) {
  const portHash = await sha256(portableExe);
  checksumLines.push(`${portHash}  Account-Manager-EGO-${pkg.version}.exe`);
}

await fs.writeFile(`release/SHA256SUMS-${pkg.version}.txt`, checksumLines.join('\n') + '\n', 'utf8');
await fs.writeFile(`SHA256SUMS-${pkg.version}.txt`, checksumLines.join('\n') + '\n', 'utf8');
console.log(`\nChecksums updated in release/SHA256SUMS-${pkg.version}.txt\n`);
