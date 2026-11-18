import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { AccountPlatform } from "../../shared/types.js";

export type TaskbarWidgetInput =
  | { type: "leave" }
  | { type: "enter" | "click" | "context"; platform: AccountPlatform; point: { x: number; y: number } };

type TaskbarWidgetEvent = TaskbarWidgetInput | { type: "ready" } | { type: "unavailable" };
type TaskbarWidgetTheme = "dark" | "light";
type WidgetProcess = ChildProcessByStdio<Writable, Readable, null>;

export function encodeTaskbarWidgetState(codex: string, antigravity: string, theme: TaskbarWidgetTheme): string {
  const quota = /^(?:<1%|(?:0|[1-9]\d?|100)%)$/;
  return `state\t${quota.test(codex) ? codex : "—"}\t${quota.test(antigravity) ? antigravity : "—"}\t${theme}\n`;
}

export function parseTaskbarWidgetEvent(line: string): TaskbarWidgetEvent | null {
  const [type, platform, xText, yText, ...extra] = line.split("\t");
  if ((type === "ready" || type === "unavailable" || type === "leave") && platform === undefined) return { type };
  if ((type !== "enter" && type !== "click" && type !== "context") ||
      (platform !== "codex" && platform !== "antigravity") || extra.length ||
      !/^-?\d{1,10}$/.test(xText ?? "") || !/^-?\d{1,10}$/.test(yText ?? "")) return null;
  const x = Number(xText), y = Number(yText);
  if (x !== (x | 0) || y !== (y | 0)) return null;
  return { type, platform, point: { x, y } };
}

export class QuotaTaskbarWidget {
  private child: WidgetProcess | null = null;
  private enabled = false;
  private available = false;
  private state = encodeTaskbarWidgetState("—", "—", "dark");
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelay = 1_000;

  constructor(private readonly executable: string, private readonly handlers: {
    onAvailability(available: boolean): void;
    onInput(event: TaskbarWidgetInput): void;
  }) {}

  setState(codex: string, antigravity: string, theme: TaskbarWidgetTheme): void {
    const state = encodeTaskbarWidgetState(codex, antigravity, theme);
    if (this.state === state) return;
    this.state = state;
    if (this.child?.stdin.writable) this.child.stdin.write(state);
  }

  start(): void {
    this.enabled = true;
    if (!this.child && !this.retryTimer) this.launch();
  }

  stop(): void {
    this.enabled = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryDelay = 1_000;
    this.setAvailable(false);
    this.child?.stdin.end();
  }

  private setAvailable(available: boolean): void {
    if (this.available === available) return;
    this.available = available;
    this.handlers.onAvailability(available);
  }

  private launch(): void {
    const { SystemRoot, WINDIR, TEMP, TMP } = process.env;
    const child = spawn(this.executable, [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: { SystemRoot, WINDIR, TEMP, TMP }
    });
    this.child = child;
    const startedAt = Date.now();
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const handshakeTimer = setTimeout(() => child.kill(), 5_000).unref();
    let stopTimer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (this.child !== child) return;
      this.child = null;
      clearTimeout(handshakeTimer);
      clearTimeout(stopTimer);
      lines.close();
      this.setAvailable(false);
      if (!this.enabled) return;
      if (Date.now() - startedAt >= 30_000) this.retryDelay = 1_000;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.launch();
      }, this.retryDelay).unref();
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    };

    child.once("error", finish);
    child.once("exit", finish);
    child.stdin.on("error", () => {
      if (this.child === child) child.kill();
    });
    child.stdin.once("finish", () => {
      if (this.child === child) stopTimer = setTimeout(() => child.kill(), 2_000).unref();
    });
    lines.on("line", (line) => {
      if (this.child !== child || !this.enabled || child.stdin.writableEnded) return;
      const event = parseTaskbarWidgetEvent(line);
      if (!event) return;
      if (event.type === "ready" || event.type === "unavailable") {
        clearTimeout(handshakeTimer);
        this.setAvailable(event.type === "ready");
      } else if (this.available) {
        this.handlers.onInput(event);
      }
    });
    child.stdin.write(this.state);
  }
}
