import { maskSensitiveDisplayText } from "../shared/privacyDisplay";
import type { AppSettings } from "../shared/types";

/** Protects free-form metadata as well as the dedicated email/path fields. */
export function displayMetadata(value: string, privacyMode: boolean, language: AppSettings["language"]): string {
  if (!privacyMode) return value;
  const hiddenPath = language === "en" ? "[path hidden]" : "[путь скрыт]";
  const hide = (path: string) => hiddenPath + (path.match(/\s+$/)?.[0] ?? "");
  return maskSensitiveDisplayText(value)
    .replace(/\b[A-Z]:[\\/][^·;\r\n]*/gi, hide)
    .replace(/\\\\[^\\\r\n]+\\[^·;\r\n]*/g, hide)
    .replace(/(?<![:\w])\/(?:Users|home|mnt|tmp)\/[^·;\r\n]*/g, hide);
}
