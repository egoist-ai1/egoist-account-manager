import crypto from "node:crypto";
import type {
  AccountPlatform,
  ManagedAccount,
  SwitchPreparationResult,
  SwitchTransaction,
  SwitchTransactionPhase,
  SwitchTransactionStatus
} from "../../shared/types.js";
import { redactSensitiveText } from "../../shared/redaction.js";
import type { AccountStore } from "../db.js";

const transitions: Partial<Record<SwitchTransactionPhase, SwitchTransactionPhase[]>> = {
  preparing: ["validating_previous", "failed", "aborted"],
  validating_previous: ["validating_target", "failed", "aborted"],
  validating_target: ["ready", "failed", "aborted"],
  ready: ["quiescing", "aborted"],
  quiescing: ["activating", "failed", "aborted"],
  activating: ["launching", "rolling_back", "failed", "recovery_required"],
  launching: ["verifying", "rolling_back", "failed", "recovery_required"],
  verifying: ["committed", "rolling_back", "failed", "recovery_required"],
  rolling_back: ["rolled_back", "failed", "recovery_required"]
};

function statusForPhase(phase: SwitchTransactionPhase): SwitchTransactionStatus {
  if (phase === "ready") return "pending";
  if (phase === "committed") return "committed";
  if (phase === "rolled_back") return "rolled_back";
  if (phase === "aborted") return "aborted";
  if (phase === "failed") return "failed";
  if (phase === "recovery_required") return "recovery_required";
  if (phase === "rolling_back") return "rolling_back";
  return "running";
}

function safeMessage(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 480);
}

export interface SwitchPreparationInput {
  platform: AccountPlatform;
  targetAccountId: string;
  previousAccountId: string | null;
  targetFingerprint: string | null;
  previousFingerprint: string | null;
  validatePrevious(): Promise<string[] | void> | string[] | void;
  validateTarget(): Promise<string[] | void> | string[] | void;
}

export class SwitchTransactionService {
  constructor(
    private readonly store: AccountStore,
    private readonly onUpdate?: (transaction: SwitchTransaction) => void
  ) {}

  async prepare(input: SwitchPreparationInput): Promise<SwitchPreparationResult> {
    let transaction = this.store.createSwitchTransaction({
      id: crypto.randomUUID(),
      platform: input.platform,
      targetAccountId: input.targetAccountId,
      previousAccountId: input.previousAccountId,
      targetFingerprint: input.targetFingerprint,
      previousFingerprint: input.previousFingerprint
    });
    this.emit(transaction);
    const warnings: string[] = [];
    try {
      transaction = this.advance(transaction, "validating_previous");
      warnings.push(...(await input.validatePrevious() ?? []));
      transaction = this.advance(transaction, "validating_target");
      warnings.push(...(await input.validateTarget() ?? []));
      transaction = this.advance(transaction, "ready");
      return { transaction, canCommit: true, warnings };
    } catch (error) {
      this.fail(transaction.id, "PREPARE_FAILED", safeMessage(error));
      throw error;
    }
  }

  cancel(id: string): SwitchTransaction {
    const current = this.require(id);
    if (!["preparing", "validating_previous", "validating_target", "ready", "quiescing"].includes(current.phase)) {
      throw new Error(`Switch transaction cannot be cancelled during ${current.phase}`);
    }
    return this.advance(current, "aborted", {
      errorCode: "CANCELLED",
      errorMessage: "Cancelled before auth activation."
    });
  }

  begin(id: string, targetAccountId: string): SwitchTransaction {
    const current = this.require(id);
    if (current.targetAccountId !== targetAccountId) {
      throw new Error("Prepared switch target does not match the requested account");
    }
    if (current.phase !== "ready" || current.status !== "pending") {
      throw new Error("Switch transaction is not ready to commit");
    }
    return this.advance(current, "quiescing");
  }

  advanceById(
    id: string,
    phase: SwitchTransactionPhase,
    details: {
      backupPath?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    } = {}
  ): SwitchTransaction {
    return this.advance(this.require(id), phase, details);
  }

  finalizeWithActiveAccount(
    id: string,
    phase: "committed" | "rolled_back",
    accountId: string,
    details: {
      backupPath?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    } = {}
  ): { account: ManagedAccount; transaction: SwitchTransaction } {
    const current = this.require(id);
    const allowed = transitions[current.phase] ?? [];
    if (!allowed.includes(phase)) {
      throw new Error(`Invalid switch transaction transition: ${current.phase} -> ${phase}`);
    }
    const finalized = this.store.finalizeSwitchTransactionWithActiveAccount(
      current.id,
      accountId,
      { phase, ...details },
      current.version
    );
    this.emit(finalized.transaction);
    return finalized;
  }

  fail(id: string, errorCode: string, errorMessage: string): SwitchTransaction {
    const current = this.require(id);
    if (["committed", "rolled_back", "aborted", "failed", "recovery_required"].includes(current.status)) return current;
    return this.advance(current, "failed", {
      errorCode,
      errorMessage: redactSensitiveText(errorMessage).slice(0, 480)
    }, true);
  }

  list(limit = 30): SwitchTransaction[] {
    return this.store.listSwitchTransactions(limit);
  }

  get(id: string): SwitchTransaction | null {
    return this.store.getSwitchTransaction(id);
  }

  reconcileInterrupted(): SwitchTransaction[] {
    const reconciled = this.store.reconcileInterruptedSwitchTransactions();
    reconciled.forEach((transaction) => this.emit(transaction));
    return reconciled;
  }

  private advance(
    current: SwitchTransaction,
    phase: SwitchTransactionPhase,
    details: {
      backupPath?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    } = {},
    allowFailureFromAnyNonTerminal = false
  ): SwitchTransaction {
    const allowed = transitions[current.phase] ?? [];
    if (!allowed.includes(phase) && !(allowFailureFromAnyNonTerminal && phase === "failed")) {
      throw new Error(`Invalid switch transaction transition: ${current.phase} -> ${phase}`);
    }
    const updated = this.store.updateSwitchTransaction(current.id, {
      status: statusForPhase(phase),
      phase,
      ...details
    }, current.version);
    this.emit(updated);
    return updated;
  }

  private require(id: string): SwitchTransaction {
    const transaction = this.store.getSwitchTransaction(id);
    if (!transaction) throw new Error("Switch transaction not found");
    return transaction;
  }

  private emit(transaction: SwitchTransaction): void {
    this.onUpdate?.(transaction);
  }
}
