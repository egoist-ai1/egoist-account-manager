import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { windowsNumericVersion } from './installer-ownership.mjs';

if (process.platform === 'win32') {
  const root = path.resolve(import.meta.dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = windowsNumericVersion(pkg);
  const framework = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const source = path.join(root, 'src', 'taskbar');
  const output = path.join(root, 'build', 'taskbar');
  fs.mkdirSync(output, { recursive: true });

  const assemblyInfo = path.join(output, 'AssemblyInfo.cs');
  fs.writeFileSync(assemblyInfo, [
    '[assembly: System.Reflection.AssemblyTitle("Квессер — лимиты на панели задач")]',
    `[assembly: System.Reflection.AssemblyProduct("${pkg.productName}")]`,
    `[assembly: System.Reflection.AssemblyVersion("${version}")]`,
    `[assembly: System.Reflection.AssemblyFileVersion("${version}")]`,
    `[assembly: System.Reflection.AssemblyInformationalVersion("${pkg.version}")]`
  ].join('\n') + '\n', 'utf8');

  const compiler = spawnSync(path.join(framework, 'csc.exe'), [
    '/nologo',
    '/codepage:65001',
    '/platform:x64',
    '/target:winexe',
    '/optimize+',
    `/lib:${path.join(framework, 'WPF')}`,
    '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll',
    '/r:WindowsBase.dll',
    '/r:UIAutomationClient.dll',
    '/r:UIAutomationTypes.dll',
    `/win32manifest:${path.join(source, 'KvesserQuotaWidget.manifest')}`,
    `/out:${path.join(output, 'KvesserQuotaWidget.exe')}`,
    path.join(source, 'KvesserQuotaWidget.cs'),
    path.join(source, 'QuotaGlyphs.cs'),
    assemblyInfo
  ], { stdio: 'inherit', windowsHide: true });
  if (compiler.error) throw compiler.error;
  if (compiler.status !== 0) throw new Error(`Quota widget compiler exited with status ${compiler.status}`);
}
