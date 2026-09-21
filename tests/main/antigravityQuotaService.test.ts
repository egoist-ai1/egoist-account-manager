import { describe, expect, it } from "vitest";
import { fetchAntigravityQuota } from "../../src/main/services/antigravityQuotaService";

describe("antigravityQuotaService", () => {
  it("prefers Cockpit-style retrieveUserQuota buckets when a Code Assist project is available", async () => {
    const calls: Array<{ url: string; body: string; userProject: string | null }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(url),
        body: String(init?.body ?? ""),
        userProject: headers.get("x-goog-user-project")
      });
      if (String(url).includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: "project-1",
          currentTier: { id: "free-tier" },
          paidTier: {
            id: "google-ai-ultra-x20",
            name: "Google AI Ultra X20",
            availableCredits: [{ creditAmount: 2000, minimumCreditAmountForUsage: 50 }]
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("retrieveUserQuota")) {
        return new Response(JSON.stringify({
          buckets: [
            {
              modelId: "gemini-3-pro",
              remainingFraction: 0.28,
              resetTime: "2026-05-29T22:00:00Z"
            },
            {
              modelId: "gemini-3-flash",
              remainingFraction: 0.65,
              resetTime: "2026-06-05T17:00:00Z"
            }
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected request ${String(url)}`);
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-05-29T17:00:00Z") / 1000
    });

    expect(result.accountContext).toMatchObject({
      googleProjectId: "project-1",
      tier: "paid",
      tierId: "Google AI Ultra X20"
    });
    expect(result.limits).toMatchObject({
      planType: "google-ai-ultra-x20",
      primary: { usedPercent: 72, windowDurationMins: 300 },
      secondary: { usedPercent: 35, windowDurationMins: 10080 }
    });
    expect(result.status).toBe("active");
    expect(calls.some((call) => call.url.includes("retrieveUserQuota"))).toBe(true);
    expect(calls.some((call) => call.url.includes("fetchAvailableModels"))).toBe(false);
    expect(calls.find((call) => call.url.includes("retrieveUserQuota"))?.userProject).toBe("project-1");
    expect(JSON.stringify(result)).not.toContain("access-secret-value");
  });

  it("fetches Code Assist context and model quota without storing raw secret fields", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: "project-1",
          currentTier: { id: "g1-pro-tier" },
          paidTier: { id: "g1-pro-tier" }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        models: {
          "gemini-3-pro": {
            displayName: "Gemini 3 Pro",
            quotaInfo: {
              remainingFraction: 0.25,
              resetTime: "2026-05-23T18:00:00Z"
            }
          },
          "claude-sonnet-4.5": {
            displayName: "Claude Sonnet 4.5",
            quotaInfo: {
              remainingFraction: 0.6,
              resetTime: "2026-05-24T18:00:00Z"
            }
          }
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(result.accountContext).toMatchObject({
      googleProjectId: "project-1",
      tier: "unknown",
      tierId: null
    });
    expect(result.limits).toMatchObject({
      planType: "unknown",
      primary: { usedPercent: 75 },
      secondary: { usedPercent: 40 }
    });
    expect(result.status).toBe("active");
    expect(JSON.stringify(result)).not.toContain("access-secret-value");
    expect(calls.some((call) => call.url.includes("fetchAvailableModels"))).toBe(true);
  });

  it("marks quota as forbidden when Google returns 403 after project fallback", async () => {
    let quotaCalls = 0;
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: "project-1",
          allowedTiers: [{ id: "free", isDefault: true }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      quotaCalls += 1;
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(result.forbidden).toBe(true);
    expect(result.status).toBe("active");
    expect(result.limits.rateLimitReachedType).toBe("forbidden");
    expect(quotaCalls).toBe(2);
  });

  it("keeps plan unknown when only a paid offer tier is present", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: "project-1",
          paidTier: { id: "g1-pro-tier" }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        models: {
          "gemini-3-pro": {
            displayName: "Gemini 3 Pro",
            quotaInfo: {
              remainingFraction: 0.25,
              resetTime: "2026-05-23T18:00:00Z"
            }
          }
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch
    });

    expect(result.accountContext).toMatchObject({
      tier: "unknown",
      tierId: null
    });
    expect(result.limits.planType).toBe("unknown");
    expect(result.limits.primary?.usedPercent).toBe(75);
  });

  it("maps the live Google AI Pro Code Assist shape with credits and a single returned bucket", async () => {
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (String(url).includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: "project-1",
          currentTier: { id: "free-tier", name: "Antigravity" },
          paidTier: {
            id: "g1-pro-tier",
            name: "Google AI Pro",
            availableCredits: [{ creditAmount: 1000, minimumCreditAmountForUsage: 50 }]
          },
          allowedTiers: [
            { id: "free-tier", name: "Antigravity", isDefault: true },
            { id: "standard-tier", name: "Antigravity" }
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("retrieveUserQuota") && headers.get("x-goog-user-project")) {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("retrieveUserQuota")) {
        return new Response(JSON.stringify({
          buckets: [{
            modelId: "claude-opus-4-6-thinking",
            remainingFraction: 1,
            resetTime: "2026-05-29T22:00:00Z"
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("fetchAvailableModels")) {
        return new Response(JSON.stringify({ models: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected request ${String(url)}`);
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-05-29T17:00:00Z") / 1000
    });

    expect(result.accountContext).toMatchObject({
      googleProjectId: "project-1",
      tier: "paid",
      tierId: "Google AI Pro"
    });
    expect(result.limits.planType).toBe("google-ai-pro");
    expect(result.limits.primary).toMatchObject({ usedPercent: 0, windowDurationMins: 300 });
    expect(result.limits.secondary).toBeNull();
    expect(result.status).toBe("active");
  });

  it("keeps same-model five-hour and weekly retrieveUserQuota buckets as separate windows", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: "project-1",
          paidTier: {
            id: "g1-pro-tier",
            name: "Google AI Pro",
            availableCredits: [{ creditAmount: 1000, minimumCreditAmountForUsage: 50 }]
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("retrieveUserQuota")) {
        return new Response(JSON.stringify({
          buckets: [
            {
              modelId: "claude-opus-4-6-thinking",
              remainingFraction: 0.25,
              resetTime: "2026-05-29T22:00:00Z"
            },
            {
              modelId: "claude-opus-4-6-thinking",
              remainingFraction: 0.6,
              resetTime: "2026-06-05T17:00:00Z"
            }
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected request ${String(url)}`);
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-05-29T17:00:00Z") / 1000
    });

    expect(result.limits.primary).toMatchObject({ usedPercent: 75, windowDurationMins: 300 });
    expect(result.limits.secondary).toMatchObject({ usedPercent: 40, windowDurationMins: 10080 });
    expect(result.limits.limitName).toBe("5 часов / неделя");
  });

  it("supplements a single retrieveUserQuota window with a weekly fetchAvailableModels window", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      const target = String(url);
      calls.push(target);
      if (target.includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: "project-1",
          paidTier: {
            id: "g1-pro-tier",
            name: "Google AI Pro",
            availableCredits: [{ creditAmount: 1000, minimumCreditAmountForUsage: 50 }]
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.includes("retrieveUserQuota")) {
        return new Response(JSON.stringify({
          buckets: [{
            modelId: "claude-opus-4-6-thinking",
            remainingFraction: 0.2,
            resetTime: "2026-05-29T22:00:00Z"
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.includes("fetchAvailableModels")) {
        return new Response(JSON.stringify({
          models: {
            "claude-opus-4-6-thinking": {
              quotaInfo: {
                remainingFraction: 0.55,
                resetTime: "2026-06-05T17:00:00Z"
              }
            }
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected request ${target}`);
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-05-29T17:00:00Z") / 1000
    });

    expect(calls.some((url) => url.includes("fetchAvailableModels"))).toBe(true);
    expect(result.limits.primary).toMatchObject({ usedPercent: 80, windowDurationMins: 300 });
    expect(result.limits.secondary).toMatchObject({ usedPercent: 45, windowDurationMins: 10080 });
    expect(result.limits.planType).toBe("google-ai-pro");
  });

  it("continues across fetchAvailableModels endpoints until a weekly window is found", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      const target = String(url);
      calls.push(target);
      if (target.includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: "project-1",
          paidTier: {
            id: "g1-pro-tier",
            name: "Google AI Pro",
            availableCredits: [{ creditAmount: 1000, minimumCreditAmountForUsage: 50 }]
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.includes("retrieveUserQuota")) {
        return new Response(JSON.stringify({
          buckets: [{
            modelId: "claude-opus-4-6-thinking",
            remainingFraction: 1,
            resetTime: "2026-05-29T22:00:00Z"
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.includes("daily-cloudcode-pa.googleapis.com")) {
        return new Response(JSON.stringify({
          models: {
            "claude-opus-4-6-thinking": {
              quotaInfo: {
                remainingFraction: 1,
                resetTime: "2026-05-29T22:00:00Z"
              }
            }
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.includes("autopush-cloudcode-pa.sandbox.googleapis.com")) {
        return new Response(JSON.stringify({
          models: {
            "claude-opus-4-6-thinking": {
              quotaInfo: {
                remainingFraction: 0.42,
                resetTime: "2026-06-05T17:00:00Z"
              }
            }
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected request ${target}`);
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-05-29T17:00:00Z") / 1000
    });

    expect(calls.some((url) => url.includes("autopush-cloudcode-pa.sandbox.googleapis.com"))).toBe(true);
    expect(result.limits.primary).toMatchObject({ usedPercent: 0, windowDurationMins: 300 });
    expect(result.limits.secondary).toMatchObject({ usedPercent: 58, windowDurationMins: 10080 });
  });

  it("groups Antigravity model quota into five-hour and weekly windows by reset time", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          allowedTiers: [{ id: "standard-tier", name: "Antigravity Standard", isDefault: true }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        models: {
          "gemini-3.1-pro-high": {
            displayName: "Gemini 3.1 Pro (High)",
            quotaInfo: {
              remainingFraction: 0.2,
              resetTime: "2026-05-29T22:00:00Z"
            }
          },
          "gemini-3.1-flash-lite": {
            displayName: "Gemini 3.1 Flash Lite",
            quotaInfo: {
              remainingFraction: 0.75,
              resetTime: "2026-05-29T20:00:00Z"
            }
          },
          "claude-opus-4-6-thinking": {
            displayName: "Claude Opus 4.6 (Thinking)",
            quotaInfo: {
              remainingFraction: 0.4,
              resetTime: "2026-06-05T17:00:00Z"
            }
          }
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-05-29T17:00:00Z") / 1000
    });

    expect(result.limits.planType).toBe("unknown");
    expect(result.limits.primary).toMatchObject({
      usedPercent: 80,
      windowDurationMins: 300,
      resetsAt: Date.parse("2026-05-29T22:00:00Z") / 1000
    });
    expect(result.limits.secondary).toMatchObject({
      usedPercent: 60,
      windowDurationMins: 10080,
      resetsAt: Date.parse("2026-06-05T17:00:00Z") / 1000
    });
  });

  it("includes GPT and image model families exposed by Code Assist", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          allowedTiers: [{ id: "standard-tier", name: "Antigravity Standard", isDefault: true }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        models: {
          "gpt-5.1-codex": {
            quotaInfo: {
              remainingFraction: 0.5,
              resetTime: "2026-05-29T22:00:00Z"
            }
          },
          "imagen-4": {
            quotaInfo: {
              remainingFraction: 0.9,
              resetTime: "2026-06-05T17:00:00Z"
            }
          }
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-05-29T17:00:00Z") / 1000
    });

    expect(result.limits.primary).toMatchObject({ usedPercent: 50, windowDurationMins: 300 });
    expect(result.limits.secondary).toMatchObject({ usedPercent: 10, windowDurationMins: 10080 });
  });

  it("parses native retrieveUserQuotaSummary with both 5-hour and weekly windows across model groups", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: "project-1",
          currentTier: { id: "free-tier", name: "Antigravity" }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.includes("retrieveUserQuota")) {
        return new Response(JSON.stringify({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  bucketId: "gemini-weekly",
                  displayName: "Weekly Limit Remaining",
                  window: "weekly",
                  resetTime: "2026-06-05T17:00:00Z",
                  remainingFraction: 0.79
                },
                {
                  bucketId: "gemini-5h",
                  displayName: "Five Hour Limit Remaining",
                  window: "5h",
                  resetTime: "2026-05-29T22:00:00Z",
                  remainingFraction: 0.72
                }
              ]
            },
            {
              displayName: "Claude and GPT models",
              buckets: [
                {
                  bucketId: "3p-weekly",
                  displayName: "Weekly Limit Remaining",
                  window: "weekly",
                  resetTime: "2026-06-05T18:00:00Z",
                  remainingFraction: 1.0
                },
                {
                  bucketId: "3p-5h",
                  displayName: "Five Hour Limit Remaining",
                  window: "5h",
                  resetTime: "2026-05-29T23:00:00Z",
                  remainingFraction: 1.0
                }
              ]
            }
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected request ${target}`);
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-05-29T17:00:00Z") / 1000
    });

    expect(result.limits.primary).toMatchObject({
      usedPercent: 28,
      windowDurationMins: 300,
      resetsAt: Date.parse("2026-05-29T22:00:00Z") / 1000
    });
    expect(result.limits.secondary).toMatchObject({
      usedPercent: 21,
      windowDurationMins: 10080,
      resetsAt: Date.parse("2026-06-05T17:00:00Z") / 1000
    });
    expect(result.limits.limitName).toBe("5 часов / неделя");
    expect(result.status).toBe("active");
  });

  it("prioritizes daily-cloudcode-pa endpoint and correctly handles 100% used 5h quota", async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      const target = String(url);
      requestedUrls.push(target);
      if (target.includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          cloudaicompanionProject: "aicode-consumers",
          currentTier: { id: "paid-tier", name: "Google AI Pro" }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.startsWith("https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary")) {
        return new Response(JSON.stringify({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  bucketId: "gemini-weekly",
                  displayName: "Weekly Limit Remaining",
                  window: "weekly",
                  resetTime: "2026-09-28T15:49:41Z",
                  remainingFraction: 0.82367986
                },
                {
                  bucketId: "gemini-5h",
                  displayName: "Five Hour Limit Remaining",
                  window: "5h",
                  resetTime: "2026-09-21T20:49:41Z",
                  remainingFraction: 0
                }
              ]
            }
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.startsWith("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary")) {
        return new Response(JSON.stringify({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  bucketId: "gemini-weekly",
                  displayName: "Weekly Limit Remaining",
                  window: "weekly",
                  resetTime: "2026-09-28T18:23:41Z",
                  remainingFraction: 1.0
                },
                {
                  bucketId: "gemini-5h",
                  displayName: "Five Hour Limit Remaining",
                  window: "5h",
                  resetTime: "2026-09-21T23:23:41Z",
                  remainingFraction: 1.0
                }
              ]
            }
          ]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected request ${target}`);
    };

    const result = await fetchAntigravityQuota({
      accessToken: "access-secret-value",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => Date.parse("2026-09-21T18:20:00Z") / 1000
    });

    // Verify daily-cloudcode-pa was called first
    expect(requestedUrls[0]).toContain("daily-cloudcode-pa.googleapis.com");
    expect(requestedUrls.some((u) => u.startsWith("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"))).toBe(false);

    // Verify 5h limit is 100% used (0% remaining)
    expect(result.limits.primary).toMatchObject({
      usedPercent: 100,
      windowDurationMins: 300,
      resetsAt: Date.parse("2026-09-21T20:49:41Z") / 1000
    });
    // Verify weekly limit is 18% used (82% remaining)
    expect(result.limits.secondary).toMatchObject({
      usedPercent: 18,
      windowDurationMins: 10080,
      resetsAt: Date.parse("2026-09-28T15:49:41Z") / 1000
    });
    expect(result.status).toBe("limited");
    expect(result.statusReason).toContain("Gemini Models: Five Hour Limit Remaining");
  });
});
