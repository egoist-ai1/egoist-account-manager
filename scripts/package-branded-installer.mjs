import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { verifyInstallerPayload, verifyExecutableMetadata } from './installer-payload.mjs';
import { finalizeReleaseArtifacts } from './finalize-release-artifacts.mjs';
import { createOwnershipManifest, windowsNumericVersion } from './installer-ownership.mjs';
import { resolveInstallerTools } from './installer-tools.mjs';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));

console.log(`Packaging ${pkg.productName} v${pkg.version}`);

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const wpfLib = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF';
const modernInstallerCs = path.resolve('src/installer/ModernInstaller.cs');
const modernInstallerManifest = path.resolve('src/installer/ModernInstaller.manifest');
const outputDirectory = path.resolve(pkg.build.directories.output);
const installerBuildDirectory = path.join(outputDirectory, 'installer-build');
await fs.mkdir(installerBuildDirectory, { recursive: true });
const numericVersion = windowsNumericVersion(pkg);
const generatedManifest = path.join(installerBuildDirectory, 'ModernInstaller.manifest');
await fs.writeFile(generatedManifest, (await fs.readFile(modernInstallerManifest, 'utf8')).replace(/(<assemblyIdentity version=")[^"]+/, `$1${numericVersion}`), 'utf8');
const modernInstallerExe = path.join(installerBuildDirectory, 'ModernInstaller.exe');
const ownershipSource = path.resolve('src/installer/InstallOwnership.cs');
const generatedAssemblyInfo = path.join(installerBuildDirectory, 'AssemblyInfo.cs');
await fs.writeFile(generatedAssemblyInfo, `[assembly: System.Reflection.AssemblyTitle("Квессер Setup")]\n[assembly: System.Reflection.AssemblyProduct("${pkg.productName}")]\n[assembly: System.Reflection.AssemblyVersion("${numericVersion}")]\n[assembly: System.Reflection.AssemblyFileVersion("${numericVersion}")]\n[assembly: System.Reflection.AssemblyInformationalVersion("${pkg.version}")]\n`, 'utf8');
const brandIcon = path.resolve('assets/icon.ico');
const brandPng = path.resolve('assets/icon.png');
const fontPath = path.resolve('assets/Unbounded.ttf');
const legacyOwnershipPath = path.resolve('assets/legacy/3.1.10-ownership.json');

console.log('1. Compiling ModernInstaller.exe (WPF C#)...');
const cscResult = spawnSync(csc, [
  '/nologo',
  '/codepage:65001',
  '/t:winexe',
  `/win32icon:${brandIcon}`,
  `/resource:${brandPng},EgoistBrand.png`,
  `/resource:${legacyOwnershipPath},Legacy311Payload.json`,
  `/win32manifest:${generatedManifest}`,
  `/lib:${wpfLib}`,
  '/r:PresentationFramework.dll',
  '/r:PresentationCore.dll',
  '/r:WindowsBase.dll',
  '/r:System.dll',
  '/r:System.Core.dll',
  '/r:System.Web.Extensions.dll',
  '/r:System.Xaml.dll',
  '/r:System.Windows.Forms.dll',
  '/r:System.Drawing.dll',
  `/out:${modernInstallerExe}`,
  modernInstallerCs, ownershipSource, generatedAssemblyInfo
], { encoding: 'utf8' });

if (cscResult.status !== 0) {
  throw new Error('Failed to compile ModernInstaller.exe:\n' + (cscResult.stderr || '') + (cscResult.stdout || ''));
}
console.log(`   OK: Compiled ${modernInstallerExe} (${(await fs.stat(modernInstallerExe)).size} bytes)`);

// A previous unpacked release must never be relabeled as the current version.
const payloadDir = path.join(outputDirectory, 'win-unpacked');
try {
  await verifyInstallerPayload(root, payloadDir, pkg);
} catch (error) {
  throw new Error('Installer payload verification failed. Run a successful build:dir before packaging.\n' + error.message, { cause: error });
}

