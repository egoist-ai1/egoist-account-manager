import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const part of createReadStream(file)) hash.update(part);
  return hash.digest('hex');
}
async function run(file, args, timeoutMs = 180000, environment = process.env, launchOptions = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...launchOptions, windowsHide: true, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    const timer = setTimeout(() => {
      // Do not kill an in-progress deployment: it owns bounded file writes and a recovery journal.
      reject(Object.assign(new Error(`Installer did not finish within ${timeoutMs}ms; isolated files retained for inspection`), { pendingProcessId: child.pid }));
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
// NSIS requires its final /D= to remain unquoted even when the path has spaces.
// CreateProcess receives a fixed executable and literal arguments; no shell is used.
export function nsisTestInvocation(executable, directory) {
  if (!path.win32.isAbsolute(executable) || !/^[A-Za-z]:[\\/]/.test(directory)
      || /[\u0000"\r\n]/.test(executable + directory)) {
    throw new Error('NSIS test invocation requires safe absolute local paths');
  }
  return { args: ['/S', '/TEST', `/D=${directory}`], options: { argv0: `"${executable}"`, windowsVerbatimArguments: true } };
}
async function runTestSetup(setup, directory, environment) {
  const invocation = nsisTestInvocation(setup, directory);
  return run(setup, invocation.args, 180000, environment, invocation.options);
}

const integrationCommand = String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $registry = [ordered]@{}
  $entry = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO")
  if ($entry) {
    try {
      $names = $entry.GetValueNames()
      [Array]::Sort($names, [StringComparer]::Ordinal)
      foreach ($name in $names) { $registry[$name] = $entry.GetValue($name) }
    } finally { $entry.Dispose() }
  }
  $desktop = [Environment]::GetFolderPath("DesktopDirectory")
  $programs = [Environment]::GetFolderPath("Programs")
  $locations = [ordered]@{
    "desktop-current" = [IO.Path]::Combine($desktop, "Квессер.lnk")
    "programs-current" = [IO.Path]::Combine($programs, "Квессер", "Квессер.lnk")
    "desktop-previous" = [IO.Path]::Combine($desktop, "Egoist.lnk")
    "programs-previous" = [IO.Path]::Combine($programs, "Egoist", "Egoist.lnk")
    "desktop-legacy" = [IO.Path]::Combine($desktop, "Account Manager EGO.lnk")
    "programs-legacy" = [IO.Path]::Combine($programs, "Account Manager EGO", "Account Manager EGO.lnk")
  }
  $links = [ordered]@{}
  foreach ($label in $locations.Keys) {
    $location = $locations[$label]
    if ([IO.File]::Exists($location)) {
      $stream = $null; $fileHasher = $null
      try {
        $stream = [IO.File]::OpenRead($location)
        $fileHasher = [Security.Cryptography.SHA256]::Create()
        $links[$label] = [BitConverter]::ToString($fileHasher.ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
      } finally {
        if ($stream) { $stream.Dispose() }
        if ($fileHasher) { $fileHasher.Dispose() }
      }
    } else { $links[$label] = $null }
  }
  $snapshot = [ordered]@{ registry = $registry; links = $links } | ConvertTo-Json -Depth 5 -Compress
  $hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($snapshot)
    [Console]::Out.WriteLine([BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant())
  } finally { $hasher.Dispose() }
} catch {
  $diagnostic = [ordered]@{
    category = $_.CategoryInfo.Category.ToString()
    errorId = $_.FullyQualifiedErrorId
    errorType = $_.Exception.GetType().FullName
    command = $_.InvocationInfo.MyCommand.Name
    line = $_.InvocationInfo.ScriptLineNumber
    column = $_.InvocationInfo.OffsetInLine
  }
  [Console]::Error.WriteLine(($diagnostic | ConvertTo-Json -Compress))
  exit 1
}`;

function boundaryDiagnostic(result) {
  const stderr = String(result.stderr ?? '');
  const diagnostic = { exitCode: result.code, stderrBytes: Buffer.byteLength(stderr), stderrSha256: crypto.createHash('sha256').update(stderr).digest('hex') };
  try {
    const parsed = JSON.parse(stderr.trim().replace(/^\uFEFF/, ''));
    const allowed = {
      category: /^[A-Za-z]{1,64}$/,
      errorType: /^System\.[A-Za-z0-9_.+]{1,140}$/,
      errorId: /^(?:CommandNotFoundException|MethodInvocationException|InvalidOperationException|RuntimeException|System\.[A-Za-z0-9_.]*Exception)(?:,Microsoft\.PowerShell\.Commands\.[A-Za-z]+Command)?$/,
      command: /^(?:[A-Za-z]+-[A-Za-z]+)$/
    };
    for (const [key, pattern] of Object.entries(allowed)) {
      if (typeof parsed[key] === 'string' && pattern.test(parsed[key])) diagnostic[key] = parsed[key];
    }
    for (const key of ['line', 'column']) if (Number.isSafeInteger(parsed[key]) && parsed[key] >= 0) diagnostic[key] = parsed[key];
  } catch { /* Preserve a fingerprint, never arbitrary registry/path output. */ }
  return diagnostic;
}

export async function integrationDigest(options = {}) {
  const runner = options.runner ?? run;
  let result;
  try {
    result = await runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', integrationCommand], 15000);
  } catch (cause) {
    const diagnostic = { launcherErrorCode: /^[A-Z0-9_]{1,40}$/.test(cause.code ?? '') ? cause.code : 'UNAVAILABLE' };
    throw Object.assign(new Error(`Unable to observe the integration boundary (PowerShell ${diagnostic.launcherErrorCode})`, { cause }), {
      integrationDiagnostic: diagnostic, pendingProcessId: cause.pendingProcessId
    });
  }
  if (result.code !== 0) {
    const diagnostic = boundaryDiagnostic(result);
    const details = Object.entries(diagnostic).filter(([key]) => !key.startsWith('stderr')).map(([key, value]) => `${key}=${value}`).join('; ');
    throw Object.assign(new Error(`Unable to observe the integration boundary (${details}); stderr fingerprint=${diagnostic.stderrSha256}`), { integrationDiagnostic: diagnostic });
  }
  const digest = String(result.stdout ?? '').trim();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw Object.assign(new Error('Unable to observe the integration boundary (invalid digest response)'), { integrationDiagnostic: { exitCode: result.code, outputBytes: Buffer.byteLength(String(result.stdout ?? '')) } });
  }
  return digest;
}

async function requireCondition(condition, message) { if (!condition) throw new Error(message); }
async function waitRemoved(file, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { await fs.access(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Native uninstaller did not remove its owned files in time');
}

export async function verifyCustomInstallerReceipt(projectRoot, pkg, setup) {
  const setupHash = await hashFile(setup);
  const buildReceipt = JSON.parse(await fs.readFile(path.join(projectRoot, pkg.build.directories.output, 'installer-build', 'ownership-receipt.json'), 'utf8'));
  if (buildReceipt.schemaVersion !== 1 || buildReceipt.appId !== pkg.build.appId || buildReceipt.version !== pkg.version
      || buildReceipt.setupSha256 !== setupHash || buildReceipt.testMode !== 'manifest-owned-no-integration'
      || buildReceipt.nsisSha256 !== await hashFile(path.join(projectRoot, 'src/installer/setup.nsi'))
      || buildReceipt.ownershipSourceSha256 !== await hashFile(path.join(projectRoot, 'src/installer/InstallOwnership.cs'))
      || buildReceipt.uiSourceSha256 !== await hashFile(path.join(projectRoot, 'src/installer/ModernInstaller.cs'))
      || buildReceipt.legacyOwnershipSha256 !== await hashFile(path.join(projectRoot, 'assets/legacy/3.1.10-ownership.json'))) {
    throw new Error('Shipping setup is not the verified custom manifest-owned installer; refusing execution');
  }
  return setupHash;
}

export function installerArtifactPaths(projectRoot, pkg) {
  const productName = pkg.productName ?? pkg.name;
  if (typeof productName !== 'string' || !productName || /[<>:"/\\|?*\u0000-\u001F]/.test(productName) || /[. ]$/.test(productName)) {
    throw new Error('Installer product name must be a safe Windows filename');
  }
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    throw new Error('Installer version must be a safe semantic version');
  }
  return { setup: path.join(projectRoot, pkg.build.directories.output, `${productName}-Setup-${pkg.version}.exe`),
    executable: `${productName}.exe`, uninstaller: `Uninstall ${productName}.exe`, productName,
    evidenceRoot: path.join(projectRoot, 'artifacts', pkg.version, 'verification') };
}

export function installerReceiptPath(locations, requested) {
  const destination = path.resolve(requested ?? path.join(locations.evidenceRoot, 'installer-acceptance.json'));
  if (!destination.toLowerCase().startsWith(path.resolve(locations.evidenceRoot).toLowerCase() + path.sep)) {
    throw new Error('Installer receipt must stay in current version project verification artifacts');
  }
  return destination;
}

export async function verifyOwnedInstaller(options = {}) {
  if (process.platform !== 'win32') throw new Error('Native installer acceptance requires Windows');
  const work = options.work ?? process.env.CAM_TEST_WORKDIR;
  if (!work || !path.isAbsolute(work)) throw new Error('CAM_TEST_WORKDIR must name the calling task isolated work directory');
  const workRoot = path.resolve(work);
  const workInfo = await fs.lstat(workRoot);
  if (!workInfo.isDirectory() || workInfo.isSymbolicLink()) throw new Error('Task work must be a regular directory');
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const locations = installerArtifactPaths(root, pkg);
  const destination = installerReceiptPath(locations, options.receipt);
  const setup = options.setup ?? locations.setup;
  const setupHash = await verifyCustomInstallerReceipt(root, pkg, setup);
  const scratch = await fs.mkdtemp(path.join(workRoot, 'ia-'));
  const target = path.join(scratch, locations.productName);
  const pluginTemp = path.join(scratch, 'temp');
  await fs.mkdir(pluginTemp);
  const installerEnvironment = { ...process.env, TEMP: pluginTemp, TMP: pluginTemp };
  const foreignTarget = path.join(scratch, 'Foreign');
  const report = { schemaVersion: 1, version: pkg.version, setupSha256: setupHash, applicationLaunched: false,
    testMode: true, integrationUnchanged: false, checks: [], startedAt: new Date().toISOString(), status: 'running' };
  const persistReport = async () => {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n', 'utf8');
  };
  try {
    report.stage = 'observe-integration-before';
    const beforeIntegration = await integrationDigest();
    report.integrationBefore = beforeIntegration;
    report.stage = 'reject-foreign-target';
    await persistReport();
    await fs.mkdir(foreignTarget);
    await fs.writeFile(path.join(foreignTarget, 'sentinel.txt'), 'must remain untouched');
    const denied = await runTestSetup(setup, foreignTarget, installerEnvironment);
    await requireCondition(denied.code !== 0 && (await fs.readdir(foreignTarget)).length === 1, 'Nonempty foreign target was not rejected');
    await requireCondition(await fs.readFile(path.join(foreignTarget, 'sentinel.txt'), 'utf8') === 'must remain untouched', 'Foreign target changed');
    report.checks.push({ id: 'foreign-target-rejected', passed: true, exitCode: denied.code });
    report.stage = 'install';
    await persistReport();
    const install = await runTestSetup(setup, target, installerEnvironment);
    await requireCondition(install.code === 0, `Native setup failed with ${install.code}`);
    const installed = JSON.parse(await fs.readFile(path.join(target, '.egoist-install.json'), 'utf8'));
    await requireCondition(installed.appId === pkg.build.appId && installed.version === pkg.version && installed.testMode === true && installed.installRoot.toLowerCase() === target.toLowerCase(), 'Installed ownership identity mismatch');
    for (const entry of installed.files) await requireCondition(await hashFile(path.join(target, entry.relativePath)) === entry.sha256, `Installed file hash mismatch: ${entry.relativePath}`);
    report.checks.push({ id: 'native-install-all-hashes', passed: true, fileCount: installed.files.length });
    const sentinel = path.join(target, 'foreign-sentinel.txt');
    const nested = path.join(target, 'resources', 'user-notes.json');
    await fs.writeFile(sentinel, 'foreign root bytes');
    await fs.writeFile(nested, 'foreign nested bytes');
    report.stage = 'upgrade';
    await persistReport();
    const upgrade = await runTestSetup(setup, target, installerEnvironment);
    await requireCondition(upgrade.code === 0, `Owned native upgrade failed with ${upgrade.code}`);
    await requireCondition(await fs.readFile(sentinel, 'utf8') === 'foreign root bytes' && await fs.readFile(nested, 'utf8') === 'foreign nested bytes', 'Owned upgrade changed foreign data');
    report.checks.push({ id: 'owned-native-upgrade', passed: true });
    report.stage = 'uninstall';
    await persistReport();
    const uninstall = await run(path.join(target, locations.uninstaller), ['/S'], 180000, installerEnvironment);
    await requireCondition(uninstall.code === 0, `Native uninstaller launcher failed with ${uninstall.code}`);
    // NSIS relocates its own executable before deletion; wait for the relocated child evidence.
    await waitRemoved(path.join(target, '.egoist-install.json'));
    await requireCondition(await fs.readFile(sentinel, 'utf8') === 'foreign root bytes' && await fs.readFile(nested, 'utf8') === 'foreign nested bytes', 'Uninstall changed foreign data');
    try { await fs.access(path.join(target, locations.executable)); throw new Error('Owned executable survived uninstall'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    report.checks.push({ id: 'uninstall-preserves-foreign-sentinels', passed: true });
    report.stage = 'observe-integration-after';
    const afterIntegration = await integrationDigest();
    report.integrationAfter = afterIntegration;
    await requireCondition(afterIntegration === beforeIntegration, 'Test installation changed user registry or shortcuts');
    report.integrationUnchanged = true;
    report.checks.push({ id: 'integration-boundary-unchanged', passed: true });
    report.stage = 'complete';
    report.status = 'passed';
    const finalRoot = path.resolve(scratch);
    await requireCondition(finalRoot.startsWith(workRoot + path.sep) && !(await fs.lstat(finalRoot)).isSymbolicLink(), 'Cleanup escaped the task work directory');
    await fs.rm(finalRoot, { recursive: true, force: true });
  } catch (error) {
    report.status = 'failed'; report.error = error.message; report.retainedWork = scratch;
    if (error.pendingProcessId) report.pendingProcessId = error.pendingProcessId;
    if (error.integrationDiagnostic) report.integrationDiagnostic = error.integrationDiagnostic;
    throw Object.assign(error, { installerReport: report });
  } finally {
    report.finishedAt = new Date().toISOString();
    await persistReport();
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await verifyOwnedInstaller();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}