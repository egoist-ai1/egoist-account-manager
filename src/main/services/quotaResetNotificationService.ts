import type { AccountPlatform, ManagedAccount } from "../../shared/types.js";
import { buildProviderQuotaState } from "../../shared/providerAdapter.js";

export interface QuotaResetNotification {
  accountId: string;
  accountLabel: string;
  platform: AccountPlatform;
  title: string;
  body: string;
}

export interface QuotaResetNotificationServiceOptions {
  onNotify: (notification: QuotaResetNotification) => void;
  onTriggerRefresh?: (accountId: string) => void;
  now?: () => number;
  isEnglish?: () => boolean;
}

interface TrackedReset {
  accountId: string;
  accountLabel: string;
  platform: AccountPlatform;
  windowId: string;
  resetAt: number;
  notified: boolean;
}

export class QuotaResetNotificationService {
  private readonly onNotify: (notification: QuotaResetNotification) => void;
  private readonly onTriggerRefresh?: (accountId: string) => void;
  private readonly now: () => number;
  private readonly isEnglish: () => boolean;

  private readonly trackedResets = new Map<string, TrackedReset>();
  private readonly notifiedKeys = new Set<string>();
  private readonly previousRemaining = new Map<string, number>();
  private isInitialized = false;

  constructor(options: QuotaResetNotificationServiceOptions) {
    this.onNotify = options.onNotify;
    this.onTriggerRefresh = options.onTriggerRefresh;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.isEnglish = options.isEnglish ?? (() => false);
  }

  public onAccountsUpdated(accounts: ManagedAccount[]): void {
    const now = this.now();
    const en = this.isEnglish();

    for (const account of accounts) {
      if (account.archived) continue;
      const quotaState = buildProviderQuotaState(account);
      const prevRem = this.previousRemaining.get(account.id);
      const currentRem = quotaState.remaining;

      // Track each window with a reset time
      for (const window of quotaState.windows) {
        if (window.resetAt === null || window.resetAt === undefined) continue;
        const key = `${account.id}:${window.id}:${window.resetAt}`;

        if (!this.isInitialized) {
          // On first initialization at app boot:
          // Do not send notifications for already passed timestamps
          if (window.resetAt <= now) {
            this.notifiedKeys.add(key);
          } else {
            this.trackedResets.set(key, {
              accountId: account.id,
              accountLabel: account.label,
              platform: account.platform,
              windowId: window.id,
              resetAt: window.resetAt,
              notified: false
            });
          }
        } else {
          // Running state:
          if (!this.notifiedKeys.has(key)) {
            if (window.resetAt > now) {
              if (!this.trackedResets.has(key)) {
                this.trackedResets.set(key, {
                  accountId: account.id,
                  accountLabel: account.label,
                  platform: account.platform,
                  windowId: window.id,
                  resetAt: window.resetAt,
                  notified: false
                });
              }
            } else if (window.resetAt <= now && window.resetAt >= now - 180) {
              // Reset time just passed in the last 3 minutes and wasn't notified yet
              this.notifyReset(account.id, account.label, account.platform, key, en);
            }
          }
        }
      }

      // Detect quota jump after refresh:
      // If account was previously constrained (e.g. <= 30% remaining) and now jumped to >= 80%
      if (
        this.isInitialized &&
        typeof prevRem === "number" &&
        prevRem <= 30 &&
        typeof currentRem === "number" &&
        currentRem >= 80
      ) {
        const jumpKey = `${account.id}:jump:${Math.floor(now / 300)}`;
        if (!this.notifiedKeys.has(jumpKey)) {
          this.notifiedKeys.add(jumpKey);
          this.emitNotification(account.id, account.label, account.platform, en);
        }
      }

      if (typeof currentRem === "number") {
        this.previousRemaining.set(account.id, currentRem);
      }
    }

    this.isInitialized = true;
  }

  public checkTimeBasedResets(): void {
    const now = this.now();
    const en = this.isEnglish();

    for (const [key, tracked] of this.trackedResets.entries()) {
      if (!tracked.notified && now >= tracked.resetAt) {
        this.notifyReset(tracked.accountId, tracked.accountLabel, tracked.platform, key, en);
        if (this.onTriggerRefresh) {
          this.onTriggerRefresh(tracked.accountId);
        }
      }
    }
  }

  private notifyReset(
    accountId: string,
    accountLabel: string,
    platform: AccountPlatform,
    key: string,
    en: boolean
  ): void {
    if (this.notifiedKeys.has(key)) return;
    this.notifiedKeys.add(key);
    const tracked = this.trackedResets.get(key);
    if (tracked) tracked.notified = true;
    this.emitNotification(accountId, accountLabel, platform, en);
  }

  private emitNotification(
    accountId: string,
    accountLabel: string,
    platform: AccountPlatform,
    en: boolean
  ): void {
    const isAg = platform === "antigravity";
    const title = isAg
      ? (en ? "Antigravity · Quota Restored" : "Antigravity · Лимиты восстановлены")
      : (en ? "Codex · Quota Restored" : "Codex · Лимиты восстановлены");
    const body = en
      ? `Limits for "${accountLabel}" have been restored and are ready to use.`
      : `Лимиты для "${accountLabel}" восстановлены и готовы к работе.`;

    this.onNotify({
      accountId,
      accountLabel,
      platform,
      title,
      body
    });
  }
}
