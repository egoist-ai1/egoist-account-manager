import { describe, expect, it } from "vitest";
import { displayMetadata } from "../../src/renderer/displayPrivacy";

describe("privacy for provider metadata", () => {
  it("preserves useful model and scope names and the original value outside privacy mode", () => {
    expect(displayMetadata("fixture-model-a · aggregate", true, "ru")).toBe("fixture-model-a · aggregate");
    const raw = "probe account@example.com · C:\\Users\\Alice\\Codex Home\\auth.json";
    expect(displayMetadata(raw, false, "en")).toBe(raw);
  });
  it("removes full local paths, including spaces, and email values from metadata", () => {
    const value = displayMetadata("model account@example.com · C:\\Users\\Alice\\Codex Home\\auth.json · aggregate", true, "en");
    expect(value).not.toContain("account@example.com");
    expect(value).not.toContain("Alice");
    expect(value).not.toContain("auth.json");
    expect(value).toContain("[path hidden] · aggregate");
  });
  it("hides UNC and home paths without treating official URLs as local paths", () => {
    expect(displayMetadata("probe \\\\server\\profiles\\Alice Home · scope", true, "ru")).toBe("probe [путь скрыт] · scope");
    expect(displayMetadata("probe /home/alice/codex · scope", true, "en")).toBe("probe [path hidden] · scope");
    expect(displayMetadata("https://example.com/home/docs", true, "en")).toBe("https://example.com/home/docs");
  });
});
