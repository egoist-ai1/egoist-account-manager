import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createOwnershipManifest } from './installer-ownership.mjs';
import { resolveInstallerTools } from './installer-tools.mjs';
import { integrationDigest } from './verify-installer-owned.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceNames = ['src/installer/ModernInstaller.cs', 'src/installer/InstallOwnership.cs', 'src/installer/setup.nsi',
  'tests/installer/InstallerFixtureEntry.cs', 'scripts/installer-gui-fixture.mjs', 'scripts/installer-gui-fixture.test.mjs', 'scripts/verify-installer-owned.mjs',
  'scripts/installer-ownership.mjs', 'scripts/installer-tools.mjs', 'assets/legacy/3.1.10-ownership.json'];
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const csharp = (value) => `@"${value.replaceAll('"', '""')}"`;

async function noLinks(input) {
  let current = path.resolve(input);
  while (true) {
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Fixture context contains a link/non-directory');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function fixtureContext(options = {}) {
  const work = process.env.CAM_TEST_WORKDIR;
  const threadId = process.env.CODEX_THREAD_ID;
  if (process.platform !== 'win32' || !work || !/^[a-f0-9-]{36}$/i.test(threadId ?? '')
      || !/^[a-z]:[\\/]/i.test(work) || /[\u0000"\r\n]/.test(work)) throw new Error('Explicit Windows task work and actual thread identity are required');
  if ((options.threadId !== undefined && options.threadId !== threadId)
      || (options.work !== undefined && path.resolve(options.work).toLowerCase() !== path.resolve(work).toLowerCase())) {
    throw new Error('Fixture context differs from the actual calling thread and work');
  }
  const absolute = path.resolve(work);
  if (!absolute.toLowerCase().endsWith(path.join('tasks', threadId, 'work').toLowerCase())) throw new Error('Fixture work does not belong to the calling thread');
  await noLinks(absolute);
  const sources = [];
  for (const relativePath of sourceNames) sources.push({ relativePath, sha256: sha(await fs.readFile(path.join(root, relativePath))) });
  return { work: absolute, threadId, sources, reviewSha256: sha(JSON.stringify(sources)) };
}

function preparedAbsolute(value) {
  if (typeof value !== 'string' || !/^[a-z]:[\\/]/i.test(value) || /[\u0000"\r\n]/.test(value)) throw new Error('Prepared fixture path is not absolute');
  const absolute = path.resolve(value);
  if (absolute.toLowerCase() !== value.toLowerCase()) throw new Error('Prepared fixture path is not canonical');
  return absolute;
}

async function noLinksTree(input) {
  const info = await fs.lstat(input);
  if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) throw new Error('Prepared fixture tree contains a link/non-regular entry');
  if (info.isDirectory()) {
    for (const name of await fs.readdir(input)) await noLinksTree(path.join(input, name));
  }
}

export async function validatePreparedFixture(prepared) {
  const current = await fixtureContext();
  if (prepared.threadId !== current.threadId || preparedAbsolute(prepared.work).toLowerCase() !== current.work.toLowerCase()) {
    throw new Error('Prepared fixture identity differs from the actual calling thread and work');
  }
  const scratch = preparedAbsolute(prepared.scratch);
  if (path.dirname(scratch).toLowerCase() !== current.work.toLowerCase() || !/^ig-[A-Za-z0-9]{6}$/.test(path.basename(scratch))) {
    throw new Error('Prepared scratch escaped its generated task layout');
  }
  const expected = { setup: 'fixture.exe', helper: 'ModernInstaller.exe', temp: 'tmp', target: 'Kvesser' };
  for (const [key, relative] of Object.entries(expected)) {
    if (preparedAbsolute(prepared[key]).toLowerCase() !== path.join(scratch, relative).toLowerCase()) throw new Error('Prepared fixture path escaped its fixed scratch layout');
  }
  await noLinks(scratch);
  await noLinksTree(scratch);
  if (!(await fs.lstat(prepared.temp)).isDirectory()) throw new Error('Prepared fixture temp is not a directory');
  for (const key of ['setup', 'helper']) if (!(await fs.lstat(prepared[key])).isFile()) throw new Error('Prepared fixture binary is not a regular file');
  return current;
}

export async function prepareGuiFixture(options = {}) {
  const context = await fixtureContext(options);
  const scenario = options.scenario ?? 'initialize';
  if (!['initialize', 'install', 'retry'].includes(scenario)) throw new Error('Unknown fixture scenario');
  const scratch = await fs.mkdtemp(path.join(context.work, 'ig-'));
  await noLinks(scratch);
  const target = path.join(scratch, 'Kvesser');
  const temp = path.join(scratch, 'tmp');
  const payload = path.join(scratch, 'payload');
  await fs.mkdir(temp);
  await fs.mkdir(path.join(payload, 'resources'), { recursive: true });
  await fs.writeFile(path.join(payload, 'Kvesser.exe'), 'fixture executable bytes, never launched');
  await fs.writeFile(path.join(payload, 'resources', 'app.asar'), 'fixture ASAR bytes, never loaded');
  const pkg = { productName: 'Kvesser', version: '3.2.0-rc.2', build: { appId: 'one.egoist.codex-account-manager', buildVersion: '3.2.0.2' } };
  const manifest = path.join(scratch, 'payload-ownership.json');
  await fs.writeFile(manifest, JSON.stringify(await createOwnershipManifest(payload, pkg)));
  const config = path.join(scratch, 'FixtureConfig.cs');
  await fs.writeFile(config, `internal static class InstallerFixtureConfig { public const string Work=${csharp(context.work)}; public const string Scratch=${csharp(scratch)}; public const string Target=${csharp(target)}; public const string ThreadId=${csharp(context.threadId)}; public const string Scenario=${csharp(scenario)}; }\n`);
  const framework = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const helper = path.join(scratch, 'ModernInstaller.exe');
  const legacyResource = path.join(root, 'assets/legacy/3.1.10-ownership.json');
  const resources = [`/resource:${path.join(root, 'assets/icon.png')},EgoistBrand.png`];
  await fs.access(legacyResource);
  resources.push(`/resource:${legacyResource},Legacy311Payload.json`);
  const compiled = spawnSync(path.join(framework, 'csc.exe'), ['/nologo', '/codepage:65001', '/t:winexe', '/main:InstallerFixtureEntry',
    `/lib:${path.join(framework, 'WPF')}`, '/r:PresentationFramework.dll', '/r:PresentationCore.dll', '/r:WindowsBase.dll',
    '/r:System.dll', '/r:System.Core.dll', '/r:System.Web.Extensions.dll', '/r:System.Xaml.dll', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
    ...resources, `/out:${helper}`, config, path.join(root, 'tests/installer/InstallerFixtureEntry.cs'),
    path.join(root, 'src/installer/ModernInstaller.cs'), path.join(root, 'src/installer/InstallOwnership.cs')],
  { encoding: 'utf8', windowsHide: true, env: { ...process.env, TEMP: temp, TMP: temp } });
  if (compiled.status !== 0) throw new Error('Fixture compilation failed: ' + compiled.stdout + compiled.stderr);
  const tools = await resolveInstallerTools(root, pkg);
  const setup = path.join(scratch, 'fixture.exe');
  const nsis = spawnSync(tools.path, ['/V2', '/INPUTCHARSET', 'UTF8', `/DNSIS_PLUGIN_DIR=${tools.pluginDir}`, '/DPRODUCT_VERSION=3.2.0-rc.2',
    '/DNUMERIC_VERSION=3.2.0.2', `/DOWNERSHIP_MANIFEST=${manifest}`, `/DPAYLOAD=${payload}`, `/DICON_PATH=${path.join(root, 'assets/icon.ico')}`,
    `/DMODERN_INSTALLER_EXE=${helper}`, `/DFONT_PATH=${path.join(root, 'assets/Unbounded.ttf')}`, `/DOUTPUT=${setup}`, path.join(root, 'src/installer/setup.nsi')],
  { encoding: 'utf8', windowsHide: true, env: { ...tools.env, TEMP: temp, TMP: temp } });
  if (nsis.status !== 0) throw new Error('Fixture NSIS compilation failed: ' + nsis.stdout + nsis.stderr);
  const receipt = { schemaVersion: 1, ...context, scenario, scratch, target, temp, helper, setup, compiledOnly: true,
    setupSha256: sha(await fs.readFile(setup)), helperSha256: sha(await fs.readFile(helper)), nativeMode: 'forced-test-manifest-with-denied-integration' };
  await fs.writeFile(path.join(scratch, 'prepared.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

export async function executeGuiFixture(prepared, options = {}) {
  const current = await validatePreparedFixture(prepared);
  const approved = options.reviewSha256 ?? process.env.CAM_INSTALLER_FIXTURE_REVIEW_SHA;
  if (approved !== current.reviewSha256 || approved !== prepared.reviewSha256) throw new Error('Exact fixture sources have not passed root guard review');
  if (sha(await fs.readFile(prepared.setup)) !== prepared.setupSha256 || sha(await fs.readFile(prepared.helper)) !== prepared.helperSha256) throw new Error('Prepared fixture binary changed');
  // Retain actual BEFORE digest before any native launch. Production shortcuts/registry cannot be reached by FixtureEntry.
  const before = await integrationDigest();
  const result = { schemaVersion: 1, scenario: prepared.scenario, reviewSha256: approved, testMode: true, applicationLaunched: false,
    integrationBefore: before, status: 'running', startedAt: new Date().toISOString() };
  const receipt = path.join(prepared.scratch, 'result.json');
  await fs.writeFile(receipt, JSON.stringify(result, null, 2) + '\n');
  const invocation = { argv0: `"${prepared.setup}"`, windowsVerbatimArguments: true, windowsHide: true,
    env: { ...process.env, CODEX_THREAD_ID: current.threadId, TEMP: prepared.temp, TMP: prepared.temp }, encoding: 'utf8' };
  const native = spawnSync(prepared.setup, [`/D=${prepared.target}`], invocation);
  result.exitCode = native.status;
  result.integrationAfter = await integrationDigest();
  result.integrationUnchanged = before === result.integrationAfter;
  result.events = (await fs.readFile(path.join(prepared.scratch, 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  const rendered = result.events.some((event) => event.name === 'gui-rendered' && event.data.directory === prepared.target && event.data.title.includes('Квессер'));
  const guardError = result.events.some((event) => event.name === 'fixture-guard-error' || event.name === 'gui-timeout');
  const complete = result.events.some((event) => event.name === 'gui-complete' && event.data.testMode === true);
  const retry = result.events.some((event) => event.name === 'gui-error' && event.data.text.includes('payload-invalid'));
  result.status = rendered && !guardError && result.integrationUnchanged && (prepared.scenario === 'initialize' ? native.status === 1 : native.status === 0 && complete)
    && (prepared.scenario !== 'retry' || retry) ? 'passed' : 'failed';
  result.finishedAt = new Date().toISOString();
  await fs.writeFile(receipt, JSON.stringify(result, null, 2) + '\n');
  if (result.status !== 'passed') throw Object.assign(new Error('Guarded GUI fixture failed; evidence retained in exact own scratch'), { receipt });
  return { ...result, receipt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const scenario = process.argv[2] ?? 'initialize';
  const prepared = await prepareGuiFixture({ scenario });
  console.log(JSON.stringify({ prepared: path.join(prepared.scratch, 'prepared.json'), reviewSha256: prepared.reviewSha256, compiledOnly: true }));
  if (process.argv.includes('--execute')) console.log(JSON.stringify(await executeGuiFixture(prepared)));
}
