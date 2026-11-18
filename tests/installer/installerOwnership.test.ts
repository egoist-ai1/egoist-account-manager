import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
// @ts-expect-error Native release tooling exports are tested directly.
import { createOwnershipManifest, validateOwnedRelativePath, windowsNumericVersion } from '../../scripts/installer-ownership.mjs';

// @ts-expect-error Native acceptance tooling exports are tested directly.
import { verifyCustomInstallerReceipt } from '../../scripts/verify-installer-owned.mjs';

type Manifest = { schemaVersion: number; appId: string; version: string; installRoot?: string; testMode?: boolean; files: { relativePath: string; sha256: string }[] };
const project = path.resolve('.');
const identity = { productName: 'Kvesser', version: '3.2.0-rc.1', build: { appId: 'one.egoist.codex-account-manager', buildVersion: '3.2.0.1' } };
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
let scratch: string;
let scenario: string;
let source: string;
let target: string;
let manifestFile: string;
let helper: string;
let legacyProbe: string;
let legacyExecutable: string;
let uninstaller: string;
let counter = 0;

function execute(...args: string[]) {
  return spawnSync(helper, args, { encoding: 'utf8', timeout: 30000, windowsHide: true });
}
async function makePayload(version = '3.2.0-rc.1') {
  await fs.mkdir(path.join(source, 'resources'), { recursive: true });
  await fs.writeFile(path.join(source, 'Kvesser.exe'), `app-${version}`);
  await fs.writeFile(path.join(source, 'resources', 'app.asar'), `archive-${version}`);
  await fs.writeFile(uninstaller, 'isolated-fake-uninstaller');
  const manifest = await createOwnershipManifest(source, { ...identity, version });
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  return manifest as Manifest;
}
function install() { return execute('--install-owned', source, manifestFile, target, uninstaller, '1'); }
async function installedManifest() { return JSON.parse(await fs.readFile(path.join(target, '.egoist-install.json'), 'utf8')) as Manifest; }

