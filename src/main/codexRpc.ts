import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { PlanType, RateLimitSnapshot } from "../shared/types.js";
import { appVersion } from "../shared/releaseNotes.js";

type RpcResponse<T> = { id: number; result?: T; error?: { code: number; message: string; data?: unknown } };
type Notification = { method: string; params?: unknown };
const MAX_PROTOCOL_BUFFER_BYTES = 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024;

export interface CodexInitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export interface CodexCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CodexAccount =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string | null; planType: PlanType }
  | { type: "amazonBedrock"; credentialSource?: string };

export interface AccountReadResponse {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
}

export type LoginResponse =
  | { type: "apiKey" }
  | { type: "chatgpt"; loginId: string; authUrl: string }
  | { type: "chatgptDeviceCode"; loginId: string; verificationUrl: string; userCode: string }
  | { type: "chatgptAuthTokens" };

export interface RateLimitsResponse {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: Record<string, RateLimitSnapshot | undefined> | null;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export function spawnCodexProcess(codexPath: string, args: string[], env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  const extension = path.extname(codexPath).toLowerCase();
  if (process.platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    return spawn("cmd.exe", ["/d", "/c", "call", codexPath, ...args], {
      env,
      windowsHide: true,
      stdio: "pipe"
    });
  }
  if (process.platform === "win32" && extension === ".ps1") {
    return spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", codexPath, ...args], {
      env,
      windowsHide: true,
      stdio: "pipe"
    });
  }
  return spawn(codexPath, args, {
    env,
    windowsHide: true,
    stdio: "pipe"
  });
}

export function runCodexCommand(
  codexPath: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; maxOutputBytes?: number; stdin?: string } = {}
): Promise<CodexCommandResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_COMMAND_OUTPUT_BYTES;
  const child = spawnCodexProcess(codexPath, args, { ...process.env, ...options.env });

  return new Promise<CodexCommandResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const fail = (error: Error) => finish(() => {
      if (!child.killed) child.kill();
      reject(error);
    });
    const append = (current: string, chunk: Buffer | string): string => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next, "utf8") > maxOutputBytes) {
        fail(new Error("Codex command exceeded the bounded output limit"));
        return current;
      }
      return next;
    };

    const timer = setTimeout(
      () => fail(new Error(`Codex command timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.stdin.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") fail(error);
    });
    child.once("error", (error) => fail(error));
    child.once("exit", (code, signal) => finish(() => {
      if (code === null) {
        reject(new Error(`Codex command exited by signal ${signal ?? "unknown"}`));
        return;
      }
      resolve({ stdout, stderr, exitCode: code });
    }));
    child.stdin.end(options.stdin ?? "");
  });
}

export class CodexRpcClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private buffer = "";
  private initialized = false;
  private initializeResponse: CodexInitializeResponse | null = null;

  constructor(private readonly codexHome: string, private readonly codexPath = "codex") {
    super();
  }

  async start(): Promise<void> {
    if (this.child) return;
    fs.mkdirSync(this.codexHome, { recursive: true });

    this.child = spawnCodexProcess(this.codexPath, ["app-server", "--listen", "stdio://"], { ...process.env, CODEX_HOME: this.codexHome });

    this.child.on("error", (error) => {
      this.rejectAllPending(error);
      this.child = null;
      this.initialized = false;
      this.emit("stderr", `Failed to start Codex app-server with "${this.codexPath}": ${error.message}`);
      this.emit("exit", { code: null, signal: "spawn-error" });
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => this.emit("stderr", chunk));
    this.child.on("exit", (code, signal) => {
      const error = new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})`);
      this.rejectAllPending(error);
      this.child = null;
      this.initialized = false;
      this.emit("exit", { code, signal });
    });

    try {
      this.initializeResponse = await this.request<CodexInitializeResponse>("initialize", {
        clientInfo: {
          name: "egoist_codex_account_manager",
          title: "Egoist Account Manager",
          version: appVersion
        },
        capabilities: {
          optOutNotificationMethods: [
            "thread/started",
            "turn/started",
            "item/agentMessage/delta",
            "command/exec/outputDelta"
          ]
        }
      }, 15_000);
      this.sendNotification("initialized", {});
      this.initialized = true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.rejectAllPending(new Error("Codex app-server stopped"));
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
    this.child = null;
    this.initialized = false;
    this.initializeResponse = null;
  }

  getInitializeResponse(): CodexInitializeResponse | null {
    return this.initializeResponse ? { ...this.initializeResponse } : null;
  }

  async readAccount(refreshToken = false): Promise<AccountReadResponse> {
    await this.start();
    return this.request<AccountReadResponse>("account/read", { refreshToken }, 15_000);
  }

  async startLogin(
    input: { type: "chatgpt" | "chatgptDeviceCode" } | { type: "apiKey"; apiKey: string }
  ): Promise<LoginResponse> {
    await this.start();
    return this.request<LoginResponse>("account/login/start", input);
  }

  async readRateLimits(): Promise<RateLimitsResponse> {
    await this.start();
    return this.request<RateLimitsResponse>("account/rateLimits/read", undefined, 15_000);
  }

  private request<T>(method: string, params: unknown, timeoutMs = 45_000): Promise<T> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("Codex app-server is not running"));
    const id = this.nextId++;
    const payload = params === undefined ? { method, id } : { method, id, params };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private sendNotification(method: string, params: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_PROTOCOL_BUFFER_BYTES && !this.buffer.includes("\n")) {
      const error = new Error("Codex app-server emitted an oversized protocol frame");
      this.emit("stderr", error.message);
      this.rejectAllPending(error);
      this.child?.kill();
      this.buffer = "";
      return;
    }
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.onMessage(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private onMessage(line: string): void {
    let message: RpcResponse<unknown> | Notification;
    try {
      message = JSON.parse(line) as RpcResponse<unknown> | Notification;
    } catch {
      this.emit("stderr", `Invalid JSON from Codex app-server (${Buffer.byteLength(line, "utf8")} bytes)`);
      return;
    }

    if ("id" in message && typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) {
        this.respondToServerRequest(message.id, message);
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }

    if ("method" in message) {
      this.emit(message.method, message.params);
      this.emit("notification", message);
    }
  }

  private respondToServerRequest(id: number, message: unknown): void {
    const method = (message as { method?: string }).method;
    if (!method) return;
    this.child?.stdin.write(
      `${JSON.stringify({
        id,
        error: {
          code: -32601,
          message: `Client-side server request is not supported by Egoist Account Manager: ${method}`
        }
      })}\n`
    );
  }
}

