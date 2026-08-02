import { redactSensitiveText } from "./redaction.js";

export function maskEmailForPrivacy(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "email скрыт";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function maskPathForPrivacy(value: string | null | undefined, emptyLabel = "не выбран"): string {
  return value ? "путь скрыт" : emptyLabel;
}

export function maskSensitiveDisplayText(value: string): string {
  return redactSensitiveText(value);
}
