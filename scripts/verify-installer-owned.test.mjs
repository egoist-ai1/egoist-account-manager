import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import path from 'node:path';
import { integrationDigest, nsisTestInvocation, installerArtifactPaths, installerReceiptPath } from './verify-installer-owned.mjs';

const execute = promisify(execFile);
const hash = 'a'.repeat(64);
const native = process.platform === 'win32';
async function readOnlyPowerShell(file, args) {
  try {
    const result = await execute(file, args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return { code: 0, ...result };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test('integration probe returns a validated digest and invokes only read-only PowerShell', async () => {
  let calls = 0;
  const result = await integrationDigest({ runner: async (file, args, timeout) => {
    calls++;
    assert.equal(file, 'powershell.exe');
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
    assert.equal(timeout, 15000);
    return { code: 0, stdout: `${hash}\r\n`, stderr: '' };
  } });
  assert.equal(result, hash);
  assert.equal(calls, 1);
});

test('actual Windows integration digest works when Get-FileHash is deliberately unavailable', { skip: !native }, async () => {
  const result = await integrationDigest({ runner: (file, args) => readOnlyPowerShell(file, [
    ...args.slice(0, 3), `function Get-FileHash { throw 'Get-FileHash must not be called' };\n${args[3]}`
  ]) });
  assert.match(result, /^[a-f0-9]{64}$/);
});

test('failed PowerShell probe exposes safe structured cause and stderr fingerprint', async () => {
  const stderr = JSON.stringify({ category: 'ObjectNotFound', errorId: 'CommandNotFoundException', command: 'Get-FileHash', errorType: 'System.Management.Automation.CommandNotFoundException', line: 30, column: 4, secret: 'PRIVATE_REGISTRY_VALUE' });
  await assert.rejects(integrationDigest({ runner: async () => ({ code: 1, stdout: '', stderr }) }), (error) => {
    assert.match(error.message, /exitCode=1.*ObjectNotFound.*CommandNotFoundException/);
    assert.match(error.message, /line=30; column=4/);
    assert.doesNotMatch(error.message, /PRIVATE_REGISTRY_VALUE/);
    assert.equal(error.integrationDiagnostic.stderrBytes, Buffer.byteLength(stderr));
    assert.match(error.integrationDiagnostic.stderrSha256, /^[a-f0-9]{64}$/);
    return true;
  });
});

test('arbitrary exception text and path-bearing diagnostic fields are withheld', async () => {
  const stderr = JSON.stringify({ category: 'PRIVATE/path', errorType: 'PRIVATE_REGISTRY_VALUE', errorId: 'PRIVATE_REGISTRY_VALUE', command: 'C:/Users/PRIVATE/path', line: 20, column: 2 });
  await assert.rejects(integrationDigest({ runner: async () => ({ code: 1, stdout: '', stderr }) }), (error) => {
    assert.doesNotMatch(error.message, /PRIVATE|Users/);
    assert.equal(error.integrationDiagnostic.errorId, undefined);
    assert.equal(error.integrationDiagnostic.errorType, undefined);
    assert.equal(error.integrationDiagnostic.command, undefined);
    assert.equal(error.integrationDiagnostic.line, 20);
    return true;
  });
});

test('legacy unstructured stderr is fingerprinted without logging private content', async () => {
  await assert.rejects(integrationDigest({ runner: async () => ({ code: 1, stdout: '', stderr: 'Access denied C:/Users/PRIVATE/auth.json' }) }), (error) => {
    assert.doesNotMatch(error.message, /PRIVATE|auth.json|Access denied/);
    assert.match(error.message, /stderr fingerprint=/);
    return true;
  });
});

test('invalid success output is rejected without exposing snapshot values', async () => {
  await assert.rejects(integrationDigest({ runner: async () => ({ code: 0, stdout: '{"registry":"PRIVATE"}', stderr: '' }) }), (error) => {
    assert.match(error.message, /invalid digest response/);
    assert.doesNotMatch(error.message, /PRIVATE|registry/);
    return true;
  });
});

test('launcher failures retain a safe code without echoing environment or paths', async () => {
  await assert.rejects(integrationDigest({ runner: async () => { throw Object.assign(new Error('PRIVATE_CREDENTIAL_PATH'), { code: 'ENOENT' }); } }), (error) => {
    assert.match(error.message, /PowerShell ENOENT/);
    assert.doesNotMatch(error.message, /PRIVATE/);
    assert.equal(error.integrationDiagnostic.launcherErrorCode, 'ENOENT');
    return true;
  });
});

test('actual PowerShell exception diagnostic does not disclose its message', { skip: !native }, async () => {
  await assert.rejects(integrationDigest({ runner: (file, args) => readOnlyPowerShell(file, [
    ...args.slice(0, 3), args[3].replace('try {', 'try { throw [IO.IOException]::new("PRIVATE_REGISTRY_VALUE");')
  ]) }), (error) => {
    assert.doesNotMatch(error.message, /PRIVATE_REGISTRY_VALUE/);
    assert.match(error.integrationDiagnostic.errorType, /^System\./);
    assert.ok(error.integrationDiagnostic.line > 0);
    return true;
  });
});

test('NSIS invocation preserves an unquoted final Unicode directory and quoted executable', () => {
  const executable = 'C:\\Task Folder\\Egoist Setup.exe';
  const directory = 'C:\\Task Folder\\Профили Egoist';
  const invocation = nsisTestInvocation(executable, directory);
  assert.deepEqual(invocation.args, ['/S', '/TEST', `/D=${directory}`]);
  assert.equal(invocation.options.windowsVerbatimArguments, true);
  assert.equal(invocation.options.argv0, `"${executable}"`);
});

test('NSIS test invocation rejects relative, network and quote-bearing paths', () => {
  for (const directory of ['relative', '\\\\server\\share', 'C:\\bad"folder', 'C:\\bad\nfolder']) {
    assert.throws(() => nsisTestInvocation('C:\\setup.exe', directory), /safe absolute local paths/);
  }
});

const fixtureProject = path.resolve('fixture-project');
const fixturePackage = { productName: 'Kvesser', name: 'legacy-package-id', version: '3.2.0-rc.2', build: { directories: { output: 'release/3.2.0-rc.2' } } };

test('installer paths bind current product filename and exact prerelease evidence directory', () => {
  const locations = installerArtifactPaths(fixtureProject, fixturePackage);
  assert.equal(locations.setup, path.join(fixtureProject, 'release/3.2.0-rc.2/Kvesser-Setup-3.2.0-rc.2.exe'));
  assert.equal(locations.executable, 'Kvesser.exe');
  assert.equal(locations.uninstaller, 'Uninstall Kvesser.exe');
  assert.equal(installerReceiptPath(locations), path.join(fixtureProject, 'artifacts/3.2.0-rc.2/verification/installer-acceptance.json'));
});

test('installer paths retain package-name fallback when productName is absent', () => {
  const locations = installerArtifactPaths(fixtureProject, { ...fixturePackage, productName: undefined, name: 'OtherProduct' });
  assert.equal(locations.executable, 'OtherProduct.exe');
  assert.equal(locations.uninstaller, 'Uninstall OtherProduct.exe');
});

test('installer paths reject traversal-bearing product or version values', () => {
  for (const productName of ['../foreign', 'C:\\foreign', 'bad"name', 'bad.']) {
    assert.throws(() => installerArtifactPaths(fixtureProject, { ...fixturePackage, productName }), /safe Windows filename/);
  }
  assert.throws(() => installerArtifactPaths(fixtureProject, { ...fixturePackage, version: '../../foreign' }), /safe semantic version/);
});

test('installer receipts reject an older version, sibling folder and traversal escape before launch', () => {
  const locations = installerArtifactPaths(fixtureProject, fixturePackage);
  for (const requested of [path.join(fixtureProject, 'artifacts/3.2.0/verification/receipt.json'),
    path.join(fixtureProject, 'artifacts/3.2.0-rc.2/verification-other/receipt.json'),
    path.join(locations.evidenceRoot, '../../outside.json')]) {
    assert.throws(() => installerReceiptPath(locations, requested), /current version/);
  }
});
