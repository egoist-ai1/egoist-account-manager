import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const manifestFormat = "one.egoist.codex-account-manager.auth-activation";
const manifestVersion = 1;
const allowedRelativePaths = new Set([
  "auth.json",
  ".codex-global-state.json",
  ".codex-global-state.json.bak"
]);

export interface AuthBundleFile {
  relativePath: "auth.json" | ".codex-global-state.json" | ".codex-global-state.json.bak";
  contents: string;
}

export interface DurableAuthBundleAdapter {
  exists(filePath: string): boolean;
  readUtf8(filePath: string): string;
  writeDurableUtf8(filePath: string, contents: string): void;
  mkdir(directoryPath: string): void;
  rename(sourcePath: string, targetPath: string): void;
  remove(targetPath: string, recursive?: boolean): void;
}

export interface DurableAuthBundleOptions {
  codexHome: string;
  sealBackup(contents: string): string;
  unsealBackup(ciphertext: string): string;
  adapter?: DurableAuthBundleAdapter;
  platform?: NodeJS.Platform;
  renameRetryDelaysMs?: number[];
  stableCheckCount?: number;
  stableCheckIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DurableAuthActivationInput {
  transactionId: string;
  files: AuthBundleFile[];
}

export interface DurableAuthActivationResult {
  transactionId: string;
  backupPath: string;
  targetHashes: Record<string, string>;
  stableChecks: number;
}

type ManifestStatus = "staging" | "staged" | "activating" | "activated" | "rolling_back" | "rolled_back";

interface DurableAuthManifestFile {
  relativePath: AuthBundleFile["relativePath"];
  targetHash: string;
  previousExisted: boolean;
  previousHash: string | null;
  sealedPreviousContents: string | null;
  stageFileName: string;
  replaced: boolean;
}

interface DurableAuthManifest {
  format: typeof manifestFormat;
  version: typeof manifestVersion;
  transactionId: string;
  status: ManifestStatus;
  createdAt: number;
  updatedAt: number;
  files: DurableAuthManifestFile[];
}

export class DurableAuthActivationError extends Error {
  readonly name = "DurableAuthActivationError";

