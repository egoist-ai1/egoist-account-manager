import { describe, expect, it } from "vitest";
import type { CodexCredentialStoreDiagnostics } from "../../src/shared/types";
import { formatCredentialStore, formatQuotaReset } from "../../src/renderer/components/v3/OverviewPage";

function credentialStore(
  input: Partial<CodexCredentialStoreDiagnostics> = {}
): CodexCredentialStoreDiagnostics {
  return {
    configuredMode: "file",
    effectiveStore: "file",
    authJsonPresent: true,
    managerCompatible: true,
    message: "compatible",
    ...input
  };
}

describe("OverviewPage presentation model", () => {
  it("presents the documented default as a file store instead of raw unspecified state", () => {
    const diagnostics = credentialStore({ configuredMode: "unspecified" });

    expect(formatCredentialStore(diagnostics, false)).toBe("Файл · по умолчанию");
    expect(formatCredentialStore(diagnostics, true)).toBe("File · default");
  });

  it("keeps incompatible credential modes explicit", () => {
    expect(formatCredentialStore(credentialStore({ configuredMode: "keyring", effectiveStore: "keyring" }), false))
      .toBe("Хранилище Windows");
    expect(formatCredentialStore(credentialStore({ configuredMode: "auto", effectiveStore: "unknown" }), false))
      .toBe("Автовыбор");
    expect(formatCredentialStore(credentialStore({ configuredMode: "invalid", effectiveStore: "unknown" }), false))
      .toBe("Ошибка настройки");
  });

  it("formats reset windows with readable Russian plurals", () => {
    const now = 1_000_000;

    expect(formatQuotaReset(now + 60, now, false)).toBe("Сброс через 1 минуту");
    expect(formatQuotaReset(now + 2 * 3600, now, false)).toBe("Сброс через 2 часа");
    expect(formatQuotaReset(now + 5 * 3600, now, false)).toBe("Сброс через 5 часов");
    expect(formatQuotaReset(now + 6 * 86_400, now, false)).toBe("Сброс через 6 дней");
    expect(formatQuotaReset(null, now, false)).toBe("Обновите, чтобы узнать сброс");
  });
});
