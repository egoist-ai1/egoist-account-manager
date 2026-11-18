import { maskEmailForPrivacy, maskSensitiveDisplayText } from "./privacyDisplay.js";

export interface TrayAccountLabelInput {
  label: string;
  email: string;
  isActive: boolean;
}

export function buildTrayAccountLabel(account: TrayAccountLabelInput, privacyMode: boolean, language: "ru" | "en" = "ru"): string {
  const prefix = account.isActive ? (language === "en" ? "[Selected] " : "[Выбран] ") : "";
  const email = privacyMode ? maskEmailForPrivacy(account.email) : account.email;
  const label = privacyMode ? maskSensitiveDisplayText(account.label) : account.label;
  return `${prefix}${label} · ${email}`;
}
