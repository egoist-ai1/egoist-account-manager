import type { ManagedAccount, PlanType, RateLimitSnapshot } from "../../shared/types.js";
import { fetchAntigravityGoogleAccountContext, type AntigravityGoogleAccountContext } from "./antigravityGoogleAuthService.js";

const fetchAvailableModelsEndpoints = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  "https://autopush-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
  "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels"
] as const;

const retrieveUserQuotaEndpoint = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";

interface QuotaApiResponse {
  models?: Record<string, {
    quotaInfo?: {
      remainingFraction?: unknown;
      resetTime?: unknown;
    };
    displayName?: unknown;
  }>;
  buckets?: Array<{
    modelId?: unknown;
    displayName?: unknown;
    remainingFraction?: unknown;
    remainingAmount?: unknown;
    resetTime?: unknown;
  }>;
}

export interface AntigravityQuotaResult {
  limits: RateLimitSnapshot;
  status: ManagedAccount["status"];
  statusReason: string | null;
  accountContext: AntigravityGoogleAccountContext;
  forbidden: boolean;
}

interface ModelQuota {
  name: string;
  displayName: string;
  usedPercent: number;
  resetAt: number | null;
  windowDurationMins: number | null;
  bucketHint: "pro" | "flash" | "model" | "unknown";
}

interface QuotaWindow {
  id: string;
  displayName: string;
  usedPercent: number;
  resetAt: number | null;
  windowDurationMins: number | null;
}

