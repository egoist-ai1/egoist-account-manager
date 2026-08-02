import { describe, expect, it } from "vitest";
import { normalizeCodexPlanType, selectBestRateLimit } from "../../src/main/codexRpc";
import type { RateLimitSnapshot } from "../../src/shared/types";

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

describe("codexRpc helpers", () => {
  it("maps Codex Pro to the x20 plan badge used by the product UI", () => {
    expect(normalizeCodexPlanType("pro")).toBe("pro-x20");
    expect(normalizeCodexPlanType("prolite")).toBe("pro-x10");
    expect(normalizeCodexPlanType("plus")).toBe("plus");
  });

  it("keeps x10/x20 markers from rate limit snapshots when available", () => {
    expect(normalizeCodexPlanType("pro", snapshot({ planType: "codex-pro-x10" }))).toBe("pro-x10");
    expect(normalizeCodexPlanType("plus", snapshot({ limitName: "Codex Pro X20" }))).toBe("pro-x20");
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
    })).toBe(codex);
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
    })).toBe(aggregate);
  });
});
