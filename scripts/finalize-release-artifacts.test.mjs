import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createPackage, uncacheAll } from '@electron/asar';
import { finalizeReleaseArtifacts, resolveBlockMapBuilder } from './finalize-release-artifacts.mjs';

const work = process.env.CAM_RELEASE_TEST_WORK;
if (!work) throw new Error('CAM_RELEASE_TEST_WORK must identify this task fixture directory');
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(bytes).digest(encoding);
const date = new Date('2026-10-04T12:00:00.000Z');

async function fixture(t) {
  await fs.mkdir(work, { recursive: true });
  const root = await fs.mkdtemp(path.join(work, 'release-finalizer-'));
  t.after(async () => { uncacheAll(); await fs.rm(root, { recursive: true, force: true }); });
  const pkg = { name: 'codex-account-manager', productName: 'Account Manager EGO', version: '3.1.10', main: 'dist/main/main.js' };
  const payload = path.join(root, 'release', 'win-unpacked');
  const staged = path.join(root, 'packed-source');
  for (const directory of ['dist/main', 'assets', 'release/win-unpacked/resources', 'packed-source/dist/main', 'packed-source/assets']) {
    await fs.mkdir(path.join(root, directory), { recursive: true });
  }
  for (const relative of ['package.json', 'packed-source/package.json']) await fs.writeFile(path.join(root, relative), JSON.stringify(pkg));
  for (const relative of ['dist/main/main.js', 'packed-source/dist/main/main.js']) await fs.writeFile(path.join(root, relative), 'console.log("built");');
  for (const relative of ['assets/icon.ico', 'packed-source/assets/icon.ico', 'assets/icon.png', 'release/win-unpacked/resources/icon.png']) await fs.writeFile(path.join(root, relative), Buffer.from([1, 2, 3]));
  await fs.writeFile(path.join(payload, `${pkg.productName}.exe`), 'fake application executable');
  await createPackage(staged, path.join(payload, 'resources', 'app.asar'));
  const setup = path.join(root, 'release', `Account-Manager-EGO-Setup-${pkg.version}.exe`);
  const portable = path.join(root, 'release', `Account-Manager-EGO-${pkg.version}.exe`);
  await fs.writeFile(setup, Buffer.alloc(8192, 33));
  await fs.writeFile(portable, 'fake portable executable');
  await fs.writeFile(path.join(root, 'release', 'latest.yml'), 'stale metadata');
  const builder = async (file, format, output) => {
    assert.equal(file, setup);
    assert.equal(format, 'gzip');
    assert.equal(output, `${setup}.blockmap`);
    const bytes = await fs.readFile(file);
    await fs.writeFile(output, gzipSync(JSON.stringify({ version: '2', files: [] })));
    return { sha512: hash(bytes, 'sha512', 'base64'), size: bytes.length };
  };
  return { root, setup, portable, builder, payload };
}

test('finalizes exact five assets without changing installer and synchronizes existing root manifest', async (t) => {
  const f = await fixture(t);
  const manifestName = 'SHA256SUMS-3.1.10.txt';
  await fs.writeFile(path.join(f.root, manifestName), 'stale checksums');
  const original = await fs.readFile(f.setup);
  const result = await finalizeReleaseArtifacts(f.root, { buildBlockMap: f.builder, releaseDate: date });
  assert.equal(result.rootManifestSynced, true);
  assert.equal(result.assets.length, 5);
  assert.deepEqual(await fs.readFile(f.setup), original);
  const latest = await fs.readFile(path.join(f.root, 'release', 'latest.yml'), 'utf8');
  assert.match(latest, /version: 3\.1\.10/);
  assert.match(latest, /size: 8192/);
  assert.ok(latest.includes(hash(original, 'sha512', 'base64')));
  assert.ok(latest.includes(date.toISOString()));
  const manifest = await fs.readFile(path.join(f.root, 'release', manifestName), 'utf8');
  assert.equal(await fs.readFile(path.join(f.root, manifestName), 'utf8'), manifest);
  const lines = manifest.trim().split('\n');
  assert.equal(lines.length, 4);
  for (const line of lines) {
    const [expected, name] = line.split('  ');
    assert.equal(hash(await fs.readFile(path.join(f.root, 'release', name))), expected);
  }
});

