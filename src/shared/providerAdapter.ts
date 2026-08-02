import type { AccountPlatform, ManagedAccount, PlanType } from "./types.js";

export type ProviderCapabilityConfidence = "confirmed" | "inferred" | "estimated" | "unknown";
export type ProviderCapabilitySource =
  | "official_app_server"
  | "official_cli"
  | "official_docs"
  | "local_status"
  | "manual"
  | "unknown";
export type ProviderLimitWindowType = "daily" | "weekly" | "rolling" | "5h" | "unknown";
export type ProviderQuotaSource = "official_api" | "local_status" | "error_response" | "manual" | "unknown";

export interface ProviderCapability {
  supported: boolean;
  confidence: ProviderCapabilityConfidence;
  source: ProviderCapabilitySource;
  reason: string;
}

export interface ProviderLimitWindowMetadata {
  windowType: ProviderLimitWindowType;
  confidence: ProviderCapabilityConfidence;
  source: ProviderCapabilitySource;
  reason: string;
}

export interface ProviderAdapterMetadata {
  id: AccountPlatform;
  displayName: string;
  accountKind: string;
  docsSource: string[];
  supportsEncryptedExport: boolean;
  supportsSessionTransfer: boolean;
  capabilities: {
    detectActiveAccount: ProviderCapability;
    validateAuth: ProviderCapability;
    getQuotaState: ProviderCapability;
    switchAccount: ProviderCapability;
    restartOrReloadIntegration: ProviderCapability;
    getHistory: ProviderCapability;
  };
  knownLimitWindows: ProviderLimitWindowMetadata[];
}

export interface ProviderQuotaState {
  provider: AccountPlatform;
  accountId: string;
  planType: PlanType | null;
  remaining: number | null;
  used: number | null;
  resetAt: number | null;
  windowType: ProviderLimitWindowType;
  confidence: ProviderCapabilityConfidence;
  source: ProviderQuotaSource;
  lastCheckedAt: number | null;
  errorReason: string | null;
  windows: ProviderQuotaWindow[];
}

export interface ProviderQuotaWindow {
  id: string;
  used: number | null;
  remaining: number | null;
  resetAt: number | null;
  windowType: ProviderLimitWindowType;
  confidence: ProviderCapabilityConfidence;
  source: ProviderQuotaSource;
}

const confirmedAppServer: Pick<ProviderCapability, "confidence" | "source"> = {
  confidence: "confirmed",
  source: "official_app_server"
};

const localInferred: Pick<ProviderCapability, "confidence" | "source"> = {
  confidence: "inferred",
  source: "local_status"
};

export const knownProviderAdapterMetadata: ProviderAdapterMetadata[] = [
  {
    id: "codex",
    displayName: "OpenAI Codex",
    accountKind: "OpenAI / ChatGPT",
    docsSource: [
      "https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md",
      "https://help.openai.com/en/articles/11369540-icodex-in-chatgpt"
    ],
    supportsEncryptedExport: true,
    supportsSessionTransfer: false,
    capabilities: {
      detectActiveAccount: {
        supported: true,
        ...localInferred,
        reason: "Active account is detected from local Codex auth state and app-server account/read."
      },
      validateAuth: {
        supported: true,
        ...confirmedAppServer,
        reason: "Codex app-server documents account/read with optional token refresh."
      },
      getQuotaState: {
        supported: true,
        ...confirmedAppServer,
        reason: "Codex app-server documents account/rateLimits/read with reset timestamps and window durations."
      },
      switchAccount: {
        supported: true,
        ...localInferred,
        reason: "Switching uses user-authorized local Codex auth.json replacement with backup and verification."
      },
      restartOrReloadIntegration: {
        supported: true,
        ...localInferred,
        reason: "Codex Desktop can be restarted locally after a verified account switch."
      },
      getHistory: {
        supported: true,
        ...localInferred,
        reason: "Local switch and limit history are recorded by Codex Account Manager."
      }
    },
    knownLimitWindows: [
      {
        windowType: "5h",
        confidence: "inferred",
        source: "official_app_server",
        reason: "The app-server returns windowDurationMins; a 5-hour label is inferred from duration."
      },
      {
        windowType: "weekly",
        confidence: "inferred",
        source: "official_app_server",
        reason: "The app-server returns windowDurationMins; a weekly label is inferred from duration."
      },
      {
        windowType: "rolling",
        confidence: "confirmed",
        source: "official_app_server",
        reason: "Codex app-server exposes reset timestamps per returned quota window."
      },
      {
        windowType: "unknown",
        confidence: "confirmed",
        source: "official_app_server",
        reason: "Unknown windows are preserved when duration cannot be classified."
      }
    ]
  },
  {
    id: "antigravity",
    displayName: "Google Antigravity",
    accountKind: "Google account",
    docsSource: [
      "https://www.antigravity.google/docs/cli-getting-started",
      "https://antigravity.google/docs/plans"
    ],
    supportsEncryptedExport: true,
    supportsSessionTransfer: false,
    capabilities: {
      detectActiveAccount: {
        supported: true,
        ...localInferred,
        reason: "Local IDE profile files can be inspected without reading secret values."
      },
      validateAuth: {
        supported: false,
        confidence: "unknown",
        source: "official_cli",
        reason: "Official Antigravity CLI docs describe OS secure keyring and browser sign-in; no portable local validation API is documented."
      },
      getQuotaState: {
        supported: true,
        confidence: "inferred",
        source: "local_status",
        reason: "Google OAuth accounts can query Antigravity Code Assist model availability; exact window labels remain unknown."
      },
      switchAccount: {
        supported: true,
        ...localInferred,
        reason: "Google OAuth accounts are applied through Antigravity OS Credential Manager; legacy IDE profiles can use guarded local state writes."
      },
      restartOrReloadIntegration: {
        supported: true,
        confidence: "inferred",
        source: "local_status",
        reason: "On Windows, Codex Account Manager can restart Antigravity.exe/language_server so the Hub reloads OS Credential Manager state."
      },
      getHistory: {
        supported: true,
        ...localInferred,
        reason: "Local switch/import history can be recorded by Codex Account Manager."
      }
    },
    knownLimitWindows: [
      {
        windowType: "unknown",
        confidence: "unknown",
        source: "unknown",
        reason: "Antigravity plan docs state limits vary by Google AI plan, but exact local windows are not documented here."
      }
    ]
  }
];

