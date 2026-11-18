import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const installerAppId = 'one.egoist.codex-account-manager';

export function windowsNumericVersion(pkg) {
  const explicit = pkg.build?.buildVersion ?? pkg.buildVersion;
  const semantic = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(pkg.version);
  if (!semantic) throw new Error('Invalid release version');
  const revision = semantic[4] ? /(?:^|\.)(\d+)$/.exec(semantic[4])?.[1] ?? '0' : '0';
  const value = explicit ?? `${semantic[1]}.${semantic[2]}.${semantic[3]}.${revision}`;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(value) || value.split('.').some((part) => Number(part) > 65535)) {
    throw new Error('Windows version must contain four numeric components in 0..65535');
  }
  return value;
}

export function validateOwnedRelativePath(relative) {
  if (!relative || relative.length > 220 || relative.includes('\\') || relative.startsWith('/') || relative.endsWith('/')) {
    throw new Error('Invalid installer relative path');
  }
  for (const part of relative.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) || /[<>:"|?*\u0000-\u001f]/.test(part)
        || /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(part)) {
      throw new Error('Invalid installer relative path');
    }
  }
  return relative;
}

export async function createOwnershipManifest(payloadDir, pkg) {
  if (pkg.productName !== 'Kvesser' || pkg.build?.appId !== installerAppId) throw new Error('Installer identity mismatch');
  const files = [];
  const seen = new Set();
  async function walk(relative = '') {
    for (const entry of await fs.readdir(path.join(payloadDir, relative), { withFileTypes: true })) {
      const name = validateOwnedRelativePath(path.posix.join(relative, entry.name));
      const source = path.join(payloadDir, name);
      const info = await fs.lstat(source);
      if (info.isSymbolicLink() || !entry.isDirectory() && (!entry.isFile() || info.nlink !== 1)) {
        throw new Error(`Linked or unsupported installer payload: ${name}`);
      }
      if (entry.isDirectory()) await walk(name);
      else {
        if (['.egoist-install.json', 'Uninstall Kvesser.exe', 'Uninstall Egoist.exe', 'installer-test.flag'].includes(name) || seen.has(name.toLowerCase())) {
          throw new Error(`Reserved or duplicate installer payload: ${name}`);
        }
        seen.add(name.toLowerCase());
        const hash = crypto.createHash('sha256');
        for await (const data of createReadStream(source)) hash.update(data);
        files.push({ relativePath: name, sha256: hash.digest('hex') });
      }
    }
  }
  await walk();
  if (!seen.has('kvesser.exe') || !seen.has('resources/app.asar')) throw new Error('Incomplete installer payload');
  return { schemaVersion: 1, appId: installerAppId, version: pkg.version, files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)) };
}