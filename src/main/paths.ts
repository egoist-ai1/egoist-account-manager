import os from "node:os";
import path from "node:path";
import { app } from "electron";

export function getDefaultCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  if (configured && path.isAbsolute(configured)) return path.normalize(configured);
  return path.join(os.homedir(), ".codex");
}

export function getDefaultWorkspacePath(): string {
  return path.join(os.homedir(), "Desktop", "EgoistCODEX");
}

export function getAppDataDir(): string {
  return app.getPath("userData");
}

export function getProfilesDir(appDataDir: string): string {
  return path.join(appDataDir, "profiles");
}

export function getProfileDir(appDataDir: string, profileId: string): string {
  return path.join(getProfilesDir(appDataDir), profileId);
}

export function getAuthJsonPath(codexHome: string): string {
  return path.join(codexHome, "auth.json");
}
