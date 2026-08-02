export const knownAuthStates = [
  "unknown",
  "authorized",
  "expired",
  "revoked",
  "needs_reauth",
  "validation_failed"
] as const;

export type AuthState = (typeof knownAuthStates)[number];

const labels: Record<AuthState, string> = {
  unknown: "неизвестно",
  authorized: "авторизован",
  expired: "истёк срок",
  revoked: "отозван",
  needs_reauth: "нужен вход",
  validation_failed: "проверка не удалась"
};

export interface AuthValidationState {
  state: AuthState;
  lastValidatedAt: number | null;
  errorReason: string | null;
}

export function isAuthState(value: unknown): value is AuthState {
  return typeof value === "string" && (knownAuthStates as readonly string[]).includes(value);
}

export function authStateLabel(state: AuthState): string {
  return labels[state];
}

export function classifyAuthValidationError(error: unknown): Exclude<AuthState, "unknown" | "authorized"> {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/\brevoked\b|invalid_grant|invalid refresh/.test(message)) return "revoked";
  if (/\bexpired\b|\b401\b|\b403\b|unauthorized/.test(message)) return "expired";
  if (/not authenticated|not logged into a chatgpt(?:-compatible)? account|belongs to a different chatgpt account|login required|reauth|required.*auth|sign.?in/.test(message)) return "needs_reauth";
  return "validation_failed";
}
