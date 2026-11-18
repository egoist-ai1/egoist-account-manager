import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CodexRpcClient,
  runCodexCommand,
  type AccountReadResponse,
  type CodexCommandResult,
  type CodexInitializeResponse
} from "../codexRpc.js";
import { resolveCodexPath } from "../processManager.js";
import {
  CODEX_LOGIN_METHODS,
  unavailableCodexCapabilityReport,
  type CodexCapabilityReport,
  type CodexCapabilityStability,
  type CodexLoginCapability,
  type CodexLoginMethodId,
  type CodexRuntimeIdentity,
  type CodexFeatureCapabilities
} from "../../shared/codexCapabilities.js";
import { redactSensitiveText } from "../../shared/redaction.js";

interface CapabilityRpcClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  readAccount(refreshToken?: boolean): Promise<AccountReadResponse>;
  getInitializeResponse(): CodexInitializeResponse | null;
}

interface LoginSchemaVariant {
  description?: string;
  properties?: {
    type?: {
      enum?: unknown[];
    };
  };
}

interface LoginAccountSchema {
  oneOf?: LoginSchemaVariant[];
}

export interface CodexCapabilityServiceOptions {
  appDataDir: string;
  codexHome: string;
  codexPath: string | null;
  now?: () => number;
  runCommand?: (
    codexPath: string,
    args: string[],
    options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number; maxOutputBytes?: number; stdin?: string }
  ) => Promise<CodexCommandResult>;
  createRpcClient?: (codexHome: string, codexPath: string) => CapabilityRpcClient;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message).replace(/\s+/g, " ").trim().slice(0, 320) || "Unknown Codex capability error";
}

function methodStability(id: CodexLoginMethodId, description: string | undefined): CodexCapabilityStability {
  if (id === "enterpriseAccessToken") return "experimental";
  if (id !== "chatgptAuthTokens") return "stable";
  return /internal use only/i.test(description ?? "") ? "internal" : "experimental";
}

export function extractLoginCapabilities(schema: LoginAccountSchema): CodexLoginCapability[] {
  const discovered = new Map<CodexLoginMethodId, { stability: CodexCapabilityStability; reason: string | null }>();
  for (const variant of schema.oneOf ?? []) {
    const raw = variant.properties?.type?.enum?.[0];
    if (typeof raw !== "string" || !CODEX_LOGIN_METHODS.includes(raw as CodexLoginMethodId)) continue;
    const id = raw as CodexLoginMethodId;
    const stability = methodStability(id, variant.description);
    discovered.set(id, {
      stability,
      reason: stability === "internal" ? "Installed Codex marks this method for internal use only." : null
    });
  }

  return CODEX_LOGIN_METHODS.map((id) => {
    const capability = discovered.get(id);
    return {
      id,
      available: Boolean(capability),
      stability: capability?.stability
        ?? (id === "chatgptAuthTokens" ? "internal" : id === "enterpriseAccessToken" ? "experimental" : "stable"),
      reason: capability ? capability.reason : "Not advertised by the installed Codex schema."
    };
  });
}

function identityFromAccount(response: AccountReadResponse): CodexRuntimeIdentity {
  const account = response.account;
  if (!account) {
    return {
      signedIn: false,
      authMode: null,
      email: null,
      planType: null,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      error: null
    };
  }
  if (account.type === "chatgpt") {
    return {
      signedIn: true,
      authMode: "chatgpt",
      email: account.email,
      planType: account.planType,
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      error: null
    };
  }
  return {
    signedIn: true,
    authMode: account.type,
    email: null,
    planType: null,
    requiresOpenaiAuth: response.requiresOpenaiAuth,
    error: null
  };
}

function schemaCacheKey(codexPath: string, cliVersion: string): string {
  const digest = crypto.createHash("sha256").update(`${codexPath}\0${cliVersion}`).digest("hex").slice(0, 12);
  const version = cliVersion.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "unknown";
  return `${version}-${digest}`;
}

