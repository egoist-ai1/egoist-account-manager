import { describe, expect, it } from "vitest";
import { uiText } from "../../src/renderer/i18n/ru";
import { uiTextEn } from "../../src/renderer/i18n/en";

function walk(value: unknown, path: string[] = []): Array<{ path: string; text: string }> {
  if (typeof value === "string") return [{ path: path.join("."), text: value }];
  if (!value || typeof value !== "object") {
    throw new Error(`Unsupported UI text leaf at ${path.join(".") || "<root>"}`);
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new Error(`Empty UI text group at ${path.join(".") || "<root>"}`);
  }

  return entries.flatMap(([key, child]) => walk(child, [...path, key]));
}

describe("русский пользовательский интерфейс", () => {
  it("хранит все пользовательские строки в русском словаре", () => {
    const strings = walk(uiText);

    expect(strings.length).toBeGreaterThan(20);
    expect(strings).not.toContainEqual(expect.objectContaining({ text: expect.stringMatching(/^\s*$/) }));
    expect(strings.filter(({ text }) => /[А-Яа-яЁё]/.test(text)).length).toBe(strings.length);
  });

  it("отклоняет неподдерживаемые значения в словаре", () => {
    expect(() => walk({ broken: null })).toThrow("Unsupported UI text leaf");
    expect(() => walk({ broken: 1 })).toThrow("Unsupported UI text leaf");
    expect(() => walk({ broken: false })).toThrow("Unsupported UI text leaf");
    expect(() => walk({ broken: {} })).toThrow("Empty UI text group");
  });

  it("хранит английскую версию с той же структурой словаря", () => {
    const russianStrings = walk(uiText);
    const englishStrings = walk(uiTextEn);

    expect(englishStrings.map(({ path }) => path)).toEqual(russianStrings.map(({ path }) => path));
    expect(englishStrings.filter(({ text }) => /[A-Za-z]/.test(text)).length).toBe(englishStrings.length);
  });
});
