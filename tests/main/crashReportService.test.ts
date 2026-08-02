import { describe, expect, it } from "vitest";
import { buildCrashReport, sanitizeCrashText } from "../../src/main/services/crashReportService";

describe("crashReportService", () => {
  it("redacts common token shapes from crash text", () => {
    const text = sanitizeCrashText('Bearer sk-test-secret-token-value and "access_token":"eyJvery-secret-token"');

    expect(text).toContain("Bearer [скрыто]");
    expect(text).toContain('"access_token":"[скрыто]"');
    expect(text).not.toContain("sk-test-secret-token-value");
    expect(text).not.toContain("eyJvery-secret-token");
  });

  it("builds a local crash report without raw secret values", () => {
    const error = new Error("failed with password");
    error.stack = 'Error: failed\n{"password":"super-secret"}';

    const report = buildCrashReport("test", error);

    expect(report.format).toBe("one.egoist.codex-account-manager.crash-report");
    expect(report.kind).toBe("test");
    expect(report.message).toContain('"password":"[скрыто]"');
    expect(report.message).not.toContain("super-secret");
  });

  it("redacts account identity and local user paths from crash text", () => {
    const text = sanitizeCrashText(
      "Refresh failed for user@example.com at C:\\Users\\EGOIST\\AppData\\Roaming\\Codex\\auth.json accountId=acc_1234567890abcdef"
    );

    expect(text).toContain("u***@example.com");
    expect(text).toContain("C:\\Users\\[user]\\AppData\\Roaming\\Codex\\auth.json");
    expect(text).toContain("accountId=[идентификатор]");
    expect(text).not.toContain("user@example.com");
    expect(text).not.toContain("EGOIST");
    expect(text).not.toContain("acc_1234567890abcdef");
  });
});
