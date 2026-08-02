export interface RefreshBackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  nowMs?: () => number;
}

export interface RefreshBlockedReason {
  remainingMs: number;
  message: string;
}

interface RefreshBackoffEntry {
  failures: number;
  blockedUntilMs: number;
  lastReason: string;
}

export class RefreshBackoff {
  private readonly entries = new Map<string, RefreshBackoffEntry>();
  private readonly nowMs: () => number;

  constructor(private readonly options: RefreshBackoffOptions) {
    this.nowMs = options.nowMs ?? Date.now;
  }

  getBlockedReason(accountId: string): RefreshBlockedReason | null {
    const entry = this.entries.get(accountId);
    if (!entry) return null;

    const remainingMs = Math.max(0, entry.blockedUntilMs - this.nowMs());
    if (remainingMs <= 0) return null;

    return {
      remainingMs,
      message: `Обновление лимитов временно отложено после недавней ошибки. Повторите через ${Math.ceil(remainingMs / 1000)} с.`
    };
  }

  recordFailure(accountId: string, reason: string): void {
    const previous = this.entries.get(accountId);
    const failures = (previous?.failures ?? 0) + 1;
    const delayMs = Math.min(this.options.maxDelayMs, this.options.baseDelayMs * 2 ** (failures - 1));
    this.entries.set(accountId, {
      failures,
      blockedUntilMs: this.nowMs() + delayMs,
      lastReason: reason
    });
  }

  recordSuccess(accountId: string): void {
    this.entries.delete(accountId);
  }
}