const executableMetadataResult = spawnSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-Command',
  '$ErrorActionPreference = "Stop"; $version = (Get-Item -LiteralPath $env:CAM_PAYLOAD_EXE).VersionInfo; [ordered]@{productName=$version.ProductName;fileVersion=$version.FileVersion;productVersion=$version.ProductVersion} | ConvertTo-Json -Compress'
], {
  encoding: 'utf8',
  timeout: 15000,
  env: { ...process.env, CAM_PAYLOAD_EXE: path.join(payloadDir, `${pkg.productName}.exe`) }
});
if (executableMetadataResult.status !== 0) {
  throw new Error('Unable to verify payload executable metadata: ' + (executableMetadataResult.error?.message || executableMetadataResult.stderr));
}
verifyExecutableMetadata(JSON.parse(executableMetadataResult.stdout.replace(/^\uFEFF/, '').trim()), pkg);

console.log('2. Configuring NSIS engine...');
const nsisTools = await resolveInstallerTools(root, pkg);
const makensis = nsisTools.path;
const pluginDir = nsisTools.pluginDir;

await fs.access(makensis);
await fs.access(pluginDir);

const outputSetupExe = path.join(outputDirectory, `${pkg.productName}-Setup-${pkg.version}.exe`);
const candidateSetupExe = path.join(outputDirectory, `${pkg.productName}-Setup-${pkg.version}.building`);
const ownershipManifestPath = path.join(installerBuildDirectory, 'payload-ownership.json');
await fs.writeFile(ownershipManifestPath, JSON.stringify(await createOwnershipManifest(payloadDir, pkg), null, 2) + '\n', 'utf8');

await fs.rm(candidateSetupExe, { force: true });

console.log('3. Running NSIS solid LZMA compression...');
const nsisCode = await new Promise((resolve, reject) => {
  const child = spawn(makensis, [
    '/V2',
    '/INPUTCHARSET', 'UTF8',
    `/DNSIS_PLUGIN_DIR=${pluginDir}`,
    `/DPRODUCT_VERSION=${pkg.version}`,
    `/DNUMERIC_VERSION=${numericVersion}`,
    `/DOWNERSHIP_MANIFEST=${ownershipManifestPath}`,
    `/DPAYLOAD=${payloadDir}`,
    `/DICON_PATH=${brandIcon}`,
    `/DMODERN_INSTALLER_EXE=${modernInstallerExe}`,
    `/DFONT_PATH=${fontPath}`,
    `/DOUTPUT=${candidateSetupExe}`,
    'src/installer/setup.nsi'
  ], { stdio: 'inherit', env: nsisTools.env });
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
const portableExe = path.join(outputDirectory, `${pkg.productName}-${pkg.version}.exe`);
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
  `${setupHash}  ${pkg.productName}-Setup-${pkg.version}.exe`
];

if (portableSize > 0) {
  const portHash = await sha256(portableExe);
  checksumLines.push(`${portHash}  ${pkg.productName}-${pkg.version}.exe`);
}

await fs.writeFile(path.join(outputDirectory, `SHA256SUMS-${pkg.version}.txt`), checksumLines.join('\n') + '\n', 'utf8');
await fs.writeFile(`SHA256SUMS-${pkg.version}.txt`, checksumLines.join('\n') + '\n', 'utf8');
console.log(`\nChecksums updated in ${outputDirectory}/SHA256SUMS-${pkg.version}.txt\n`);

// The branded installer replaces electron-builder's setup; refresh all update metadata.
await finalizeReleaseArtifacts(root);
console.log('Final blockmap, latest.yml and complete checksum manifest verified.');
await fs.writeFile(path.join(installerBuildDirectory, 'ownership-receipt.json'), JSON.stringify({
  schemaVersion: 1,
  appId: pkg.build.appId,
  productName: pkg.productName,
  version: pkg.version,
  numericVersion,
  setupName: path.basename(outputSetupExe),
  setupSha256: setupHash,
  nsisSha256: await sha256(path.resolve('src/installer/setup.nsi')),
  helperSha256: await sha256(modernInstallerExe),
  ownershipSourceSha256: await sha256(ownershipSource),
  uiSourceSha256: await sha256(modernInstallerCs),
  legacyOwnershipSha256: await sha256(legacyOwnershipPath),
  testMode: 'manifest-owned-no-integration',
  recordedAt: new Date().toISOString()
}, null, 2) + '\n', 'utf8');
