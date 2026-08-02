import { maskAccountIdentifier, redactSensitiveText } from "./redaction.js";

const accountIdKeyPattern = /^(id|accountId|previousAccountId|incomingId|existingId)$/i;
const accountIdValuePattern = /\b(acc_[a-z0-9._:-]{8,}|ag_[a-z0-9._:-]{8,})\b/gi;

function redactDiagnosticValue(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (accountIdKeyPattern.test(key)) return maskAccountIdentifier(value);
    return redactSensitiveText(value).replace(accountIdValuePattern, (match) => maskAccountIdentifier(match));
  }
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue("", item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactDiagnosticValue(childKey, childValue)]));
  }
  return value;
}

export function redactDiagnosticReport<T>(report: T): T {
  return redactDiagnosticValue("", report) as T;
}
