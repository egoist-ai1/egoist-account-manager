import { describe, expect, it } from "vitest";
import {
  createAntigravityUnifiedEnterprisePreferences,
  createAntigravityUnifiedOAuthToken,
  createAntigravityUnifiedStateEntry,
  createAntigravityUnifiedUserStatus,
  decodeAntigravityUnifiedStateEntry,
  parseAntigravityUnifiedEnterprisePreferences,
  parseAntigravityUnifiedOAuthToken,
  parseAntigravityUnifiedUserStatus
} from "../../src/main/services/antigravityUnifiedState";

describe("antigravity unified state", () => {
  it("round-trips OAuth token info in the Antigravity unified state row format", () => {
    const entry = createAntigravityUnifiedOAuthToken({
      accessToken: "access-token-123456",
      refreshToken: "refresh-token-123456",
      expiresAt: 1_800_000_000,
      email: "user@example.com"
    });

    expect(parseAntigravityUnifiedOAuthToken(entry)).toEqual({
      accessToken: "access-token-123456",
      refreshToken: "refresh-token-123456",
      expiresAt: 1_800_000_000,
      idToken: null
    });
  });

  it("round-trips user status and enterprise project rows", () => {
    expect(parseAntigravityUnifiedUserStatus(createAntigravityUnifiedUserStatus("user@example.com"))).toEqual({
      email: "user@example.com"
    });
    expect(parseAntigravityUnifiedEnterprisePreferences(createAntigravityUnifiedEnterprisePreferences("project-12345"))).toEqual({
      googleProjectId: "project-12345"
    });
  });

  it("preserves sentinel labels in generic unified state entries", () => {
    const entry = createAntigravityUnifiedStateEntry("customSentinel", Uint8Array.from([1, 2, 3]));
    const decoded = decodeAntigravityUnifiedStateEntry(entry);

    expect(decoded.sentinelKey).toBe("customSentinel");
    expect([...decoded.payload]).toEqual([1, 2, 3]);
  });
});
