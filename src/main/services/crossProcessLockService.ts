import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface LockRecord {
  format: "one.egoist.codex-account-manager.operation-lock";
  token: string;
  pid: number;
  processStartedAt: number;
  operation: string;
  createdAt: number;
}

export interface CrossProcessLockOptions {
  lockPath: string;
  pid?: number;
  processStartedAt?: number;
  isOwnerAlive?: (record: Readonly<LockRecord>) => boolean;
}

export class CrossProcessLockError extends Error {
  readonly name = "CrossProcessLockError";
}

function defaultIsOwnerAlive(record: Readonly<LockRecord>): boolean {
  if (!Number.isInteger(record.pid) || record.pid <= 0) return false;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseRecord(lockPath: string): LockRecord | null {
  try {
    const record = JSON.parse(fs.readFileSync(lockPath, "utf8")) as LockRecord;
    return record.format === "one.egoist.codex-account-manager.operation-lock" ? record : null;
  } catch {
    return null;
  }
}

export class CrossProcessLockService {
  private readonly pid: number;
  private readonly processStartedAt: number;
  private readonly isOwnerAlive: (record: Readonly<LockRecord>) => boolean;

  constructor(private readonly options: CrossProcessLockOptions) {
    this.pid = options.pid ?? process.pid;
    this.processStartedAt = options.processStartedAt ?? Math.floor(Date.now() - process.uptime() * 1000);
    this.isOwnerAlive = options.isOwnerAlive ?? defaultIsOwnerAlive;
  }

  async runExclusive<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    const release = this.acquire(operationName);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private acquire(operationName: string): () => void {
    const lockPath = path.resolve(this.options.lockPath);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const record: LockRecord = {
      format: "one.egoist.codex-account-manager.operation-lock",
      token: crypto.randomUUID(),
      pid: this.pid,
      processStartedAt: this.processStartedAt,
      operation: operationName.slice(0, 120),
      createdAt: Date.now()
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let descriptor: number | null = null;
      try {
        descriptor = fs.openSync(lockPath, "wx", 0o600);
        fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        return () => {
          const current = parseRecord(lockPath);
          if (current?.token === record.token) fs.rmSync(lockPath, { force: true });
        };
      } catch (error) {
        if (descriptor !== null) fs.closeSync(descriptor);
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        const owner = parseRecord(lockPath);
        if (owner && this.isOwnerAlive(owner)) {
          throw new CrossProcessLockError(
            `Another Codex Account Manager process is running ${owner.operation || "an account operation"}.`
          );
        }
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          // The next exclusive create decides whether another process won the stale-lock race.
        }
      }
    }
    throw new CrossProcessLockError("The cross-process account operation lock could not be acquired.");
  }
}
