import { describe, expect, it } from "vitest";
import {
  validateAntigravityAuthState,
  validateCodexAuthState
} from "../../src/main/services/authValidationService";

describe("authValidationService", () => {
  it("marks Codex ChatGPT accounts as authorized after account/read refresh", async () => {
    const state = await validateCodexAuthState({
      now: () => 1_800_000_000,
      readAccount: async (refreshToken) => ({
        account: { type: "chatgpt", email: "user@example.com", planType: "plus" },
        requiresOpenaiAuth: false,
        refreshToken
      } as never)
    });

    expect(state).toEqual({
      state: "authorized",
      lastValidatedAt: 1_800_000_000,
      errorReason: null
    });
  });

  it("marks Codex accounts without a compatible identity as needs_reauth", async () => {
    const state = await validateCodexAuthState({
      now: () => 1_800_000_001,
      readAccount: async () => ({
        account: null,
        requiresOpenaiAuth: true
      })
    });

    expect(state).toEqual({
      state: "needs_reauth",
      lastValidatedAt: 1_800_000_001,
      errorReason: "Codex requires ChatGPT-compatible authentication."
    });
  });

  it("validates API-key and enterprise token modes against their official runtime identity", async () => {
    await expect(validateCodexAuthState({
      expectedAuthMode: "apiKey",
      now: () => 1_800_000_010,
      readAccount: async () => ({ account: { type: "apiKey" }, requiresOpenaiAuth: false })
    })).resolves.toEqual({
      state: "authorized",
      lastValidatedAt: 1_800_000_010,
      errorReason: null
    });

    await expect(validateCodexAuthState({
      expectedAuthMode: "enterpriseAccessToken",
      now: () => 1_800_000_011,
      readAccount: async () => ({
        account: { type: "chatgpt", email: "enterprise@example.com", planType: "enterprise" },
        requiresOpenaiAuth: true
      })
    })).resolves.toEqual({
      state: "authorized",
      lastValidatedAt: 1_800_000_011,
      errorReason: null
    });
  });

  it("classifies Codex validation failures without leaking raw error strings", async () => {
    const state = await validateCodexAuthState({
      now: () => 1_800_000_002,
      readAccount: async () => {
        throw new Error("401 unauthorized Bearer sk-proj-secret-token-value");
      }
    });

    expect(state.state).toBe("expired");
    expect(state.lastValidatedAt).toBe(1_800_000_002);
    expect(state.errorReason).toBe("Codex auth validation failed.");
    expect(JSON.stringify(state)).not.toContain("sk-proj-secret-token-value");
  });

  it("keeps Antigravity validation honest when no official validator is available", () => {
    expect(validateAntigravityAuthState({ detected: false, now: () => 1_800_000_003 })).toEqual({
      state: "needs_reauth",
      lastValidatedAt: 1_800_000_003,
      errorReason: "Antigravity local profile was not detected."
    });

    expect(validateAntigravityAuthState({ detected: true, now: () => 1_800_000_004 })).toEqual({
      state: "unknown",
      lastValidatedAt: 1_800_000_004,
      errorReason: "Official Antigravity local auth validation is not available."
    });
  });
});
