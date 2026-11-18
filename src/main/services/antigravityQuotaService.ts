import type { ManagedAccount, PlanType, RateLimitSnapshot } from "../../shared/types.js";
import { ProviderRequestError, providerHttpError, type ProviderRequestErrorDetails } from "../../shared/quotaRefreshError.js";
import { fetchAntigravityGoogleAccountContext, type AntigravityGoogleAccountContext } from "./antigravityGoogleAuthService.js";

const endpoints = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels"
] as const;

interface RawQuotaBucket {
  bucketId?: unknown;
  modelId?: unknown;
  displayName?: unknown;
  window?: unknown;
  windowDurationMins?: unknown;
  resetTime?: unknown;
  remainingFraction?: unknown;
  remainingAmount?: unknown;
}

interface QuotaApiResponse {
  response?: Pick<QuotaApiResponse, "groups" | "buckets" | "models">;
  error?: { code?: number; message?: string; status?: string; details?: unknown[] };
  groups?: Array<{ displayName?: unknown; description?: unknown; buckets?: RawQuotaBucket[] }>;
  buckets?: RawQuotaBucket[];
  models?: Record<string, { quotaInfo?: RawQuotaBucket; displayName?: unknown }>;
  tieredModelIds?: Record<string, unknown>;
}

export interface AntigravityQuotaResult {
  limits: RateLimitSnapshot;
  status: ManagedAccount["status"];
  statusReason: string | null;
  accountContext: AntigravityGoogleAccountContext;
  forbidden: boolean;
  refreshError?: ProviderRequestErrorDetails | null;
}

export interface ModelQuota {
  name: string;
  displayName: string;
  usedPercent: number;
  resetAt: number | null;
  windowDurationMins: number | null;
  bucketHint: "pro" | "flash" | "model" | "unknown";
  modelId?: string | null;
  scope?: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resetAtSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 0 ? value : null;
  const raw = text(value);
  if (!raw) return null;
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : null;
}

export function parseQuotaWindowDuration(window: unknown, explicitMinutes?: unknown): number | null {
  if (typeof explicitMinutes === "number" && Number.isFinite(explicitMinutes) && explicitMinutes > 0) return explicitMinutes;
  const raw = text(window)?.toLowerCase();
  if (!raw) return null;
  if (raw === "weekly" || raw === "week") return 10_080;
  if (raw === "daily" || raw === "day") return 1_440;
  const duration = /^(\d+(?:\.\d+)?)\s*(m|min|minutes?|h|hours?|d|days?|w|weeks?)$/.exec(raw);
  if (!duration) return null;
  const value = Number(duration[1]);
  if (value <= 0) return null;
  const unit = duration[2];
  return value * (/^(h|hour)/.test(unit) ? 60 : /^(d|day)/.test(unit) ? 1440 : /^(w|week)/.test(unit) ? 10_080 : 1);
}

function usedPercentFromRemainingFraction(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const fraction = Number(value);
  if (!Number.isFinite(fraction)) return null;
  return Math.min(100, Math.max(0, (1 - Math.min(1, Math.max(0, fraction))) * 100));
}

function parseBucket(bucket: RawQuotaBucket, fallbackId: string, modelId: string | null, scope: string | null, prefix?: string): ModelQuota | null {
  const usedPercent = usedPercentFromRemainingFraction(bucket.remainingFraction);
  if (usedPercent === null) return null;
  const name = text(bucket.bucketId) ?? text(bucket.modelId) ?? fallbackId;
  const label = text(bucket.displayName) ?? name;
  return { name, displayName: prefix ? `${prefix}: ${label}` : label, usedPercent,
    resetAt: resetAtSeconds(bucket.resetTime),
    windowDurationMins: parseQuotaWindowDuration(bucket.window, bucket.windowDurationMins),
    bucketHint: modelId ? "model" : "unknown", modelId, scope };
}

export function parseSummaryGroups(body: QuotaApiResponse, _nowSeconds: number): ModelQuota[] {
  return (body.groups ?? body.response?.groups ?? []).flatMap((group, index) => {
    const name = text(group.displayName) ?? `Group ${index + 1}`;
    return (group.buckets ?? []).flatMap((bucket, slot) => {
      const parsed = parseBucket(bucket, `group-${index}-${slot}`, text(bucket.modelId), name, name);
      return parsed ? [parsed] : [];
    });
  });
}

