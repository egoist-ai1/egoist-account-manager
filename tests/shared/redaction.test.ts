import { describe, expect, it } from "vitest";
import { maskAccountIdentifier, redactSensitiveText } from "../../src/shared/redaction";

describe("redaction", () => {
  it("redacts token-like values and auth json fields", () => {
    const text = redactSensitiveText(
      'Authorization: Bearer sk-proj-secret-token-value\n{"refreshToken":"refresh-secret-token-123456","access_token":"eyJsecret-token"}'
    );

    expect(text).toContain("Authorization: Bearer [скрыто]");
    expect(text).toContain('"refreshToken":"[скрыто]"');
    expect(text).toContain('"access_token":"[скрыто]"');
    expect(text).not.toContain("sk-proj-secret-token-value");
    expect(text).not.toContain("refresh-secret-token-123456");
    expect(text).not.toContain("eyJsecret-token");
  });

  it("masks emails, account ids, and local Windows user paths", () => {
    const text = redactSensitiveText(
      "user@example.com account_id=acc_1234567890abcdef C:\\Users\\EGOIST\\AppData\\Roaming\\Codex\\auth.json"
    );

    expect(text).toContain("u***@example.com");
    expect(text).toContain("account_id=[идентификатор]");
    expect(text).toContain("C:\\Users\\[user]\\AppData\\Roaming\\Codex\\auth.json");
    expect(text).not.toContain("user@example.com");
    expect(text).not.toContain("acc_1234567890abcdef");
    expect(text).not.toContain("EGOIST");
  });

  it("masks account identifiers while preserving short troubleshooting hints", () => {
    expect(maskAccountIdentifier("acc_1234567890abcdef")).toBe("acc_...cdef");
    expect(maskAccountIdentifier("short")).toBe("[идентификатор]");
  });
});
