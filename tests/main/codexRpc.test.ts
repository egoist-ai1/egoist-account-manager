import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexRpcClient, classifyRateLimit, normalizeCodexPlanType, selectBestRateLimit } from "../../src/main/codexRpc";
import type { RateLimitSnapshot } from "../../src/shared/types";
import { ProviderRequestError } from "../../src/shared/quotaRefreshError";

function snapshot(input: Partial<RateLimitSnapshot>): RateLimitSnapshot {
  return {
    limitId: null,
    limitName: null,
    primary: null,
    secondary: null,
    credits: null,
    planType: null,
    rateLimitReachedType: null,
    ...input
  };
}

function transportFixture(reply: (id: number) => unknown) {
  const client = new CodexRpcClient("fixture-home", "fixture-binary");
  vi.spyOn(client, "start").mockResolvedValue();
  const frames: Array<Record<string, unknown>> = [];
  const transport = client as unknown as { child: { stdin: { write: (frame: string, callback: (error: Error | null) => void) => void } }; onMessage: (line: string) => void };
  transport.child = { stdin: { write: (frame, callback) => {
    const request = JSON.parse(frame) as Record<string, unknown>;
    frames.push(request);
    queueMicrotask(() => transport.onMessage(JSON.stringify(reply(request.id as number))));
    callback(null);
  } } };
  return { client, frames };
}

afterEach(() => vi.restoreAllMocks());

describe("codexRpc helpers", () => {
  it("keeps the explicit provider plan without invented multipliers", () => {
    expect(normalizeCodexPlanType("pro")).toBe("pro");
    expect(normalizeCodexPlanType("prolite")).toBe("prolite");
    expect(normalizeCodexPlanType("plus")).toBe("plus");
  });

  it("does not identify a subscription from a model/limit name or version number", () => {
    expect(normalizeCodexPlanType("pro", snapshot({ planType: "codex-pro-x10" }))).toBe("pro");
    expect(normalizeCodexPlanType("plus", snapshot({ limitName: "gpt-6.10 Codex Pro X20" }))).toBe("plus");
    expect(normalizeCodexPlanType(null, snapshot({ planType: "future-plan" }))).toBe("future-plan");
  });

  it("selects a Codex-like rate limit snapshot even when the key is provider-specific", () => {
    const aggregate = snapshot({ limitId: "aggregate" });
    const codex = snapshot({
      limitId: "openai-codex-pro",
      primary: { usedPercent: 10, resetsAt: null, windowDurationMins: 300 },
      secondary: { usedPercent: 20, resetsAt: null, windowDurationMins: 10_080 }
    });

    expect(selectBestRateLimit({
      rateLimits: aggregate,
      rateLimitsByLimitId: {
        "openai-codex-pro": codex
      }
    })).toMatchObject({ ...codex, buckets: [{ ...codex }] });
  });

  it("prefers the aggregate codex snapshot over model-specific codex keys", () => {
    const aggregate = snapshot({ limitId: "codex" });
    const modelSpecific = snapshot({ limitId: "codex_bengalfox" });

    expect(selectBestRateLimit({
      rateLimits: modelSpecific,
      rateLimitsByLimitId: {
        codex_bengalfox: modelSpecific,
        codex: aggregate
      }
    })).toMatchObject({ ...aggregate, buckets: [{ ...modelSpecific }, { ...aggregate }] });
  });

  it("keeps every bucket and attaches response-level identity/ordinary-usage evidence", () => {
    const result = selectBestRateLimit({
      accountId: "provider-account", ordinaryUsageAllowed: false,
      rateLimits: snapshot({}), rateLimitsByLimitId: {
        codex: snapshot({ limitId: "codex", primary: { usedPercent: 43, windowDurationMins: 300, resetsAt: 100 } }),
        model: snapshot({ limitId: "model", primary: { usedPercent: 99.6, windowDurationMins: 120, resetsAt: 200 }, spendControlReached: true })
      }
    });
    expect(result).toMatchObject({ accountId: "provider-account", ordinaryUsageAllowed: false });
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets?.[1]).toMatchObject({ spendControlReached: true, primary: { usedPercent: 99.6 } });
    expect(classifyRateLimit(result)).toMatchObject({ status: "limited" });
  });

  it("preserves an explicit model slug when only the legacy aggregate field is returned", () => {
    const result = selectBestRateLimit({ rateLimits: snapshot({ normalModelSlug: "model-a", limitId: "model-limit" }), rateLimitsByLimitId: null });
    expect(result.buckets?.[0]).toMatchObject({ modelId: "model-a" });
  });

  it("does not report missing usage as active or exhausted usage as merely near its limit", () => {
    expect(classifyRateLimit(snapshot({})).status).toBe("unknown");
    expect(classifyRateLimit(snapshot({ primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 100 } })).status).toBe("limited");
    expect(classifyRateLimit(snapshot({ primary: { usedPercent: 99.6, windowDurationMins: 300, resetsAt: 100 } })).status).toBe("near_limit");
  });

  it("keeps legacy quota wire parameters unchanged and sends background optimization only when requested", async () => {
    const { client, frames } = transportFixture(id => ({ id, result: { rateLimits: snapshot({}), rateLimitsByLimitId: null } }));
    await client.readRateLimits();
    await client.readRateLimits({ excludeResetCreditDetails: true });
    expect(frames).toEqual([
      { id: 1, method: "account/rateLimits/read" },
      { id: 2, method: "account/rateLimits/read", params: { excludeResetCreditDetails: true } }
    ]);
  });

  it("preserves RPC error codes and structured retry/auth metadata for the caller", async () => {
    const { client } = transportFixture(id => ({ id, error: { code: -32001, message: "HTTP 429",
      data: { statusCode: 429, retryAfterSeconds: 60 } } }));
    await expect(client.readRateLimits()).rejects.toMatchObject({ code: -32001, data: { statusCode: 429, retryAfterSeconds: 60 } });
  });

  it.each([401, 403, 429])("normalizes explicit HTTP %i evidence without losing RPC data", async (status) => {
    const data = { statusCode: status, retryAfterSeconds: 60.5, opaqueField: "preserved" };
    const { client, frames } = transportFixture(id => ({ id, error: { code: -32001, message: "Provider rejected quota request", data } }));
    const error = await client.readRateLimits().catch(error => error);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error).toMatchObject({ statusCode: status, retryAfterSeconds: 61, requiresReauth: status === 401, code: -32001, data });
    expect(frames).toHaveLength(1);
  });

  it("accepts a proven HTTP status line but does not infer HTTP status from unrelated numbers", async () => {
    const http = transportFixture(id => ({ id, error: { code: -32603, message: "Request failed with HTTP status code: 429", data: { retryAfter: "600" } } }));
    await expect(http.client.readRateLimits()).rejects.toMatchObject({ statusCode: 429, retryAfterSeconds: 600 });
    const unrelated = transportFixture(id => ({ id, error: { code: -32603, message: "Model429 build401 version403 unavailable" } }));
    const error = await unrelated.client.readRateLimits().catch(error => error);
    expect(error).not.toBeInstanceOf(ProviderRequestError);
    expect(error).toMatchObject({ code: -32603, message: "Model429 build401 version403 unavailable" });
  });
});
