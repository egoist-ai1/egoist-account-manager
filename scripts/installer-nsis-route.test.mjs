import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { createOwnershipManifest } from './installer-ownership.mjs';
import { resolveInstallerTools } from './installer-tools.mjs';
import { integrationDigest, nsisTestInvocation } from './verify-installer-owned.mjs';

const native = process.platform === 'win32';
const root = path.resolve(import.meta.dirname, '..');
const work = process.env.CAM_RELEASE_TEST_WORK;
let scratch; let setup; let environment; let integrationBefore; let relativeNative;
const pkg = { productName: 'Kvesser', version: '3.2.0-rc.2', build: { appId: 'one.egoist.codex-account-manager', buildVersion: '3.2.0.2' } };
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

before(async () => {
  if (!native) return;
  if (!work || !path.isAbsolute(work)) throw new Error('CAM_RELEASE_TEST_WORK must name this task isolated fixture directory');
  scratch = await fs.mkdtemp(path.join(work, 'nsis-h-'));
  const temp = path.join(scratch, 'temp');
  await fs.mkdir(temp);
  environment = { ...process.env, TEMP: temp, TMP: temp };
  integrationBefore = await integrationDigest();
  const payload = path.join(scratch, 'payload');
  await fs.mkdir(path.join(payload, 'resources'), { recursive: true });
  await fs.writeFile(path.join(payload, 'Kvesser.exe'), 'isolated fixture executable bytes, never launched');
  await fs.writeFile(path.join(payload, 'resources', 'app.asar'), 'isolated fixture ASAR bytes');
  // Exact 3.2.0 RC shipping relative path; fixture bytes never load a native module.
  relativeNative = "resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node";
  await fs.mkdir(path.dirname(path.join(payload, relativeNative)), { recursive: true });
  await fs.writeFile(path.join(payload, relativeNative), 'not a native module: byte/path fixture only');
  const ownership = path.join(scratch, 'payload-ownership.json');
  await fs.writeFile(ownership, JSON.stringify(await createOwnershipManifest(payload, pkg)));
  const helper = path.join(scratch, 'ModernInstaller.exe');
  const framework = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319');
  const compiled = spawnSync(path.join(framework, 'csc.exe'), [
    '/nologo', '/codepage:65001', '/t:winexe', `/lib:${path.join(framework, 'WPF')}`,
    '/r:PresentationFramework.dll', '/r:PresentationCore.dll', '/r:WindowsBase.dll',
    '/r:System.dll', '/r:System.Core.dll', '/r:System.Web.Extensions.dll', '/r:System.Xaml.dll',
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
    `/resource:${path.join(root, 'assets/icon.png')},EgoistBrand.png`, `/resource:${path.join(root, 'assets/legacy/3.1.10-ownership.json')},Legacy311Payload.json`, `/out:${helper}`,
    path.join(root, 'src/installer/ModernInstaller.cs'), path.join(root, 'src/installer/InstallOwnership.cs')
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const tools = await resolveInstallerTools(root, pkg);
  setup = path.join(scratch, 'Egoist-route-fixture.exe');
  const nsis = spawnSync(tools.path, [
    '/V2', '/INPUTCHARSET', 'UTF8', `/DNSIS_PLUGIN_DIR=${tools.pluginDir}`, `/DPRODUCT_VERSION=${pkg.version}`, '/DNUMERIC_VERSION=3.2.0.2',
    `/DOWNERSHIP_MANIFEST=${ownership}`, `/DPAYLOAD=${payload}`, `/DICON_PATH=${path.join(root, 'assets/icon.ico')}`,
    `/DMODERN_INSTALLER_EXE=${helper}`, `/DFONT_PATH=${path.join(root, 'assets/Unbounded.ttf')}`,
    `/DOUTPUT=${setup}`, path.join(root, 'src/installer/setup.nsi')
  ], { encoding: 'utf8', windowsHide: true, env: { ...tools.env, TEMP: temp, TMP: temp } });
  assert.equal(nsis.status, 0, nsis.stdout + nsis.stderr);
});

after(async () => {
  if (!scratch) return;
  assert.equal(await integrationDigest(), integrationBefore, 'Fixture changed host registry/shortcut integration');
  assert.ok(path.resolve(scratch).startsWith(path.resolve(work) + path.sep));
  assert.equal((await fs.lstat(scratch)).isSymbolicLink(), false);
  await fs.rm(scratch, { recursive: true, force: true });
});

function install(target) {
  const invocation = nsisTestInvocation(setup, target);
  return spawnSync(setup, invocation.args, { ...invocation.options, encoding: 'utf8', windowsHide: true, env: environment });
}
async function assertInstalled(target) {
  const manifest = JSON.parse(await fs.readFile(path.join(target, '.egoist-install.json'), 'utf8'));
  assert.equal(manifest.testMode, true);
  assert.equal(manifest.installRoot.toLowerCase(), target.toLowerCase());
  for (const entry of manifest.files) assert.equal(hash(await fs.readFile(path.join(target, entry.relativePath))), entry.sha256);
}

test('production NSIS source rejects /TEST without an explicit /D before writes', { skip: !native }, () => {
  const result = spawnSync(setup, ['/S', '/TEST'], { encoding: 'utf8', windowsHide: true, env: environment });
  assert.equal(result.status, 3);
});

test('production NSIS source preserves explicit /D instead of registry fallback', { skip: !native }, async () => {
  const target = path.join(scratch, 'Fresh');
  const result = install(target);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  await assertInstalled(target);
});

test('production NSIS source accepts Unicode spaces with native unquoted final /D', { skip: !native }, async () => {
  const target = path.join(scratch, 'Профили Egoist');
  const result = install(target);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  await assertInstalled(target);
});

test('actual shipping SQLite relative path installs under a 133-character root', { skip: !native }, async () => {
  const target = path.join(scratch, 'L'.repeat(133 - scratch.length - 1));
  assert.equal(target.length, 133);
  const destination = path.join(target, relativeNative);
  assert.ok(destination.length + '.egoist-'.length + 32 + '.tmp'.length >= 260, 'Fixture does not exercise the former MAX_PATH boundary');
  const result = install(target);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  await assertInstalled(target);
});
