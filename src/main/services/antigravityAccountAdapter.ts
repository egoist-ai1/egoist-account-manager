import type { AntigravityPathInput } from "./antigravityPaths.js";
import {
  writePreparedAntigravityProfile,
  type AntigravityProfileWriteInput,
  type AntigravityProfileWriteResult,
  type AntigravityStateWriteItem
} from "./antigravityProfileWriter.js";
import {
  createAntigravityUnifiedEnterprisePreferences,
  createAntigravityUnifiedOAuthToken,
  createAntigravityUnifiedUserStatus
} from "./antigravityUnifiedState.js";

export const ANTIGRAVITY_AUTH_STATE_KEY = "antigravityUnifiedStateSync.oauthToken";
export const ANTIGRAVITY_USER_STATUS_STATE_KEY = "antigravityUnifiedStateSync.userStatus";
export const ANTIGRAVITY_ENTERPRISE_PREFERENCES_STATE_KEY = "antigravityUnifiedStateSync.enterprisePreferences";
export const ANTIGRAVITY_AUTH_STATUS_STATE_KEY = "antigravityAuthStatus";
export const ANTIGRAVITY_ONBOARDING_STATE_KEY = "antigravityOnboarding";
export const ANTIGRAVITY_LEGACY_GOOGLE_STATE_KEY = "google.antigravity";
export const ANTIGRAVITY_ACTIVE_ACCOUNT_STORAGE_KEY = "storage.serviceMachineId";

export interface AntigravityCredentialPackage {
  accountId: string;
  email: string;
  refreshToken: string;
  accessToken?: string | null;
  expiresAt?: number | null;
  googleProjectId?: string | null;
  scopes?: string[];
  machineId?: string | null;
}

export interface AntigravityAccountWriteSummary {
  accountId: string;
  email: string;
  stateKeys: string[];
  storageKeys: string[];
  writesMachineId: boolean;
  tokenFields: Array<"refreshToken" | "accessToken">;
}

export interface AntigravityAccountWritePlan {
  allowedStateKeys: string[];
  stateItems: AntigravityStateWriteItem[];
  stateDeleteKeys: string[];
  allowedStorageKeys: string[];
  storagePatch: Record<string, unknown>;
  machineId?: string;
  allowMachineIdWrite: boolean;
  summary: AntigravityAccountWriteSummary;
}

export interface AntigravityAccountApplyInput extends AntigravityPathInput {
  backupRoot: string;
  credentials: AntigravityCredentialPackage;
}

export interface AntigravityAccountApplyResult {
  applied: boolean;
  summary: AntigravityAccountWriteSummary;
  backupId: string;
  backupDir: string;
  writtenStateItems: number;
  writtenStorageKeys: string[];
  machineIdWritten: boolean;
}

function validateCredentials(input: AntigravityCredentialPackage): void {
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(input.email)) {
    throw new Error("Antigravity email is invalid");
  }
  if (!input.accountId.trim()) {
    throw new Error("Antigravity accountId is required");
  }
  if (input.refreshToken.trim().length < 20) {
    throw new Error("Antigravity refresh token is too short");
  }
  if (input.accessToken !== undefined && input.accessToken !== null && input.accessToken.trim().length < 12) {
    throw new Error("Antigravity access token is too short");
  }
  if (input.expiresAt !== undefined && input.expiresAt !== null && (!Number.isFinite(input.expiresAt) || input.expiresAt < 0)) {
    throw new Error("Antigravity expiresAt is invalid");
  }
}

