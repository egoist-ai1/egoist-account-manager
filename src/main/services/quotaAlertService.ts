import type { ManagedAccount } from "../../shared/types.js";
import { buildProviderQuotaState, type ProviderQuotaWindow } from "../../shared/providerAdapter.js";
import { selectAutoSwitchAccount } from "../../shared/smartSelection.js";

interface PersistedQuotaAlertState {
  version: 1;
  notifiedWindows: Record<string, number>;
}

export interface QuotaAlert {
  accountId: string;
  accountLabel: string;
  windowId: string;
  windowType: ProviderQuotaWindow["windowType"];
  remainingPercent: number;
  resetAt: number;
  recommendedAccountId: string | null;
  recommendedAccountLabel: string | null;
}

export interface QuotaAlertServiceOptions {
  readState: () => string | null;
  writeState: (value: string) => void;
  now?: () => number;
  staleAfterSeconds?: number;
}

const emptyState = (): PersistedQuotaAlertState => ({ version: 1, notifiedWindows: {} });

function parseState(raw: string | null): PersistedQuotaAlertState {
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedQuotaAlertState>;
    if (parsed.version !== 1 || !parsed.notifiedWindows || typeof parsed.notifiedWindows !== "object") return emptyState();
    return {
      version: 1,
      notifiedWindows: Object.fromEntries(
        Object.entries(parsed.notifiedWindows)
          .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      )
    };
  } catch {
    return emptyState();
  }
}

function alertableWindows(account: ManagedAccount, now: number, staleAfterSeconds: number): ProviderQuotaWindow[] {
  const quota = buildProviderQuotaState(account);
  if (
    !account.isActive ||
    account.archived ||
    account.status === "error" ||
    account.status === "unknown" ||
    quota.source !== "official_api" ||
    quota.confidence !== "confirmed" ||
    !quota.lastCheckedAt ||
    now - quota.lastCheckedAt > staleAfterSeconds
  ) {
    return [];
  }

  return quota.windows.filter((window) =>
    window.source === "official_api" &&
    window.confidence === "confirmed" &&
    typeof window.remaining === "number" &&
    typeof window.resetAt === "number" &&
    window.resetAt > now
  );
}

export class QuotaAlertService {
  private readonly now: () => number;
  private readonly staleAfterSeconds: number;

  constructor(private readonly options: QuotaAlertServiceOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.staleAfterSeconds = options.staleAfterSeconds ?? 15 * 60;
  }

  evaluate(accounts: ManagedAccount[], thresholdPercent: number): QuotaAlert[] {
    const now = this.now();
    const threshold = Math.max(5, Math.min(50, Math.round(thresholdPercent)));
    const state = parseState(this.options.readState());
    state.notifiedWindows = Object.fromEntries(
      Object.entries(state.notifiedWindows).filter(([, resetAt]) => resetAt > now)
    );

    const recommendation = selectAutoSwitchAccount(accounts, {
      now,
      staleAfterSeconds: this.staleAfterSeconds,
      thresholdPercent: threshold
    });
    const alerts: QuotaAlert[] = [];

    for (const account of accounts) {
      for (const window of alertableWindows(account, now, this.staleAfterSeconds)) {
        if ((window.remaining ?? 100) > threshold || window.resetAt === null || window.remaining === null) continue;
        const key = `${account.id}:${window.id}:${window.resetAt}`;
        if (state.notifiedWindows[key]) continue;
        state.notifiedWindows[key] = window.resetAt;
        alerts.push({
          accountId: account.id,
          accountLabel: account.label,
          windowId: window.id,
          windowType: window.windowType,
          remainingPercent: window.remaining,
          resetAt: window.resetAt,
          recommendedAccountId: recommendation?.accountId ?? null,
          recommendedAccountLabel: recommendation?.accountLabel ?? null
        });
      }
    }

    this.options.writeState(JSON.stringify(state));
    return alerts;
  }
}
