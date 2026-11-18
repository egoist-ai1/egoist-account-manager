import fs from "node:fs";
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

export function assertManagedPath(root: string, target: string, allowRoot = false): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if ((!relative && !allowRoot) || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Managed path escaped its owned directory");
  }
  // lstat catches Windows junctions as well as ordinary symlinks. Inspect existing
  // ancestors too: realpath alone would legitimize a redirected managed root.
  let current = resolvedTarget;
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Managed path crosses a reparse point");
      const canonical = fs.realpathSync.native(current);
      const same = process.platform === "win32" ? canonical.toLowerCase() === current.toLowerCase() : canonical === current;
      if (!same) throw new Error("Managed path is redirected by a reparse point or is not canonical");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolvedTarget;
}

export function getProfileDir(appDataDir: string, profileId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(profileId) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(profileId)) {
    throw new Error("Invalid managed profile id");
  }
  return assertManagedPath(getProfilesDir(appDataDir), path.join(getProfilesDir(appDataDir), profileId));
}

export function getAuthJsonPath(codexHome: string): string {
  return path.join(codexHome, "auth.json");
}
