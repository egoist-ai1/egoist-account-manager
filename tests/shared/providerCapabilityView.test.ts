import { describe, expect, it } from "vitest";
import { buildProviderCapabilityRows, providerCapabilityTone, providerSupportLabel } from "../../src/shared/providerCapabilityView";
import { getProviderAdapterMetadata } from "../../src/shared/providerAdapter";

describe("provider capability view model", () => {
  it("builds compact Russian rows for provider diagnostics", () => {
    const rows = buildProviderCapabilityRows(getProviderAdapterMetadata("codex"));

    expect(rows.map((row) => row.id)).toEqual([
      "validateAuth",
      "getQuotaState",
      "switchAccount",
      "restartOrReloadIntegration",
      "getHistory",
      "sessionTransfer"
    ]);
    expect(rows[0]).toMatchObject({
      label: "Проверка входа",
      value: "поддерживается",
      tone: "supported",
      confidenceLabel: "подтверждено"
    });
  });

  it("shows Antigravity quota as local/inferred and session transfer as unsupported", () => {
    const rows = buildProviderCapabilityRows(getProviderAdapterMetadata("antigravity"));
    const quota = rows.find((row) => row.id === "getQuotaState");
    const transfer = rows.find((row) => row.id === "sessionTransfer");

    expect(quota).toMatchObject({
      value: "поддерживается",
      tone: "limited",
      confidenceLabel: "выведено",
      sourceLabel: "локальное состояние"
    });
    expect(transfer).toMatchObject({
      value: "не поддерживается",
      tone: "unsupported"
    });
    expect(transfer?.reason.toLowerCase()).toContain("официально переносимый формат сессии не подтверждён");
  });

  it("maps support and capability tone consistently", () => {
    expect(providerSupportLabel(true)).toBe("поддерживается");
    expect(providerSupportLabel(false)).toBe("не поддерживается");
    expect(providerCapabilityTone({ supported: true, confidence: "confirmed", source: "official_docs" })).toBe("supported");
    expect(providerCapabilityTone({ supported: true, confidence: "inferred", source: "local_status" })).toBe("limited");
    expect(providerCapabilityTone({ supported: false, confidence: "unknown", source: "unknown" })).toBe("unknown");
  });
});