export class CodexCapabilityService {
  private cached: CodexCapabilityReport | null = null;
  private inFlight: Promise<CodexCapabilityReport> | null = null;

  constructor(private readonly options: CodexCapabilityServiceOptions) {}

  async getReport(force = false): Promise<CodexCapabilityReport> {
    if (this.inFlight) return structuredClone(await this.inFlight);
    this.inFlight = this.probe(force);
    try {
      this.cached = await this.inFlight;
      return structuredClone(this.cached);
    } finally {
      this.inFlight = null;
    }
  }

  invalidate(): void {
    this.cached = null;
  }

  private async probe(force: boolean): Promise<CodexCapabilityReport> {
    const generatedAt = Math.floor((this.options.now?.() ?? Date.now()) / 1000);
    const codexPath = (this.options.codexPath && fs.existsSync(this.options.codexPath))
      ? this.options.codexPath
      : resolveCodexPath();
    if (!codexPath) return unavailableCodexCapabilityReport("Codex CLI was not found.", generatedAt);

    const run = this.options.runCommand ?? runCodexCommand;
    const versionResult = await run(codexPath, ["--version"], { timeoutMs: 5_000 });
    if (versionResult.exitCode !== 0) {
      return unavailableCodexCapabilityReport(
        `Codex version probe failed with exit code ${versionResult.exitCode}.`,
        generatedAt
      );
    }
    const cliVersion = versionResult.stdout.trim().split(/\r?\n/, 1)[0]?.slice(0, 120) || null;
    if (!cliVersion) return unavailableCodexCapabilityReport("Codex version probe returned no version.", generatedAt);
    const versionKey = schemaCacheKey(codexPath, cliVersion);
    if (!force && this.cached?.protocol.schemaVersionKey === versionKey && generatedAt - this.cached.generatedAt < 5 * 60) {
      return this.cached;
    }

    let loginMethods: CodexLoginCapability[];
    let schemaVersionKey: string | null = null;
    let schemaError: string | null = null;
    let features = this.readFeatures(versionKey);
    try {
      schemaVersionKey = schemaCacheKey(codexPath, cliVersion);
      const schema = await this.loadLoginSchema(run, codexPath, schemaVersionKey);
      loginMethods = extractLoginCapabilities(schema);
      features = this.readFeatures(schemaVersionKey);
    } catch (error) {
      schemaError = safeError(error);
      loginMethods = CODEX_LOGIN_METHODS.map((id) => ({
        id,
        available: false,
        stability: id === "chatgptAuthTokens" ? "internal" : id === "enterpriseAccessToken" ? "experimental" : "stable",
        reason: schemaError
      }));
    }
    const accessTokenHelp = await run(codexPath, ["login", "--help"], {
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024
    }).catch(() => null);
    const supportsAccessToken = accessTokenHelp?.exitCode === 0
      && /--with-access-token\b/.test(`${accessTokenHelp.stdout}\n${accessTokenHelp.stderr}`);
    loginMethods = loginMethods.map((method) => method.id === "enterpriseAccessToken"
      ? {
          id: method.id,
          available: supportsAccessToken,
          stability: "experimental",
          reason: supportsAccessToken
            ? "Supported by the installed Codex CLI through the official --with-access-token flow."
            : "The installed Codex CLI does not advertise --with-access-token."
        }
      : method);

    let initialize: CodexInitializeResponse | null = null;
    let identity: CodexRuntimeIdentity = {
      signedIn: false,
      authMode: null,
      email: null,
      planType: null,
      requiresOpenaiAuth: true,
      error: null
    };
    const client = this.options.createRpcClient?.(this.options.codexHome, codexPath)
      ?? new CodexRpcClient(this.options.codexHome, codexPath);
    try {
      await client.start();
      initialize = client.getInitializeResponse();
      if (features.accountRead.available) identity = identityFromAccount(await client.readAccount(false));
      else identity.error = features.accountRead.reason;
    } catch (error) {
      identity.error = safeError(error);
    } finally {
      await client.stop().catch(() => undefined);
    }

    features.initialize = { available: Boolean(initialize), reason: initialize ? null : identity.error ?? "Initialization failed." };
    const compatible = !schemaError && features.initialize.available;

    return {
      generatedAt,
      cliVersion,
      protocol: {
        compatible,
        userAgent: initialize?.userAgent ?? null,
        codexHome: initialize?.codexHome ?? null,
        platformFamily: initialize?.platformFamily ?? null,
        platformOs: initialize?.platformOs ?? null,
        schemaVersionKey,
        error: schemaError ?? identity.error
      },
      loginMethods,
      identity,
      features
    };
  }

