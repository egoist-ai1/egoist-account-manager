import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAntigravityQuota, normalizeAntigravityPlan, parseSummaryGroups } from "../../src/main/services/antigravityQuotaService";

const now = 1_900_000_000;
const context = { googleProjectId: null, tier: "free" as const, tierId: "free-tier", source: "code_assist" as const, errorReason: null };
const summary = { groups: [{ displayName: "Gemini", buckets: [
  { bucketId: "gemini-five", window: "5h", remainingFraction: 0.72, resetTime: new Date((now + 3 * 3600) * 1000).toISOString() },
  { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.79, resetTime: new Date((now + 2 * 86400) * 1000).toISOString() }
] }] };
const response = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
afterEach(() => vi.useRealTimers());

describe("antigravityQuotaService", () => {
  it.each([null, undefined, "", "  ", false, true, {}, [], "invalid", Infinity, NaN].map(value => [value]))(
    "does not invent exhausted quota for an unavailable fraction %j", (remainingFraction) => {
      expect(parseSummaryGroups({ groups: [{ buckets: [{ remainingFraction }] }] }, now)).toEqual([]);
    });
  it.each([0, "0", 0.25, "0.25", 0.004])("keeps valid numeric fractions %j", (remainingFraction) => {
    const [model] = parseSummaryGroups({ groups: [{ buckets: [{ remainingFraction }] }] }, now);
    expect(model.usedPercent).toBeCloseTo((1 - Number(remainingFraction)) * 100);
  });

  it.each(["headers", "body"])("aborts a stalled quota %s before one bounded fallback", async (phase) => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      if (signals.length === 1) {
        if (phase === "headers") return new Promise<Response>(() => undefined);
        return { text: () => new Promise<string>(() => undefined) } as Response;
      }
      return response(summary);
    });
    const pending = fetchAntigravityQuota({ accessToken: "fixture-token", accountContext: context,
      fetchImpl: fetchImpl as typeof fetch, requestTimeoutMs: 100, now: () => now });
    await vi.advanceTimersByTimeAsync(101);
    const result = await pending;
    expect(result.status).toBe("active");
    expect(result.limits.primary?.usedPercent).toBeCloseTo(28);
    expect(signals[0]?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves explicit periods, scopes and every quota group without rounded usage", async () => {
    const fetchImpl = vi.fn(async () => response({ groups: [
      ...summary.groups, { displayName: "Claude", buckets: [
        { bucketId: "claude-five", window: "5h", remainingFraction: 0.004 },
        { bucketId: "claude-weekly", window: "weekly", remainingFraction: 1 }
      ] }
    ] }));
    const result = await fetchAntigravityQuota({ accessToken: "fixture", accountContext: context, fetchImpl: fetchImpl as typeof fetch, now: () => now });
    expect(result.limits.buckets).toHaveLength(4);
    expect(result.limits.buckets?.find(bucket => bucket.limitId === "claude-five")).toMatchObject({
      scope: "Claude", primary: { usedPercent: 99.6, windowDurationMins: 300 }
    });
    expect(result.limits.capturedAt).toBe(now);
    expect(result.status).toBe("active");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps a partial successful snapshot instead of seeking an invented second window", async () => {
    const fetchImpl = vi.fn(async () => fetchImpl.mock.calls.length === 1
      ? response({ response: { buckets: [{ modelId: "future-model", remainingFraction: 0.4,
          resetTime: new Date((now + 5 * 3600) * 1000).toISOString() }] } })
      : response({}, 403));
    const result = await fetchAntigravityQuota({ accessToken: "fixture", accountContext: context, fetchImpl: fetchImpl as typeof fetch, now: () => now });
    expect(result.limits.primary?.usedPercent).toBeCloseTo(60);
    expect(result.limits.primary?.windowDurationMins).toBeNull();
    expect(result.limits.secondary).toBeNull();
    expect(result.limits.buckets?.[0].modelId).toBe("future-model");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not guess a weekly or five-hour period from the distance to reset", async () => {
    const body = { models: { "gemini-3-pro": { quotaInfo: { remainingFraction: 0.28, resetTime: new Date((now + 5 * 3600) * 1000).toISOString() } } } };
    const fetchImpl = async () => response(body);
    const result = await fetchAntigravityQuota({ accessToken: "fixture", accountContext: context, fetchImpl: fetchImpl as typeof fetch, now: () => now });
    expect(result.limits.primary?.windowDurationMins).toBeNull();
    expect(result.limits.planType).toBe("free");
    expect(result.limits.buckets?.[0].modelId).toBe("gemini-3-pro");
  });

  it("reports exhaustion per model without excluding a different available model", async () => {
    const fetchImpl = async () => response({ models: {
      "claude": { quotaInfo: { remainingFraction: 0 } }, "gemini": { quotaInfo: { remainingFraction: 0.5 } }
    } });
    const result = await fetchAntigravityQuota({ accessToken: "fixture", accountContext: context, fetchImpl: fetchImpl as typeof fetch });
    expect(result.status).toBe("active");
    expect(result.statusReason).toContain("claude");
    expect(result.limits.buckets?.find(bucket => bucket.modelId === "claude")?.rateLimitReachedType).toBe("quota_exhausted");
  });

  it.each([401, 403, 429])("stops on HTTP %s and preserves typed retry/auth evidence", async (status) => {
    const fetchImpl = vi.fn(async () => response({}, status, { "Retry-After": "600" }));
    await expect(fetchAntigravityQuota({ accessToken: "fixture", accountContext: { ...context, googleProjectId: "project" },
      fetchImpl: fetchImpl as typeof fetch, now: () => now }))
      .rejects.toMatchObject({ statusCode: status, retryAfterSeconds: 600, requiresReauth: status === 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 429])("does not wait for an error body or retry after HTTP %s headers", async (status) => {
    const text = vi.fn(() => new Promise<string>(() => undefined));
    const fetchImpl = vi.fn(async () => ({ status, ok: false, headers: new Headers({ "Retry-After": "600" }), text }) as unknown as Response);
    await expect(fetchAntigravityQuota({ accessToken: "fixture", accountContext: context, fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toMatchObject({ statusCode: status, retryAfterSeconds: 600 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled();
  });

  it("caps empty fallback attempts and does not visit sandbox environments", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => { urls.push(String(url)); return response({}); };
    await expect(fetchAntigravityQuota({ accessToken: "fixture", accountContext: context, fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toThrow(/no known quota/);
    expect(urls).toHaveLength(4);
    expect(urls.join(" ")).not.toContain("sandbox");
  });

  it("supports request cancellation even when the injected fetch ignores its signal", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const fetchImpl = async (_url: unknown, init?: RequestInit) => {
      seenSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    };
    const pending = fetchAntigravityQuota({ accessToken: "fixture", accountContext: context,
      fetchImpl: fetchImpl as typeof fetch, signal: controller.signal });
    controller.abort(new Error("fixture cancelled"));
    await expect(pending).rejects.toThrow("fixture cancelled");
    expect(seenSignal?.aborted).toBe(true);
  });

  it("normalizes only explicit known plan values, independent of accessible model names", () => {
    expect(normalizeAntigravityPlan("Google AI Pro", "paid")).toBe("google-ai-pro");
    expect(normalizeAntigravityPlan("Google AI Ultra X20", "paid")).toBe("google-ai-ultra-x20");
    expect(normalizeAntigravityPlan("g1-pro-tier", "unknown")).toBe("unknown");
    expect(normalizeAntigravityPlan("model-6.10-pro", "paid")).toBe("unknown");
  });
});
