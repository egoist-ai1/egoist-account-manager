export const DEVICE_CODE_CLIPBOARD_TTL_MS = 15 * 60 * 1000;

export interface DeviceCodeClipboard {
  writeText(value: string): void;
  readText(): string;
  clear(): void;
}

type TimerHandle = ReturnType<typeof setTimeout>;
type ScheduleTimer = (callback: () => void, delayMs: number) => TimerHandle;
type CancelTimer = (timer: TimerHandle) => void;

export class DeviceCodeHandoffService {
  private clearTimer: TimerHandle | null = null;
  private currentCode: string | null = null;

  constructor(
    private readonly clipboard: DeviceCodeClipboard,
    private readonly ttlMs = DEVICE_CODE_CLIPBOARD_TTL_MS,
    private readonly scheduleTimer: ScheduleTimer = setTimeout,
    private readonly cancelTimer: CancelTimer = clearTimeout
  ) {}

  copy(userCode: string): void {
    const normalizedCode = userCode.trim();
    if (!/^[a-z0-9-]{4,64}$/i.test(normalizedCode)) {
      throw new Error("Invalid device code");
    }

    this.clipboard.writeText(normalizedCode);
    this.currentCode = normalizedCode;
    if (this.clearTimer) this.cancelTimer(this.clearTimer);
    this.clearTimer = this.scheduleTimer(() => {
      this.clearTimer = null;
      this.currentCode = null;
      try {
        if (this.clipboard.readText() === normalizedCode) this.clipboard.clear();
      } catch {
        // Clipboard cleanup is best-effort and must never interrupt login.
      }
    }, this.ttlMs);
    this.clearTimer.unref?.();
  }

  dispose(): void {
    if (this.clearTimer) {
      this.cancelTimer(this.clearTimer);
      this.clearTimer = null;
    }
    const code = this.currentCode;
    this.currentCode = null;
    if (!code) return;
    try {
      if (this.clipboard.readText() === code) this.clipboard.clear();
    } catch {
      // Clipboard cleanup is best-effort during application shutdown.
    }
  }
}