function parseModels(body: QuotaApiResponse): ModelQuota[] {
  return Object.entries(body.models ?? body.response?.models ?? {}).flatMap(([id, model]) => {
    const parsed = parseBucket({ ...model.quotaInfo, displayName: model.displayName }, id, id, id);
    return parsed ? [parsed] : [];
  });
}

function parseBuckets(body: QuotaApiResponse): ModelQuota[] {
  return (body.buckets ?? body.response?.buckets ?? []).flatMap((bucket, index) => {
    const modelId = text(bucket.modelId);
    const parsed = parseBucket(bucket, `bucket-${index}`, modelId, modelId);
    return parsed ? [parsed] : [];
  });
}

export function normalizeAntigravityPlan(tierId: string | null, tier: AntigravityGoogleAccountContext["tier"]): PlanType {
  const key = (tierId ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  const plans: Record<string, PlanType> = {
    "free": "free", "free-tier": "free", "legacy-tier": "free", "zero": "free",
    "google-ai-pro": "google-ai-pro", "google-ai-ultra": "google-ai-ultra",
    "google-ai-ultra-x20": "google-ai-ultra-x20"
  };
  if (plans[key]) return plans[key];
  // Eligibility, accessible model names and remaining credits do not identify a subscription.
  if (tier === "free") return "free";
  return "unknown";
}

function orderedModels(models: ModelQuota[]): ModelQuota[] {
  return [...models].sort((a, b) => {
    const aWindow = a.windowDurationMins === 300 ? 0 : a.windowDurationMins === 10_080 ? 1 : 2;
    const bWindow = b.windowDurationMins === 300 ? 0 : b.windowDurationMins === 10_080 ? 1 : 2;
    return aWindow - bWindow || b.usedPercent - a.usedPercent || a.name.localeCompare(b.name);
  });
}

export function quotaResultFromModels(models: ModelQuota[], context: AntigravityGoogleAccountContext, forbidden: boolean,
  _hasProModels = false, forbiddenReason?: string | null): AntigravityQuotaResult {
  const ordered = orderedModels(models);
  const primary = ordered[0] ?? null;
  const secondary = primary?.windowDurationMins !== null
    ? ordered.find((model) => model.windowDurationMins !== null && model.windowDurationMins !== primary?.windowDurationMins) ?? ordered[1] ?? null
    : ordered[1] ?? null;
  const window = (model: ModelQuota | null) => model ? {
    usedPercent: model.usedPercent, windowDurationMins: model.windowDurationMins, resetsAt: model.resetAt,
    label: model.displayName, scope: model.scope ?? null
  } : null;
  const groups = new Map<string, number>();
  for (const model of models) {
    const key = model.modelId ?? model.scope ?? "account";
    groups.set(key, Math.max(groups.get(key) ?? 0, model.usedPercent));
  }
  const allExhausted = groups.size > 0 && [...groups.values()].every((used) => used >= 100);
  const allNearLimit = groups.size > 0 && [...groups.values()].every((used) => used >= 90);
  const status: ManagedAccount["status"] = forbidden ? "error" : !models.length ? "unknown"
    : allExhausted ? "limited" : allNearLimit ? "near_limit" : "active";
  const exhausted = models.filter((model) => model.usedPercent >= 100);
  return {
    limits: {
      limitId: primary?.name ?? null, limitName: primary?.displayName ?? null,
      primary: forbidden ? null : window(primary), secondary: forbidden ? null : window(secondary), credits: null,
      planType: normalizeAntigravityPlan(context.tierId, context.tier), rateLimitReachedType: forbidden ? "forbidden" : null,
      rawPlanType: context.tierId,
      buckets: forbidden ? [] : ordered.map((model) => ({ limitId: model.name, limitName: model.displayName,
        modelId: model.modelId ?? null, scope: model.scope ?? null, primary: window(model), secondary: null,
        rateLimitReachedType: model.usedPercent >= 100 ? "quota_exhausted" : null })),
      source: "antigravity_api"
    },
    status, statusReason: forbidden ? forbiddenReason ?? "Antigravity quota access was forbidden."
      : !models.length ? "Antigravity returned no known quota."
      : allExhausted ? "Лимиты всех известных моделей исчерпаны"
      : exhausted.length ? `Лимит отдельных моделей исчерпан: ${exhausted.map((model) => model.displayName).slice(0, 2).join(", ")}` : null,
    accountContext: context, forbidden
  };
}

async function requestQuotaEndpoint(input: {
  endpoint: string; accessToken: string; project: string | null; fetchImpl: typeof fetch;
  requestTimeoutMs: number; nowSeconds: number; signal?: AbortSignal;
}): Promise<{ response: Response; body: QuotaApiResponse }> {
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      (async () => {
        const headers: Record<string, string> = { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json",
          "User-Agent": "antigravity/1.20.5 windows/amd64 google-api-nodejs-client/10.3.0" };
        if (input.project) headers["x-goog-user-project"] = input.project;
        const response = await input.fetchImpl(input.endpoint, { method: "POST", headers,
          body: JSON.stringify(input.project ? { project: input.project } : {}), signal: controller.signal });
        if ([401, 403, 429].includes(response.status)) {
          const error = providerHttpError(response.status, "Antigravity quota", response.headers.get("Retry-After"), input.nowSeconds);
          controller.abort(error);
          throw error;
        }
        const raw = await response.text();
        let body: QuotaApiResponse;
        try { body = (raw ? JSON.parse(raw) : {}) as QuotaApiResponse; } catch { body = {}; }
        return { response, body };
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Antigravity quota request timed out after ${Math.ceil(input.requestTimeoutMs / 1000)} seconds`));
        }, input.requestTimeoutMs);
        if (input.signal?.aborted) reject(input.signal.reason ?? new Error("Antigravity quota request cancelled"));
        controller.signal.addEventListener("abort", () => {
          if (input.signal?.aborted) reject(input.signal.reason ?? new Error("Antigravity quota request cancelled"));
        }, { once: true });
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
  }
}

export async function fetchAntigravityQuota(input: {
  accessToken: string; googleProjectId?: string | null; accountContext?: AntigravityGoogleAccountContext;
  fetchImpl?: typeof fetch; requestTimeoutMs?: number; now?: () => number; signal?: AbortSignal;
}): Promise<AntigravityQuotaResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const nowSeconds = input.now?.() ?? Math.floor(Date.now() / 1000);
  const requestTimeoutMs = input.requestTimeoutMs ?? 20_000;
  const accountContext = input.accountContext ?? await fetchAntigravityGoogleAccountContext({
    accessToken: input.accessToken, fetchImpl, requestTimeoutMs, signal: input.signal
  });
  const rawProject = accountContext.googleProjectId ?? input.googleProjectId ?? null;
  const project = rawProject === "aicode-consumers" ? null : rawProject;
  let lastError: Error | null = null;
  for (const endpoint of endpoints) {
    if (input.signal?.aborted) throw input.signal.reason ?? new Error("Antigravity quota request cancelled");
    let response: Response;
    let body: QuotaApiResponse;
    try {
      ({ response, body } = await requestQuotaEndpoint({ endpoint, accessToken: input.accessToken, project,
        fetchImpl, requestTimeoutMs, nowSeconds, signal: input.signal }));
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (error instanceof ProviderRequestError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }
    if (!response.ok) {
      const error = providerHttpError(response.status, "Antigravity quota", response.headers.get("Retry-After"), nowSeconds);
      // Auth, verification and throttling errors do not become successful empty snapshots or environment retries.
      if ([401, 403, 429].includes(response.status)) throw error;
      lastError = error;
      if (response.status >= 500 || [404, 405, 501].includes(response.status)) continue;
      throw error;
    }
    const models = [...parseSummaryGroups(body, nowSeconds), ...parseBuckets(body), ...parseModels(body)];
    if (models.length) {
      const result = quotaResultFromModels(models, accountContext, false);
      result.limits.capturedAt = nowSeconds;
      return result;
    }
    lastError = new Error("Antigravity quota response contained no known quota data.");
  }
  throw lastError ?? new Error("Antigravity quota data unavailable");
}
