import {
  buildProviderQuotaState,
  getProviderAdapterMetadata,
  type ProviderAdapterMetadata,
  type ProviderQuotaState
} from "../../shared/providerAdapter.js";
import type { AccountPlatform, AuthValidationState, LimitHistoryPoint, ManagedAccount } from "../../shared/types.js";

export interface ProviderManagerFacade {
  list(): ManagedAccount[];
  validateAuth(accountId: string): Promise<AuthValidationState>;
  switchAccount(accountId: string): Promise<ManagedAccount>;
  refreshAccount(accountId: string): Promise<ManagedAccount>;
  getLimitHistory(accountId: string): LimitHistoryPoint[];
}

export interface ProviderRuntimeAdapter {
  id: AccountPlatform;
  displayName: string;
  metadata: ProviderAdapterMetadata;
  detectActiveAccount(): Promise<ManagedAccount | null>;
  validateAuth(accountId: string): Promise<AuthValidationState>;
  getQuotaState(accountId: string): Promise<ProviderQuotaState>;
  refreshQuota(accountId: string): Promise<ProviderQuotaState>;
  switchAccount(accountId: string): Promise<ManagedAccount>;
  restartOrReloadIntegration(): Promise<{ supported: boolean; reason: string }>;
  getHistory(accountId: string): Promise<LimitHistoryPoint[]>;
}

export type ProviderRuntimeAdapterRegistry = Record<AccountPlatform, ProviderRuntimeAdapter>;

function findProviderAccount(manager: ProviderManagerFacade, providerId: AccountPlatform, accountId: string): ManagedAccount {
  const account = manager.list().find((item) => item.id === accountId);
  if (!account) throw new Error("Account not found");
  if (account.platform !== providerId) {
    throw new Error(`Account ${accountId} does not belong to provider ${providerId}`);
  }
  return account;
}

function createProviderRuntimeAdapter(
  providerId: AccountPlatform,
  manager: ProviderManagerFacade
): ProviderRuntimeAdapter {
  const metadata = getProviderAdapterMetadata(providerId);
  return {
    id: providerId,
    displayName: metadata.displayName,
    metadata,
    async detectActiveAccount() {
      return manager.list().find((account) => account.platform === providerId && account.isActive) ?? null;
    },
    async validateAuth(accountId) {
      findProviderAccount(manager, providerId, accountId);
      return manager.validateAuth(accountId);
    },
    async getQuotaState(accountId) {
      return buildProviderQuotaState(findProviderAccount(manager, providerId, accountId));
    },
    async refreshQuota(accountId) {
      findProviderAccount(manager, providerId, accountId);
      return buildProviderQuotaState(await manager.refreshAccount(accountId));
    },
    async switchAccount(accountId) {
      findProviderAccount(manager, providerId, accountId);
      return manager.switchAccount(accountId);
    },
    async restartOrReloadIntegration() {
      const capability = metadata.capabilities.restartOrReloadIntegration;
      return { supported: capability.supported, reason: capability.reason };
    },
    async getHistory(accountId) {
      findProviderAccount(manager, providerId, accountId);
      return manager.getLimitHistory(accountId);
    }
  };
}

export function createProviderRuntimeAdapters(manager: ProviderManagerFacade): ProviderRuntimeAdapterRegistry {
  return {
    codex: createProviderRuntimeAdapter("codex", manager),
    antigravity: createProviderRuntimeAdapter("antigravity", manager)
  };
}
