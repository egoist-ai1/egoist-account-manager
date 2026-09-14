import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveAntigravityPaths, type AntigravityPathInput } from "./antigravityPaths.js";
import { cleanAntigravitySessionCache } from "./antigravityProcessService.js";
import type { AntigravityHygieneResult } from "../../shared/types.js";

function getFolderSizeAndClean(dirPath: string): { freedBytes: number; deletedCount: number; errors: string[] } {
  let freedBytes = 0;
  let deletedCount = 0;
  const errors: string[] = [];

  if (!fs.existsSync(dirPath)) {
    return { freedBytes, deletedCount, errors };
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = getFolderSizeAndClean(fullPath);
          freedBytes += sub.freedBytes;
          deletedCount += sub.deletedCount;
          errors.push(...sub.errors);
          fs.rmdirSync(fullPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          freedBytes += stat.size;
          fs.unlinkSync(fullPath);
          deletedCount++;
        }
      } catch (err) {
        errors.push(`${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`${dirPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { freedBytes, deletedCount, errors };
}

/**
 * Performs Context & Session Hygiene on Antigravity IDE state:
 * - Purges stale lockfiles (SingletonLock, lockfile, DevToolsActivePort, etc.)
 * - Cleans ephemeral GPU caches
 * - Cleans crash reporter dumps
 */
export function performAntigravityHygiene(
  input: AntigravityPathInput = {}
): AntigravityHygieneResult {
  const paths = resolveAntigravityPaths(input);
  const home = input.home ?? os.homedir();
  const cleanedLocks: string[] = [];
  const cleanedCaches: string[] = [];
  const errors: string[] = [];
  let freedBytes = 0;

  // 1. Session lockfiles
  const lockResult = cleanAntigravitySessionCache(input);
  cleanedLocks.push(...lockResult.cleaned);
  errors.push(...lockResult.errors);

  // 2. Ephemeral GPU caches
  const cacheDirs = [
    path.join(paths.userDataDir, "DawnWebGPUCache"),
    path.join(paths.userDataDir, "GPUCache")
  ];

  for (const cacheDir of cacheDirs) {
    if (fs.existsSync(cacheDir)) {
      const result = getFolderSizeAndClean(cacheDir);
      freedBytes += result.freedBytes;
      if (result.deletedCount > 0) {
        cleanedCaches.push(`${cacheDir} (${result.deletedCount} files)`);
      }
      errors.push(...result.errors);
    }
  }

  // 3. Crash dumps in ~/.gemini/antigravity/crashes
  const crashDir = path.join(home, ".gemini", "antigravity", "crashes");
  if (fs.existsSync(crashDir)) {
    const result = getFolderSizeAndClean(crashDir);
    freedBytes += result.freedBytes;
    if (result.deletedCount > 0) {
      cleanedCaches.push(`${crashDir} (${result.deletedCount} files)`);
    }
    errors.push(...result.errors);
  }

  return {
    cleanedLocks,
    cleanedCaches,
    freedBytes,
    errors
  };
}
