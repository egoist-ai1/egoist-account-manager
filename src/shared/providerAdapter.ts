import type { AccountPlatform, ManagedAccount, PlanType } from "./types.js";
import { getAccountQuotaSelection, getAccountQuotaWindows } from "./smartSelection.js";

export type ProviderCapabilityConfidence = "confirmed" | "inferred" | "estimated" | "unknown";
export type ProviderCapabilitySource =
  | "official_app_server"
  | "official_cli"
  | "official_docs"
  | "local_status"
  | "manual"
  | "unknown";
export type ProviderLimitWindowType = "daily" | "weekly" | "rolling" | "5h" | "unknown";
export type ProviderQuotaSource = "official_api" | "provider_api" | "local_status" | "error_response" | "manual" | "unknown";

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
  windowDurationMins?: number | null;
  label?: string | null;
  modelId?: string | null;
  scope?: string | null;
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
        reason: "Local auth identifies the selected profile; a separate app-server account/read probe identifies that probe, not the running Desktop account."
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
        reason: "Local switch and limit history are recorded by Квессер."
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
      "https://antigravity.google/docs/plans",
      "https://developers.google.com/identity/protocols/oauth2/native-app"
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
        supported: true,
        confidence: "confirmed",
        source: "official_docs",
        reason: "Google OAuth userinfo validates the token's account; a separate OS-bound IDE check is required to confirm the running runtime. Legacy IDE keyring material alone is not online proof."
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
        reason: "On Windows, Квессер can restart Antigravity.exe/language_server; launch and runtime identity are checked separately."
      },
      getHistory: {
        supported: true,
        ...localInferred,
        reason: "Local switch/import history can be recorded by Квессер."
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
  return Math.min(100, Math.max(0, value));
}

export function formatQuotaRemaining(remaining: number | null, locale: "ru" | "en" = "ru"): string {
  if (remaining === null || !Number.isFinite(remaining)) return "—";
  const percent = clampPercent(remaining);
  if (percent > 0 && percent < 1) return "<1%";
  const displayed = percent < 10 ? Math.min(9, Math.round(percent)) : Math.round(percent);
  return `${displayed.toLocaleString(locale)}%`;
}

export function quotaWindowLabel(durationMins: number | null, locale: "ru" | "en" = "ru"): string {
  if (!durationMins || !Number.isFinite(durationMins)) return locale === "ru" ? "Период неизвестен" : "Unknown window";
  if (durationMins === 300) return locale === "ru" ? "5 часов" : "5 hours";
  if (durationMins === 1440) return locale === "ru" ? "сутки" : "daily";
  if (durationMins === 10_080) return locale === "ru" ? "неделя" : "weekly";
  if (durationMins % 60 === 0) return `${durationMins / 60} ${locale === "ru" ? "ч" : "h"}`;
  return `${durationMins} ${locale === "ru" ? "мин" : "min"}`;
}

function classifyWindow(durationMins: number | null): ProviderLimitWindowType {
  if (durationMins === 300) return "5h";
  if (durationMins === 1440) return "daily";
  if (durationMins === 10080) return "weekly";
  return durationMins ? "rolling" : "unknown";
}

export function buildProviderQuotaState(account: ManagedAccount): ProviderQuotaState {
  const confidence = account.platform === "codex" ? "confirmed" : "inferred";
  const source = account.platform === "codex" ? "official_api"
    : account.quotaSnapshot?.source === "antigravity_api" ? "provider_api" : "local_status";
  const windows = buildAccountQuotaWindows(account, confidence, source);
  const selection = getAccountQuotaSelection(account);
  const selectionIds = new Set(selection.windows.map(window => window.id));
  const representative = windows.filter(window => selectionIds.has(window.id))
    .sort((left, right) => (right.used ?? -1) - (left.used ?? -1))[0];
  const hasQuota = Boolean(representative);
  return {
    provider: account.platform,
    accountId: account.id,
    planType: account.planType,
    remaining: representative?.remaining ?? null,
    used: representative?.used ?? null,
    resetAt: representative?.resetAt ?? null,
    windowType: representative?.windowType ?? "unknown",
    confidence: hasQuota ? confidence : "unknown",
    source: hasQuota ? source : "unknown",
    lastCheckedAt: account.quotaSnapshot?.capturedAt ?? account.lastRefreshAt ?? account.antigravity?.lastQuotaRefreshAt ?? null,
    errorReason: account.lastRefreshError ?? (account.status === "error" ? account.statusReason : null),
    windows
  };
}

function buildAccountQuotaWindows(
  account: ManagedAccount,
  confidence: ProviderCapabilityConfidence,
  source: ProviderQuotaSource
): ProviderQuotaWindow[] {
  return getAccountQuotaWindows(account).map((candidate) => {
    const used = clampPercent(candidate.usedPercent);
    return {
      id: candidate.id,
      used,
      remaining: 100 - used,
      resetAt: candidate.resetsAt,
      windowType: classifyWindow(candidate.windowDurationMins),
      windowDurationMins: candidate.windowDurationMins,
      label: candidate.label,
      modelId: candidate.modelId,
      scope: candidate.scope,
      confidence,
      source
    };
  });
}