export function getAuthFilePath(codexHome: string): string {
  return path.join(codexHome, "auth.json");
}

export function selectBestRateLimit(response: RateLimitsResponse): RateLimitSnapshot {
  const entries = Object.entries(response.rateLimitsByLimitId ?? {}).filter((entry): entry is [string, RateLimitSnapshot] => Boolean(entry[1]));
  const byCodex = entries.find(([id]) => id.toLowerCase() === "codex")?.[1]
    ?? entries.find(([id]) => id.toLowerCase().includes("codex"))?.[1];
  if (byCodex) return byCodex;
  return entries.find(([, snapshot]) => {
    const durations = [snapshot.primary?.windowDurationMins, snapshot.secondary?.windowDurationMins];
    return durations.includes(300) && durations.includes(10_080);
  })?.[1] ?? response.rateLimits;
}

export function normalizeCodexPlanType(planType: PlanType | null | undefined, snapshot?: RateLimitSnapshot | null): PlanType {
  const candidates = [
    snapshot?.planType,
    snapshot?.limitId,
    snapshot?.limitName,
    planType
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const normalized = candidates.map((value) => value.toLowerCase().replace(/[\s_-]+/g, ""));
  if (normalized.some((value) => value.includes("20") || value.includes("prox20") || value.includes("pro20"))) return "pro-x20";
  if (normalized.some((value) => value.includes("10") || value === "prolite" || value.includes("prox10") || value.includes("pro10"))) return "pro-x10";
  const direct = planType?.trim();
  if (!direct) return "unknown";
  if (direct.toLowerCase() === "pro") return "pro-x20";
  return direct;
}

export function classifyRateLimit(snapshot: RateLimitSnapshot): { status: "active" | "near_limit" | "limited"; reason: string | null } {
  if (snapshot.rateLimitReachedType) return { status: "limited", reason: snapshot.rateLimitReachedType };
  const used = Math.max(snapshot.primary?.usedPercent ?? 0, snapshot.secondary?.usedPercent ?? 0);
  if (used >= 90) return { status: "near_limit", reason: "Usage is above 90%" };
  return { status: "active", reason: null };
}
