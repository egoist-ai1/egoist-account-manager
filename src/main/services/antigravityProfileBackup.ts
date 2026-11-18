import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { assertManagedPath } from "../paths.js";
import { resolveAntigravityPaths, type AntigravityPathInput } from "./antigravityPaths.js";

export type AntigravityBackupFileKind = "stateDb" | "secondaryStateDb" | "storageJson" | "machineId" | "appStorage" | "installationId" | "sessionCache";

export interface AntigravityBackupFile {
  kind: AntigravityBackupFileKind;
  label: string;
  sourcePath: string;
  backupPath: string;
  existed: boolean;
  sizeBytes: number | null;
  hash?: string | null;
}

export interface AntigravityCredentialSnapshot {
  existed: boolean;
  value: string | null;
}

export interface AntigravityBackupRuntime {
  target: NonNullable<AntigravityPathInput["target"]>;
  exePath: string | null;
  wasRunning: boolean;
}

export interface AntigravityProfileBackupManifest {
  version?: 2;
  id: string;
  createdAt: number;
  backupDir: string;
  files: AntigravityBackupFile[];
  credentialSnapshot?: { existed: boolean; sealedValue: string; hash: string };
  runtime?: AntigravityBackupRuntime;
  sealedManifest?: string;
}

export interface AntigravityBackupProtection {
  sealBackup?: (contents: string) => string;
  unsealBackup?: (ciphertext: string) => string;
  credentialSnapshot?: AntigravityCredentialSnapshot;
  existingBackup?: AntigravityProfileBackupManifest;
}

export interface AntigravityProfileBackupInput extends AntigravityPathInput, AntigravityBackupProtection {
  backupRoot: string;
  runtime?: AntigravityBackupRuntime;
}

export interface AntigravityProfileRestoreOptions {
  unsealBackup: (ciphertext: string) => string;
  pathInput: AntigravityPathInput;
  backupRoot?: string;
}

export interface AntigravityProfileRestoreResult {
  restoredFiles: number;
  skippedFiles: number;
  verified: true;
  credentialSnapshot?: AntigravityCredentialSnapshot;
}

interface SnapshotPayload {
  sourcePath: string;
  existed: boolean;
  contents: string | null;
  hash: string | null;
}

