import { describe, expect, it } from "vitest";
import {
  antigravityCredentialPayloadImportInputSchema,
  antigravityExternalImportInputSchema,
  antigravityOAuthCancelInputSchema,
  antigravityOAuthFinishInputSchema,
  accountActionInputSchema,
  accountPlatformSchema,
  antigravityRefreshTokenSchema,
  deviceCodeActionInputSchema,
  deviceCodeOpenInputSchema,
  validateAuthInputSchema,
  importAntigravityCredentialsInputSchema,
  quotaStateInputSchema,
  loginStartInputSchema,
  openExternalInputSchema,
  reauthenticateAccountInputSchema,
  switchAccountInputSchema,
  switchEventInputSchema,
  switchTransactionActionInputSchema,
  updateSettingsInputSchema,
  workspaceBindingInputSchema
} from "../../src/shared/ipcSchemas";

describe("IPC schemas", () => {
  it("accepts valid switch input and rejects empty account id", () => {
    expect(switchAccountInputSchema.parse({ accountId: "acc_123" })).toEqual({ accountId: "acc_123" });
    expect(switchAccountInputSchema.parse({ accountId: "acc_123", platform: "antigravity" })).toEqual({
      accountId: "acc_123",
      platform: "antigravity"
    });
    expect(switchAccountInputSchema.parse({
      accountId: "acc_123",
      transactionId: "transaction_123"
    })).toEqual({
      accountId: "acc_123",
      transactionId: "transaction_123"
    });
    expect(() => switchAccountInputSchema.parse({ accountId: "" })).toThrow();
  });

  it("rejects unknown switch input keys", () => {
    expect(() => switchAccountInputSchema.parse({ accountId: "acc_123", extra: true })).toThrow();
    expect(() => switchAccountInputSchema.parse({ accountId: "acc_123", platform: "cursor" })).toThrow();
  });

  it("validates typed preload action envelopes", () => {
    expect(loginStartInputSchema.parse({ type: "chatgptDeviceCode" })).toEqual({ type: "chatgptDeviceCode" });
    expect(reauthenticateAccountInputSchema.parse({ accountId: "acc_123", type: "chatgpt" })).toEqual({ accountId: "acc_123", type: "chatgpt" });
    expect(loginStartInputSchema.parse({ type: "apiKey", credential: "sk-test-key" })).toEqual({
      type: "apiKey",
      credential: "sk-test-key"
    });
    expect(loginStartInputSchema.parse({
      type: "enterpriseAccessToken",
      credential: "enterprise-token-value"
    })).toEqual({
      type: "enterpriseAccessToken",
      credential: "enterprise-token-value"
    });
    expect(accountActionInputSchema.parse({ accountId: "acc_123" })).toEqual({ accountId: "acc_123" });
    expect(workspaceBindingInputSchema.parse({ accountId: null })).toEqual({ accountId: null });
    expect(switchEventInputSchema.parse({ eventId: "event_123" })).toEqual({ eventId: "event_123" });
    expect(switchTransactionActionInputSchema.parse({ transactionId: "transaction_123" })).toEqual({
      transactionId: "transaction_123"
    });
    expect(openExternalInputSchema.parse({ url: "https://github.com/egoistgorbachev/codex-account-manager" })).toMatchObject({ url: expect.any(String) });
    expect(deviceCodeActionInputSchema.parse({ userCode: "ABCD-1234" })).toEqual({ userCode: "ABCD-1234" });
    expect(deviceCodeOpenInputSchema.parse({
      url: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234"
    })).toEqual({ url: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" });
    expect(() => loginStartInputSchema.parse({ type: "unknown" })).toThrow();
    expect(() => loginStartInputSchema.parse({ type: "apiKey" })).toThrow();
    expect(() => loginStartInputSchema.parse({ type: "chatgpt", credential: "must-not-be-accepted" })).toThrow();
    expect(() => openExternalInputSchema.parse({ url: "javascript:alert(1)" })).toThrow();
    expect(() => deviceCodeActionInputSchema.parse({ userCode: "<script>" })).toThrow();
    expect(() => deviceCodeOpenInputSchema.parse({ url: "javascript:alert(1)", userCode: "ABCD-1234" })).toThrow();
  });

  it("validates auth validation input without extra keys", () => {
    expect(validateAuthInputSchema.parse({ accountId: "acc_123" })).toEqual({ accountId: "acc_123" });
    expect(() => validateAuthInputSchema.parse({ accountId: "" })).toThrow();
    expect(() => validateAuthInputSchema.parse({ accountId: "acc_123", rawToken: "secret" })).toThrow();
  });

  it("validates provider quota state input without extra keys", () => {
    expect(quotaStateInputSchema.parse({ accountId: "acc_123" })).toEqual({ accountId: "acc_123" });
    expect(() => quotaStateInputSchema.parse({ accountId: "" })).toThrow();
    expect(() => quotaStateInputSchema.parse({ accountId: "acc_123", forceRefresh: true })).toThrow();
  });

  it("validates supported platforms and Antigravity refresh token shape", () => {
    expect(accountPlatformSchema.parse("codex")).toBe("codex");
    expect(accountPlatformSchema.parse("antigravity")).toBe("antigravity");
    expect(() => accountPlatformSchema.parse("windsurf")).toThrow();
    expect(antigravityRefreshTokenSchema.parse("r".repeat(32))).toBe("r".repeat(32));
    expect(() => antigravityRefreshTokenSchema.parse("short")).toThrow();
  });

  it("accepts supported UI language settings", () => {
    expect(updateSettingsInputSchema.parse({ language: "ru", autoRefreshIntervalMs: 180000 })).toEqual({
      language: "ru",
      autoRefreshIntervalMs: 180000
    });
    expect(updateSettingsInputSchema.parse({ language: "en" })).toEqual({
      language: "en"
    });
    expect(updateSettingsInputSchema.parse({ autoRefreshIntervalMs: 0 })).toEqual({
      autoRefreshIntervalMs: 0
    });
    expect(updateSettingsInputSchema.parse({ trayRefreshIntervalMs: 60_000 })).toEqual({
      trayRefreshIntervalMs: 60_000
    });
    expect(updateSettingsInputSchema.parse({ trayRefreshIntervalMs: 300_000 })).toEqual({
      trayRefreshIntervalMs: 300_000
    });
    expect(() => updateSettingsInputSchema.parse({ language: "de" })).toThrow();
  });

  it("rejects unsupported refresh intervals", () => {
    expect(() => updateSettingsInputSchema.parse({ language: "ru", autoRefreshIntervalMs: 120000 })).toThrow();
    expect(() => updateSettingsInputSchema.parse({ trayRefreshIntervalMs: 120000 })).toThrow();
  });

  it("accepts optional privacy and switch confirmation booleans", () => {
    expect(
      updateSettingsInputSchema.parse({
        language: "ru",
        privacyMode: true,
        confirmSwitch: false,
        smartSwitchMode: "suggest",
        smartSwitchThresholdPercent: 15,
        notificationSoundEnabled: false
      })
    ).toEqual({
      language: "ru",
      privacyMode: true,
      confirmSwitch: false,
      smartSwitchMode: "suggest",
      smartSwitchThresholdPercent: 15,
      notificationSoundEnabled: false
    });
    expect(() => updateSettingsInputSchema.parse({ smartSwitchMode: "manual" })).toThrow();
    expect(() => updateSettingsInputSchema.parse({ smartSwitchThresholdPercent: 3 })).toThrow();
  });

  it("rejects unknown settings input keys", () => {
    expect(() => updateSettingsInputSchema.parse({ language: "ru", extra: true })).toThrow();
  });

  it("validates manual Antigravity credential import input without extra keys", () => {
    expect(importAntigravityCredentialsInputSchema.parse({
      label: "Рабочий AG",
      email: "user@example.com",
      accountId: "google-oauth-sub",
      refreshToken: "r".repeat(32),
      accessToken: "a".repeat(16),
      expiresAt: 1_800_000_000,
      googleProjectId: "project-1",
      fingerprintId: "fp-1",
      machineId: "machine-123456"
    })).toMatchObject({
      email: "user@example.com",
      accountId: "google-oauth-sub"
    });
    expect(() => importAntigravityCredentialsInputSchema.parse({
      email: "user@example.com",
      accountId: "google-oauth-sub",
      refreshToken: "short"
    })).toThrow();
    expect(() => importAntigravityCredentialsInputSchema.parse({
      email: "user@example.com",
      accountId: "google-oauth-sub",
      refreshToken: "r".repeat(32),
      extra: true
    })).toThrow();
  });

  it("validates Antigravity OAuth and token import inputs without extra keys", () => {
    expect(antigravityOAuthFinishInputSchema.parse({
      sessionId: "oauth-session-123",
      callbackUrl: "http://localhost:36742/oauth-callback?code=abc&state=state"
    })).toMatchObject({ sessionId: "oauth-session-123" });
    expect(antigravityOAuthCancelInputSchema.parse({ sessionId: "oauth-session-123" })).toEqual({ sessionId: "oauth-session-123" });
    expect(() => antigravityOAuthFinishInputSchema.parse({ sessionId: "short" })).toThrow();
    expect(() => antigravityOAuthCancelInputSchema.parse({ sessionId: "oauth-session-123", token: "secret" })).toThrow();

    expect(antigravityCredentialPayloadImportInputSchema.parse({
      payload: "1//refresh-token-value-with-enough-length",
      source: "token_json"
    })).toMatchObject({ source: "token_json" });
    expect(antigravityExternalImportInputSchema.parse({ source: "cockpit" })).toEqual({ source: "cockpit" });
    expect(() => antigravityExternalImportInputSchema.parse({ source: "local_files" })).toThrow();
    expect(() => antigravityCredentialPayloadImportInputSchema.parse({ payload: "short" })).toThrow();
  });
});
