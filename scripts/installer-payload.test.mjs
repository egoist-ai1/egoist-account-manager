import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createPackage, uncacheAll } from '@electron/asar';
import { verifyInstallerPayload, verifyExecutableMetadata } from './installer-payload.mjs';
import { resolveBuilderWindowsToolsets, resolveInstallerTools } from './installer-tools.mjs';

const work = process.env.CAM_RELEASE_TEST_WORK;
if (!work) throw new Error('CAM_RELEASE_TEST_WORK must identify this task fixture directory');
const rcPackage = () => ({ name: 'codex-account-manager', productName: 'Egoist', version: '3.2.0-rc.1', main: 'dist/main/main.js', build: { buildVersion: '3.2.0.1' } });
const rcMetadata = () => ({ productName: 'Egoist', fileVersion: '3.2.0.1', productVersion: '3.2.0.0' });

async function fixture(t) {
  await fs.mkdir(work, { recursive: true });
  const root = await fs.mkdtemp(path.join(work, 'installer-version-'));
  const payload = path.join(root, 'payload');
  const staged = path.join(root, 'staged');
  const pkg = rcPackage();
  t.after(async () => { uncacheAll(); await fs.rm(root, { recursive: true, force: true }); });
  for (const relative of ['dist/main', 'assets', 'payload/resources', 'staged/dist/main', 'staged/assets']) await fs.mkdir(path.join(root, relative), { recursive: true });
  await fs.writeFile(path.join(staged, 'package.json'), JSON.stringify(pkg));
  for (const relative of ['dist/main/main.js', 'staged/dist/main/main.js']) await fs.writeFile(path.join(root, relative), 'console.log("fixture");');
  for (const relative of ['assets/icon.ico', 'staged/assets/icon.ico', 'assets/icon.png', 'payload/resources/icon.png']) await fs.writeFile(path.join(root, relative), Buffer.from([1, 2, 3]));
  await fs.writeFile(path.join(payload, 'Egoist.exe'), 'metadata supplied independently in unit fixture');
  await createPackage(staged, path.join(payload, 'resources', 'app.asar'));
  return { root, payload, pkg };
}

test('coerced RC ProductVersion is rejected without ASAR/source proof', () => {
  assert.throws(() => verifyExecutableMetadata(rcMetadata(), rcPackage()), /identity\/version/);
});

test('exact ASAR RC plus exact numeric FileVersion accepts builder numeric ProductVersion', async (t) => {
  const f = await fixture(t);
  await verifyInstallerPayload(f.root, f.payload, f.pkg);
  assert.doesNotThrow(() => verifyExecutableMetadata(rcMetadata(), f.pkg));
});

test('ASAR proof never permits a different file revision, core version or product', async (t) => {
  const f = await fixture(t);
  await verifyInstallerPayload(f.root, f.payload, f.pkg);
  for (const metadata of [
    { ...rcMetadata(), fileVersion: '3.2.0.0' },
    { ...rcMetadata(), fileVersion: '3.2.0-rc.1' },
    { ...rcMetadata(), productVersion: '3.1.10.0' },
    { ...rcMetadata(), productName: 'Account Manager EGO' }
  ]) assert.throws(() => verifyExecutableMetadata(metadata, f.pkg), /identity\/version/);
});

test('ASAR proof is bound to the original package identity and build revision', async (t) => {
  const f = await fixture(t);
  await verifyInstallerPayload(f.root, f.payload, f.pkg);
  assert.throws(() => verifyExecutableMetadata(rcMetadata(), structuredClone(f.pkg)), /identity\/version/);
  f.pkg.main = 'dist/main/another.js';
  assert.throws(() => verifyExecutableMetadata(rcMetadata(), f.pkg), /identity\/version/);
});

test('failed payload revalidation revokes an earlier RC proof', async (t) => {
  const f = await fixture(t);
  await verifyInstallerPayload(f.root, f.payload, f.pkg);
  await fs.writeFile(path.join(f.payload, 'resources', 'icon.png'), 'changed');
  await assert.rejects(verifyInstallerPayload(f.root, f.payload, f.pkg), /resource differs/);
  assert.throws(() => verifyExecutableMetadata(rcMetadata(), f.pkg), /identity\/version/);
});

test('stale RC ASAR does not grant coerced numeric ProductVersion acceptance', async (t) => {
  const f = await fixture(t);
  const wrongPackage = { ...f.pkg, version: '3.2.0-rc.0' };
  await fs.writeFile(path.join(f.root, 'staged', 'package.json'), JSON.stringify(wrongPackage));
  uncacheAll();
  await createPackage(path.join(f.root, 'staged'), path.join(f.payload, 'resources', 'app.asar'));
  await assert.rejects(verifyInstallerPayload(f.root, f.payload, f.pkg), /version does not match/);
  assert.throws(() => verifyExecutableMetadata(rcMetadata(), f.pkg), /identity\/version/);
});

test('legacy stable and exact semver/numeric metadata retain their strict acceptance', () => {
  const pkg = { ...rcPackage(), version: '3.1.10', build: undefined };
  assert.doesNotThrow(() => verifyExecutableMetadata({ productName: 'Egoist', fileVersion: '3.1.10', productVersion: '3.1.10.0' }, pkg));
  assert.doesNotThrow(() => verifyExecutableMetadata({ ...rcMetadata(), productVersion: '3.2.0-rc.1' }, rcPackage()));
  assert.doesNotThrow(() => verifyExecutableMetadata({ ...rcMetadata(), productVersion: '3.2.0.1' }, rcPackage()));
});

test('builder toolset resolver uses package-context module resolution without a download', () => {
  const functions = resolveBuilderWindowsToolsets(path.resolve(import.meta.dirname, '..'));
  assert.equal(typeof functions.getMakeNsisPath, 'function');
  assert.equal(typeof functions.getNsisPluginsPath, 'function');
});

test('toolset bootstrap preserves builder NSISDIR and configurable pinned resource versions', async () => {
  const calls = [];
  const pkg = { build: { toolsets: { nsis: '0.0.0' }, nsis: { customNsisBinary: { checksum: 'binary-sha' }, customNsisResources: { checksum: 'resources-sha' } } } };
  const tools = await resolveInstallerTools('unused', pkg, {
    environment: { PATH: 'original-path', NSISDIR: 'old-path' },
    windowsToolsets: {
      async getMakeNsisPath(...args) { calls.push(['binary', ...args]); return { path: 'random-cache/Bin/makensis.exe', env: { NSISDIR: 'random-cache' } }; },
      async getNsisPluginsPath(...args) { calls.push(['plugins', ...args]); return 'random-resource-cache/plugins'; }
    }
  });
  assert.equal(tools.path, 'random-cache/Bin/makensis.exe');
  assert.equal(tools.pluginDir, path.join('random-resource-cache/plugins', 'x86-unicode'));
  assert.equal(tools.env.NSISDIR, 'random-cache');
  assert.equal(tools.env.PATH, 'original-path');
  assert.deepEqual(calls, [['binary', '0.0.0', pkg.build.nsis.customNsisBinary], ['plugins', '0.0.0', pkg.build.nsis.customNsisResources]]);
});

test('explicit NSIS executable/plugin overrides do not invoke or require builder bootstrap', async () => {
  const environment = { MAKENSIS: 'custom/makensis.exe', NSIS_PLUGIN_DIR: 'custom/plugins', NSISDIR: 'custom' };
  assert.deepEqual(await resolveInstallerTools('missing-project', {}, { environment }), {
    path: environment.MAKENSIS, pluginDir: environment.NSIS_PLUGIN_DIR, env: environment
  });
});