test('does not create an absent root checksum manifest', async (t) => {
  const f = await fixture(t);
  const result = await finalizeReleaseArtifacts(f.root, { buildBlockMap: f.builder, releaseDate: date });
  assert.equal(result.rootManifestSynced, false);
  await assert.rejects(fs.stat(path.join(f.root, 'SHA256SUMS-3.1.10.txt')), { code: 'ENOENT' });
});

test('missing portable fails before changing metadata or calling blockmap builder', async (t) => {
  const f = await fixture(t);
  await fs.rm(f.portable);
  let called = false;
  await assert.rejects(finalizeReleaseArtifacts(f.root, { buildBlockMap: async () => { called = true; } }), { code: 'ENOENT' });
  assert.equal(called, false);
  assert.equal(await fs.readFile(path.join(f.root, 'release', 'latest.yml'), 'utf8'), 'stale metadata');
});

test('stale packaged version refuses finalization before modifying metadata', async (t) => {
  const f = await fixture(t);
  const source = JSON.parse(await fs.readFile(path.join(f.root, 'package.json'), 'utf8'));
  source.version = '3.1.11';
  await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify(source));
  await fs.rename(f.setup, f.setup.replace('3.1.10', '3.1.11'));
  await fs.rename(f.portable, f.portable.replace('3.1.10', '3.1.11'));
  await assert.rejects(finalizeReleaseArtifacts(f.root, { buildBlockMap: f.builder }), /Payload package version does not match/);
});

test('different source build output refuses finalization', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'dist/main/main.js'), 'modified build');
  await assert.rejects(finalizeReleaseArtifacts(f.root, { buildBlockMap: f.builder }), /Payload differs from build output/);
});

test('detects a builder appending bytes to the installer', async (t) => {
  const f = await fixture(t);
  const badBuilder = async (...args) => {
    const result = await f.builder(...args);
    await fs.appendFile(f.setup, 'accidental append');
    return result;
  };
  await assert.rejects(finalizeReleaseArtifacts(f.root, { buildBlockMap: badBuilder }), /changed the installer/);
  assert.equal(await fs.readFile(path.join(f.root, 'release', 'latest.yml'), 'utf8'), 'stale metadata');
});

test('refuses incorrect builder hash metadata', async (t) => {
  const f = await fixture(t);
  await assert.rejects(finalizeReleaseArtifacts(f.root, { buildBlockMap: async (...args) => ({ ...await f.builder(...args), sha512: 'wrong' }) }), /inconsistent metadata/);
});

test('detects portable mutation during blockmap generation', async (t) => {
  const f = await fixture(t);
  await assert.rejects(finalizeReleaseArtifacts(f.root, { buildBlockMap: async (...args) => {
    await fs.writeFile(f.portable, 'changed portable');
    return f.builder(...args);
  } }), /executable changed during finalization/);
  await assert.rejects(fs.stat(path.join(f.root, 'release', 'SHA256SUMS-3.1.10.txt')), { code: 'ENOENT' });
});

test('installed electron-builder dependency resolves pnpm blockmap builder and writes a separate gzip file', async (t) => {
  const f = await fixture(t);
  const original = await fs.readFile(f.setup);
  const buildBlockMap = resolveBlockMapBuilder(path.resolve(import.meta.dirname, '..'));
  const result = await finalizeReleaseArtifacts(f.root, { buildBlockMap, releaseDate: date });
  assert.equal(result.setupSize, original.length);
  assert.deepEqual(await fs.readFile(f.setup), original);
  const blockmap = JSON.parse(gunzipSync(await fs.readFile(`${f.setup}.blockmap`)).toString());
  assert.equal(blockmap.version, '2');
  assert.equal(blockmap.files.length, 1);
});
