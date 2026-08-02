import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { AntigravityPathInput } from "./antigravityPaths.js";
import { resolveAntigravityPaths } from "./antigravityPaths.js";

export type AntigravityBackupFileKind = "stateDb" | "storageJson" | "machineId";

export interface AntigravityBackupFile {
  kind: AntigravityBackupFileKind;
  label: "state.vscdb" | "storage.json" | "machineid";
  sourcePath: string;
  backupPath: string;
  existed: boolean;
  sizeBytes: number | null;
}

export interface AntigravityProfileBackupManifest {
  id: string;
  createdAt: number;
  backupDir: string;
  files: AntigravityBackupFile[];
}

export interface AntigravityProfileBackupInput extends AntigravityPathInput {
  backupRoot: string;
}

export interface AntigravityProfileRestoreResult {
  restoredFiles: number;
  skippedFiles: number;
}

function profileFiles(input: AntigravityPathInput): Array<{ kind: AntigravityBackupFileKind; label: AntigravityBackupFile["label"]; sourcePath: string }> {
  const paths = resolveAntigravityPaths(input);
  return [
    { kind: "stateDb", label: "state.vscdb", sourcePath: paths.stateDbPath },
    { kind: "storageJson", label: "storage.json", sourcePath: paths.storageJsonPath },
    { kind: "machineId", label: "machineid", sourcePath: paths.machineIdPath }
  ];
}

function copyAtomically(sourcePath: string, destinationPath: string): void {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(sourcePath, tempPath);
  fs.renameSync(tempPath, destinationPath);
}

export function createAntigravityProfileBackup(input: AntigravityProfileBackupInput): AntigravityProfileBackupManifest {
  const id = `ag-backup-${Date.now()}-${nanoid(8)}`;
  const backupDir = path.join(input.backupRoot, id);
  fs.mkdirSync(backupDir, { recursive: true });

  const files = profileFiles(input).map((file): AntigravityBackupFile => {
    const backupPath = path.join(backupDir, file.label);
    if (!fs.existsSync(file.sourcePath)) {
      return { ...file, backupPath, existed: false, sizeBytes: null };
    }
    fs.copyFileSync(file.sourcePath, backupPath);
    const sizeBytes = fs.statSync(file.sourcePath).size;
    return { ...file, backupPath, existed: true, sizeBytes };
  });

  const manifest: AntigravityProfileBackupManifest = {
    id,
    createdAt: Math.floor(Date.now() / 1000),
    backupDir,
    files
  };
  fs.writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function restoreAntigravityProfileBackup(manifest: AntigravityProfileBackupManifest): AntigravityProfileRestoreResult {
  let restoredFiles = 0;
  let skippedFiles = 0;
  for (const file of manifest.files) {
    if (!file.existed || !fs.existsSync(file.backupPath)) {
      skippedFiles += 1;
      continue;
    }
    copyAtomically(file.backupPath, file.sourcePath);
    restoredFiles += 1;
  }
  return { restoredFiles, skippedFiles };
}
