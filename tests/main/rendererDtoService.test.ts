import { describe, expect, it } from "vitest";
import { toRendererDto } from "../../src/main/services/rendererDtoService";

describe("Renderer DTO secret boundary", () => {
  it("whitelists nested account results from login, switch and import without modifying the store row", () => {
    const account = { id: "fixture", email: "fixture@example.com", platform: "codex", credentialState: "ready",
      profileDir: "owned/profile", version: 2, encryptedAuthJson: "sealed-secret", internalFutureSecret: "secret",
      quotaSnapshot: { primary: { usedPercent: 99.5, windowDurationMins: 300 }, access_token: "secret" },
      runtimeVerification: { profileApplied: true, credentials: "probe_observed", runtime: "unsupported" } };
    const result = toRendererDto({ account, accounts: [account], imported: true });
    expect(result.account).not.toHaveProperty("encryptedAuthJson");
    expect(result.accounts[0]).not.toHaveProperty("internalFutureSecret");
    expect(result.account.quotaSnapshot).not.toHaveProperty("access_token");
    expect(result.account.runtimeVerification.credentials).toBe("probe_observed");
    expect(result.account.quotaSnapshot.primary.usedPercent).toBe(99.5);
    expect(account.encryptedAuthJson).toBe("sealed-secret");
  });

  it("strips nested provider secrets while retaining public evidence and login handoff fields", () => {
    const result = toRendererDto({ loginId: "login", userCode: "public-code", authUrl: "https://auth.example/flow",
      evidence: { credentials: "online_verified", credentialMethod: "google.userinfo", runtime: "verified" },
      diagnostics: { accessToken: "secret", refresh_token: "secret", client_secret: "secret", token: { value: "secret" } } });
    expect(result.diagnostics).toEqual({});
    expect(result.evidence.credentials).toBe("online_verified");
    expect(result.userCode).toBe("public-code");
    expect(result.authUrl).toBe("https://auth.example/flow");
  });
});