const native = process.platform === 'win32' ? describe : describe.skip;
native('compiled installer ownership boundary', () => {
  beforeAll(async () => {
    scratch = await fs.mkdtemp(path.join(process.env.CAM_TEST_WORKDIR ?? os.tmpdir(), 'installer-ownership-'));
    helper = path.join(scratch, 'ModernInstaller.exe');
    const framework = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
    const result = spawnSync(path.join(framework, 'csc.exe'), [
      '/nologo', '/codepage:65001', '/t:winexe', `/lib:${path.join(framework, 'WPF')}`, '/r:PresentationFramework.dll', '/r:PresentationCore.dll',
      '/r:WindowsBase.dll', '/r:System.dll', '/r:System.Core.dll', '/r:System.Web.Extensions.dll', '/r:System.Xaml.dll',
      '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', `/resource:${path.join(project, 'assets/icon.png')},EgoistBrand.png`, `/resource:${path.join(project, 'assets/legacy/3.1.10-ownership.json')},Legacy311Payload.json`, `/out:${helper}`,
      path.join(project, 'src/installer/ModernInstaller.cs'), path.join(project, 'src/installer/InstallOwnership.cs')
    ], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    expect(result.error, result.stdout + result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const fixture = path.join(scratch, 'LegacyFixture.cs');
    await fs.writeFile(fixture, '[assembly: System.Reflection.AssemblyProduct("Account Manager EGO")]\n[assembly: System.Reflection.AssemblyFileVersion("3.1.10.0")]\n[assembly: System.Reflection.AssemblyInformationalVersion("3.1.10.0")]\npublic class Fixture { public static void Main() {} }');
    legacyExecutable = path.join(scratch, 'LegacyFixture.exe');
    const fixtureCompile = spawnSync(path.join(framework, 'csc.exe'), ['/nologo', '/t:exe', `/out:${legacyExecutable}`, fixture], { encoding: 'utf8', windowsHide: true });
    expect(fixtureCompile.status, fixtureCompile.stdout + fixtureCompile.stderr).toBe(0);
    const probeSource = path.join(scratch, 'LegacyProbe.cs');
    await fs.writeFile(probeSource, `using System; using System.Web.Script.Serialization; using AccountManagerEGO.Installer;
public class LegacyProbe { public static int Main(string[] args) {
try { if (args[0] == "inspect") { var manifest = InstallOwnership.ReadLegacyForRegisteredRoot(args[1], args[2]); Console.WriteLine(new JavaScriptSerializer().Serialize(manifest)); return 0; }
InstallOwnership.ReadRegisteredInstallLocation = delegate { return args[1]; };
if (args[0] == "late-foreign") InstallOwnership.InstallPhase = delegate(string phase) {
if (phase == "before-file-apply" && !System.IO.File.Exists(System.IO.Path.Combine(args[1], "Kvesser.exe")))
System.IO.File.WriteAllText(System.IO.Path.Combine(args[1], "Kvesser.exe"), "late foreign bytes");
};
if (args[0] == "fail" || args[0] == "rollback-fail") InstallOwnership.InstallPhase = delegate(string phase) {
if (phase == "file-applied" || args[0] == "rollback-fail" && phase == "before-rollback") throw new System.IO.IOException("injected installer failure");
};
InstallOwnership.Install(args[2], args[3], args[1], args[4], false); return 0;
} catch(Exception error) { Console.Error.WriteLine(error.Message); return 3; }
} }`);
    legacyProbe = path.join(scratch, 'LegacyProbe.exe');
    const probeCompile = spawnSync(path.join(framework, 'csc.exe'), ['/nologo', '/t:exe', '/r:System.dll', '/r:System.Core.dll', '/r:System.Web.Extensions.dll', `/resource:${path.join(project, 'assets/legacy/3.1.10-ownership.json')},Legacy311Payload.json`, `/out:${legacyProbe}`, probeSource, path.join(project, 'src/installer/InstallOwnership.cs')], { encoding: 'utf8', windowsHide: true });
    expect(probeCompile.status, probeCompile.stdout + probeCompile.stderr).toBe(0);
  });
  beforeEach(async () => {
    scenario = path.join(scratch, `case-${counter++}`);
    source = path.join(scenario, 'payload');
    target = path.join(scenario, 'Kvesser');
    manifestFile = path.join(scenario, 'payload-ownership.json');
    uninstaller = path.join(scenario, 'Uninstall Kvesser.exe');
    await fs.mkdir(source, { recursive: true });
  });
  afterAll(async () => {
    if (!scratch || !path.resolve(scratch).startsWith(path.resolve(process.env.CAM_TEST_WORKDIR ?? os.tmpdir()) + path.sep)) return;
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('rejects a nonempty unowned directory without creating any application file', async () => {
    await makePayload();
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'foreign.txt'), 'foreign');
    expect(install().status).toBe(3);
    expect(await fs.readdir(target)).toEqual(['foreign.txt']);
    expect(await fs.readFile(path.join(target, 'foreign.txt'), 'utf8')).toBe('foreign');
  });
  it('upgrades an Egoist RC1 ownership manifest while preserving foreign files', async () => {
    await makePayload();
    await fs.mkdir(path.join(target, 'resources'), { recursive: true });
    const previousFiles = [{ relativePath: 'Egoist.exe', bytes: 'previous Egoist app' }, { relativePath: 'resources/app.asar', bytes: 'previous archive' }, { relativePath: 'Uninstall Egoist.exe', bytes: 'previous owned uninstaller' }];
    for (const entry of previousFiles) await fs.writeFile(path.join(target, entry.relativePath), entry.bytes);
    await fs.writeFile(path.join(target, '.egoist-install.json'), JSON.stringify({ schemaVersion: 1, appId: identity.build.appId, version: '3.2.0-rc.1', installRoot: target, testMode: true, files: previousFiles.map(entry => ({ relativePath: entry.relativePath, sha256: digest(entry.bytes) })) }));
    await fs.writeFile(path.join(target, 'foreign-note.txt'), 'preserve');
    expect(install().status).toBe(0);
    expect(await fs.readFile(path.join(target, 'Kvesser.exe'), 'utf8')).toBe('app-3.2.0-rc.1');
    await expect(fs.stat(path.join(target, 'Egoist.exe'))).rejects.toThrow();
    await expect(fs.stat(path.join(target, 'Uninstall Egoist.exe'))).rejects.toThrow();
    expect(await fs.readFile(path.join(target, 'foreign-note.txt'), 'utf8')).toBe('preserve');
  });

  it('recognizes exact pinned legacy SQLite extras and replaces them during upgrade', async () => {
    await makePayload();
    const relative = 'resources/app.asar.unpacked/node_modules/better-sqlite3/deps/common.gypi';
    await fs.mkdir(path.dirname(path.join(target, relative)), { recursive: true });
    await fs.copyFile(legacyExecutable, path.join(target, 'Account Manager EGO.exe'));
    await fs.writeFile(path.join(target, 'resources/app.asar'), 'legacy archive fixture');
    await fs.copyFile(path.join(project, 'tests/installer/fixtures/legacy-common.gypi'), path.join(target, relative));
    const oldBytes = await fs.readFile(path.join(target, relative));
    const trusted = JSON.parse(await fs.readFile(path.join(project, 'assets/legacy/3.1.10-ownership.json'), 'utf8')) as Manifest;
    expect(trusted.files.find(entry => entry.relativePath === relative)?.sha256).toBe(crypto.createHash('sha256').update(oldBytes).digest('hex'));
    await fs.mkdir(path.dirname(path.join(source, relative)), { recursive: true });
    await fs.writeFile(path.join(source, relative), 'current SQLite build definitions fixture');
    await fs.writeFile(manifestFile, JSON.stringify(await createOwnershipManifest(source, identity)));
    const result = spawnSync(legacyProbe, ['install', target, source, manifestFile, uninstaller], { encoding: 'utf8', windowsHide: true });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(await fs.readFile(path.join(target, relative), 'utf8')).toBe('current SQLite build definitions fixture');
  });

  it('preserves modified legacy SQLite extras and refuses payload overwrite', async () => {
    await makePayload();
    const relative = 'resources/app.asar.unpacked/node_modules/better-sqlite3/deps/common.gypi';
    await fs.mkdir(path.dirname(path.join(target, relative)), { recursive: true });
    await fs.copyFile(legacyExecutable, path.join(target, 'Account Manager EGO.exe'));
    await fs.writeFile(path.join(target, 'resources/app.asar'), 'legacy archive fixture');
    await fs.writeFile(path.join(target, relative), 'modified legacy bytes');
    await fs.mkdir(path.dirname(path.join(source, relative)), { recursive: true });
    await fs.writeFile(path.join(source, relative), 'current source bytes');
    await fs.writeFile(manifestFile, JSON.stringify(await createOwnershipManifest(source, identity)));
    const result = spawnSync(legacyProbe, ['install', target, source, manifestFile, uninstaller], { encoding: 'utf8', windowsHide: true });
    expect(result.status).toBe(3);
    expect(await fs.readFile(path.join(target, relative), 'utf8')).toBe('modified legacy bytes');
    expect(await fs.readFile(path.join(target, 'resources/app.asar'), 'utf8')).toBe('legacy archive fixture');
    await expect(fs.stat(path.join(target, 'Kvesser.exe'))).rejects.toThrow();
  });

  it('installs exact manifest files, then preserves foreign files and directories on uninstall', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    const manifest = await installedManifest();
    expect(manifest).toMatchObject({ appId: identity.build.appId, installRoot: target, testMode: true });
    await fs.writeFile(path.join(target, 'foreign.txt'), 'foreign');
    await fs.mkdir(path.join(target, 'notes'));
    await fs.writeFile(path.join(target, 'notes', 'keep.txt'), 'notes');
    expect(execute('--uninstall-owned', target).status).toBe(0);
    expect(await fs.readdir(target)).toEqual(['foreign.txt', 'notes']);
    expect(await fs.readFile(path.join(target, 'notes', 'keep.txt'), 'utf8')).toBe('notes');
  });
  it('upgrades an owned test install while retaining unknown files', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    await fs.writeFile(path.join(target, 'foreign.txt'), 'preserved');
    await makePayload('3.2.0-rc.2');
    expect(install().status).toBe(0);
    expect((await installedManifest()).version).toBe('3.2.0-rc.2');
    expect(await fs.readFile(path.join(target, 'Kvesser.exe'), 'utf8')).toBe('app-3.2.0-rc.2');
    expect(await fs.readFile(path.join(target, 'foreign.txt'), 'utf8')).toBe('preserved');
  });
  it('rejects an unknown new payload path before changing any existing owned file', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    await fs.writeFile(path.join(target, 'z-foreign.txt'), 'preserved');
    await fs.writeFile(path.join(source, 'z-foreign.txt'), 'overwrite attempt');
    await makePayload('3.2.0-rc.2');
    expect(install().status).toBe(3);
    expect(await fs.readFile(path.join(target, 'Kvesser.exe'), 'utf8')).toBe('app-3.2.0-rc.1');
    expect(await fs.readFile(path.join(target, 'z-foreign.txt'), 'utf8')).toBe('preserved');
  });
  it('rejects an invalid late payload entry before the target directory is created', async () => {
    const manifest = await makePayload();
    manifest.files.push({ relativePath: 'z-missing.txt', sha256: digest('missing') });
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    expect(install().status).toBe(3);
    await expect(fs.stat(target)).rejects.toThrow();
  });
  it('rejects a MAX_PATH staging boundary before creating the target directory', async () => {
    await makePayload();
    const directory = 'd'.repeat(260 - target.length - 1 - 40);
    const relative = `${directory}/a`;
    await fs.mkdir(path.join(source, directory));
    await fs.writeFile(path.join(source, relative), 'long path fixture');
    await fs.writeFile(manifestFile, JSON.stringify(await createOwnershipManifest(source, identity)));
    expect(install().status).toBe(3);
    await expect(fs.stat(target)).rejects.toThrow();
  });
  it('preserves a late foreign file and removes only its own uncommitted stage', async () => {
    await makePayload();
    const result = spawnSync(legacyProbe, ['late-foreign', target, source, manifestFile, uninstaller], { encoding: 'utf8', windowsHide: true });
    expect(result.status).toBe(3);
    expect(await fs.readdir(target)).toEqual(['Kvesser.exe']);
    expect(await fs.readFile(path.join(target, 'Kvesser.exe'), 'utf8')).toBe('late foreign bytes');
  });
  it('preserves changed owned files on uninstall and reports that fact', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    await fs.writeFile(path.join(target, 'resources', 'app.asar'), 'user changed archive');
    expect(execute('--uninstall-owned', target).status).toBe(10);
    expect(await fs.readFile(path.join(target, 'resources', 'app.asar'), 'utf8')).toBe('user changed archive');
    expect((await installedManifest()).files).toHaveLength(3);
    expect(execute('--uninstall-owned', target).status).toBe(10);
  });
  it('refuses modified owned files during upgrade', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    await fs.writeFile(path.join(target, 'Kvesser.exe'), 'custom file');
    await makePayload('3.2.0-rc.2');
    expect(install().status).toBe(3);
    expect(await fs.readFile(path.join(target, 'Kvesser.exe'), 'utf8')).toBe('custom file');
  });
  it('rejects traversal in an installed manifest before deleting legitimate files', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    await fs.writeFile(path.join(scenario, 'outside.txt'), 'outside');
    const manifest = await installedManifest();
    manifest.files.push({ relativePath: '../outside.txt', sha256: digest('outside') });
    await fs.writeFile(path.join(target, '.egoist-install.json'), JSON.stringify(manifest));
    expect(execute('--uninstall-owned', target).status).toBe(3);
    expect(await fs.readFile(path.join(scenario, 'outside.txt'), 'utf8')).toBe('outside');
    expect(await fs.readFile(path.join(target, 'Kvesser.exe'), 'utf8')).toBe('app-3.2.0-rc.1');
  });
  it('rejects a moved manifest and a different product ownership', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    const manifest = await installedManifest();
    manifest.installRoot = scenario;
    await fs.writeFile(path.join(target, '.egoist-install.json'), JSON.stringify(manifest));
    expect(execute('--uninstall-owned', target).status).toBe(3);
    manifest.installRoot = target;
    manifest.appId = 'other.product';
    await fs.writeFile(path.join(target, '.egoist-install.json'), JSON.stringify(manifest));
    expect(execute('--uninstall-owned', target).status).toBe(3);
    expect(await fs.readFile(path.join(target, 'Kvesser.exe'), 'utf8')).toBe('app-3.2.0-rc.1');
  });
  it('rejects drive/user/common roots without writes', () => {
    for (const root of [path.parse(scratch).root, os.homedir(), path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'AppData', 'Local')]) {
      expect(execute('--validate-install', root, '1').status).toBe(3);
    }
  });
  it('rejects a junction ancestor and leaves its destination unchanged', async () => {
    const actual = path.join(scenario, 'actual');
    const junction = path.join(scenario, 'junction');
    await fs.mkdir(actual);
    await fs.writeFile(path.join(actual, 'sentinel.txt'), 'untouched');
    await fs.symlink(actual, junction, 'junction');
    await makePayload();
    target = path.join(junction, 'Kvesser');
    expect(install().status).toBe(3);
    expect(await fs.readdir(actual)).toEqual(['sentinel.txt']);
    await fs.unlink(junction);
  });
  it('rejects a linked owned file without deleting its outside alias', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    const alias = path.join(scenario, 'alias.exe');
    await fs.link(path.join(target, 'Kvesser.exe'), alias);
    expect(execute('--uninstall-owned', target).status).toBe(3);
    expect(await fs.readFile(alias, 'utf8')).toBe('app-3.2.0-rc.1');
  });
  it('upgrades the exact registered legacy 3.1.10 identity without taking ownership of unknown files', async () => {
    await makePayload();
    await fs.mkdir(path.join(target, 'resources'), { recursive: true });
    await fs.copyFile(legacyExecutable, path.join(target, 'Account Manager EGO.exe'));
    await fs.writeFile(path.join(target, 'resources', 'app.asar'), 'legacy archive');
    await fs.writeFile(path.join(target, 'Uninstall Account Manager EGO.exe'), 'unsafe legacy uninstaller');
    await fs.writeFile(path.join(target, 'foreign.txt'), 'foreign');
    await fs.writeFile(path.join(target, 'resources', 'preferences.json'), 'preferences');
    const inspect = spawnSync(legacyProbe, ['inspect', target, target], { encoding: 'utf8', windowsHide: true });
    expect(inspect.status).toBe(0);
    const legacy = JSON.parse(inspect.stdout) as Manifest;
    expect(legacy.files.map((f) => f.relativePath)).toEqual(['Account Manager EGO.exe', 'Uninstall Account Manager EGO.exe', 'resources/app.asar']);
    const upgrade = spawnSync(legacyProbe, ['upgrade', target, source, manifestFile, uninstaller], { encoding: 'utf8', windowsHide: true });
    expect(upgrade.status, upgrade.stdout + upgrade.stderr).toBe(0);
    expect(await fs.readFile(path.join(target, 'Kvesser.exe'), 'utf8')).toBe('app-3.2.0-rc.1');
    await expect(fs.stat(path.join(target, 'Uninstall Account Manager EGO.exe'))).rejects.toThrow();
    expect(await fs.readFile(path.join(target, 'foreign.txt'), 'utf8')).toBe('foreign');
    expect(await fs.readFile(path.join(target, 'resources', 'preferences.json'), 'utf8')).toBe('preferences');
    const manifest = await installedManifest();
    expect(manifest.files.map((f) => f.relativePath)).not.toContain('foreign.txt');
    expect(manifest.testMode).toBe(false);
    manifest.testMode = true;
    await fs.writeFile(path.join(target, '.egoist-install.json'), JSON.stringify(manifest));
    expect(execute('--uninstall-owned', target).status).toBe(0);
    expect(await fs.readFile(path.join(target, 'resources', 'preferences.json'), 'utf8')).toBe('preferences');
  });
  it('does not recognize legacy files at a different registered location', async () => {
    await fs.mkdir(path.join(target, 'resources'), { recursive: true });
    await fs.copyFile(legacyExecutable, path.join(target, 'Account Manager EGO.exe'));
    await fs.writeFile(path.join(target, 'resources', 'app.asar'), 'legacy archive');
    const inspect = spawnSync(legacyProbe, ['inspect', target, scenario], { encoding: 'utf8', windowsHide: true });
    expect(inspect.status).toBe(0);
    expect(JSON.parse(inspect.stdout)).toBeNull();
  });
  it('does not follow a replaced owned resource directory during uninstall', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    const outside = path.join(scenario, 'outside');
    await fs.rename(path.join(target, 'resources'), outside);
    await fs.symlink(outside, path.join(target, 'resources'), 'junction');
    expect(execute('--uninstall-owned', target).status).toBe(3);
    expect(await fs.readFile(path.join(outside, 'app.asar'), 'utf8')).toBe('archive-3.2.0-rc.1');
    expect(await fs.readFile(path.join(target, 'Kvesser.exe'), 'utf8')).toBe('app-3.2.0-rc.1');
    await fs.unlink(path.join(target, 'resources'));
  });
  it('restores the original files and manifest after an injected post-write failure', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    const oldManifest = await fs.readFile(path.join(target, '.egoist-install.json'));
    await makePayload('3.2.0-rc.2');
    const failed = spawnSync(legacyProbe, ['fail', target, source, manifestFile, uninstaller], { encoding: 'utf8', windowsHide: true });
    expect(failed.status).toBe(3);
    expect(await fs.readFile(path.join(target, 'Kvesser.exe'), 'utf8')).toBe('app-3.2.0-rc.1');
    expect(await fs.readFile(path.join(target, '.egoist-install.json'))).toEqual(oldManifest);
    expect((await fs.readdir(target)).filter((name) => name.startsWith('.egoist-recovery-'))).toEqual([]);
  });
  it('leaves a failed new installation retryable after verified rollback', async () => {
    await makePayload();
    const failed = spawnSync(legacyProbe, ['fail', target, source, manifestFile, uninstaller], { encoding: 'utf8', windowsHide: true });
    expect(failed.status).toBe(3);
    await expect(fs.stat(target)).rejects.toThrow();
    expect(install().status).toBe(0);
  });
  it('retains exact rollback evidence outside source staging when rollback itself fails', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    await makePayload('3.2.0-rc.2');
    const failed = spawnSync(legacyProbe, ['rollback-fail', target, source, manifestFile, uninstaller], { encoding: 'utf8', windowsHide: true });
    expect(failed.status).toBe(3);
    const recovery = (await fs.readdir(target)).find((name) => name.startsWith('.egoist-recovery-'))!;
    expect(recovery).toMatch(/^\.egoist-recovery-[0-9a-f]{32}$/);
    const evidence = JSON.parse(await fs.readFile(path.join(target, recovery, 'recovery.json'), 'utf8'));
    expect(evidence).toMatchObject({ schemaVersion: 1, appId: identity.build.appId, installRoot: target, changed: ['Kvesser.exe'] });
    expect(evidence.backups[0]).toMatchObject({ relativePath: 'Kvesser.exe', sha256: digest('app-3.2.0-rc.1') });
    expect(await fs.readFile(path.join(target, recovery, evidence.backups[0].savedName), 'utf8')).toBe('app-3.2.0-rc.1');
    await fs.rm(source, { recursive: true, force: true });
    expect(await fs.readFile(path.join(target, recovery, evidence.backups[0].savedName), 'utf8')).toBe('app-3.2.0-rc.1');
  });
  it('prevents a test installation from touching a production-owned folder', async () => {
    await makePayload();
    expect(install().status).toBe(0);
    const manifest = await installedManifest();
    manifest.testMode = false;
    await fs.writeFile(path.join(target, '.egoist-install.json'), JSON.stringify(manifest));
    expect(execute('--validate-install', target, '1').status).toBe(3);
    expect(install().status).toBe(3);
  });
});

