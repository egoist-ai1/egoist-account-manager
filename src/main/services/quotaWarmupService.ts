import type { AccountManager } from "../accountManager.js";
import type { ManagedAccount, QuotaWarmupAccountResult, QuotaWarmupFleetResult } from "../../shared/types.js";
import { runCodexCommand } from "../codexRpc.js";

function formatMinutesLeft(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours} ч ${remMins} мин` : `${hours} ч`;
}

export class QuotaWarmupService {
  constructor(private readonly manager: AccountManager) {}

  /**
   * Triggers a minimal test request on a single account to start its rolling reset cooldown timer.
   * If the timer is already active (resetsAt > now), skips redundant requests.
   */
  async warmupAccount(accountId: string): Promise<QuotaWarmupAccountResult> {
    const account = this.manager.getStore().get(accountId);
    if (!account) {
      return {
        accountId,
        accountLabel: accountId,
        platform: "codex",
        status: "failed",
        message: "Аккаунт не найден",
        resetsAt: null
      };
    }

    if (account.archived) {
      return {
        accountId: account.id,
        accountLabel: account.label,
        platform: account.platform,
        status: "skipped",
        message: "Аккаунт в архиве",
        resetsAt: account.primaryResetsAt
      };
    }

    const now = Math.floor(Date.now() / 1000);

    // If timer is already running and has more than 2 minutes left, do not send redundant requests
    if (account.primaryResetsAt && account.primaryResetsAt > now + 120) {
      const remainingSecs = account.primaryResetsAt - now;
      return {
        accountId: account.id,
        accountLabel: account.label,
        platform: account.platform,
        status: "already_active",
        message: `Таймер уже запущен (до сброса ${formatMinutesLeft(remainingSecs)})`,
        resetsAt: account.primaryResetsAt
      };
    }

    try {
      if (account.platform === "codex") {
        await this.warmupCodexAccount(account);
      } else {
        await this.warmupAntigravityAccount(account);
      }

      // Refresh rate limits to capture the newly started reset window
      const refreshed = await this.manager.refreshAccount(account.id);
      const resetsAt = refreshed.primaryResetsAt;

      if (resetsAt && resetsAt > now) {
        const remainingSecs = resetsAt - now;
        return {
          accountId: account.id,
          accountLabel: account.label,
          platform: account.platform,
          status: "triggered",
          message: `Таймер успешно запущен (сброс через ${formatMinutesLeft(remainingSecs)})`,
          resetsAt
        };
      }

      return {
        accountId: account.id,
        accountLabel: account.label,
        platform: account.platform,
        status: "triggered",
        message: "Тестовый запрос отправлен, квота обновлена",
        resetsAt: null
      };
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      return {
        accountId: account.id,
        accountLabel: account.label,
        platform: account.platform,
        status: "failed",
        message: `Ошибка прогрева: ${errMessage}`,
        resetsAt: account.primaryResetsAt
      };
    }
  }

  /**
   * Warms up all non-archived accounts sequentially to trigger their cooldown timers.
   */
  async warmupAll(): Promise<QuotaWarmupFleetResult> {
    const accounts = this.manager.list().filter((a) => !a.archived);
    const results: QuotaWarmupAccountResult[] = [];
    let triggered = 0;
    let alreadyActive = 0;
    let failed = 0;

    for (const account of accounts) {
      const res = await this.warmupAccount(account.id);
      results.push(res);
      if (res.status === "triggered") triggered++;
      else if (res.status === "already_active") alreadyActive++;
      else if (res.status === "failed") failed++;
    }

    return {
      total: accounts.length,
      triggered,
      alreadyActive,
      failed,
      results
    };
  }

  private async warmupCodexAccount(account: ManagedAccount): Promise<void> {
    const codexPath = this.manager.getCodexPath?.() ?? null;
    if (codexPath) {
      try {
        await runCodexCommand(codexPath, ["exec", "--sandbox", "read-only", "echo ping"], {
          timeoutMs: 15_000,
          env: { ...process.env, CODEX_HOME: account.profileDir }
        });
        return;
      } catch {
        // Fall back to refresh polling if CLI exec is not permitted in environment
      }
    }
    // Standard refresh triggers account/rateLimits/read or RPC ping
    await this.manager.refreshAccount(account.id);
  }

  private async warmupAntigravityAccount(account: ManagedAccount): Promise<void> {
    // Quota refresh on Antigravity initializes code assist context and activates rolling quotas
    await this.manager.refreshAccount(account.id);
  }
}
