import crypto from "node:crypto";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { AntigravityLocalIdentity, AntigravityProfileInspection } from "../../shared/types.js";
import type { AntigravityPathInput } from "./antigravityPaths.js";
import { resolveAntigravityPaths } from "./antigravityPaths.js";
import {
  parseAntigravityUnifiedEnterprisePreferences,
  parseAntigravityUnifiedOAuthToken,
  parseAntigravityUnifiedUserStatus,
  type AntigravityUnifiedOAuthToken
} from "./antigravityUnifiedState.js";

const authKeyPattern = /auth|token|oauth|credential|session|google/i;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const googleProjectPattern = /(?:projectId|googleProjectId|project_id)["']?\s*[:=]\s*["']?([a-z0-9][a-z0-9-]{4,80})/i;
const oauthStateKey = "antigravityUnifiedStateSync.oauthToken";
const userStatusStateKey = "antigravityUnifiedStateSync.userStatus";
const enterprisePreferencesStateKey = "antigravityUnifiedStateSync.enterprisePreferences";

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not a database|file is not a database/i.test(message)) return "Файл не является SQLite базой";
  if (/no such table/i.test(message)) return "Таблица ItemTable не найдена";
  if (/permission|access/i.test(message)) return "Нет доступа к файлу";
  if (/json/i.test(message) || /unexpected/i.test(message)) return "JSON поврежден";
  return "Не удалось прочитать файл";
}

function inspectStateDb(filePath: string): AntigravityProfileInspection["stateDb"] {
  if (!fs.existsSync(filePath)) {
    return { exists: false, readable: false, itemTableFound: false, itemCount: null, authRelatedItemCount: null, error: null };
  }
  let db: Database.Database | null = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ItemTable'").get() as { name: string } | undefined;
    if (!table) {
      return { exists: true, readable: true, itemTableFound: false, itemCount: null, authRelatedItemCount: null, error: null };
    }
    const itemCount = (db.prepare("SELECT count(*) AS count FROM ItemTable").get() as { count: number }).count;
    const rows = db.prepare("SELECT key FROM ItemTable").all() as Array<{ key: string }>;
    return {
      exists: true,
      readable: true,
      itemTableFound: true,
      itemCount,
      authRelatedItemCount: rows.filter((row) => authKeyPattern.test(row.key)).length,
      error: null
    };
  } catch (error) {
    return { exists: true, readable: false, itemTableFound: false, itemCount: null, authRelatedItemCount: null, error: safeError(error) };
  } finally {
    db?.close();
  }
}

function inspectStorageJson(filePath: string): AntigravityProfileInspection["storageJson"] {
  if (!fs.existsSync(filePath)) {
    return { exists: false, readable: false, validJson: false, topLevelKeyCount: null, authRelatedKeyCount: null, error: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [];
    return {
      exists: true,
      readable: true,
      validJson: true,
      topLevelKeyCount: keys.length,
      authRelatedKeyCount: keys.filter((key) => authKeyPattern.test(key)).length,
      error: null
    };
  } catch (error) {
    return { exists: true, readable: false, validJson: false, topLevelKeyCount: null, authRelatedKeyCount: null, error: safeError(error) };
  }
}

function inspectMachineId(filePath: string): AntigravityProfileInspection["machineId"] {
  if (!fs.existsSync(filePath)) {
    return { exists: false, readable: false, hashPrefix: null, error: null };
  }
  try {
    const value = fs.readFileSync(filePath);
    return {
      exists: true,
      readable: true,
      hashPrefix: crypto.createHash("sha256").update(value).digest("hex").slice(0, 12),
      error: null
    };
  } catch (error) {
    return { exists: true, readable: false, hashPrefix: null, error: safeError(error) };
  }
}

export function inspectAntigravityProfile(input: AntigravityPathInput = {}): AntigravityProfileInspection {
  const paths = resolveAntigravityPaths(input);
  return {
    inspectedAt: Math.floor(Date.now() / 1000),
    stateDb: inspectStateDb(paths.stateDbPath),
    storageJson: inspectStorageJson(paths.storageJsonPath),
    machineId: inspectMachineId(paths.machineIdPath)
  };
}

function collectStateDbText(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ItemTable'").get() as { name: string } | undefined;
    if (!table) return [];
    const rows = db
      .prepare(
        "SELECT key, value FROM ItemTable WHERE key LIKE '%antigravity%' OR key LIKE '%auth%' OR key LIKE '%oauth%' OR key LIKE '%account%' OR key LIKE '%google%' LIMIT 80"
      )
      .all() as Array<{ key: string; value: string | Buffer | null }>;
    return rows.flatMap((row) => [row.key, typeof row.value === "string" ? row.value : row.value?.toString("utf8") ?? ""]);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function readStateDbValue(filePath: string, key: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ItemTable'").get() as { name: string } | undefined;
    if (!table) return null;
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key) as { value: string | Buffer | null } | undefined;
    if (!row?.value) return null;
    return typeof row.value === "string" ? row.value : row.value.toString("utf8");
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function collectStorageJsonText(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    const output: string[] = [];
    const visit = (value: unknown, depth: number): void => {
      if (depth > 4 || value === null || value === undefined) return;
      if (typeof value === "string") {
        output.push(value);
        return;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        output.push(String(value));
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 80)) visit(item, depth + 1);
        return;
      }
      if (typeof value === "object") {
        for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 160)) {
          output.push(key);
          visit(nested, depth + 1);
        }
      }
    };
    visit(parsed, 0);
    return output;
  } catch {
    return [];
  }
}

