import { buildCommandPalette, type BuildCommandPaletteInput, type CommandPaletteCommand } from "../shared/commandPalette";
import { getAccountReadiness } from "../shared/smartSelection";
import { maskEmailForPrivacy, maskSensitiveDisplayText } from "../shared/privacyDisplay";
import type { AppSettings } from "../shared/types";
import { profilePresentation } from "./profilePresentation";

export function buildUiCommands(input: BuildCommandPaletteInput, language: AppSettings["language"], now: number): CommandPaletteCommand[] {
  const en = language === "en";
  const text: Record<string, [string, string]> = {
    "nav.overview": ["Open overview", "Selected profiles, quotas and evidence"], "nav.accounts": ["Open profiles", "Table, cards and profile details"], "nav.activity": ["Open journal", "Switch transactions and recovery"], "nav.settings": ["Open settings", "Application behavior and workspace"],
    "account.login": ["Add Codex profile", "Official browser sign-in or device code"], "account.login.antigravity": ["Add Antigravity profile", "Official Google sign-in or local import"], "accounts.refreshAll": ["Refresh all quotas", "Request a fresh observation"], "account.switchBest": ["Switch to recommended profile", input.smartRecommendation ? "A fresh matching quota snapshot is available" : "No fresh recommendation"],
    "platform.filter.antigravity": ["Show Antigravity profiles", "Filter profiles by Antigravity"], "platform.filter.codex": ["Show Codex profiles", "Filter profiles by Codex"], "diagnostics.antigravity": ["Antigravity diagnostics", "Open Antigravity profiles and their details"], "accounts.export": ["Export profiles", "Create an encrypted .cam-export"], "diagnostics.logs": ["Open diagnostic log", "Recent application events"], "diagnostics.export": ["Save diagnostic report", "Export a safe local report"]
  };
  const commands = buildCommandPalette(input).filter((command) => command.action !== "switchAccount").map((command) => {
    const translated = text[command.id];
    return { ...command, title: en && translated ? translated[0] : command.id === "nav.accounts" ? "Открыть профили" : command.id === "nav.activity" ? "Открыть журнал" : command.title, subtitle: en && translated ? translated[1] : input.privacyMode ? maskSensitiveDisplayText(command.subtitle) : command.subtitle };
  });
  for (const account of input.accounts.filter((item) => !item.archived && (!item.isActive || item.runtimeVerification?.runtime !== "verified")).slice(0, 12)) {
    const label = input.privacyMode ? maskSensitiveDisplayText(account.label) : account.label;
    const email = input.privacyMode ? maskEmailForPrivacy(account.email) : account.email;
    const view = profilePresentation(account, now, language);
    commands.push({ id: `account.switch.${account.id}`, group: "Аккаунты", title: `${en ? "Switch" : "Переключить"}: ${label}`, subtitle: `${email} · ${en ? "remaining" : "остаток"} ${view.formatRemaining(view.remainingPercent)}`, keywords: [label, email, "switch", "переключить"], action: "switchAccount", accountId: account.id, disabled: !getAccountReadiness(account, { now }).canSwitchManually });
  }
  return commands;
}
