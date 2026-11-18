import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPackage } from '@electron/asar';
// @ts-expect-error The release tooling is a native ESM script.
import { verifyInstallerPayload, verifyExecutableMetadata } from '../../scripts/installer-payload.mjs';

const pkg = { name: 'codex-account-manager', productName: 'Account Manager EGO', version: '9.0.1', main: 'dist/main/main.js' };
let scratch: string;
let root: string;
let payload: string;
let archiveSource: string;

async function write(relative: string, contents: string) {
  const file = path.join(scratch, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}
async function pack() {
  await createPackage(archiveSource, path.join(payload, 'resources/app.asar'));
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(process.env.CAM_TEST_WORKDIR ?? os.tmpdir(), 'installer-payload-'));
  root = path.join(scratch, 'project');
  payload = path.join(scratch, 'payload');
  archiveSource = path.join(scratch, 'archive');
  await write('project/dist/main/main.js', 'current build');
  await write('project/assets/icon.ico', 'ico');
  await write('project/assets/icon.png', 'png');
  await write('archive/dist/main/main.js', 'current build');
  await write('archive/assets/icon.ico', 'ico');
  await write('archive/package.json', JSON.stringify(pkg));
  await write('payload/resources/icon.png', 'png');
  await write('payload/Account Manager EGO.exe', 'exe');
  await pack();
});
afterEach(async () => { await fs.rm(scratch, { recursive: true, force: true }); });

describe('installer payload release boundary', () => {
  it('accepts matching Windows executable resources', () => {
    expect(() => verifyExecutableMetadata({ productName: pkg.productName, fileVersion: pkg.version, productVersion: `${pkg.version}.0` }, pkg)).not.toThrow();
  });
  it('rejects an old executable attached to a current archive', () => {
    expect(() => verifyExecutableMetadata({ productName: pkg.productName, fileVersion: '9.0.0', productVersion: '9.0.0.0' }, pkg)).toThrow('identity/version');
  });
  it('accepts an exact current payload', async () => { await expect(verifyInstallerPayload(root, payload, pkg)).resolves.toBeUndefined(); });
  it('rejects an older release even when compiled bytes match', async () => {
    await write('archive/package.json', JSON.stringify({ ...pkg, version: '9.0.0' }));
    await pack();
    await expect(verifyInstallerPayload(root, payload, pkg)).rejects.toThrow('version');
  });
  it('rejects an old build with the current version', async () => {
    await write('archive/dist/main/main.js', 'old build');
    await pack();
    await expect(verifyInstallerPayload(root, payload, pkg)).rejects.toThrow('differs from build output');
  });
  it('rejects leftover executable code in the archive', async () => {
    await write('archive/dist/main/old.js', 'stale');
    await pack();
    await expect(verifyInstallerPayload(root, payload, pkg)).rejects.toThrow('file set');
  });
  it('rejects omitted renderer files', async () => {
    await write('project/dist/renderer/index.html', '<html>');
    await expect(verifyInstallerPayload(root, payload, pkg)).rejects.toThrow('file set');
  });
  it('rejects stale external icon resources', async () => {
    await write('payload/resources/icon.png', 'old png');
    await expect(verifyInstallerPayload(root, payload, pkg)).rejects.toThrow('resource differs');
  });
  it('rejects a different application identity', async () => {
    await write('archive/package.json', JSON.stringify({ ...pkg, name: 'other-app' }));
    await pack();
    await expect(verifyInstallerPayload(root, payload, pkg)).rejects.toThrow('name');
  });
});

describe('installer host-session safety', () => {
  it('never kills a process tree or elevates the per-user app', async () => {
    const installer = await fs.readFile(path.resolve('src/installer/ModernInstaller.cs'), 'utf8');
    const nsis = await fs.readFile(path.resolve('src/installer/setup.nsi'), 'utf8');
    const manifest = await fs.readFile(path.resolve('src/installer/ModernInstaller.manifest'), 'utf8');
    expect(installer).not.toMatch(/\.Kill\(|taskkill|Verb\s*=\s*"runas"|EnumWindows/);
    expect(nsis).not.toMatch(/taskkill|RequestExecutionLevel admin|RMDir \/r/);
    expect(nsis).toContain('RequestExecutionLevel user');
    expect(nsis).not.toContain('StrCpy $INSTDIR "$LOCALAPPDATA');
    expect(manifest).toContain('level="asInvoker"');
    expect(nsis.match(/--check-running/g)).toHaveLength(2);
    expect(installer).toContain('process.MainModule.FileName');
  });
  it('fails visibly when its UI stops responding and preserves Unicode exchange paths', async () => {
    const installer = await fs.readFile(path.resolve('src/installer/ModernInstaller.cs'), 'utf8');
    const nsis = await fs.readFile(path.resolve('src/installer/setup.nsi'), 'utf8');
    expect(nsis).toContain('IfErrors UiFailed');
    expect(nsis).toContain('ui_error.flag');
    expect(nsis).toContain('${If} $3 > 150');
    expect(installer).toContain('ui_heartbeat.flag');
    expect(installer).toContain('installerProcess.HasExited');
    expect(nsis).toContain('GetCurrentProcessId');
    expect(installer).toContain('System.Text.Encoding.Unicode');
    expect(nsis).toContain('FileReadUTF16LE $0 $1');
    expect(nsis).toContain('FileWriteUTF16LE /BOM $0');
  });
});

describe('isolated silent installer acceptance mode', () => {
  it('validates a test-owned or empty target and excludes both user default locations', async () => {
    const nsis = await fs.readFile(path.resolve('src/installer/setup.nsi'), 'utf8');
    const init = nsis.slice(nsis.indexOf('Function .onInit'), nsis.indexOf('Section "Kvesser"'));
    expect(init).toContain('${IfNot} ${Silent}');
    expect(init).toContain('/TEST');
    expect(init).toContain('$LOCALAPPDATA\\Programs\\Egoist');
    expect(init).toContain('$LOCALAPPDATA\\Programs\\Account Manager EGO');
    expect(init).toContain('--validate-install');
  });
  it('routes target writes and removal through the same compiled ownership boundary', async () => {
    const nsis = await fs.readFile(path.resolve('src/installer/setup.nsi'), 'utf8');
    const install = nsis.slice(nsis.indexOf('Section "Kvesser"'), nsis.indexOf('Section "Uninstall"'));
    expect(install).toContain('SetOutPath "$PLUGINSDIR\\payload"');
    expect(install).toContain('--install-owned');
    expect(install).not.toContain('SetOutPath "$INSTDIR"');
    expect(install).not.toMatch(/WriteReg|CreateShortcut|FileOpen \$0 "\$INSTDIR/);
    expect(install.indexOf('Goto DoneIntegration')).toBeLessThan(install.indexOf('--integrate'));
    const uninstall = nsis.slice(nsis.indexOf('Section "Uninstall"'));
    expect(uninstall).toContain('--uninstall-owned');
    expect(uninstall).not.toMatch(/DeleteRegKey|RMDir|Delete "\$INSTDIR/);
  });
});