function firstEmail(values: string[]): string | null {
  for (const value of values) {
    const match = value.match(emailPattern)?.[0];
    if (match) return match.toLowerCase();
  }
  return null;
}

function firstGoogleProjectId(values: string[]): string | null {
  for (const value of values) {
    const match = googleProjectPattern.exec(value);
    if (match?.[1]) return match[1];
  }
  return null;
}

function displayLabel(email: string | null, fingerprintId: string): string {
  if (email) return email.split("@")[0] || email;
  return `Antigravity ${fingerprintId.slice(0, 6)}`;
}

export function extractAntigravityLocalIdentity(input: AntigravityPathInput = {}): AntigravityLocalIdentity {
  const paths = resolveAntigravityPaths(input);
  const machineBytes = fs.existsSync(paths.machineIdPath) ? fs.readFileSync(paths.machineIdPath) : Buffer.from(paths.userDataDir);
  const fingerprintId = crypto.createHash("sha256").update(machineBytes).digest("hex").slice(0, 16);
  const officialState = readAntigravityOfficialAuthState(input);
  const stateValues = collectStateDbText(paths.stateDbPath);
  const storageValues = collectStorageJsonText(paths.storageJsonPath);
  const values = [...stateValues, ...storageValues];
  const email = officialState.email ?? firstEmail(values);
  const googleProjectId = officialState.googleProjectId ?? firstGoogleProjectId(values);
  const accountId = email ? `ag_${crypto.createHash("sha256").update(email).digest("hex").slice(0, 24)}` : `ag_local_${fingerprintId}`;
  const source: AntigravityLocalIdentity["source"] = email
    ? (stateValues.some((value) => value.toLowerCase().includes(email)) ? "state_db" : "storage_json")
    : fs.existsSync(paths.machineIdPath)
      ? "machine_id"
      : "profile_path";

  return {
    email,
    accountId,
    label: displayLabel(email, fingerprintId),
    fingerprintId,
    googleProjectId,
    source,
    confidence: officialState.oauth ? "confirmed" : email ? "inferred" : "unknown"
  };
}

export interface AntigravityOfficialAuthState {
  oauth: AntigravityUnifiedOAuthToken | null;
  email: string | null;
  googleProjectId: string | null;
}

export function readAntigravityOfficialAuthState(input: AntigravityPathInput = {}): AntigravityOfficialAuthState {
  const paths = resolveAntigravityPaths(input);
  const oauthValue = readStateDbValue(paths.stateDbPath, oauthStateKey);
  const userStatusValue = readStateDbValue(paths.stateDbPath, userStatusStateKey);
  const enterprisePreferencesValue = readStateDbValue(paths.stateDbPath, enterprisePreferencesStateKey);
  const oauth = oauthValue ? safeParse(() => parseAntigravityUnifiedOAuthToken(oauthValue)) : null;
  const email = userStatusValue ? safeParse(() => parseAntigravityUnifiedUserStatus(userStatusValue).email) : null;
  const googleProjectId = enterprisePreferencesValue
    ? safeParse(() => parseAntigravityUnifiedEnterprisePreferences(enterprisePreferencesValue).googleProjectId)
    : null;
  return {
    oauth,
    email,
    googleProjectId
  };
}

function safeParse<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}
