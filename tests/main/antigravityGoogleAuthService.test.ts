import { describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_GOOGLE_OAUTH_SCOPES,
  buildAntigravityGoogleAuthUrl,
  createAntigravityGoogleOAuthAuthorization,
  createAntigravityPkce,
  exchangeAntigravityGoogleCode,
  fetchAntigravityGoogleAccountContext,
  fetchAntigravityGoogleUserInfo,
  resolveAntigravityOAuthClient,
  runAntigravityGoogleOAuthFlow
} from "../../src/main/services/antigravityGoogleAuthService";

describe("antigravityGoogleAuthService", () => {
  it("builds a Google OAuth URL with PKCE and Antigravity scopes", () => {
    const url = new URL(buildAntigravityGoogleAuthUrl({
      clientId: "client-id",
      redirectUri: "http://localhost:36742/oauth-callback",
      state: "state-1",
      codeChallenge: "challenge-1"
    }));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:36742/oauth-callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.has("include_granted_scopes")).toBe(false);
    expect(url.searchParams.get("scope")).not.toContain("openid");
    for (const scope of ANTIGRAVITY_GOOGLE_OAUTH_SCOPES) {
      expect(url.searchParams.get("scope")).toContain(scope);
    }
  });

  it("requires a user-configured PKCE client and never falls back to an embedded secret", () => {
    expect(() => resolveAntigravityOAuthClient({})).toThrow("requires your own PKCE desktop client ID");
    expect(resolveAntigravityOAuthClient({
      CAM_ANTIGRAVITY_OAUTH_CLIENT_ID: "client-id",
      CAM_ANTIGRAVITY_OAUTH_CLIENT_SECRET: "client-secret"
    })).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      usesBundledPublicClient: false
    });
  });

  it("generates verifier and challenge values suitable for PKCE", () => {
    const first = createAntigravityPkce();
    const second = createAntigravityPkce();

    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).not.toBe(first.verifier);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("creates a loopback OAuth callback on an available runtime port", async () => {
    const authorization = await createAntigravityGoogleOAuthAuthorization({
      env: {
        CAM_ANTIGRAVITY_OAUTH_CLIENT_ID: "client-id",
        CAM_ANTIGRAVITY_OAUTH_CLIENT_SECRET: "client-secret"
      },
      timeoutMs: 1000
    });
    try {
      const redirect = new URL(authorization.redirectUri);
      expect(redirect.hostname).toBe("localhost");
      expect(Number(redirect.port)).toBeGreaterThan(0);
      expect(redirect.pathname).toBe("/oauth-callback");

      await fetch(`${authorization.redirectUri}?code=code-value&state=${authorization.expectedState}`);
      await expect(authorization.waitForCallback).resolves.toEqual({
        code: "code-value",
        state: authorization.expectedState
      });
    } finally {
      await authorization.close();
    }
  });

  it("exchanges an OAuth code without exposing token fields in the returned shape names", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({
        access_token: "access-token-value",
        refresh_token: "refresh-token-value",
        expires_in: 3600,
        scope: "scope-a scope-b",
        token_type: "Bearer"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const tokens = await exchangeAntigravityGoogleCode({
      clientId: "client-id",
      clientSecret: "public-client-secret",
      redirectUri: "http://localhost:36742/oauth-callback",
      code: "code-value",
      codeVerifier: "verifier-value",
      fetchImpl: fetchImpl as typeof fetch,
      now: () => 100
    });

    expect(tokens).toMatchObject({
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      expiresAt: 3700,
      scope: ["scope-a", "scope-b"],
      tokenType: "Bearer"
    });
    expect(requests[0].body).toContain("code_verifier=verifier-value");
    expect(requests[0].body).toContain("client_secret=public-client-secret");
  });

  it("returns the Google token exchange error when Google rejects a code", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({
        error: "invalid_request",
        error_description: "client_secret is required"
      }), { status: 400, headers: { "Content-Type": "application/json" } });

    await expect(exchangeAntigravityGoogleCode({
      clientId: "client-id",
      clientSecret: null,
      redirectUri: "http://localhost:36742/oauth-callback",
      code: "code-value",
      codeVerifier: "verifier-value",
      fetchImpl: fetchImpl as typeof fetch
    })).rejects.toThrow(/client_secret is required/);
  });

  it("hard-times-out a stalled token exchange", async () => {
    const fetchImpl = () => new Promise<Response>(() => undefined);

    await expect(exchangeAntigravityGoogleCode({
      clientId: "client-id",
      clientSecret: "public-client-secret",
      redirectUri: "http://localhost:36742/oauth-callback",
      code: "code-value",
      codeVerifier: "verifier-value",
      fetchImpl: fetchImpl as typeof fetch,
      requestTimeoutMs: 5
    })).rejects.toThrow(/timed out/);
  });

  it("reads Google user info from an authorized access token", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({
        id: "google-sub-1",
        email: "ag@example.com",
        verified_email: true,
        name: "AG User"
      }), { status: 200, headers: { "Content-Type": "application/json" } });

    await expect(fetchAntigravityGoogleUserInfo({
      accessToken: "access-token-value",
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toEqual({
      id: "google-sub-1",
      email: "ag@example.com",
      verifiedEmail: true,
      name: "AG User"
    });
  });

  it("falls back to oauth2 v2 userinfo when the v1 endpoint is unavailable", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes("/oauth2/v1/userinfo")) {
        return new Response(JSON.stringify({ error: "temporarily unavailable" }), { status: 503 });
      }
      return new Response(JSON.stringify({
        id: "google-sub-2",
        email: "fallback@example.com",
        verified_email: true,
        name: "Fallback User"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    await expect(fetchAntigravityGoogleUserInfo({
      accessToken: "access-token-value",
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toMatchObject({
      id: "google-sub-2",
      email: "fallback@example.com"
    });
    expect(calls.some((url) => url.includes("/oauth2/v2/userinfo"))).toBe(true);
  });

  it("keeps generic Antigravity Code Assist tier unknown", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({
        cloudaicompanionProject: "project-123",
        currentTier: { id: "g1-pro-tier" },
        allowedTiers: [{ id: "g1-pro-tier", isDefault: true }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });

    await expect(fetchAntigravityGoogleAccountContext({
      accessToken: "access-token-value",
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toEqual({
      googleProjectId: "project-123",
      tier: "unknown",
      tierId: null,
      source: "code_assist",
      errorReason: null
    });
  });

  it("uses strong planInfo markers when Code Assist returns a named Google AI plan", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({
        cloudaicompanionProject: "project-123",
        planInfo: {
          subscriptionPlan: "Google AI Ultra X20"
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });

    await expect(fetchAntigravityGoogleAccountContext({
      accessToken: "access-token-value",
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toMatchObject({
      googleProjectId: "project-123",
      tier: "paid",
      tierId: "Google AI Ultra X20"
    });
  });

  it("uses an active paidTier with available credits even when currentTier is free", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({
        cloudaicompanionProject: "project-123",
        currentTier: { id: "free-tier" },
        paidTier: {
          id: "g1-pro-tier",
          name: "Google AI Pro",
          availableCredits: [{ creditAmount: 1000, minimumCreditAmountForUsage: 50 }]
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });

    await expect(fetchAntigravityGoogleAccountContext({
      accessToken: "access-token-value",
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toMatchObject({
      googleProjectId: "project-123",
      tier: "paid",
      tierId: "Google AI Pro"
    });
  });

  it("keeps current free tier when paidTier is only an offer without usable credits", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({
        cloudaicompanionProject: "project-123",
        currentTier: { id: "free-tier" },
        paidTier: { id: "g1-pro-tier", name: "Google AI Pro" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });

    await expect(fetchAntigravityGoogleAccountContext({
      accessToken: "access-token-value",
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toMatchObject({
      googleProjectId: "project-123",
      tier: "free",
      tierId: "free-tier"
    });
  });

  it("falls back to a metadata-free Code Assist context request when Antigravity metadata is rejected", async () => {
    const requestBodies: string[] = [];
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      requestBodies.push(body);
      if (body.includes('"metadata"')) {
        return new Response(JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT"
          }
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        allowedTiers: [{
          id: "standard-tier",
          name: "Antigravity Standard",
          isDefault: true,
          userDefinedCloudaicompanionProject: true
        }],
        ineligibleTiers: [{ tierId: "free-tier", tierName: "Antigravity" }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    await expect(fetchAntigravityGoogleAccountContext({
      accessToken: "access-token-value",
      fetchImpl: fetchImpl as typeof fetch,
      requestTimeoutMs: 1000
    })).resolves.toEqual({
      googleProjectId: null,
      tier: "standard",
      tierId: "standard-tier",
      source: "code_assist",
      errorReason: null
    });
    expect(requestBodies.some((body) => !body.includes('"metadata"'))).toBe(true);
  });

  it("onboards a free Antigravity Code Assist project when loadCodeAssist has no project", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).includes("loadCodeAssist")) {
        return new Response(JSON.stringify({
          allowedTiers: [{ id: "free", isDefault: true }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("onboardUser")) {
        return new Response(JSON.stringify({
          done: true,
          response: {
            cloudaicompanionProject: { id: "managed-project-1" }
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500, headers: { "Content-Type": "application/json" } });
    };

    await expect(fetchAntigravityGoogleAccountContext({
      accessToken: "access-token-value",
      fetchImpl: fetchImpl as typeof fetch,
      requestTimeoutMs: 1000
    })).resolves.toEqual({
      googleProjectId: "managed-project-1",
      tier: "free",
      tierId: "free",
      source: "code_assist",
      errorReason: null
    });
    expect(requests.some((request) => request.url.includes("onboardUser"))).toBe(true);
    expect(requests[0].body).toContain("FULL_ELIGIBILITY_CHECK");
  });

  it("does not treat paidTier offers as an active Antigravity subscription", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({
        cloudaicompanionProject: "project-123",
        allowedTiers: [{ id: "free", isDefault: true }],
        paidTier: { id: "g1-pro-tier" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });

    await expect(fetchAntigravityGoogleAccountContext({
      accessToken: "access-token-value",
      fetchImpl: fetchImpl as typeof fetch
    })).resolves.toEqual({
      googleProjectId: "project-123",
      tier: "free",
      tierId: "free",
      source: "code_assist",
      errorReason: null
    });
  });

  it("can finish OAuth after userinfo without waiting for Code Assist context", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      const target = String(url);
      calls.push(target);
      if (target.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
          expires_in: 3600,
          scope: "scope-a",
          token_type: "Bearer"
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (target.includes("www.googleapis.com/oauth2/v1/userinfo")) {
        return new Response(JSON.stringify({
          id: "google-sub-1",
          email: "ag@example.com",
          verified_email: true,
          name: "AG User"
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "Code Assist should be deferred" }), { status: 500 });
    };

    await expect(runAntigravityGoogleOAuthFlow({
      env: {
        CAM_ANTIGRAVITY_OAUTH_CLIENT_ID: "client-id",
        CAM_ANTIGRAVITY_OAUTH_CLIENT_SECRET: "client-secret"
      },
      fetchImpl: fetchImpl as typeof fetch,
      resolveAccountContext: false,
      requestTimeoutMs: 1000,
      openExternal: async (authUrl) => {
        const parsed = new URL(authUrl);
        const redirectUri = parsed.searchParams.get("redirect_uri");
        const state = parsed.searchParams.get("state");
        if (!redirectUri || !state) throw new Error("OAuth URL is missing callback params");
        await fetch(`${redirectUri}?code=code-value&state=${state}`);
      }
    })).resolves.toMatchObject({
      user: { email: "ag@example.com" },
      accountContext: {
        googleProjectId: null,
        tier: "unknown",
        source: "unavailable"
      }
    });
    expect(calls.some((url) => url.includes("loadCodeAssist"))).toBe(false);
  });
});
