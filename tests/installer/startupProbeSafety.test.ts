import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/verify-packaged-startup.ps1');
function rejected(args: string[], message: string) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8', timeout: 10000 });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(message);
}

describe('packaged startup probe launch boundary', () => {
  it('rejects sibling paths that merely share the unpacked directory prefix', () => {
    rejected(['-ExecutablePath', path.resolve('release/win-unpacked-other/Account Manager EGO.exe')], 'release/win-unpacked');
  });
  it('rejects arbitrary executables under installed mode before launching anything', () => {
    rejected(['-Installed', '-ExecutablePath', path.resolve('release/win-unpacked/Account Manager EGO.exe')], 'exact current-user');
  });
  it('requires test-install targets to reside under the current TEMP boundary', () => {
    rejected(['-InstallTestRoot', path.resolve('release/win-unpacked')], 'child of the current TEMP');
  });
  it('requires an isolated installation marker for a TEMP child', () => {
    rejected(['-InstallTestRoot', path.join(process.env.TEMP ?? 'C:\\Temp', 'missing-test-install-' + Date.now())], '/TEST installation marker');
  });
  it('isolates every auth/profile path and binds cleanup to process creation identity', async () => {
    const source = await fs.readFile(script, 'utf8');
    for (const variable of ['CODEX_HOME', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CAM_USER_DATA_DIR', 'CAM_BACKGROUND_PROBE', 'CAM_DISABLE_EXTERNAL_APP_LAUNCH']) {
      expect(source).toContain(variable);
    }
    expect(source).toContain('CreationDate.ToUniversalTime().Ticks -eq $ownedProcesses');
    expect(source).toContain('$candidateId -eq $launchedPid');
    expect(source).not.toContain('ExecutablePath.StartsWith($executableRoot');
    expect(source).toContain('GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)');
  });
});