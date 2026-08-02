import { nanoid } from "nanoid";
import { appError } from "../../shared/errors.js";
import {
  DurableAuthActivationError,
  DurableAuthBundleService,
  type AuthBundleFile,
  type DurableAuthBundleAdapter
} from "./durableAuthBundleService.js";

type SwitchStatus = "started" | "completed" | "failed" | "rolled_back";

export interface SwitchEventRecord {
  id: string;
  accountId: string;
  previousAccountId: string | null;
  startedAt: number;
  completedAt: number | null;
  status: SwitchStatus;
  error: string | null;
  backupPath: string | null;
}

export interface SwitchServiceOptions {
  codexHome: string;
  sealBackup(contents: string): string;
  unsealBackup(ciphertext: string): string;
  afterWrite(): Promise<void>;
  recordEvent(event: SwitchEventRecord): Promise<void>;
  durableAdapter?: DurableAuthBundleAdapter;
  platform?: NodeJS.Platform;
  renameRetryDelaysMs?: number[];
  stableCheckCount?: number;
  stableCheckIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SwitchInput {
  transactionId?: string;
  accountId: string;
  previousAccountId: string | null;
  expectedAuthAccountId?: string | null;
  authJson: string;
  compatibilityFiles?: AuthBundleFile[];
}

export interface SwitchResult {
  eventId: string;
  backupPath: string;
  targetHashes: Record<string, string>;
  stableChecks: number;
}

function extractAccountId(authJson: string): string | null {
  try {
    const parsed = JSON.parse(authJson) as {
      account_id?: unknown;
      tokens?: { account_id?: unknown; chatgpt_account_id?: unknown };
    };
    if (typeof parsed.account_id === "string" && parsed.account_id) return parsed.account_id;
    if (typeof parsed.tokens?.account_id === "string" && parsed.tokens.account_id) return parsed.tokens.account_id;
    if (typeof parsed.tokens?.chatgpt_account_id === "string" && parsed.tokens.chatgpt_account_id) {
      return parsed.tokens.chatgpt_account_id;
    }
    return null;
  } catch {
    throw appError("AUTH_INVALID");
  }
}

export class SwitchService {
  private readonly durable: DurableAuthBundleService;

  constructor(private readonly options: SwitchServiceOptions) {
    this.durable = new DurableAuthBundleService({
      codexHome: options.codexHome,
      sealBackup: options.sealBackup,
      unsealBackup: options.unsealBackup,
      adapter: options.durableAdapter,
      platform: options.platform,
      renameRetryDelaysMs: options.renameRetryDelaysMs,
      stableCheckCount: options.stableCheckCount,
      stableCheckIntervalMs: options.stableCheckIntervalMs,
      sleep: options.sleep
    });
  }

  async switchTo(input: SwitchInput): Promise<SwitchResult> {
    const eventId = nanoid();
    const transactionId = input.transactionId ?? `legacy-${eventId.replace(/[^a-zA-Z0-9-]/g, "-")}`;
    const startedAt = Math.floor(Date.now() / 1000);
    const expectedAuthAccountId = input.expectedAuthAccountId === undefined
      ? input.accountId
      : input.expectedAuthAccountId;
    let backupPath: string | null = null;

    await this.record({
      id: eventId,
      accountId: input.accountId,
      previousAccountId: input.previousAccountId,
      startedAt,
      completedAt: null,
      status: "started",
      error: null,
      backupPath
    });

    try {
      const targetAuthAccountId = extractAccountId(input.authJson);
      if (expectedAuthAccountId !== null && targetAuthAccountId !== expectedAuthAccountId) {
        throw appError("AUTH_INVALID");
      }
      const compatibilityFiles = input.compatibilityFiles ?? [];
      const result = await this.durable.activate({
        transactionId,
        files: [
          { relativePath: "auth.json", contents: input.authJson },
          ...compatibilityFiles.filter((file) => file.relativePath !== "auth.json")
        ]
      });
      backupPath = result.backupPath;
      try {
        const writtenAuthJson = input.authJson;
        if (expectedAuthAccountId !== null && extractAccountId(writtenAuthJson) !== expectedAuthAccountId) {
          throw appError("AUTH_INVALID");
        }
        await this.options.afterWrite();
      } catch (error) {
        await this.durable.rollback(result.backupPath);
        throw new DurableAuthActivationError(
          `Post-activation verification failed: ${error instanceof Error ? error.message : String(error)}`,
          result.backupPath,
          true,
          { cause: error }
        );
      }
      await this.record({
        id: eventId,
        accountId: input.accountId,
        previousAccountId: input.previousAccountId,
        startedAt,
        completedAt: Math.floor(Date.now() / 1000),
        status: "completed",
        error: null,
        backupPath
      });
      return {
        eventId,
        backupPath,
        targetHashes: result.targetHashes,
        stableChecks: result.stableChecks
      };
    } catch (error) {
      if (error instanceof DurableAuthActivationError) backupPath = error.backupPath;
      await this.record({
        id: eventId,
        accountId: input.accountId,
        previousAccountId: input.previousAccountId,
        startedAt,
        completedAt: Math.floor(Date.now() / 1000),
        status: error instanceof DurableAuthActivationError && error.rollbackVerified ? "rolled_back" : "failed",
        error: error instanceof Error ? error.message : String(error),
        backupPath
      });
      throw error;
    }
  }

  async rollback(backupPath: string): Promise<void> {
    await this.durable.rollback(backupPath);
  }

  private async record(event: SwitchEventRecord): Promise<void> {
    await this.options.recordEvent(event);
  }
}
