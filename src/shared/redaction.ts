const secretValue = "[скрыто]";
const accountIdValue = "[идентификатор]";

const secretPatterns: Array<{ pattern: RegExp; replace: (...parts: string[]) => string }> = [
  {
    pattern: /(bearer\s+)[a-z0-9._~+/=-]+/gi,
    replace: (_match, prefix) => `${prefix}${secretValue}`
  },
  {
    pattern: /("(?:access|refresh|id)_token"\s*:\s*")[^"]+(")/gi,
    replace: (_match, prefix, suffix) => `${prefix}${secretValue}${suffix}`
  },
  {
    pattern: /("(?:accessToken|refreshToken|idToken|apiKey|api_key|token|secret|password)"\s*:\s*")[^"]+(")/g,
    replace: (_match, prefix, suffix) => `${prefix}${secretValue}${suffix}`
  },
  {
    pattern: /((?:sk|sess|eyJ)[a-z0-9._~+/=-]{12,})/gi,
    replace: () => secretValue
  }
];

export function maskAccountIdentifier(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 8) return accountIdValue;
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "[email]";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function redactSensitiveText(value: unknown): string {
  const raw = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ""}` : String(value);
  return secretPatterns
    .reduce((text, { pattern, replace }) => text.replace(pattern, replace), raw)
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, (email) => maskEmail(email))
    .replace(/([A-Za-z]:\\Users\\)[^\\\r\n]+/g, "$1[user]")
    .replace(/\b(account[_-]?id|accountId)\s*[:=]\s*["']?[a-z0-9._:-]{8,}["']?/gi, (_match, key) => `${key}=${accountIdValue}`);
}
