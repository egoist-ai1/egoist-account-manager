import type { PlanType } from "./types.js";

export type CodexLoginMethodId =
  | "chatgpt"
  | "chatgptDeviceCode"
  | "apiKey"
  | "enterpriseAccessToken"
  | "chatgptAuthTokens";

export type CodexCapabilityStability = "stable" | "experimental" | "internal";

export interface CodexLoginCapability {
  id: CodexLoginMethodId;
  available: boolean;
  stability: CodexCapabilityStability;
  reason: string | null;
}

export interface CodexRuntimeIdentity {
  signedIn: boolean;
  authMode: "chatgpt" | "apiKey" | "amazonBedrock" | null;
  email: string | null;
  planType: PlanType | null;
  requiresOpenaiAuth: boolean;
  error: string | null;
}

export interface CodexProtocolRuntime {
  compatible: boolean;
  userAgent: string | null;
  codexHome: string | null;
  platformFamily: string | null;
  platformOs: string | null;
  schemaVersionKey: string | null;
  error: string | null;
}

export interface CodexFeatureCapability {
  available: boolean;
  reason: string | null;
}

export interface CodexFeatureCapabilities {
  initialize: CodexFeatureCapability;
  accountRead: CodexFeatureCapability;
  quotaRead: CodexFeatureCapability;
  excludeResetCreditDetails: CodexFeatureCapability;
}

export interface CodexCapabilityReport {
  generatedAt: number;
  cliVersion: string | null;
  protocol: CodexProtocolRuntime;
  loginMethods: CodexLoginCapability[];
  identity: CodexRuntimeIdentity;
  features?: CodexFeatureCapabilities;
}

export const CODEX_LOGIN_METHODS: readonly CodexLoginMethodId[] = [
  "chatgpt",
  "chatgptDeviceCode",
  "apiKey",
  "enterpriseAccessToken",
  "chatgptAuthTokens"
] as const;

export function unavailableCodexCapabilityReport(error: string, generatedAt = Math.floor(Date.now() / 1000)): CodexCapabilityReport {
  return {
    generatedAt,
    cliVersion: null,
    features: {
      initialize: { available: false, reason: error },
      accountRead: { available: false, reason: error },
      quotaRead: { available: false, reason: error },
      excludeResetCreditDetails: { available: false, reason: error }
    },
    protocol: {
      compatible: false,
      userAgent: null,
      codexHome: null,
      platformFamily: null,
      platformOs: null,
      schemaVersionKey: null,
      error
    },
    loginMethods: CODEX_LOGIN_METHODS.map((id) => ({
      id,
      available: false,
      stability: id === "chatgptAuthTokens" ? "internal" : id === "enterpriseAccessToken" ? "experimental" : "stable",
      reason: error
    })),
    identity: {
      signedIn: false,
      authMode: null,
      email: null,
      planType: null,
      requiresOpenaiAuth: true,
      error
    }
  };
}
