import { describe, expect, it } from "vitest";
import type { CommandPaletteCommand } from "../../src/shared/commandPalette";
import { firstAvailableCommand } from "../../src/renderer/components/CommandPalette";

const command: CommandPaletteCommand = { id: "refresh", group: "Лимиты", title: "Refresh", subtitle: "", keywords: [], action: "refreshAll" };

describe("command palette keyboard activation", () => {
  it("matches the disabled control while a request is in progress", () => {
    expect(firstAvailableCommand([command], "refresh:all")).toBeUndefined();
    expect(firstAvailableCommand([command], null)).toBe(command);
  });
  it("skips unavailable commands and cannot activate an entirely disabled result", () => {
    expect(firstAvailableCommand([{ ...command, disabled: true }, command], null)).toBe(command);
    expect(firstAvailableCommand([{ ...command, disabled: true }], null)).toBeUndefined();
  });
});
