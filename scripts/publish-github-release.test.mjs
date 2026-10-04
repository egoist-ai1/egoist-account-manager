import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import { createReleasePlan, publishRelease } from './publish-github-release.mjs';

const work = process.env.CAM_RELEASE_TEST_WORK;
if (!work) throw new Error('Set CAM_RELEASE_TEST_WORK to this task runtime work directory.');
fs.mkdirSync(work, { recursive: true });
const roots = [];
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
const head = 'a'.repeat(40);
const gitState = { head, dirtyTracked: false };
const hash = (data, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(data).digest(encoding);

async function fixture() {
  const root = fs.mkdtempSync(path.join(work, 'release-publisher-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'release'));
  fs.mkdirSync(path.join(root, 'docs', 'releases'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.8.7', productName: 'Account Manager EGO' }));
  fs.writeFileSync(path.join(root, 'docs', 'releases', '9.8.7.md'), '# Account Manager EGO 9.8.7\n\nVersion-specific verified changes.\n');
  const setupName = 'Account-Manager-EGO-Setup-9.8.7.exe';
  const setup = Buffer.from('synthetic final installer bytes');
  const data = new Map([
    [setupName, setup],
    ['Account-Manager-EGO-9.8.7.exe', Buffer.from('synthetic portable bytes')],
    [`${setupName}.blockmap`, Buffer.from('synthetic blockmap')],
    ['latest.yml', Buffer.from(`version: 9.8.7\nfiles:\n  - url: ${setupName}\n    sha512: ${hash(setup, 'sha512', 'base64')}\n    size: ${setup.length}\npath: ${setupName}\nsha512: ${hash(setup, 'sha512', 'base64')}\nreleaseDate: '2026-10-04T12:00:00Z'\n`) ]
  ]);
  for (const [name, bytes] of data) fs.writeFileSync(path.join(root, 'release', name), bytes);
  fs.writeFileSync(path.join(root, 'release', 'SHA256SUMS-9.8.7.txt'), [...data].map(([name, bytes]) => `${hash(bytes)}  ${name}\n`).join(''));
  return { root, data, plan: await createReleasePlan(root, { gitState }) };
}

function github(plan, options = {}) {
  const calls = [];
  const logs = [];
  let tagExists = options.tagExists ?? false;
  let assets = options.assets ?? [];
  let release = options.release ? { ...options.release } : null;
  const remote = local => ({ id: 100 + plan.assets.indexOf(local), name: local.name, size: local.size, state: 'uploaded', digest: `sha256:${local.sha256}` });
  const draft = () => ({ id: 42, tag_name: plan.tag, name: plan.name, body: plan.body, target_commitish: head, draft: true, prerelease: false, html_url: `https://github.com/egoist-ai1/egoist-account-manager/releases/tag/${plan.tag}` });
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const endpoint = parsed.pathname.replace('/repos/egoist-ai1/egoist-account-manager', '');
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ endpoint, method, body, hostname: parsed.hostname });
    assert.equal(init.headers.Authorization, 'Bearer fixture-secret-token');
    assert.equal(init.redirect, 'error');
    let result;
    let status = 200;
    if (endpoint === `/commits/${head}`) result = { sha: head };
    else if (endpoint.startsWith('/git/ref/tags/')) {
      if (!tagExists) status = 404;
      result = { object: { type: 'commit', sha: options.tagHead ?? head } };
    } else if (endpoint === '/releases' && method === 'GET') result = release ? [release] : [];
    else if (endpoint === '/releases' && method === 'POST') { release = { ...draft(), ...body }; result = release; status = 201; }
    else if (endpoint === '/releases/42/assets' && method === 'GET') result = options.finalMismatch && calls.filter(call => call.method === 'POST' && call.hostname === 'uploads.github.com').length === 5
      ? assets.map((asset, index) => index === 0 ? { ...asset, digest: `sha256:${'0'.repeat(64)}` } : asset) : assets;
    else if (endpoint === '/releases/42/assets' && method === 'POST') {
      const local = plan.assets.find(asset => asset.name === parsed.searchParams.get('name'));
      assert.ok(local);
      if (options.failUpload === local.name) return new Response('{}', { status: 502 });
      result = remote(local);
      if (options.uploadMismatch === local.name) result.digest = `sha256:${'0'.repeat(64)}`;
      assets = [...assets, result]; status = 201;
    } else if (endpoint === '/releases/42' && method === 'GET') result = release;
    else if (endpoint === '/releases/42' && method === 'PATCH') { release = { ...release, ...body }; tagExists = true; result = release; }
    else throw new Error(`Unexpected fixture request: ${method} ${endpoint}`);
    return new Response(JSON.stringify(result), { status });
  };
  return { fetchImpl, calls, logs, remote, draft, options: { token: 'fixture-secret-token', fetchImpl, log: message => logs.push(message) } };
}

const writes = calls => calls.filter(call => call.method !== 'GET');
const publishes = calls => calls.filter(call => call.method === 'PATCH' && call.body?.draft === false);

test('local preflight requires all assets, current release notes and verified checksums', async () => {
  const { root, plan } = await fixture();
  assert.equal(plan.assets.length, 5);
  assert.equal(plan.git.head, head);
  assert.match(plan.body, /Version-specific verified changes/);
  fs.unlinkSync(path.join(root, 'release', 'Account-Manager-EGO-9.8.7.exe'));
  await assert.rejects(createReleasePlan(root, { gitState }), /ENOENT/);
});

test('local preflight rejects changed bytes and incomplete checksum entries', async () => {
  const { root } = await fixture();
  const checksums = path.join(root, 'release', 'SHA256SUMS-9.8.7.txt');
  fs.writeFileSync(checksums, fs.readFileSync(checksums, 'utf8').split('\n').slice(1).join('\n'));
  await assert.rejects(createReleasePlan(root, { gitState }), /SHA256SUMS/);
  const fresh = await fixture();
  fs.appendFileSync(path.join(fresh.root, 'release', 'Account-Manager-EGO-Setup-9.8.7.exe'), 'changed');
  await assert.rejects(createReleasePlan(fresh.root, { gitState }), /SHA256SUMS/);
});

test('local preflight rejects stale update metadata even with regenerated SHA256SUMS', async () => {
  const { root, data } = await fixture();
  const latest = Buffer.from(data.get('latest.yml').toString().replace('version: 9.8.7', 'version: 1.0.0'));
  data.set('latest.yml', latest);
  fs.writeFileSync(path.join(root, 'release', 'latest.yml'), latest);
  fs.writeFileSync(path.join(root, 'release', 'SHA256SUMS-9.8.7.txt'), [...data].map(([name, bytes]) => `${hash(bytes)}  ${name}\n`).join(''));
  await assert.rejects(createReleasePlan(root, { gitState }), /latest.yml/);
});

test('publishes a draft only after all five SHA256-verified assets and exact target commit', async () => {
  const { plan } = await fixture();
  const mock = github(plan);
  const result = await publishRelease(plan, mock.options);
  assert.equal(result.alreadyPublished, false);
  const mutations = writes(mock.calls);
  assert.equal(mutations[0].method, 'POST');
  assert.equal(mutations[0].body.draft, true);
  assert.equal(mutations[0].body.target_commitish, head);
  assert.equal(mutations.filter(call => call.hostname === 'uploads.github.com').length, 5);
  assert.equal(mutations.at(-1).body.draft, false);
  assert.equal(publishes(mock.calls).length, 1);
  assert.ok(!mock.logs.join('\n').includes('fixture-secret-token'));
});

test('upload error leaves an unpublished recoverable draft', async () => {
  const { plan } = await fixture();
  const mock = github(plan, { failUpload: plan.assets[2].name });
  await assert.rejects(publishRelease(plan, mock.options), /HTTP 502/);
  assert.equal(publishes(mock.calls).length, 0);
});

test('same-size incorrect upload digest prevents publication', async () => {
  const { plan } = await fixture();
  const mock = github(plan, { uploadMismatch: plan.assets[0].name });
  await assert.rejects(publishRelease(plan, mock.options), /digest was not verified/);
  assert.equal(publishes(mock.calls).length, 0);
});

test('fresh complete asset verification must pass before final publication', async () => {
  const { plan } = await fixture();
  const mock = github(plan, { finalMismatch: true });
  await assert.rejects(publishRelease(plan, mock.options), /complete draft asset set/);
  assert.equal(publishes(mock.calls).length, 0);
});

test('resume finds a draft through list releases and skips verified existing assets', async () => {
  const { plan } = await fixture();
  const seed = github(plan);
  const mock = github(plan, { release: seed.draft(), assets: plan.assets.slice(0, 2).map(seed.remote) });
  await publishRelease(plan, mock.options);
  assert.equal(writes(mock.calls).filter(call => call.endpoint === '/releases').length, 0);
  assert.equal(writes(mock.calls).filter(call => call.hostname === 'uploads.github.com').length, 3);
});

test('published releases are verified read-only and never overwritten', async () => {
  const { plan } = await fixture();
  const seed = github(plan);
  const mock = github(plan, { release: { ...seed.draft(), draft: false }, tagExists: true, assets: plan.assets.map(seed.remote) });
  assert.equal((await publishRelease(plan, mock.options)).alreadyPublished, true);
  assert.equal(writes(mock.calls).length, 0);
  const mismatch = github(plan, { release: { ...seed.draft(), draft: false, body: 'different body' }, tagExists: true, assets: plan.assets.map(seed.remote) });
  await assert.rejects(publishRelease(plan, mismatch.options), /will not be modified/);
  assert.equal(writes(mismatch.calls).length, 0);
});

test('an existing tag pointing elsewhere and dirty source both prevent writes', async () => {
  const { plan } = await fixture();
  const mock = github(plan, { tagExists: true, tagHead: 'b'.repeat(40) });
  await assert.rejects(publishRelease(plan, mock.options), /different commit/);
  assert.equal(writes(mock.calls).length, 0);
  const dirtyMock = github(plan);
  await assert.rejects(publishRelease({ ...plan, git: { ...plan.git, dirtyTracked: true } }, dirtyMock.options), /must be committed/);
  assert.equal(dirtyMock.calls.length, 0);
});


test('source changes detected before final publication leave the draft unpublished', async () => {
  const { plan } = await fixture();
  const mock = github(plan);
  let checks = 0;
  await assert.rejects(publishRelease(plan, { ...mock.options, verifySource: () => {
    checks += 1;
    if (checks === 2) throw new Error('Source changed');
  } }), /Source changed/);
  assert.equal(publishes(mock.calls).length, 0);
});

test('a file changed after preflight prevents even draft creation', async () => {
  const { plan } = await fixture();
  const mock = github(plan);
  fs.appendFileSync(plan.assets[0].file, 'changed');
  await assert.rejects(publishRelease(plan, mock.options), /changed after preflight/);
  assert.equal(mock.calls.length, 0);
});
