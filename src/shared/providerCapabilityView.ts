import type { AccountPlatform } from "./types.js";
import type {
  ProviderAdapterMetadata,
  ProviderCapability,
  ProviderCapabilityConfidence,
  ProviderCapabilitySource
} from "./providerAdapter.js";

export type ProviderCapabilityTone = "supported" | "limited" | "unsupported" | "unknown";

export interface ProviderCapabilityRow {
  id:
    | "validateAuth"
    | "getQuotaState"
    | "switchAccount"
    | "restartOrReloadIntegration"
    | "getHistory"
    | "sessionTransfer";
  label: string;
  value: string;
  tone: ProviderCapabilityTone;
  confidenceLabel: string;
  sourceLabel: string;
  reason: string;
}

const capabilityLabels: Record<ProviderCapabilityRow["id"], string> = {
  validateAuth: "Проверка входа",
  getQuotaState: "Лимиты",
  switchAccount: "Переключение",
  restartOrReloadIntegration: "Перезапуск",
  getHistory: "История",
  sessionTransfer: "Перенос сессии"
};

const confidenceLabels: Record<ProviderCapabilityConfidence, string> = {
  confirmed: "подтверждено",
  inferred: "выведено",
  estimated: "оценка",
  unknown: "неизвестно"
};

const sourceLabels: Record<ProviderCapabilitySource, string> = {
  official_app_server: "официальный app-server",
  official_cli: "официальный CLI",
  official_docs: "официальные docs",
  local_status: "локальное состояние",
  manual: "ручной ввод",
  unknown: "источник неизвестен"
};

export function providerSupportLabel(supported: boolean): string {
  return supported ? "поддерживается" : "не поддерживается";
}

export function providerCapabilityTone(capability: Pick<ProviderCapability, "supported" | "confidence" | "source">): ProviderCapabilityTone {
  if (capability.supported && capability.confidence === "confirmed") return "supported";
  if (capability.supported) return "limited";
  if (capability.source === "unknown" || capability.confidence === "unknown") return "unknown";
  return "unsupported";
}

function capabilityRow(id: ProviderCapabilityRow["id"], capability: ProviderCapability): ProviderCapabilityRow {
  return {
    id,
    label: capabilityLabels[id],
    value: providerSupportLabel(capability.supported),
    tone: providerCapabilityTone(capability),
    confidenceLabel: confidenceLabels[capability.confidence],
    sourceLabel: sourceLabels[capability.source],
    reason: capability.reason
  };
}

export function buildProviderCapabilityRows(provider: ProviderAdapterMetadata): ProviderCapabilityRow[] {
  const transferCapability: ProviderCapability = {
    supported: provider.supportsSessionTransfer,
    confidence: "confirmed",
    source: "official_docs",
    reason: provider.supportsSessionTransfer
      ? "Провайдер описывает переносимый формат сессии."
      : "Официально переносимый формат сессии не подтверждён; экспорт должен оставаться metadata-only или требовать повторный вход."
  };

  return [
    capabilityRow("validateAuth", provider.capabilities.validateAuth),
    capabilityRow("getQuotaState", provider.capabilities.getQuotaState),
    capabilityRow("switchAccount", provider.capabilities.switchAccount),
    capabilityRow("restartOrReloadIntegration", provider.capabilities.restartOrReloadIntegration),
    capabilityRow("getHistory", provider.capabilities.getHistory),
    capabilityRow("sessionTransfer", transferCapability)
  ];
}

export function providerCapabilitySummary(provider: ProviderAdapterMetadata): string {
  const rows = buildProviderCapabilityRows(provider);
  const confirmed = rows.filter((row) => row.tone === "supported").length;
  const limited = rows.filter((row) => row.tone === "limited").length;
  const blocked = rows.length - confirmed - limited;
  return `${confirmed} подтверждено · ${limited} локально · ${blocked} неизвестно`;
}

export function providerCapabilityCardTone(providerId: AccountPlatform): "codex" | "antigravity" {
  return providerId === "antigravity" ? "antigravity" : "codex";
}
