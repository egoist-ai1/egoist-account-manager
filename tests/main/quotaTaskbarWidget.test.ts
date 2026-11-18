import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { encodeTaskbarWidgetState, parseTaskbarWidgetEvent, QuotaTaskbarWidget } from "../../src/main/services/quotaTaskbarWidget";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

class FixtureChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly kill = vi.fn();
  readonly writes: string[] = [];

  constructor() {
    super();
    this.stdin.on("data", (data: Buffer) => this.writes.push(data.toString()));
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

test("widget protocol serializes bounded quota values only", () => {
  expect(encodeTaskbarWidgetState("<1%", "0%", "dark")).toBe("state\t<1%\t0%\tdark\n");
  expect(encodeTaskbarWidgetState("100%", "—", "light")).toBe("state\t100%\t—\tlight\n");
  expect(encodeTaskbarWidgetState("private\nname", "101%", "light")).toBe("state\t—\t—\tlight\n");
});

test("widget events accept physical Windows coordinates and known platforms", () => {
  expect(parseTaskbarWidgetEvent("context\tantigravity\t-1520\t861")).toEqual({
    type: "context", platform: "antigravity", point: { x: -1520, y: 861 }
  });
  expect(parseTaskbarWidgetEvent("leave")).toEqual({ type: "leave" });
  expect(parseTaskbarWidgetEvent("ready")).toEqual({ type: "ready" });
  expect(parseTaskbarWidgetEvent("unavailable")).toEqual({ type: "unavailable" });
  expect(parseTaskbarWidgetEvent("click\tother\t1\t2")).toBeNull();
  expect(parseTaskbarWidgetEvent("enter\tcodex\t1.5\t2")).toBeNull();
  expect(parseTaskbarWidgetEvent("enter\tcodex\t1\t2\textra")).toBeNull();
  expect(parseTaskbarWidgetEvent("click\tcodex\t2147483648\t0")).toBeNull();
});

test("widget keeps its connection when availability changes and replays the latest state after exit", () => {
  vi.useFakeTimers();
  const first = new FixtureChild();
  const replacement = new FixtureChild();
  vi.mocked(spawn)
    .mockReturnValueOnce(first as unknown as ReturnType<typeof spawn>)
    .mockReturnValueOnce(replacement as unknown as ReturnType<typeof spawn>);
  const onAvailability = vi.fn();
  const onInput = vi.fn();
  const widget = new QuotaTaskbarWidget("C:\\fixture\\KvesserQuotaWidget.exe", { onAvailability, onInput });
  widget.setState("34%", "—", "dark");
  widget.start();
  widget.start();
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(first.writes).toEqual(["state\t34%\t—\tdark\n"]);
  first.stdout.write("click\tcodex\t3\t4\nready\r\n");
  expect(onInput).not.toHaveBeenCalled();
  expect(onAvailability).toHaveBeenLastCalledWith(true);
  first.stdout.write("enter\tantigravity\t-30");
  first.stdout.write("\t42\r\nleave\n");
  expect(onInput.mock.calls).toEqual([
    [{ type: "enter", platform: "antigravity", point: { x: -30, y: 42 } }],
    [{ type: "leave" }]
  ]);
  first.stdout.write("unavailable\nready\n");
  expect(onAvailability.mock.calls).toEqual([[true], [false], [true]]);
  expect(spawn).toHaveBeenCalledTimes(1);

  widget.setState("34%", "—", "dark");
  widget.setState("34%", "100%", "light");
  expect(first.writes).toEqual(["state\t34%\t—\tdark\n", "state\t34%\t100%\tlight\n"]);
  first.emit("exit", 1, null);
  expect(onAvailability).toHaveBeenLastCalledWith(false);
  expect(spawn).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1_000);
  expect(replacement.writes).toEqual(["state\t34%\t100%\tlight\n"]);

  widget.stop();
  expect(replacement.stdin.writableEnded).toBe(true);
  replacement.emit("exit", 0, null);
  vi.advanceTimersByTime(60_000);
  expect(spawn).toHaveBeenCalledTimes(2);
});

test("failed startups back off and disabling the widget cancels a scheduled retry", () => {
  vi.useFakeTimers();
  const missing = new FixtureChild();
  const silent = new FixtureChild();
  vi.mocked(spawn)
    .mockReturnValueOnce(missing as unknown as ReturnType<typeof spawn>)
    .mockReturnValueOnce(silent as unknown as ReturnType<typeof spawn>);
  const onAvailability = vi.fn();
  const widget = new QuotaTaskbarWidget("C:\\fixture\\KvesserQuotaWidget.exe", { onAvailability, onInput: vi.fn() });
  widget.start();
  missing.emit("error", new Error("Fixture executable unavailable"));
  vi.advanceTimersByTime(999);
  expect(spawn).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(spawn).toHaveBeenCalledTimes(2);

  vi.advanceTimersByTime(5_000);
  expect(silent.kill).toHaveBeenCalledTimes(1);
  silent.emit("exit", 1, null);
  vi.advanceTimersByTime(1_999);
  expect(spawn).toHaveBeenCalledTimes(2);
  widget.stop();
  vi.advanceTimersByTime(60_000);
  expect(spawn).toHaveBeenCalledTimes(2);
  expect(onAvailability).not.toHaveBeenCalled();
});
