import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AntigravityDiagnostics } from "../../shared/types.js";

export interface AntigravityPathInput {
  platform?: NodeJS.Platform;
  appData?: string;
  home?: string;
}

export interface AntigravityPaths {
  profileKind: "hub" | "vscode_ide" | "legacy_vscode_ide" | "unknown";
  userDataDir: string;
  globalStorageDir: string;
  stateDbPath: string;
  storageJsonPath: string;
  machineIdPath: string;
  appStoragePath: string;
  geminiDataDir: string;
  installationIdPath: string;
}

export function resolveAntigravityPaths(input: AntigravityPathInput = {}): AntigravityPaths {
  const platform = input.platform ?? process.platform;
  const home = input.home ?? os.homedir();
  const platformDirs = (() => {
    if (platform === "win32") {
      const appData = input.appData ?? path.join(home, "AppData", "Roaming");
      return {
        currentIde: path.join(appData, "Antigravity IDE"),
        hub: path.join(appData, "Antigravity")
      };
    }
    if (platform === "darwin") {
      const appSupport = path.join(home, "Library", "Application Support");
      return {
        currentIde: path.join(appSupport, "Antigravity IDE"),
        hub: path.join(appSupport, "Antigravity")
      };
    }
    const config = path.join(home, ".config");
    return {
      currentIde: path.join(config, "Antigravity IDE"),
      hub: path.join(config, "Antigravity")
    };
  })();

  const geminiDataDir = path.join(home, ".gemini", "antigravity");
  const installationIdPath = path.join(geminiDataDir, "installation_id");
  const appStoragePath = path.join(platformDirs.hub, "app_storage.json");
  const currentGlobalStorageDir = path.join(platformDirs.currentIde, "User", "globalStorage");
  const legacyGlobalStorageDir = path.join(platformDirs.hub, "User", "globalStorage");
  const currentStateDbPath = path.join(currentGlobalStorageDir, "state.vscdb");
  const legacyStateDbPath = path.join(legacyGlobalStorageDir, "state.vscdb");

  let profileKind: AntigravityPaths["profileKind"] = "unknown";
  let userDataDir = platformDirs.currentIde;
  let globalStorageDir = currentGlobalStorageDir;
  let storageJsonPath = path.join(currentGlobalStorageDir, "storage.json");
  let machineIdPath = path.join(platformDirs.currentIde, "machineid");

  if (fs.existsSync(platformDirs.currentIde) || fs.existsSync(currentStateDbPath)) {
    profileKind = "vscode_ide";
  } else if (fs.existsSync(legacyStateDbPath)) {
    profileKind = "legacy_vscode_ide";
    userDataDir = platformDirs.hub;
    globalStorageDir = legacyGlobalStorageDir;
    storageJsonPath = path.join(legacyGlobalStorageDir, "storage.json");
    machineIdPath = path.join(platformDirs.hub, "machineid");
  } else if (fs.existsSync(platformDirs.hub) || fs.existsSync(geminiDataDir) || fs.existsSync(appStoragePath)) {
    profileKind = "hub";
    userDataDir = platformDirs.hub;
    globalStorageDir = legacyGlobalStorageDir;
    storageJsonPath = appStoragePath;
    machineIdPath = installationIdPath;
  }

  return {
    profileKind,
    userDataDir,
    globalStorageDir,
    stateDbPath: path.join(globalStorageDir, "state.vscdb"),
    storageJsonPath,
    machineIdPath,
    appStoragePath,
    geminiDataDir,
    installationIdPath
  };
}

export function getAntigravityDiagnostics(input: AntigravityPathInput = {}): AntigravityDiagnostics {
  const paths = resolveAntigravityPaths(input);
  return {
    ...paths,
    userDataDirExists: fs.existsSync(paths.userDataDir),
    stateDbExists: fs.existsSync(paths.stateDbPath),
    storageJsonExists: fs.existsSync(paths.storageJsonPath),
    machineIdExists: fs.existsSync(paths.machineIdPath),
    appStorageExists: fs.existsSync(paths.appStoragePath),
    geminiDataDirExists: fs.existsSync(paths.geminiDataDir),
    installationIdExists: fs.existsSync(paths.installationIdPath)
  };
}