describe('ownership payload and Windows version tooling', () => {
  it('uses a numeric fourth Windows version component for prereleases', () => {
    expect(windowsNumericVersion(identity)).toBe('3.2.0.1');
    expect(windowsNumericVersion({ version: '3.2.0-rc.4' })).toBe('3.2.0.4');
    expect(windowsNumericVersion({ version: '3.1.10' })).toBe('3.1.10.0');
    expect(() => windowsNumericVersion({ version: '3.2.0', build: { buildVersion: '3.2.0-rc.1' } })).toThrow();
  });
  it.each(['../x', 'x/../y', 'C:/x', '/x', 'x\\y', 'x:stream', 'NUL.txt', 'COM1', 'x.', 'x ', '', 'x//y'])('rejects unsafe manifest path %s', (value) => {
    expect(() => validateOwnedRelativePath(value)).toThrow();
  });
});
describe('shipping installer execution guard', () => {
  let fixtureRoot: string;
  let setup: string;
  let receiptFile: string;
  const pkg = { ...identity, build: { ...identity.build, directories: { output: 'release' } } };
  beforeEach(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(process.env.CAM_TEST_WORKDIR ?? os.tmpdir(), 'installer-receipt-'));
    await fs.mkdir(path.join(fixtureRoot, 'release', 'installer-build'), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, 'scripts'));
    setup = path.join(fixtureRoot, 'release', 'Kvesser-Setup-3.2.0-rc.1.exe');
    receiptFile = path.join(fixtureRoot, 'release', 'installer-build', 'ownership-receipt.json');
    await fs.writeFile(setup, 'custom setup');
    await fs.mkdir(path.join(fixtureRoot, 'src', 'installer'), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, 'src', 'installer', 'setup.nsi'), 'safe nsis');
    await fs.writeFile(path.join(fixtureRoot, 'src', 'installer', 'InstallOwnership.cs'), 'safe ownership');
    await fs.writeFile(path.join(fixtureRoot, 'src', 'installer', 'ModernInstaller.cs'), 'safe UI');
    await fs.mkdir(path.join(fixtureRoot, 'assets', 'legacy'), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, 'assets', 'legacy', '3.1.10-ownership.json'), 'pinned legacy ownership');
    await fs.writeFile(receiptFile, JSON.stringify({ schemaVersion: 1, appId: pkg.build.appId, version: pkg.version,
      setupSha256: digest('custom setup'), nsisSha256: digest('safe nsis'), ownershipSourceSha256: digest('safe ownership'), uiSourceSha256: digest('safe UI'), legacyOwnershipSha256: digest('pinned legacy ownership'), testMode: 'manifest-owned-no-integration' }));
  });
  afterEach(async () => {
    if (fixtureRoot && path.resolve(fixtureRoot).startsWith(path.resolve(process.env.CAM_TEST_WORKDIR ?? os.tmpdir()) + path.sep)) await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  it('accepts only the exact custom installer and source-bound receipt', async () => {
    await expect(verifyCustomInstallerReceipt(fixtureRoot, pkg, setup)).resolves.toBe(digest('custom setup'));
  });
  it('refuses a replacement default setup even at the same filename', async () => {
    await fs.writeFile(setup, 'default electron-builder setup');
    await expect(verifyCustomInstallerReceipt(fixtureRoot, pkg, setup)).rejects.toThrow('refusing execution');
  });
  it('refuses drift in the pinned legacy ownership resource', async () => {
    await fs.writeFile(path.join(fixtureRoot, 'assets', 'legacy', '3.1.10-ownership.json'), 'untrusted ownership');
    await expect(verifyCustomInstallerReceipt(fixtureRoot, pkg, setup)).rejects.toThrow('refusing execution');
  });
  it('refuses source drift and a missing receipt', async () => {
    await fs.writeFile(path.join(fixtureRoot, 'src', 'installer', 'setup.nsi'), 'changed nsis');
    await expect(verifyCustomInstallerReceipt(fixtureRoot, pkg, setup)).rejects.toThrow('refusing execution');
    await fs.unlink(receiptFile);
    await expect(verifyCustomInstallerReceipt(fixtureRoot, pkg, setup)).rejects.toThrow();
  });
});