export function getProviderAdapterMetadata(providerId: AccountPlatform): ProviderAdapterMetadata {
  const metadata = knownProviderAdapterMetadata.find((provider) => provider.id === providerId);
  if (!metadata) throw new Error(`Unknown provider: ${providerId}`);
  return metadata;
}

export function providerCapabilities(providerId: AccountPlatform): ProviderAdapterMetadata["capabilities"] {
  return getProviderAdapterMetadata(providerId).capabilities;
}

export function providerDisplayName(providerId: AccountPlatform): string {
  return getProviderAdapterMetadata(providerId).displayName;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function classifyWindow(durationMins: number | null): ProviderLimitWindowType {
  if (durationMins === 300) return "5h";
  if (durationMins === 1440) return "daily";
  if (durationMins === 10080) return "weekly";
  return durationMins ? "rolling" : "unknown";
}

function strongestKnownCodexWindow(account: ManagedAccount): {
  used: number | null;
  resetAt: number | null;
  windowType: ProviderLimitWindowType;
} {
  if (account.primaryUsedPercent !== null) {
    return {
      used: clampPercent(account.primaryUsedPercent),
      resetAt: account.primaryResetsAt ?? null,
      windowType: classifyWindow(account.primaryWindowDurationMins)
    };
  }
  if (account.fiveHourUsedPercent !== null) {
    return {
      used: clampPercent(account.fiveHourUsedPercent),
      resetAt: account.fiveHourResetsAt,
      windowType: "5h"
    };
  }
  if (account.weeklyUsedPercent !== null) {
    return {
      used: clampPercent(account.weeklyUsedPercent),
      resetAt: account.weeklyResetsAt,
      windowType: "weekly"
    };
  }
  return { used: null, resetAt: null, windowType: "unknown" };
}

export function buildProviderQuotaState(account: ManagedAccount): ProviderQuotaState {
  if (account.platform === "antigravity") {
    const used = typeof account.primaryUsedPercent === "number" && Number.isFinite(account.primaryUsedPercent)
      ? clampPercent(account.primaryUsedPercent)
      : null;
    return {
      provider: account.platform,
      accountId: account.id,
      planType: account.planType,
      remaining: used === null ? null : 100 - used,
      used,
      resetAt: account.primaryResetsAt ?? null,
      windowType: "unknown",
      confidence: used === null ? "unknown" : "inferred",
      source: used === null ? "unknown" : "local_status",
      lastCheckedAt: account.antigravity?.lastQuotaRefreshAt ?? null,
      errorReason: account.lastRefreshError ?? (account.status === "error" ? account.statusReason : null),
      windows: buildAccountQuotaWindows(account, "inferred", used === null ? "unknown" : "local_status")
    };
  }

  const known = strongestKnownCodexWindow(account);
  const hasQuota = known.used !== null;
  return {
    provider: account.platform,
    accountId: account.id,
    planType: account.planType,
    remaining: known.used === null ? null : 100 - known.used,
    used: known.used,
    resetAt: known.resetAt,
    windowType: known.windowType,
    confidence: hasQuota ? "confirmed" : "unknown",
    source: hasQuota ? "official_api" : "unknown",
    lastCheckedAt: account.lastRefreshAt,
    errorReason: account.lastRefreshError ?? (account.status === "error" ? account.statusReason : null),
    windows: buildAccountQuotaWindows(account, hasQuota ? "confirmed" : "unknown", hasQuota ? "official_api" : "unknown")
  };
}

function buildAccountQuotaWindows(
  account: ManagedAccount,
  confidence: ProviderCapabilityConfidence,
  source: ProviderQuotaSource
): ProviderQuotaWindow[] {
  const candidates: Array<{ id: string; used: number | null; resetAt: number | null; duration: number | null }> = [
    { id: "primary", used: account.primaryUsedPercent, resetAt: account.primaryResetsAt, duration: account.primaryWindowDurationMins },
    { id: "secondary", used: account.secondaryUsedPercent, resetAt: account.secondaryResetsAt, duration: account.secondaryWindowDurationMins },
    { id: "five-hour", used: account.fiveHourUsedPercent, resetAt: account.fiveHourResetsAt, duration: 300 },
    { id: "weekly", used: account.weeklyUsedPercent, resetAt: account.weeklyResetsAt, duration: 10_080 }
  ];
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    if (candidate.used === null || !Number.isFinite(candidate.used)) return [];
    const windowType = classifyWindow(candidate.duration);
    const key = `${windowType}:${candidate.resetAt ?? "none"}:${candidate.used}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const used = clampPercent(candidate.used);
    return [{
      id: candidate.id,
      used,
      remaining: 100 - used,
      resetAt: candidate.resetAt,
      windowType,
      confidence,
      source
    }];
  });
}
