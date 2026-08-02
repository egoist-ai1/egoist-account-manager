import path from "node:path";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";

/** @param {import("electron-builder").AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // The renderer is intentionally loaded from the exact packaged file URL.
    // Disabling this fuse makes Electron reject that ASAR-backed loadFile path.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true
  });
}