  private readFeatures(key: string): CodexFeatureCapabilities {
    const root = path.join(this.options.appDataDir, "protocol-cache", key);
    const read = (name: string): Record<string, unknown> | null => {
      try { return JSON.parse(fs.readFileSync(path.join(root, name), "utf8")) as Record<string, unknown>; }
      catch { return null; }
    };
    const request = read("ClientRequest.json");
    const variants = Array.isArray(request?.oneOf) ? request.oneOf : [];
    const supports = (method: string): boolean => variants.some((variant: unknown) => {
      if (!variant || typeof variant !== "object") return false;
      const record = variant as { properties?: { method?: { enum?: unknown[] } } };
      return record.properties?.method?.enum?.includes(method) === true;
    });
    const feature = (available: boolean, reason: string) => ({ available, reason: available ? null : reason });
    const responseHas = (name: string, field: string) => {
      const schema = read(name) as { properties?: Record<string, unknown> } | null;
      return Boolean(schema?.properties && field in schema.properties);
    };
    const accountRead = supports("account/read") && responseHas("v2/GetAccountResponse.json", "account");
    const quotaRead = supports("account/rateLimits/read") && responseHas("v2/GetAccountRateLimitsResponse.json", "rateLimits");
    const quotaParams = read("v2/NullableGetAccountRateLimitsParams.json") as {
      definitions?: { GetAccountRateLimitsParams?: { properties?: Record<string, unknown> } }
    } | null;
    return {
      initialize: feature(false, "Initialization has not been observed."),
      accountRead: feature(accountRead, "Installed schema does not advertise account/read."),
      quotaRead: feature(quotaRead, "Installed schema does not advertise account/rateLimits/read."),
      excludeResetCreditDetails: feature(quotaRead && Boolean(quotaParams?.definitions?.GetAccountRateLimitsParams?.properties?.excludeResetCreditDetails),
        "Installed schema does not advertise excludeResetCreditDetails.")
    };
  }

  private async loadLoginSchema(
    run: NonNullable<CodexCapabilityServiceOptions["runCommand"]>,
    codexPath: string,
    key: string
  ): Promise<LoginAccountSchema> {
    const cacheRoot = path.join(this.options.appDataDir, "protocol-cache");
    const cacheDir = path.join(cacheRoot, key);
    const schemaPath = path.join(cacheDir, "v2", "LoginAccountParams.json");
    if (fs.existsSync(schemaPath)) return this.readLoginSchema(schemaPath);

    fs.mkdirSync(cacheRoot, { recursive: true });
    const tempDir = path.join(cacheRoot, `.prepare-${key}-${process.pid}-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    try {
      const result = await run(
        codexPath,
        ["app-server", "generate-json-schema", "--out", tempDir],
        { timeoutMs: 20_000, maxOutputBytes: 128 * 1024 }
      );
      if (result.exitCode !== 0) {
        throw new Error(`Codex schema generation failed with exit code ${result.exitCode}.`);
      }
      const preparedPath = path.join(tempDir, "v2", "LoginAccountParams.json");
      const schema = this.readLoginSchema(preparedPath);
      try {
        fs.renameSync(tempDir, cacheDir);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
      }
      return schema;
    } finally {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private readLoginSchema(schemaPath: string): LoginAccountSchema {
    const parsed = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as LoginAccountSchema;
    if (!Array.isArray(parsed.oneOf)) throw new Error("Installed Codex login schema has no oneOf variants.");
    return parsed;
  }
}