  constructor(
    message: string,
    readonly backupPath: string,
    readonly rollbackVerified: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

function sha256(contents: string): string {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function createDefaultAdapter(): DurableAuthBundleAdapter {
  return {
    exists: (filePath) => fs.existsSync(filePath),
    readUtf8: (filePath) => fs.readFileSync(filePath, "utf8"),
    writeDurableUtf8(filePath, contents) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const descriptor = fs.openSync(filePath, "w", 0o600);
      try {
        fs.writeFileSync(descriptor, contents, "utf8");
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    },
    mkdir: (directoryPath) => fs.mkdirSync(directoryPath, { recursive: true }),
    rename: (sourcePath, targetPath) => fs.renameSync(sourcePath, targetPath),
    remove: (targetPath, recursive = false) => fs.rmSync(targetPath, { force: true, recursive })
  };
}

function validateTransactionId(transactionId: string): void {
  if (!/^[a-zA-Z0-9-]{8,120}$/.test(transactionId)) {
    throw new Error("Invalid durable auth transaction id");
  }
}

function validateFiles(files: AuthBundleFile[]): void {
  if (files.length === 0) throw new Error("Auth activation bundle is empty");
  const unique = new Set<string>();
  for (const file of files) {
    if (!allowedRelativePaths.has(file.relativePath)) {
      throw new Error(`Unsupported auth bundle file: ${file.relativePath}`);
    }
    if (unique.has(file.relativePath)) throw new Error(`Duplicate auth bundle file: ${file.relativePath}`);
    unique.add(file.relativePath);
    if (!file.contents) throw new Error(`Auth bundle file is empty: ${file.relativePath}`);
  }
  if (!unique.has("auth.json")) throw new Error("Auth activation bundle must include auth.json");
}

function safeManifestError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 320);
}

function isRetryableWindowsRenameError(error: unknown, platform: NodeJS.Platform): boolean {
  if (platform !== "win32" || !error || typeof error !== "object") return false;
  const record = error as { code?: unknown; win32Code?: unknown };
  if (record.code === "EACCES" || record.code === "EPERM" || record.code === "EBUSY") return true;
  return record.win32Code === 5 || record.win32Code === 32 || record.win32Code === 33;
}

export class DurableAuthBundleService {
  private readonly adapter: DurableAuthBundleAdapter;
  private readonly platform: NodeJS.Platform;
  private readonly renameRetryDelaysMs: number[];
  private readonly stableCheckCount: number;
  private readonly stableCheckIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: DurableAuthBundleOptions) {
    this.adapter = options.adapter ?? createDefaultAdapter();
    this.platform = options.platform ?? process.platform;
    this.renameRetryDelaysMs = options.renameRetryDelaysMs ?? [30, 90, 180, 360];
    this.stableCheckCount = Math.max(1, options.stableCheckCount ?? 3);
    this.stableCheckIntervalMs = Math.max(0, options.stableCheckIntervalMs ?? 120);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async activate(input: DurableAuthActivationInput): Promise<DurableAuthActivationResult> {
    validateTransactionId(input.transactionId);
    validateFiles(input.files);
    const transactionDir = this.transactionDir(input.transactionId);
    const stageDir = path.join(transactionDir, "stage");
    let manifest: DurableAuthManifest = {
      format: manifestFormat,
      version: manifestVersion,
      transactionId: input.transactionId,
      status: "staging",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      files: []
    };
    try {
      this.adapter.mkdir(stageDir);
      for (const [index, file] of input.files.entries()) {
        const targetPath = this.targetPath(file.relativePath);
        const previousExisted = this.adapter.exists(targetPath);
        const previousContents = previousExisted ? this.adapter.readUtf8(targetPath) : null;
        const stageFileName = `${index}-${file.relativePath.replace(/[^a-z0-9.-]/gi, "_")}.tmp`;
        const stagePath = path.join(stageDir, stageFileName);
        this.adapter.writeDurableUtf8(stagePath, file.contents);
        if (this.adapter.readUtf8(stagePath) !== file.contents) {
          throw new Error(`Staged auth bytes are unstable for ${file.relativePath}`);
        }
        manifest.files.push({
          relativePath: file.relativePath,
          targetHash: sha256(file.contents),
          previousExisted,
          previousHash: previousContents === null ? null : sha256(previousContents),
          sealedPreviousContents: previousContents === null ? null : this.options.sealBackup(previousContents),
          stageFileName,
          replaced: false
        });
      }
      manifest = this.writeManifest(transactionDir, { ...manifest, status: "staged" });
      manifest = this.writeManifest(transactionDir, { ...manifest, status: "activating" });

      for (const file of manifest.files) {
        const stagePath = path.join(stageDir, file.stageFileName);
        const targetPath = this.targetPath(file.relativePath);
        await this.renameWithRetry(stagePath, targetPath);
        file.replaced = true;
        manifest = this.writeManifest(transactionDir, manifest);
        if (sha256(this.adapter.readUtf8(targetPath)) !== file.targetHash) {
          throw new Error(`Auth read-back hash mismatch for ${file.relativePath}`);
        }
      }

      for (let check = 0; check < this.stableCheckCount; check += 1) {
        this.verifyTargetManifest(manifest);
        if (check + 1 < this.stableCheckCount && this.stableCheckIntervalMs > 0) {
          await this.sleep(this.stableCheckIntervalMs);
        }
      }
      manifest = this.writeManifest(transactionDir, { ...manifest, status: "activated" });
      this.adapter.remove(stageDir, true);
      return {
        transactionId: input.transactionId,
        backupPath: transactionDir,
        targetHashes: Object.fromEntries(manifest.files.map((file) => [file.relativePath, file.targetHash])),
        stableChecks: this.stableCheckCount
      };
    } catch (error) {
      let rollbackVerified = false;
      try {
        rollbackVerified = await this.rollbackManifest(transactionDir, manifest);
      } catch {
        rollbackVerified = false;
      }
      try {
        this.adapter.remove(stageDir, true);
      } catch {
        // The recovery coordinator will clean a remaining plaintext stage.
      }
      throw new DurableAuthActivationError(
        `Durable auth activation failed: ${safeManifestError(error)}`,
        transactionDir,
        rollbackVerified,
        { cause: error }
      );
    }
  }

  async rollback(backupPath: string): Promise<void> {
    const transactionDir = path.resolve(backupPath);
    const expectedRoot = path.resolve(this.transactionRoot());
    if (!transactionDir.startsWith(`${expectedRoot}${path.sep}`)) {
      throw new Error("Auth rollback path is outside the transaction root");
    }
    const manifest = this.readManifest(transactionDir);
    if (!(await this.rollbackManifest(transactionDir, manifest))) {
      throw new Error("Auth rollback bytes could not be verified");
    }
  }

  readActivation(backupPath: string): {
    transactionId: string;
    status: ManifestStatus;
    files: Array<{ relativePath: string; targetHash: string; previousHash: string | null; replaced: boolean }>;
  } {
    const manifest = this.readManifest(backupPath);
    return {
      transactionId: manifest.transactionId,
      status: manifest.status,
      files: manifest.files.map((file) => ({
        relativePath: file.relativePath,
        targetHash: file.targetHash,
        previousHash: file.previousHash,
        replaced: file.replaced
      }))
    };
  }

  verifyTargetFiles(backupPath: string): boolean {
    const manifest = this.readManifest(this.validatedTransactionDir(backupPath));
    try {
      this.verifyTargetManifest(manifest);
      return true;
    } catch {
      return false;
    }
  }

  cleanupTransientFiles(backupPath: string): void {
    const transactionDir = this.validatedTransactionDir(backupPath);
    this.adapter.remove(path.join(transactionDir, "stage"), true);
    this.adapter.remove(path.join(transactionDir, "rollback"), true);
    for (const entry of fs.existsSync(transactionDir) ? fs.readdirSync(transactionDir) : []) {
      if (entry.startsWith("manifest.json.") && entry.endsWith(".tmp")) {
        this.adapter.remove(path.join(transactionDir, entry));
      }
    }
  }

  private async rollbackManifest(
    transactionDir: string,
    inputManifest: DurableAuthManifest
  ): Promise<boolean> {
    let manifest = this.writeManifest(transactionDir, { ...inputManifest, status: "rolling_back" });
    const rollbackDir = path.join(transactionDir, "rollback");
    this.adapter.mkdir(rollbackDir);
    for (const [index, file] of [...manifest.files].reverse().entries()) {
      const targetPath = this.targetPath(file.relativePath);
      if (file.previousExisted) {
        if (!file.sealedPreviousContents || !file.previousHash) {
          throw new Error(`Rollback material is missing for ${file.relativePath}`);
        }
        const previousContents = this.options.unsealBackup(file.sealedPreviousContents);
        if (sha256(previousContents) !== file.previousHash) {
          throw new Error(`Rollback material hash mismatch for ${file.relativePath}`);
        }
        const rollbackPath = path.join(rollbackDir, `${index}.tmp`);
        this.adapter.writeDurableUtf8(rollbackPath, previousContents);
        await this.renameWithRetry(rollbackPath, targetPath);
      } else {
        this.adapter.remove(targetPath);
      }
    }
    for (const file of manifest.files) {
      const targetPath = this.targetPath(file.relativePath);
      if (!file.previousExisted) {
        if (this.adapter.exists(targetPath)) return false;
        continue;
      }
      if (!file.previousHash || !this.adapter.exists(targetPath)) return false;
      if (sha256(this.adapter.readUtf8(targetPath)) !== file.previousHash) return false;
    }
    manifest = this.writeManifest(transactionDir, { ...manifest, status: "rolled_back" });
    this.adapter.remove(rollbackDir, true);
    return manifest.status === "rolled_back";
  }

  private verifyTargetManifest(manifest: DurableAuthManifest): void {
    for (const file of manifest.files) {
      const targetPath = this.targetPath(file.relativePath);
      if (!this.adapter.exists(targetPath) || sha256(this.adapter.readUtf8(targetPath)) !== file.targetHash) {
        throw new Error(`Auth target changed during stable verification: ${file.relativePath}`);
      }
    }
  }

  private writeManifest(transactionDir: string, manifest: DurableAuthManifest): DurableAuthManifest {
    const updated = { ...manifest, updatedAt: Date.now() };
    const manifestPath = path.join(transactionDir, "manifest.json");
    const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
    this.adapter.writeDurableUtf8(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`);
    this.adapter.rename(temporaryPath, manifestPath);
    return updated;
  }

  private readManifest(transactionDir: string): DurableAuthManifest {
    const manifest = JSON.parse(this.adapter.readUtf8(path.join(transactionDir, "manifest.json"))) as DurableAuthManifest;
    if (
      manifest.format !== manifestFormat
      || manifest.version !== manifestVersion
      || !Array.isArray(manifest.files)
    ) {
      throw new Error("Unsupported durable auth activation manifest");
    }
    return manifest;
  }

  private async renameWithRetry(sourcePath: string, targetPath: string): Promise<void> {
    let attempt = 0;
    while (true) {
      try {
        this.adapter.rename(sourcePath, targetPath);
        return;
      } catch (error) {
        const delay = this.renameRetryDelaysMs[attempt];
        if (delay === undefined || !isRetryableWindowsRenameError(error, this.platform)) throw error;
        attempt += 1;
        await this.sleep(delay);
      }
    }
  }

  private targetPath(relativePath: AuthBundleFile["relativePath"]): string {
    const targetPath = path.resolve(this.options.codexHome, relativePath);
    const home = path.resolve(this.options.codexHome);
    if (path.dirname(targetPath) !== home) throw new Error("Auth bundle target escaped CODEX_HOME");
    return targetPath;
  }

  private transactionRoot(): string {
    return path.join(this.options.codexHome, ".codex-account-manager", "transactions");
  }

  private transactionDir(transactionId: string): string {
    return path.join(this.transactionRoot(), transactionId);
  }

  private validatedTransactionDir(backupPath: string): string {
    const transactionDir = path.resolve(backupPath);
    const expectedRoot = path.resolve(this.transactionRoot());
    if (!transactionDir.startsWith(`${expectedRoot}${path.sep}`)) {
      throw new Error("Auth transaction path is outside the transaction root");
    }
    return transactionDir;
  }
}
