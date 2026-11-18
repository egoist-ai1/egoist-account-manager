import path from 'node:path';
import { createRequire } from 'node:module';

export function resolveBuilderWindowsToolsets(projectRoot) {
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
  const builderRequire = createRequire(projectRequire.resolve('electron-builder/package.json'));
  const builderRoot = path.dirname(builderRequire.resolve('app-builder-lib/package.json'));
  const toolsets = builderRequire(path.join(builderRoot, 'out', 'toolsets', 'windows.js'));
  if (typeof toolsets.getMakeNsisPath !== 'function' || typeof toolsets.getNsisPluginsPath !== 'function') {
    throw new Error('Installed electron-builder does not provide the required NSIS toolset API');
  }
  return toolsets;
}

export async function resolveInstallerTools(projectRoot, pkg, options = {}) {
  const environment = options.environment ?? process.env;
  const tools = environment.MAKENSIS && environment.NSIS_PLUGIN_DIR
    ? null : options.windowsToolsets ?? resolveBuilderWindowsToolsets(projectRoot);
  const [makensis, plugins] = await Promise.all([
    environment.MAKENSIS ? { path: environment.MAKENSIS }
      : tools.getMakeNsisPath(pkg.build?.toolsets?.nsis, pkg.build?.nsis?.customNsisBinary),
    environment.NSIS_PLUGIN_DIR ? environment.NSIS_PLUGIN_DIR
      : tools.getNsisPluginsPath(pkg.build?.toolsets?.nsis, pkg.build?.nsis?.customNsisResources)
        .then((directory) => path.join(directory, 'x86-unicode'))
  ]);
  if (!makensis?.path || !plugins) throw new Error('Unable to resolve the NSIS executable/plugins');
  return { path: makensis.path, pluginDir: plugins, env: { ...environment, ...makensis.env } };
}
