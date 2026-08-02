import { describe, expect, it } from "vitest";
import {
  buildAntigravityCredentialStorePayload,
  buildWindowsCredentialManagerReadScript,
  buildWindowsCredentialManagerWriteScript
} from "../../src/main/services/antigravityCredentialStore";

describe("antigravityCredentialStore", () => {
  it("builds the Antigravity OS credential payload without leaking fields outside JSON", () => {
    const payload = buildAntigravityCredentialStorePayload({
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      expiresAt: 1_800_000_000
    });

    const parsed = JSON.parse(payload) as {
      token: { access_token: string; refresh_token: string; token_type: string; expiry: string };
      auth_method: string;
    };
    expect(parsed).toMatchObject({
      token: {
        access_token: "access-token-secret",
        refresh_token: "refresh-token-secret",
        token_type: "Bearer"
      },
      auth_method: "consumer"
    });
    expect(parsed.token.expiry).toMatch(/Z$/);
  });

  it("uses valid PowerShell static method syntax for the Windows writer", () => {
    const script = buildWindowsCredentialManagerWriteScript();

    expect(script).toContain("[EgoistCredentialWriter]::Write");
    expect(script).not.toContain("EgoistCredentialWriter::Write");
    expect(script).toContain("[Console]::In.ReadToEnd()");
  });

  it("reads the Antigravity OS credential as base64 without printing raw secret fields", () => {
    const script = buildWindowsCredentialManagerReadScript();

    expect(script).toContain("CredReadW");
    expect(script).toContain("Convert.ToBase64String");
    expect(script).toContain("[EgoistCredentialReader]::Read('gemini:antigravity')");
    expect(script).not.toContain("refresh_token");
    expect(script).not.toContain("access_token");
  });
});
