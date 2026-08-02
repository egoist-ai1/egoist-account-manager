import { maskEmailForPrivacy } from "./privacyDisplay.js";

export interface TrayAccountLabelInput {
  label: string;
  email: string;
  isActive: boolean;
}

export function buildTrayAccountLabel(account: TrayAccountLabelInput, privacyMode: boolean): string {
  const prefix = account.isActive ? "✓ " : "";
  const email = privacyMode ? maskEmailForPrivacy(account.email) : account.email;
  return `${prefix}${account.label} · ${email}`;
}
