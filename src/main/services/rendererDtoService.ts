/** Only public account fields may cross the isolated renderer boundary. */
const accountFields = new Set([
  "id", "platform", "label", "email", "authMode", "providerAccountId", "workspaceAccountId",
  "workspaceLabel", "authFingerprint", "credentialState", "lastAuthenticatedAt", "expiresAt", "version",
  "planType", "profileDir", "isActive", "createdAt", "updatedAt", "lastUsedAt", "lastRefreshAt",
  "lastRefreshErrorAt", "lastRefreshError", "subscriptionEndsAt", "status", "statusReason",
  "primaryUsedPercent", "primaryResetsAt", "primaryWindowDurationMins", "secondaryUsedPercent",
  "secondaryResetsAt", "secondaryWindowDurationMins", "fiveHourUsedPercent", "fiveHourResetsAt",
  "weeklyUsedPercent", "weeklyResetsAt", "notes", "tags", "favorite", "archived", "quotaSnapshot",
  "runtimeVerification", "antigravity"
]);

const secretFields = new Set([
  "encryptedauthjson", "authjson", "accesstoken", "refreshtoken", "idtoken", "apikey",
  "clientsecret", "secret", "password", "passphrase", "credentialpayload", "tokens", "token"
]);

function publicValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new Error("Cyclic renderer DTO");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => publicValue(item, seen));
    const source = value as Record<string, unknown>;
    const isAccount = typeof source.id === "string" && typeof source.email === "string"
      && typeof source.credentialState === "string" && typeof source.profileDir === "string";
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if (isAccount && !accountFields.has(key)) continue;
      if (secretFields.has(key.replace(/[_-]/g, "").toLowerCase())) continue;
      // Switching evidence uses a non-secret enum named credentials.
      if (key === "credentials" && typeof item !== "string") continue;
      result[key] = publicValue(item, seen);
    }
    return result;
  } finally { seen.delete(value); }
}

export function toRendererDto<T>(value: T): T {
  return publicValue(value, new WeakSet()) as T;
}
