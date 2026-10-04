import fs from 'node:fs/promises';
import path from 'node:path';
import { extractFile, listPackage, statFile } from '@electron/asar';

async function filesIn(directory, relative = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(directory, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unsupported payload source entry: ${name}`);
  }
  return files;
}

export async function verifyInstallerPayload(root, payloadDir, pkg) {
  const executable = path.join(payloadDir, `${pkg.productName}.exe`);
  if (!(await fs.stat(executable)).isFile()) throw new Error('Missing application executable');
  const asar = path.join(payloadDir, 'resources', 'app.asar');
  const packedPackage = JSON.parse(extractFile(asar, 'package.json').toString('utf8'));
  for (const key of ['name', 'productName', 'version', 'main']) {
    if (packedPackage[key] !== pkg[key]) throw new Error(`Payload package ${key} does not match: ${packedPackage[key]} != ${pkg[key]}`);
  }
  const files = await filesIn(path.join(root, 'dist'));
  if (files.length === 0 || !files.includes(pkg.main.replace(/^dist\//, ''))) throw new Error('Missing built application entry point');
  const packedFiles = listPackage(asar).map((name) => name.replaceAll('\\', '/').replace(/^\//, ''))
    .filter((name) => name.startsWith('dist/') && !statFile(asar, name.split('/').join(path.sep)).files);
  const sourceFiles = files.map((name) => `dist/${name}`).sort();
  if (JSON.stringify(packedFiles.sort()) !== JSON.stringify(sourceFiles)) throw new Error('Payload dist file set does not match build output');
  for (const name of sourceFiles) {
    if (!(await fs.readFile(path.join(root, name))).equals(extractFile(asar, name.split('/').join(path.sep)))) throw new Error(`Payload differs from build output: ${name}`);
  }
  for (const [source, packed] of [['assets/icon.ico', 'assets/icon.ico'], ['assets/icon.png', null]]) {
    const expected = await fs.readFile(path.join(root, source));
    const actual = packed ? extractFile(asar, packed.split('/').join(path.sep)) : await fs.readFile(path.join(payloadDir, 'resources', 'icon.png'));
    if (!expected.equals(actual)) throw new Error(`Payload resource differs: ${source}`);
  }
}
export function verifyExecutableMetadata(metadata, pkg) {
  if (metadata.productName !== pkg.productName
      || metadata.fileVersion !== pkg.version
      || metadata.productVersion !== `${pkg.version}.0`) {
    throw new Error('Payload executable identity/version does not match package.json');
  }
}