function profileFiles(input: AntigravityPathInput): Array<{ kind: AntigravityBackupFileKind; label: string; sourcePath: string }> {
  const platform = input.platform ?? process.platform;
  const home = input.home ?? os.homedir();
  const configRoot = platform === "win32" ? input.appData ?? path.join(home, "AppData", "Roaming")
    : platform === "darwin" ? path.join(home, "Library", "Application Support") : path.join(home, ".config");
  const files: Array<{ kind: AntigravityBackupFileKind; label: string; sourcePath: string }> = [];
  if (input.target === "hub") return files;
  const idePath = input.target === "ide" ? resolveAntigravityPaths(input).userDataDir : null;
  for (const [index, directory] of ["Antigravity IDE", "Antigravity"].entries()) {
    const userDir = path.join(configRoot, directory);
    if (idePath && path.resolve(idePath) !== path.resolve(userDir)) continue;
    const storageDir = path.join(userDir, "User", "globalStorage");
    files.push(
      { kind: index === 0 ? "stateDb" : "secondaryStateDb", label: index === 0 ? "state.vscdb" : "secondary-state.vscdb", sourcePath: path.join(storageDir, "state.vscdb") },
      { kind: "storageJson", label: `${index}-storage.json`, sourcePath: path.join(storageDir, "storage.json") },
      { kind: "machineId", label: `${index}-machineid`, sourcePath: path.join(userDir, "machineid") }
    );
    for (const name of ["lockfile", "DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      files.push({ kind: "sessionCache", label: `cache-${index}-${name}`, sourcePath: path.join(userDir, name) });
    }
  }
  if (!idePath) {
    files.push(
      { kind: "appStorage", label: "app_storage.json", sourcePath: path.join(configRoot, "Antigravity", "app_storage.json") },
      { kind: "installationId", label: "installation_id", sourcePath: path.join(home, ".gemini", "antigravity", "installation_id") }
    );
  }
  return files;
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function verifySqlite(bytes: Buffer): void {
  if (bytes.length < 100 || bytes.subarray(0, 16).toString("binary") !== "SQLite format 3\0") throw new Error("Invalid Antigravity SQLite snapshot header");
  const memoryBytes = Buffer.from(bytes);
  // sqlite3_deserialize cannot read WAL-format headers; normalize this validation
  // copy only, as specified by SQLite. The sealed snapshot keeps its original mode.
  memoryBytes[18] = 1;
  memoryBytes[19] = 1;
  const db = new Database(memoryBytes);
  try {
    if (db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("Antigravity SQLite snapshot integrity check failed");
  } finally {
    db.close();
    memoryBytes.fill(0);
  }
}

function snapshotSqlite(filePath: string): Buffer {
  const db = new Database(filePath, { readonly: true, fileMustExist: true, timeout: 5_000 });
  try {
    db.exec("BEGIN");
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    if (db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("Antigravity source SQLite integrity check failed");
    const bytes = db.serialize();
    verifySqlite(bytes);
    return bytes;
  } finally {
    if (db.inTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

function snapshotFile(file: { kind: AntigravityBackupFileKind; sourcePath: string }): Buffer | null {
  assertManagedPath(path.dirname(file.sourcePath), file.sourcePath);
  if (!fs.existsSync(file.sourcePath)) return null;
  if (!fs.statSync(file.sourcePath).isFile()) throw new Error("Antigravity snapshot target is not a regular file");
  if (file.kind === "stateDb" || file.kind === "secondaryStateDb") return snapshotSqlite(file.sourcePath);
  const before = fs.statSync(file.sourcePath);
  const first = fs.readFileSync(file.sourcePath);
  const after = fs.statSync(file.sourcePath);
  const second = fs.readFileSync(file.sourcePath);
  try {
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || !first.equals(second)) throw new Error("Antigravity profile changed during snapshot");
    return second;
  } finally {
    first.fill(0);
  }
}

function writeDurably(filePath: string, contents: string | Buffer): void {
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, contents);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeAtomically(filePath: string, contents: Buffer): void {
  assertManagedPath(path.dirname(filePath), filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = assertManagedPath(path.dirname(filePath), `${filePath}.cam-restore-${crypto.randomUUID()}.tmp`);
  try {
    writeDurably(tempPath, contents);
    assertManagedPath(path.dirname(filePath), filePath);
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(assertManagedPath(path.dirname(filePath), tempPath), { force: true });
  }
}

export function createAntigravityProfileBackup(input: AntigravityProfileBackupInput): AntigravityProfileBackupManifest {
  if (!input.sealBackup) throw new Error("A vault protector is required for Antigravity backups");
  const id = `ag-backup-${Date.now()}-${nanoid(8)}`;
  const backupDir = assertManagedPath(input.backupRoot, path.join(input.backupRoot, id));
  fs.mkdirSync(backupDir, { recursive: true });
  const files = profileFiles(input).map((file): AntigravityBackupFile => {
    const bytes = snapshotFile(file);
    try {
      const hash = bytes === null ? null : sha256(bytes);
      const payload: SnapshotPayload = { sourcePath: path.resolve(file.sourcePath), existed: bytes !== null, contents: bytes === null ? null : bytes.toString("base64"), hash };
      const backupPath = assertManagedPath(backupDir, path.join(backupDir, `${file.label}.sealed`));
      writeDurably(backupPath, input.sealBackup!(JSON.stringify(payload)));
      return { ...file, backupPath, existed: bytes !== null, sizeBytes: bytes?.length ?? null, hash };
    } finally {
      bytes?.fill(0);
    }
  });
  const manifest: AntigravityProfileBackupManifest = { version: 2, id, createdAt: Math.floor(Date.now() / 1000), backupDir, files };
  if (input.runtime) manifest.runtime = input.runtime;
  if (input.credentialSnapshot) {
    const snapshot = input.credentialSnapshot;
    if (snapshot.existed !== (snapshot.value !== null)) throw new Error("Invalid Credential Manager snapshot");
    const serialized = JSON.stringify(snapshot);
    manifest.credentialSnapshot = { existed: snapshot.existed, sealedValue: input.sealBackup(serialized), hash: sha256(serialized) };
  }
  manifest.sealedManifest = input.sealBackup(JSON.stringify(manifest));
  writeDurably(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function verifySealedAntigravityBackupManifest(manifest: AntigravityProfileBackupManifest, unseal: (ciphertext: string) => string): void {
  const { sealedManifest, ...metadata } = manifest;
  if (typeof sealedManifest !== "string" || !sealedManifest) throw new Error("Antigravity snapshot has no authenticated manifest");
  if (unseal(sealedManifest) !== JSON.stringify(metadata)) throw new Error("Antigravity sealed manifest metadata mismatch");
}

export function validateAntigravityProfileBackup(manifest: AntigravityProfileBackupManifest, options: AntigravityProfileRestoreOptions): void {
  if (manifest.version !== 2) throw new Error("A new Antigravity write requires a sealed v2 backup");
  verifySealedAntigravityBackupManifest(manifest, options.unsealBackup);
  const root = options.backupRoot ?? path.dirname(manifest.backupDir);
  const backupDir = assertManagedPath(root, manifest.backupDir);
  if (path.dirname(backupDir) !== path.resolve(root) || path.basename(backupDir) !== manifest.id || !/^ag-backup-[0-9]+-[a-zA-Z0-9_-]+$/.test(manifest.id)) throw new Error("Invalid Antigravity backup directory");
  const disk = JSON.parse(fs.readFileSync(assertManagedPath(backupDir, path.join(backupDir, "manifest.json")), "utf8")) as AntigravityProfileBackupManifest;
  if (JSON.stringify(disk) !== JSON.stringify(manifest)) throw new Error("Antigravity backup manifest changed before activation");
  const expected = new Set(profileFiles(options.pathInput).map((file) => path.resolve(file.sourcePath)));
  const seen = new Set<string>();
  for (const file of manifest.files) {
    const sourcePath = path.resolve(file.sourcePath);
    if (!expected.has(sourcePath) || seen.has(sourcePath)) throw new Error("Antigravity backup write-set is invalid");
    seen.add(sourcePath);
    const payload = JSON.parse(options.unsealBackup(fs.readFileSync(assertManagedPath(backupDir, file.backupPath), "utf8"))) as SnapshotPayload;
    if (payload.sourcePath !== sourcePath || payload.existed !== file.existed || payload.hash !== file.hash || (payload.contents === null) !== !file.existed) throw new Error("Antigravity sealed snapshot metadata mismatch");
    if (payload.contents !== null) {
      const bytes = Buffer.from(payload.contents, "base64");
      try { if (sha256(bytes) !== payload.hash) throw new Error("Antigravity sealed snapshot hash mismatch"); } finally { bytes.fill(0); }
    }
  }
  if ([...expected].some((sourcePath) => !seen.has(sourcePath))) throw new Error("Antigravity snapshot is missing a write-set target");
}

export function restoreAntigravityProfileBackup(manifest: AntigravityProfileBackupManifest, options: AntigravityProfileRestoreOptions): AntigravityProfileRestoreResult {
  const root = options.backupRoot ?? path.dirname(manifest.backupDir);
  const backupDir = assertManagedPath(root, manifest.backupDir);
  if (path.dirname(backupDir) !== path.resolve(root) || !/^ag-backup-[0-9]+-[a-zA-Z0-9_-]+$/.test(manifest.id) || path.basename(backupDir) !== manifest.id) throw new Error("Invalid Antigravity backup directory");
  if (manifest.version === 2) verifySealedAntigravityBackupManifest(manifest, options.unsealBackup);
  const expected = profileFiles(options.pathInput);
  const paths = new Set<string>();
  const decoded: Array<{ file: AntigravityBackupFile; bytes: Buffer | null }> = [];
  let credentialSnapshot: AntigravityCredentialSnapshot | undefined;
  try {
    for (const file of manifest.files) {
      const expectedFile = expected.find((item) => path.resolve(item.sourcePath) === path.resolve(file.sourcePath) && (item.kind === file.kind || ["stateDb", "secondaryStateDb"].includes(item.kind) && ["stateDb", "secondaryStateDb"].includes(file.kind)));
      if (!expectedFile || paths.has(path.resolve(file.sourcePath))) throw new Error("Antigravity backup write-set is invalid");
      paths.add(path.resolve(file.sourcePath));
      assertManagedPath(path.dirname(file.sourcePath), file.sourcePath);
      const backupPath = assertManagedPath(backupDir, file.backupPath);
      let bytes: Buffer | null;
      if (manifest.version === 2) {
        const payload = JSON.parse(options.unsealBackup(fs.readFileSync(backupPath, "utf8"))) as SnapshotPayload;
        if (payload.sourcePath !== path.resolve(file.sourcePath) || payload.existed !== file.existed || payload.hash !== file.hash || (payload.contents === null) !== !file.existed) throw new Error("Antigravity sealed snapshot metadata mismatch");
        bytes = payload.contents === null ? null : Buffer.from(payload.contents, "base64");
        if (bytes !== null && sha256(bytes) !== payload.hash) throw new Error("Antigravity sealed snapshot hash mismatch");
      } else {
        // Existing 3.1 backups remain recoverable, only at their exact configured targets.
        bytes = file.existed ? fs.readFileSync(backupPath) : null;
      }
      if (bytes && (file.kind === "stateDb" || file.kind === "secondaryStateDb")) verifySqlite(bytes);
      decoded.push({ file, bytes });
    }
    if (manifest.version === 2 && expected.some((item) => !paths.has(path.resolve(item.sourcePath)))) throw new Error("Antigravity snapshot is missing a write-set target");
    if (manifest.credentialSnapshot) {
      const serialized = options.unsealBackup(manifest.credentialSnapshot.sealedValue);
      if (sha256(serialized) !== manifest.credentialSnapshot.hash) throw new Error("Credential Manager snapshot hash mismatch");
      const parsed = JSON.parse(serialized) as AntigravityCredentialSnapshot;
      if (parsed.existed !== manifest.credentialSnapshot.existed || parsed.existed !== (typeof parsed.value === "string") || (!parsed.existed && parsed.value !== null)) throw new Error("Credential Manager snapshot is invalid");
      credentialSnapshot = parsed;
    }
    let restoredFiles = 0;
    let skippedFiles = 0;
    for (const { file, bytes } of decoded) {
      if (file.kind === "stateDb" || file.kind === "secondaryStateDb") {
        for (const suffix of ["-wal", "-shm"]) fs.rmSync(assertManagedPath(path.dirname(file.sourcePath), `${file.sourcePath}${suffix}`), { force: true });
      }
      if (bytes === null) {
        fs.rmSync(assertManagedPath(path.dirname(file.sourcePath), file.sourcePath), { force: true });
        skippedFiles += 1;
      } else {
        writeAtomically(file.sourcePath, bytes);
        restoredFiles += 1;
      }
    }
    for (const { file, bytes } of decoded) {
      if (bytes === null) {
        if (fs.existsSync(file.sourcePath)) throw new Error("Antigravity restore did not preserve original absence");
      } else if (sha256(fs.readFileSync(assertManagedPath(path.dirname(file.sourcePath), file.sourcePath))) !== sha256(bytes)) throw new Error("Antigravity restore bytes could not be verified");
    }
    return { restoredFiles, skippedFiles, verified: true, credentialSnapshot };
  } finally {
    for (const { bytes } of decoded) bytes?.fill(0);
  }
}
