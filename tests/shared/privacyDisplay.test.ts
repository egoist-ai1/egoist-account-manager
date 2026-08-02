import { describe, expect, it } from "vitest";

import { maskEmailForPrivacy, maskPathForPrivacy, maskSensitiveDisplayText } from "../../src/shared/privacyDisplay";

describe("privacy display helpers", () => {
  it("masks account emails while preserving enough context for recognition", () => {
    expect(maskEmailForPrivacy("primary@example.com")).toBe("pr*****@example.com");
    expect(maskEmailForPrivacy("a@example.com")).toBe("a***@example.com");
  });

  it("masks local paths and keeps empty labels explicit", () => {
    expect(maskPathForPrivacy("C:\\Users\\EGOIST\\.codex")).toBe("путь скрыт");
    expect(maskPathForPrivacy(null)).toBe("не выбран");
    expect(maskPathForPrivacy(undefined, "нет данных")).toBe("нет данных");
  });

  it("redacts token-like values from display text", () => {
    const value = maskSensitiveDisplayText("Authorization: Bearer sk-proj-secret-token-value");

    expect(value).toContain("[скрыто]");
    expect(value).not.toContain("sk-proj-secret-token-value");
  });
});
