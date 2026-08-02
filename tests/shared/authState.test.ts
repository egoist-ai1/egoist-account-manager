import { describe, expect, it } from "vitest";
import { authStateLabel, classifyAuthValidationError, isAuthState, knownAuthStates } from "../../src/shared/authState";

describe("auth state model", () => {
  it("defines the provider-neutral auth lifecycle states", () => {
    expect(knownAuthStates).toEqual([
      "unknown",
      "authorized",
      "expired",
      "revoked",
      "needs_reauth",
      "validation_failed"
    ]);
    expect(isAuthState("authorized")).toBe(true);
    expect(isAuthState("active")).toBe(false);
  });

  it("maps validation errors into lifecycle states without exposing raw details", () => {
    expect(classifyAuthValidationError(new Error("401 unauthorized"))).toBe("expired");
    expect(classifyAuthValidationError(new Error("refresh token revoked"))).toBe("revoked");
    expect(classifyAuthValidationError(new Error("login required"))).toBe("needs_reauth");
    expect(classifyAuthValidationError(new Error("Codex profile is not logged into a ChatGPT account"))).toBe("needs_reauth");
    expect(classifyAuthValidationError(new Error("Codex profile is not authenticated"))).toBe("needs_reauth");
    expect(classifyAuthValidationError(new Error("Codex profile belongs to a different ChatGPT account"))).toBe("needs_reauth");
    expect(classifyAuthValidationError(new Error("network timeout"))).toBe("validation_failed");
  });

  it("provides Russian UI labels for auth lifecycle states", () => {
    expect(authStateLabel("authorized")).toBe("авторизован");
    expect(authStateLabel("needs_reauth")).toBe("нужен вход");
  });
});
