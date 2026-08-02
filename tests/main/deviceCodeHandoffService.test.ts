import { describe, expect, it, vi } from "vitest";
import { DeviceCodeHandoffService } from "../../src/main/services/deviceCodeHandoffService";

describe("DeviceCodeHandoffService", () => {
  it("copies a device code and clears only the unchanged code after expiry", () => {
    let value = "previous clipboard";
    let scheduled: (() => void) | null = null;
    const timer = { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
    const clipboard = {
      writeText: vi.fn((next: string) => { value = next; }),
      readText: vi.fn(() => value),
      clear: vi.fn(() => { value = ""; })
    };
    const service = new DeviceCodeHandoffService(
      clipboard,
      900_000,
      ((callback: () => void) => {
        scheduled = callback;
        return timer;
      }) as typeof setTimeout,
      vi.fn()
    );

    service.copy("ABCD-1234");

    expect(clipboard.writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(timer.unref).toHaveBeenCalled();
    expect(scheduled).not.toBeNull();
    (scheduled as unknown as () => void)();
    expect(clipboard.clear).toHaveBeenCalledOnce();
  });

  it("does not erase clipboard content replaced by the user", () => {
    let value = "";
    let scheduled: (() => void) | null = null;
    const clipboard = {
      writeText: vi.fn((next: string) => { value = next; }),
      readText: vi.fn(() => value),
      clear: vi.fn(() => { value = ""; })
    };
    const service = new DeviceCodeHandoffService(
      clipboard,
      900_000,
      ((callback: () => void) => {
        scheduled = callback;
        return { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      vi.fn()
    );

    service.copy("WXYZ-9876");
    value = "user clipboard";
    (scheduled as unknown as () => void)();

    expect(clipboard.clear).not.toHaveBeenCalled();
    expect(value).toBe("user clipboard");
  });

  it("clears only an unchanged device code when the application exits early", () => {
    let value = "";
    const cancelTimer = vi.fn();
    const clipboard = {
      writeText: vi.fn((next: string) => { value = next; }),
      readText: vi.fn(() => value),
      clear: vi.fn(() => { value = ""; })
    };
    const service = new DeviceCodeHandoffService(
      clipboard,
      900_000,
      (() => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      cancelTimer
    );

    service.copy("EXIT-1234");
    service.dispose();

    expect(cancelTimer).toHaveBeenCalledOnce();
    expect(clipboard.clear).toHaveBeenCalledOnce();
    expect(value).toBe("");
  });

  it("rejects malformed content instead of placing it on the clipboard", () => {
    const clipboard = { writeText: vi.fn(), readText: vi.fn(), clear: vi.fn() };
    const service = new DeviceCodeHandoffService(clipboard);

    expect(() => service.copy("<script>")) .toThrow("Invalid device code");
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });
});