export function createAntigravityAccountWritePlan(input: AntigravityCredentialPackage): AntigravityAccountWritePlan {
  validateCredentials(input);
  const normalizedProjectId = input.googleProjectId?.trim() || null;
  const accessToken = input.accessToken?.trim();
  if (!accessToken) throw new Error("Antigravity access token is required for IDE attach");
  const stateItems: AntigravityStateWriteItem[] = [
    {
      key: ANTIGRAVITY_AUTH_STATE_KEY,
      value: createAntigravityUnifiedOAuthToken({
        accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt ?? null,
        email: input.email
      })
    },
    {
      key: ANTIGRAVITY_USER_STATUS_STATE_KEY,
      value: createAntigravityUnifiedUserStatus(input.email)
    },
    {
      key: ANTIGRAVITY_AUTH_STATUS_STATE_KEY,
      value: JSON.stringify({
        name: input.email,
        email: input.email,
        apiKey: accessToken
      })
    },
    {
      key: ANTIGRAVITY_ONBOARDING_STATE_KEY,
      value: "true"
    }
  ];
  if (normalizedProjectId) {
    stateItems.push({
      key: ANTIGRAVITY_ENTERPRISE_PREFERENCES_STATE_KEY,
      value: createAntigravityUnifiedEnterprisePreferences(normalizedProjectId)
    });
  }
  const allowedStateKeys = [
    ANTIGRAVITY_AUTH_STATE_KEY,
    ANTIGRAVITY_USER_STATUS_STATE_KEY,
    ANTIGRAVITY_ENTERPRISE_PREFERENCES_STATE_KEY,
    ANTIGRAVITY_AUTH_STATUS_STATE_KEY,
    ANTIGRAVITY_ONBOARDING_STATE_KEY,
    ANTIGRAVITY_LEGACY_GOOGLE_STATE_KEY
  ];
  const stateDeleteKeys = [
    ANTIGRAVITY_LEGACY_GOOGLE_STATE_KEY,
    ...(normalizedProjectId ? [] : [ANTIGRAVITY_ENTERPRISE_PREFERENCES_STATE_KEY])
  ];
  const storagePatch = input.machineId ? { [ANTIGRAVITY_ACTIVE_ACCOUNT_STORAGE_KEY]: input.machineId } : {};
  const tokenFields: Array<"refreshToken" | "accessToken"> = ["refreshToken"];
  if (input.accessToken) tokenFields.push("accessToken");
  return {
    allowedStateKeys,
    stateItems,
    stateDeleteKeys,
    allowedStorageKeys: [ANTIGRAVITY_ACTIVE_ACCOUNT_STORAGE_KEY],
    storagePatch,
    machineId: input.machineId ?? undefined,
    allowMachineIdWrite: input.machineId !== undefined && input.machineId !== null,
    summary: {
      accountId: input.accountId,
      email: input.email,
      stateKeys: stateItems.map((item) => item.key),
      storageKeys: Object.keys(storagePatch),
      writesMachineId: input.machineId !== undefined && input.machineId !== null,
      tokenFields
    }
  };
}

function sanitizeWriterResult(plan: AntigravityAccountWritePlan, result: AntigravityProfileWriteResult): AntigravityAccountApplyResult {
  return {
    applied: result.applied,
    summary: plan.summary,
    backupId: result.backup.id,
    backupDir: result.backup.backupDir,
    writtenStateItems: result.writtenStateItems,
    writtenStorageKeys: result.writtenStorageKeys,
    machineIdWritten: result.machineIdWritten
  };
}

export function applyAntigravityAccountWritePlan(input: AntigravityAccountApplyInput): AntigravityAccountApplyResult {
  const plan = createAntigravityAccountWritePlan(input.credentials);
  const writerInput: AntigravityProfileWriteInput = {
    ...input,
    allowedStateKeys: plan.allowedStateKeys,
    stateItems: plan.stateItems,
    stateDeleteKeys: plan.stateDeleteKeys,
    allowedStorageKeys: plan.allowedStorageKeys,
    storagePatch: plan.storagePatch,
    machineId: plan.machineId,
    allowMachineIdWrite: plan.allowMachineIdWrite
  };
  return sanitizeWriterResult(plan, writePreparedAntigravityProfile(writerInput));
}
