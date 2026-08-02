import type { AccountReadResponse } from "../codexRpc.js";
import type { AuthValidationState } from "../../shared/authState.js";
import type { CodexAuthMode } from "../../shared/types.js";
import { classifyAuthValidationError } from "../../shared/authState.js";

export interface CodexAuthValidationInput {
  readAccount(refreshToken: boolean): Promise<AccountReadResponse>;
  expectedAuthMode?: CodexAuthMode;
  now?: () => number;
}

export interface AntigravityAuthValidationInput {
  detected: boolean;
  now?: () => number;
}

function timestamp(now?: () => number): number {
  return now ? now() : Math.floor(Date.now() / 1000);
}

export async function validateCodexAuthState(input: CodexAuthValidationInput): Promise<AuthValidationState> {
  const validatedAt = timestamp(input.now);
  try {
    const response = await input.readAccount(true);
    const expected = input.expectedAuthMode ?? "chatgpt";
    const expectedType = expected === "apiKey" ? "apiKey" : "chatgpt";
    if (response.account?.type !== expectedType) {
      return {
        state: "needs_reauth",
        lastValidatedAt: validatedAt,
        errorReason: expected === "apiKey"
          ? "Codex API-key authentication is missing."
          : "Codex requires ChatGPT-compatible authentication."
      };
    }
    return {
      state: "authorized",
      lastValidatedAt: validatedAt,
      errorReason: null
    };
  } catch (error) {
    return {
      state: classifyAuthValidationError(error),
      lastValidatedAt: validatedAt,
      errorReason: "Codex auth validation failed."
    };
  }
}

export function validateAntigravityAuthState(input: AntigravityAuthValidationInput): AuthValidationState {
  const validatedAt = timestamp(input.now);
  if (!input.detected) {
    return {
      state: "needs_reauth",
      lastValidatedAt: validatedAt,
      errorReason: "Antigravity local profile was not detected."
    };
  }
  return {
    state: "unknown",
    lastValidatedAt: validatedAt,
    errorReason: "Official Antigravity local auth validation is not available."
  };
}
