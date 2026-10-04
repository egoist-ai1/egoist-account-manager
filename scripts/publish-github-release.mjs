import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = 'egoist-ai1/egoist-account-manager';
const apiRoot = `https://api.github.com/repos/${repository}`;
const uploadRoot = `https://uploads.github.com/repos/${repository}`;
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shaPattern = /^[a-f0-9]{40}$/i;

function git(root, args, input) {
  const executable = process.env.CAM_GIT_EXECUTABLE ?? process.env.GIT_EXECUTABLE ?? 'git';
  const result = spawnSync(executable, args, {
    cwd: root, input, encoding: 'utf8', windowsHide: true, timeout: 30_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }
  });
  if (result.error || result.status !== 0) throw new Error(`Git ${args[0]} failed; configure CAM_GIT_EXECUTABLE and the repository credentials.`);
  return result.stdout.trim();
}

function getGitToken(root) {
  const fromEnvironment = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (fromEnvironment) return fromEnvironment;
  const output = git(root, ['credential', 'fill'], 'protocol=https\nhost=github.com\n\n');
  const token = output.split(/\r?\n/).find(line => line.startsWith('password='))?.slice('password='.length);
  if (!token) throw new Error('GitHub credentials are unavailable.');
  return token;
}

async function hashFile(file, algorithm = 'sha256', encoding = 'hex') {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

function yamlScalar(text, key, indent = '') {
  const matches = [...text.matchAll(new RegExp(`^${indent}${key}:\\s*(.+)$`, 'gm'))];
  if (matches.length !== 1) throw new Error(`latest.yml must contain exactly one ${key} field at the expected level.`);
  const value = matches[0][1].trim();
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

export async function createReleasePlan(root = defaultRoot, options = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Only a stable semantic version can be released.');
  const version = pkg.version;
  const setup = `Account-Manager-EGO-Setup-${version}.exe`;
  const payloadNames = [setup, `Account-Manager-EGO-${version}.exe`, 'latest.yml', `${setup}.blockmap`];
  const checksumName = `SHA256SUMS-${version}.txt`;
  const names = [...payloadNames, checksumName];
  const assets = [];
  for (const name of names) {
    const file = path.join(root, 'release', name);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0) throw new Error(`Required release asset is empty or invalid: ${name}`);
    assets.push({ name, file, size: stat.size, sha256: await hashFile(file) });
  }
  const checksums = new Map();
  for (const line of fs.readFileSync(path.join(root, 'release', checksumName), 'utf8').split(/\r?\n/).filter(line => line.trim())) {
    const match = /^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i.exec(line);
    if (!match || !payloadNames.includes(match[2]) || checksums.has(match[2])) throw new Error('Invalid, unexpected, or duplicate checksum entry.');
    checksums.set(match[2], match[1].toLowerCase());
  }
  for (const asset of assets.filter(asset => asset.name !== checksumName)) {
    if (checksums.get(asset.name) !== asset.sha256) throw new Error(`SHA256SUMS does not match ${asset.name}`);
  }
  const latest = fs.readFileSync(path.join(root, 'release', 'latest.yml'), 'utf8');
  const setupAsset = assets.find(asset => asset.name === setup);
  const sha512 = await hashFile(setupAsset.file, 'sha512', 'base64');
  const fileEntries = [...latest.matchAll(/^  - url:\s*(.+)$/gm)];
  if (fileEntries.length !== 1 || fileEntries[0][1].trim().replace(/^(['"])(.*)\1$/, '$2') !== setup
    || yamlScalar(latest, 'version') !== version || yamlScalar(latest, 'path') !== setup
    || yamlScalar(latest, 'sha512') !== sha512 || yamlScalar(latest, 'sha512', '    ') !== sha512
    || Number(yamlScalar(latest, 'size', '    ')) !== setupAsset.size) {
    throw new Error('latest.yml does not describe the final installer bytes and current version.');
  }
  const notesRelative = `docs/releases/${version}.md`;
  const body = fs.readFileSync(path.join(root, notesRelative), 'utf8').trim();
  if (!body || !body.includes(version)) throw new Error('Version-specific release notes are missing or invalid.');
  const gitState = options.gitState ?? {
    head: git(root, ['rev-parse', 'HEAD']),
    dirtyTracked: Boolean(git(root, ['status', '--porcelain', '--untracked-files=no']))
  };
  if (!shaPattern.test(gitState.head)) throw new Error('Git HEAD is not an exact commit SHA.');
  return { root, version, tag: `v${version}`, name: `${pkg.productName} ${version}`, body, notesRelative, git: gitState, assets };
}

function verifiedAsset(remote, local) {
  return remote?.state === 'uploaded' && remote.name === local.name
    && remote.size === local.size && remote.digest === `sha256:${local.sha256}`;
}

export async function publishRelease(plan, options) {
  if (plan.git.dirtyTracked) throw new Error('Tracked source changes must be committed before publishing.');
  const { token, fetchImpl = fetch, log = () => {}, verifySource = () => {} } = options;
  verifySource();
  for (const local of plan.assets) if (await hashFile(local.file) !== local.sha256) throw new Error(`Local asset changed after preflight: ${local.name}`);
  if (!token) throw new Error('GitHub credentials are unavailable.');
  const request = async (endpoint, init = {}, { allow404 = false, upload = false } = {}) => {
    const url = `${upload ? uploadRoot : apiRoot}${endpoint}`;
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          let response;
          try {
            response = await fetchImpl(url, {
              ...init, redirect: 'error', signal: controller.signal,
              headers: {
                Authorization: `Bearer ${token}`, 'User-Agent': 'Egoist-Release-Tool',
                Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
                ...init.headers
              }
            });
          } catch {
            throw new Error(`GitHub ${init.method ?? 'GET'} ${endpoint.split('?')[0]} transport failed; inspect the draft before retrying.`);
          }
          if (allow404 && response.status === 404) return null;
          if (!response.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${endpoint.split('?')[0]} failed with HTTP ${response.status}.`);
          if (response.status === 204) return null;
          try { return await response.json(); } catch { throw new Error('GitHub returned an invalid JSON response.'); }
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('GitHub request timed out; inspect the draft before retrying.')); }, upload ? 600_000 : 60_000);
        })
      ]);
    } finally { clearTimeout(timer); }
  };
  const list = async (endpoint) => {
    const all = [];
    for (let page = 1; page <= 100; page += 1) {
      const batch = await request(`${endpoint}?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('GitHub returned an invalid list response.');
      all.push(...batch);
      if (batch.length < 100) return all;
    }
    throw new Error('GitHub pagination exceeded the release tool limit.');
  };
  const verifyTag = async (required) => {
    const ref = await request(`/git/ref/tags/${encodeURIComponent(plan.tag)}`, {}, { allow404: true });
    if (!ref) { if (required) throw new Error('The release tag does not exist.'); return; }
    let object = ref.object;
    for (let depth = 0; object?.type === 'tag' && depth < 8; depth += 1) {
      if (!shaPattern.test(object.sha)) throw new Error('GitHub returned an invalid tag SHA.');
      object = (await request(`/git/tags/${object.sha}`)).object;
    }
    if (object?.type !== 'commit' || object.sha !== plan.git.head) throw new Error('The release tag points to a different commit than local HEAD.');
  };
  const commit = await request(`/commits/${plan.git.head}`);
  if (commit.sha !== plan.git.head) throw new Error('Local HEAD is not available in the GitHub repository.');
  await verifyTag(false);
  const candidates = (await list('/releases')).filter(release => release.tag_name === plan.tag);
  if (candidates.length > 1) throw new Error('Multiple releases use the target tag; resolve this before publishing.');
  let release = candidates[0] ?? null;
  const assertRelease = (value, draft) => {
    if (!Number.isSafeInteger(value?.id) || value.id <= 0 || value.tag_name !== plan.tag
      || value.draft !== draft || value.prerelease !== false) throw new Error('GitHub returned an unexpected release identity/state.');
  };
  if (release && release.draft !== true) {
    assertRelease(release, false);
    await verifyTag(true);
    const remoteAssets = await list(`/releases/${release.id}/assets`);
    if (remoteAssets.length !== plan.assets.length || release.name !== plan.name || release.body !== plan.body
      || plan.assets.some(local => remoteAssets.filter(remote => remote.name === local.name && verifiedAsset(remote, local)).length !== 1)) {
      throw new Error('A published release already exists with different content; it will not be modified.');
    }
    return { id: release.id, url: release.html_url, alreadyPublished: true };
  }
  if (!release) {
    release = await request('/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      tag_name: plan.tag, target_commitish: plan.git.head, name: plan.name, body: plan.body, draft: true, prerelease: false
    }) });
  }
  assertRelease(release, true);
  if (release.target_commitish !== plan.git.head) throw new Error('The existing draft targets a different commit; it will not be reused.');
  if (release.name !== plan.name || release.body !== plan.body) throw new Error('The existing draft has different release notes; review it before retrying.');
  log(`Draft ${plan.tag} (ID ${release.id}) is ready; verifying all release assets.`);
  const remoteAssets = await list(`/releases/${release.id}/assets`);
  for (const local of plan.assets) {
    if (await hashFile(local.file) !== local.sha256) throw new Error(`Local asset changed after preflight: ${local.name}`);
    const matches = remoteAssets.filter(asset => asset.name === local.name);
    if (matches.length > 1) throw new Error(`Duplicate draft assets: ${local.name}`);
    if (matches.length === 1) {
      if (!verifiedAsset(matches[0], local)) throw new Error(`Existing draft asset has a different digest: ${local.name}; review the draft before retrying.`);
      log(`Verified existing draft asset ${local.name}.`);
      continue;
    }
    const stream = fs.createReadStream(local.file);
    try {
      const uploaded = await request(`/releases/${release.id}/assets?name=${encodeURIComponent(local.name)}`, {
        method: 'POST', body: stream, duplex: 'half',
        headers: { 'Content-Type': local.name.endsWith('.txt') || local.name.endsWith('.yml') ? 'text/plain' : 'application/octet-stream', 'Content-Length': String(local.size) }
      }, { upload: true });
      if (!verifiedAsset(uploaded, local)) throw new Error(`Uploaded asset digest was not verified: ${local.name}`);
    } finally { stream.destroy(); }
    log(`Uploaded and SHA256-verified ${local.name}.`);
  }
  const freshRelease = await request(`/releases/${release.id}`);
  assertRelease(freshRelease, true);
  if (freshRelease.target_commitish !== plan.git.head || freshRelease.body !== plan.body || freshRelease.name !== plan.name) throw new Error('The draft changed while assets were uploaded.');
  const verified = await list(`/releases/${release.id}/assets`);
  if (verified.length !== plan.assets.length || plan.assets.some(local => verified.filter(remote => verifiedAsset(remote, local)).length !== 1)) throw new Error('The complete draft asset set failed SHA256 verification.');
  for (const local of plan.assets) if (await hashFile(local.file) !== local.sha256) throw new Error(`Local asset changed during upload: ${local.name}`);
  await verifyTag(false);
  verifySource();
  const published = await request(`/releases/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, target_commitish: plan.git.head }) });
  assertRelease(published, false);
  await verifyTag(true);
  const publishedAssets = await list(`/releases/${published.id}/assets`);
  if (publishedAssets.length !== plan.assets.length || plan.assets.some(local => publishedAssets.filter(remote => verifiedAsset(remote, local)).length !== 1)) throw new Error('Published release readback failed SHA256 verification.');
  return { id: published.id, url: published.html_url, alreadyPublished: false };
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/publish-github-release.mjs [--check]');
  const plan = await createReleasePlan();
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ localAssetsVerified: true, version: plan.version, targetCommit: plan.git.head, dirtyTracked: plan.git.dirtyTracked, releaseNotes: plan.notesRelative, assets: plan.assets.map(({ name, size, sha256 }) => ({ name, size, sha256 })) }, null, 2));
    return;
  }
  if (plan.git.dirtyTracked) throw new Error('Tracked source changes must be committed before publishing.');
  git(plan.root, ['cat-file', '-e', `HEAD:${plan.notesRelative}`]);
  git(plan.root, ['cat-file', '-e', 'HEAD:package.json']);
  const token = getGitToken(plan.root);
  try {
    const verifySource = () => {
      if (git(plan.root, ['rev-parse', 'HEAD']) !== plan.git.head || git(plan.root, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Git HEAD or tracked source changed after preflight.');
    };
    const result = await publishRelease(plan, { token, verifySource, log: message => console.log(message) });
    console.log(`${result.alreadyPublished ? 'Verified existing immutable release' : 'Published'} ${plan.tag}: ${result.url}`);
  } catch (error) {
    throw new Error(String(error?.message ?? 'Publishing failed.').split(token).join('[redacted]'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
