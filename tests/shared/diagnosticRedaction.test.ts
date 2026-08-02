import { describe, expect, it } from "vitest";
import { redactDiagnosticReport } from "../../src/shared/diagnosticRedaction";

describe("diagnostic redaction", () => {
  it("redacts sensitive strings recursively without changing non-string values", () => {
    const report = redactDiagnosticReport({
      format: "diagnostic",
      generatedAt: "2026-05-23T00:00:00.000Z",
      diagnostics: {
        activeCodexHome: "C:\\Users\\EGOIST\\.codex",
        startupError: "Authorization: Bearer sk-proj-secret-token-value"
      },
      accounts: [
        {
          id: "acc_1234567890abcdef",
          email: "user@example.com",
          isActive: true,
          lastRefreshAt: 1_800_000_000,
          profileDir: "C:\\Users\\EGOIST\\AppData\\Roaming\\Codex\\profiles\\acc_1234567890abcdef"
        }
      ]
    });

    expect(report.accounts[0].id).toBe("acc_...cdef");
    expect(report.accounts[0].email).toBe("u***@example.com");
    expect(report.accounts[0].profileDir).toBe("C:\\Users\\[user]\\AppData\\Roaming\\Codex\\profiles\\acc_...cdef");
    expect(report.diagnostics.startupError).toBe("Authorization: Bearer [скрыто]");
    expect(report.accounts[0].isActive).toBe(true);
    expect(report.accounts[0].lastRefreshAt).toBe(1_800_000_000);
    expect(JSON.stringify(report)).not.toContain("sk-proj-secret-token-value");
    expect(JSON.stringify(report)).not.toContain("user@example.com");
    expect(JSON.stringify(report)).not.toContain("acc_1234567890abcdef");
    expect(JSON.stringify(report)).not.toContain("EGOIST");
  });
});
