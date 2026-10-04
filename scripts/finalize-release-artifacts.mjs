import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyInstallerPayload } from './installer-payload.mjs';

const defaultRoot = path.resolve(import.meta.dirname, '..');

async function digest(file, algorithm, encoding) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

async function requireFile(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Missing or invalid release file: ${path.basename(file)}`);
  return stat;
}

export function resolveBlockMapBuilder(root) {
  const projectRequire = createRequire(path.join(root, 'package.json'));
  // Resolve from electron-builder's own dependency context: pnpm hides this dependency.
  const builderRequire = createRequire(projectRequire.resolve('electron-builder/package.json'));
  const appBuilderRoot = path.dirname(builderRequire.resolve('app-builder-lib/package.json'));
  return builderRequire(path.join(appBuilderRoot, 'out', 'targets', 'blockmap', 'blockmap.js')).buildBlockMap;
}

async function atomicWrite(file, content) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function finalizeReleaseArtifacts(root = defaultRoot, options = {}) {
  root = path.resolve(root);
  const pkg = JSON.parse((await fs.readFile(path.join(root, 'package.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version ?? '')) throw new Error('Invalid release version');
  const releaseDir = path.join(root, 'release');
  const setupName = `Account-Manager-EGO-Setup-${pkg.version}.exe`;
  const portableName = `Account-Manager-EGO-${pkg.version}.exe`;
  const setup = path.join(releaseDir, setupName);
  const portable = path.join(releaseDir, portableName);
  const blockmap = `${setup}.blockmap`;
  const manifestName = `SHA256SUMS-${pkg.version}.txt`;
  const setupStat = await requireFile(setup);
  await requireFile(portable);
  await verifyInstallerPayload(root, path.join(releaseDir, 'win-unpacked'), pkg);
  const setupSha512 = await digest(setup, 'sha512', 'base64');
  const portableSha256 = await digest(portable, 'sha256', 'hex');
  const buildBlockMap = options.buildBlockMap ?? resolveBlockMapBuilder(root);
  // Passing outFile is mandatory: omitting it appends the blockmap to the executable.
  const result = await buildBlockMap(setup, 'gzip', blockmap);
  await requireFile(blockmap);
  if ((await fs.stat(setup)).size !== setupStat.size
      || await digest(setup, 'sha512', 'base64') !== setupSha512
      || result.sha512 !== setupSha512 || result.size !== setupStat.size) {
    throw new Error('Blockmap generation changed the installer or returned inconsistent metadata');
  }
  const releaseDate = (options.releaseDate ?? new Date()).toISOString();
  const latest = `version: ${pkg.version}\nfiles:\n  - url: ${setupName}\n    sha512: ${setupSha512}\n    size: ${setupStat.size}\npath: ${setupName}\nsha512: ${setupSha512}\nreleaseDate: '${releaseDate}'\n`;
  await atomicWrite(path.join(releaseDir, 'latest.yml'), latest);
  const names = [setupName, portableName, `${setupName}.blockmap`, 'latest.yml'];
  const hashes = await Promise.all(names.map((name) => digest(path.join(releaseDir, name), 'sha256', 'hex')));
  if (hashes[1] !== portableSha256 || await digest(setup, 'sha512', 'base64') !== setupSha512) {
    throw new Error('Release executable changed during finalization');
  }
  const manifest = names.map((name, index) => `${hashes[index]}  ${name}`).join('\n') + '\n';
  await atomicWrite(path.join(releaseDir, manifestName), manifest);
  const rootManifest = path.join(root, manifestName);
  let rootManifestSynced = false;
  try {
    const stat = await fs.lstat(rootManifest);
    if (!stat.isFile()) throw new Error('Root checksum manifest must be a regular file');
    await atomicWrite(rootManifest, manifest);
    rootManifestSynced = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { version: pkg.version, setupName, setupSize: setupStat.size, setupSha512,
    assets: [...names, manifestName], rootManifestSynced, releaseDate };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 2) throw new Error('Usage: node scripts/finalize-release-artifacts.mjs');
    console.log(JSON.stringify(await finalizeReleaseArtifacts(), null, 2));
  } catch (error) {
    console.error(`Release artifact finalization failed: ${error.message}`);
    process.exitCode = 1;
  }
}