async function fetchWithHardTimeout(fetchPromise: Promise<Response>, timeoutMs: number, label: string): Promise<Response> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<Response>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds`)), timeoutMs);
  });
  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

function resetAtSeconds(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function normalizePlanFromTier(tierId: string | null, fallback: AntigravityGoogleAccountContext["tier"]): PlanType {
  const normalized = (tierId ?? "").toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, "");
  if (fallback === "unknown") return "unknown";
  if (fallback === "standard" || normalized.includes("standard-tier") || normalized.includes("antigravity-standard")) return "unknown";
  if (fallback === "free" || normalized.includes("free") || normalized.includes("zero") || normalized === "legacy-tier") return "free";
  if (fallback !== "paid") return "unknown";
  if (compact.includes("googleaiultrax20") || (compact.includes("ultra") && compact.includes("20"))) return "google-ai-ultra-x20";
  if (compact.includes("googleaiultra") || compact.includes("ultra")) return "google-ai-ultra";
  if (compact.includes("googleaipro") || compact.includes("aipro")) return "google-ai-pro";
  if (normalized.includes("team")) return "team";
  if (normalized.includes("business")) return "business";
  if (normalized.includes("enterprise")) return "enterprise";
  if (normalized.includes("edu")) return "edu";
  if (normalized.includes("plus")) return "plus";
  if (normalized.includes("go")) return "go";
  if (normalized.includes("10")) return "pro-x10";
  if (normalized.includes("20")) return "pro-x20";
  return "unknown";
}

function inferWindowDurationMins(resetAt: number | null, nowSeconds: number): number | null {
  if (!resetAt) return null;
  const diffMins = Math.round((resetAt - nowSeconds) / 60);
  if (diffMins >= 240 && diffMins <= 360) return 300;
  if (diffMins >= 6 * 24 * 60 && diffMins <= 8 * 24 * 60) return 7 * 24 * 60;
  return null;
}

function parseRemainingFraction(value: unknown): number | null {
  const fraction = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(fraction)) return null;
  return Math.max(0, Math.min(1, fraction));
}

function usedPercentFromRemainingFraction(value: unknown): number | null {
  const fraction = parseRemainingFraction(value);
  return fraction == null ? null : Math.max(0, Math.min(100, Math.round((1 - fraction) * 100)));
}

function bucketHint(name: string): ModelQuota["bucketHint"] {
  const lower = name.toLowerCase();
  if (lower.includes("pro") || lower.includes("opus")) return "pro";
  if (lower.includes("flash") || lower.includes("haiku")) return "flash";
  if (lower.includes("gemini") || lower.includes("claude") || lower.startsWith("gpt") || lower.startsWith("image") || lower.startsWith("imagen")) return "model";
  return "unknown";
}

function shouldKeepQuotaModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return (
    lower.includes("gemini")
    || lower.includes("claude")
    || lower.startsWith("gpt")
    || lower.startsWith("image")
    || lower.startsWith("imagen")
  ) && !/gemini-[12](\.|$|-)/.test(lower);
}

function parseModels(body: QuotaApiResponse, nowSeconds: number): ModelQuota[] {
  return Object.entries(body.models ?? {})
    .filter(([modelName]) => shouldKeepQuotaModel(modelName))
    .map(([modelName, model]) => {
      const usedPercent = usedPercentFromRemainingFraction(model.quotaInfo?.remainingFraction);
      if (usedPercent == null) return null;
      const resetAt = resetAtSeconds(model.quotaInfo?.resetTime);
      return {
        name: modelName,
        displayName: typeof model.displayName === "string" && model.displayName.trim() ? model.displayName.trim() : modelName,
        usedPercent,
        resetAt,
        windowDurationMins: inferWindowDurationMins(resetAt, nowSeconds),
        bucketHint: bucketHint(modelName)
      };
    })
    .filter((model): model is ModelQuota => model !== null)
    .sort((a, b) => b.usedPercent - a.usedPercent || a.name.localeCompare(b.name));
}

function parseBuckets(body: QuotaApiResponse, nowSeconds: number): ModelQuota[] {
  const byBucket = new Map<string, ModelQuota>();
  for (const bucket of body.buckets ?? []) {
    const modelId = typeof bucket.modelId === "string" ? bucket.modelId.trim() : "";
    if (!modelId || !shouldKeepQuotaModel(modelId)) continue;
    const usedPercent = usedPercentFromRemainingFraction(bucket.remainingFraction);
    if (usedPercent == null) continue;
    const resetAt = resetAtSeconds(bucket.resetTime);
    const windowDurationMins = inferWindowDurationMins(resetAt, nowSeconds);
    const next: ModelQuota = {
      name: modelId,
      displayName: typeof bucket.displayName === "string" && bucket.displayName.trim() ? bucket.displayName.trim() : modelId,
      usedPercent,
      resetAt,
      windowDurationMins,
      bucketHint: bucketHint(modelId)
    };
    const key = `${modelId}\u0000${windowDurationMins ?? "unknown"}\u0000${resetAt ?? "no-reset"}`;
    const current = byBucket.get(key);
    if (!current || next.usedPercent > current.usedPercent || (next.usedPercent === current.usedPercent && (next.resetAt ?? Number.MAX_SAFE_INTEGER) < (current.resetAt ?? Number.MAX_SAFE_INTEGER))) {
      byBucket.set(key, next);
    }
  }
  return [...byBucket.values()].sort((a, b) => b.usedPercent - a.usedPercent || a.name.localeCompare(b.name));
}

function mergeQuotaModels(primary: ModelQuota[], secondary: ModelQuota[]): ModelQuota[] {
  const merged = new Map<string, ModelQuota>();
  for (const model of [...primary, ...secondary]) {
    const key = `${model.name}\u0000${model.windowDurationMins ?? "unknown"}\u0000${model.resetAt ?? "no-reset"}`;
    const current = merged.get(key);
    if (!current || model.usedPercent > current.usedPercent || (model.usedPercent === current.usedPercent && (model.resetAt ?? Number.MAX_SAFE_INTEGER) < (current.resetAt ?? Number.MAX_SAFE_INTEGER))) {
      merged.set(key, model);
    }
  }
  return [...merged.values()].sort((a, b) => b.usedPercent - a.usedPercent || a.name.localeCompare(b.name));
}

function groupWindow(models: ModelQuota[], durationMins: number, label: string): QuotaWindow | null {
  const matching = models.filter((model) => model.windowDurationMins === durationMins);
  if (matching.length === 0) return null;
  const strongest = matching.reduce((best, model) => (
    model.usedPercent > best.usedPercent ? model : best
  ));
  return {
    id: durationMins === 300 ? "antigravity-five-hour" : "antigravity-weekly",
    displayName: label,
    usedPercent: strongest.usedPercent,
    resetAt: strongest.resetAt,
    windowDurationMins: durationMins
  };
}

function groupHint(models: ModelQuota[], hint: ModelQuota["bucketHint"], label: string): QuotaWindow | null {
  const matching = models.filter((model) => model.bucketHint === hint);
  if (matching.length === 0) return null;
  const strongest = matching.reduce((best, model) => (
    model.usedPercent > best.usedPercent ? model : best
  ));
  return {
    id: `antigravity-${hint}`,
    displayName: label,
    usedPercent: strongest.usedPercent,
    resetAt: strongest.resetAt,
    windowDurationMins: strongest.windowDurationMins
  };
}

function buildQuotaWindows(models: ModelQuota[]): QuotaWindow[] {
  const fiveHour = groupWindow(models, 300, "5 часов");
  const weekly = groupWindow(models, 7 * 24 * 60, "неделя");
  const grouped = [fiveHour, weekly].filter((window): window is QuotaWindow => window !== null);
  if (grouped.length > 0) return grouped;
  const pro = groupHint(models, "pro", "Pro");
  const flash = groupHint(models, "flash", "Flash");
  const hinted = [pro, flash].filter((window): window is QuotaWindow => window !== null);
  if (hinted.length > 0) {
    const hintedIds = new Set(hinted.map((window) => window.id));
    const fallback = models
      .filter((model) => !hintedIds.has(`antigravity-${model.bucketHint}`))
      .slice(0, Math.max(0, 2 - hinted.length))
      .map((model) => ({
        id: model.name,
        displayName: model.displayName,
        usedPercent: model.usedPercent,
        resetAt: model.resetAt,
        windowDurationMins: model.windowDurationMins
      }));
    return [...hinted, ...fallback];
  }
  return models.slice(0, 2).map((model) => ({
    id: model.name,
    displayName: model.displayName,
    usedPercent: model.usedPercent,
    resetAt: model.resetAt,
    windowDurationMins: model.windowDurationMins
  }));
}

function classify(models: ModelQuota[], forbidden: boolean): { status: ManagedAccount["status"]; reason: string | null } {
  if (forbidden) return { status: "error", reason: "Antigravity quota API returned 403 forbidden." };
  if (models.length === 0) return { status: "unknown", reason: "Antigravity quota API returned no quota-enabled models." };
  const maxUsed = Math.max(...models.map((model) => model.usedPercent));
  if (maxUsed >= 100) return { status: "limited", reason: "Antigravity model quota is exhausted." };
  if (maxUsed >= 90) return { status: "near_limit", reason: "Antigravity model quota is above 90%." };
  return { status: "active", reason: null };
}

function toRateLimitSnapshot(models: ModelQuota[], context: AntigravityGoogleAccountContext, forbidden: boolean): RateLimitSnapshot {
  const windows = buildQuotaWindows(models);
  const primary = windows[0] ?? null;
  const secondary = windows.find((window) => window.id !== primary?.id) ?? null;
  return {
    limitId: primary?.id ?? null,
    limitName: primary ? `${primary.displayName}${secondary ? ` / ${secondary.displayName}` : ""}` : null,
    primary: primary ? {
      usedPercent: primary.usedPercent,
      windowDurationMins: primary.windowDurationMins,
      resetsAt: primary.resetAt
    } : null,
    secondary: secondary ? {
      usedPercent: secondary.usedPercent,
      windowDurationMins: secondary.windowDurationMins,
      resetsAt: secondary.resetAt
    } : null,
    credits: null,
    planType: normalizePlanFromTier(context.tierId, context.tier),
    rateLimitReachedType: forbidden ? "forbidden" : null
  };
}

function quotaResultFromModels(
  models: ModelQuota[],
  context: AntigravityGoogleAccountContext,
  forbidden: boolean
): AntigravityQuotaResult {
  const classified = classify(models, forbidden);
  return {
    limits: toRateLimitSnapshot(models, context, forbidden),
    status: classified.status,
    statusReason: classified.reason,
    accountContext: context,
    forbidden
  };
}

function quotaHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "antigravity/1.20.5 windows/amd64 google-api-nodejs-client/10.3.0",
    "X-Goog-Api-Client": "gl-node/22.21.1",
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br"
  };
}

function quotaHeadersWithProject(accessToken: string, project: string | null): Record<string, string> {
  const headers = quotaHeaders(accessToken);
  if (project) headers["x-goog-user-project"] = project;
  return headers;
}

async function requestQuotaEndpoint(input: {
  endpoint: string;
  accessToken: string;
  payload: Record<string, string>;
  projectHeader: string | null;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
}): Promise<{ response: Response; body: QuotaApiResponse }> {
  const response = await fetchWithHardTimeout(
    input.fetchImpl(input.endpoint, {
      method: "POST",
      headers: quotaHeadersWithProject(input.accessToken, input.projectHeader),
      body: JSON.stringify(input.payload)
    }),
    input.requestTimeoutMs,
    "Antigravity quota request"
  );
  const body = await readJson<QuotaApiResponse>(response).catch(() => ({} as QuotaApiResponse));
  return { response, body };
}

export async function fetchAntigravityQuota(input: {
  accessToken: string;
  googleProjectId?: string | null;
  accountContext?: AntigravityGoogleAccountContext;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  now?: () => number;
}): Promise<AntigravityQuotaResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const requestTimeoutMs = input.requestTimeoutMs ?? 20_000;
  const nowSeconds = input.now ? input.now() : Math.floor(Date.now() / 1000);
  const accountContext = input.accountContext ?? await fetchAntigravityGoogleAccountContext({
    accessToken: input.accessToken,
    fetchImpl,
    requestTimeoutMs
  });
  const project = accountContext.googleProjectId ?? input.googleProjectId ?? null;
  const basePayload: Record<string, string> = project ? { project } : {};
  let lastError: Error | null = null;
  let retrieveResult: AntigravityQuotaResult | null = null;
  let collectedModels: ModelQuota[] = [];
  let bestResult: AntigravityQuotaResult | null = null;
  let sawForbidden = false;

  if (project) {
    const { response, body } = await requestQuotaEndpoint({
      endpoint: retrieveUserQuotaEndpoint,
      accessToken: input.accessToken,
      payload: { project },
      projectHeader: project,
      fetchImpl,
      requestTimeoutMs
    });
    if (response.ok) {
      const buckets = parseBuckets(body, nowSeconds);
      if (buckets.length > 0) {
        collectedModels = buckets;
        retrieveResult = quotaResultFromModels(buckets, accountContext, false);
        bestResult = retrieveResult;
        if (buildQuotaWindows(buckets).length >= 2) return retrieveResult;
      }
      lastError = new Error("Antigravity retrieveUserQuota returned no quota buckets.");
    } else if (response.status === 403) {
      const retry = await requestQuotaEndpoint({
        endpoint: retrieveUserQuotaEndpoint,
        accessToken: input.accessToken,
        payload: { project },
        projectHeader: null,
        fetchImpl,
        requestTimeoutMs
      });
      if (retry.response.ok) {
        const buckets = parseBuckets(retry.body, nowSeconds);
        if (buckets.length > 0) {
          collectedModels = buckets;
          retrieveResult = quotaResultFromModels(buckets, accountContext, false);
          bestResult = retrieveResult;
          if (buildQuotaWindows(buckets).length >= 2) return retrieveResult;
        }
        lastError = new Error("Antigravity retrieveUserQuota returned no quota buckets after project-header fallback.");
      } else if (retry.response.status === 403) {
        return quotaResultFromModels([], accountContext, true);
      } else {
        lastError = new Error(`Antigravity retrieveUserQuota retry failed with HTTP ${retry.response.status}`);
      }
    } else {
      lastError = new Error(`Antigravity retrieveUserQuota failed with HTTP ${response.status}`);
    }
  }

  for (const endpoint of fetchAvailableModelsEndpoints) {
    let payload: Record<string, string> = basePayload;
    let projectHeader: string | null = project;
    let retriedWithoutProject = false;
    while (true) {
      const { response, body } = await requestQuotaEndpoint({
        endpoint,
        accessToken: input.accessToken,
        payload,
        projectHeader,
        fetchImpl,
        requestTimeoutMs
      });
      if (response.ok) {
        const models = parseModels(body, nowSeconds);
        const merged = mergeQuotaModels(collectedModels, models);
        if (merged.length > 0) {
          collectedModels = merged;
          bestResult = quotaResultFromModels(merged, accountContext, false);
          if (buildQuotaWindows(merged).length >= 2) return bestResult;
        }
        break;
      }
      if (response.status === 403 && "project" in payload && !retriedWithoutProject) {
        payload = {};
        projectHeader = null;
        retriedWithoutProject = true;
        continue;
      }
      if (response.status === 403) {
        sawForbidden = true;
        break;
      }
      lastError = new Error(`Antigravity quota API failed with HTTP ${response.status}`);
      if (!bestResult && response.status !== 429 && response.status < 500) throw lastError;
      break;
    }
  }
  if (bestResult) return bestResult;
  if (retrieveResult) return retrieveResult;
  if (sawForbidden) return quotaResultFromModels([], accountContext, true);
  throw lastError ?? new Error("Antigravity quota API failed");
}
