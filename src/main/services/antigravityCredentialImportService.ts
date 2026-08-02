import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { AntigravityCredentialImportSource } from "../../shared/types.js";
import { readAntigravityCredentialStorePayload } from "./antigravityCredentialStore.js";
import { parseAntigravityUnifiedOAuthToken } from "./antigravityUnifiedState.js";

export interface ParsedAntigravityCredential {
  label?: string | null;
  email?: string | null;
  accountId?: string | null;
  refreshToken: string;
  accessToken?: string | null;
  expiresAt?: number | null;
  googleProjectId?: string | null;
  fingerprintId?: string | null;
  machineId?: string | null;
  source: string;
}

export interface AntigravityImportPayload {
  source: string;
  payload: string;
}

export interface AntigravityExternalSourceInput {
  source: Exclude<AntigravityCredentialImportSource, "token_json" | "local_files">;
  platform?: NodeJS.Platform;
  home?: string;
  appData?: string;
  localAppData?: string;
}

const refreshTokenKeys = ["refreshToken", "refresh_token", "refresh-token"];
const accessTokenKeys = ["accessToken", "access_token", "access-token"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenLikePattern = /^[A-Za-z0-9._~+/=-]{20,}$/;

function shaId(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringAt(object: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanString(object[key]);
    if (value) return value;
  }
  return null;
}

function numberAt(object: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return Math.floor(numeric);
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
    }
  }
  return null;
}

function normalizeEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return emailPattern.test(email) ? email : null;
}

function filenameEmail(fileName?: string | null): string | null {
  if (!fileName) return null;
  const stem = path.basename(fileName, path.extname(fileName)).replace(/_at_/gi, "@");
  return normalizeEmail(stem);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nestedRecord(object: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const record = asRecord(object[key]);
    if (record) return record;
  }
  return null;
}

function credentialFromObject(
  object: Record<string, unknown>,
  source: string,
  fallback?: { email?: string | null; label?: string | null; fileName?: string | null }
): ParsedAntigravityCredential | null {
  const tokenRecord = nestedRecord(object, ["token", "tokens", "googleOAuth", "credentials", "oauth", "auth"]) ?? object;
  const refreshToken = stringAt(tokenRecord, refreshTokenKeys) ?? stringAt(object, refreshTokenKeys);
  if (!refreshToken || !tokenLikePattern.test(refreshToken)) return null;

  const email = normalizeEmail(
    stringAt(object, ["email", "accountEmail", "userEmail", "mail"])
      ?? stringAt(tokenRecord, ["email", "accountEmail", "userEmail", "mail"])
      ?? fallback?.email
      ?? filenameEmail(fallback?.fileName)
  );
  const label = stringAt(object, ["label", "name", "displayName", "title"]) ?? fallback?.label ?? email?.split("@")[0] ?? null;
  const accountId = stringAt(object, ["accountId", "account_id", "id", "sub", "userId"])
    ?? stringAt(tokenRecord, ["accountId", "account_id", "id", "sub", "userId"])
    ?? (email ? `google-oauth:${email}` : `refresh:${shaId(refreshToken)}`);

  return {
    label,
    email,
    accountId,
    refreshToken,
    accessToken: stringAt(tokenRecord, accessTokenKeys) ?? stringAt(object, accessTokenKeys),
    expiresAt: numberAt(tokenRecord, ["expiresAt", "expires_at", "expiry_timestamp", "expiryTimestamp", "expiry"])
      ?? numberAt(object, ["expiresAt", "expires_at", "expiry_timestamp", "expiryTimestamp", "expiry"]),
    googleProjectId: stringAt(object, ["googleProjectId", "google_project_id", "projectId", "project_id"])
      ?? stringAt(tokenRecord, ["googleProjectId", "google_project_id", "projectId", "project_id"]),
    fingerprintId: stringAt(object, ["fingerprintId", "fingerprint_id", "fingerprint"]),
    machineId: stringAt(object, ["machineId", "machine_id", "serviceMachineId"]),
    source
  };
}

function collectCredentialObjects(value: unknown, source: string, output: ParsedAntigravityCredential[], context: { email?: string | null; fileName?: string | null } = {}, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;

  if (typeof value === "string") {
    const token = value.trim();
    if (tokenLikePattern.test(token)) {
      output.push({
        accountId: `refresh:${shaId(token)}`,
        refreshToken: token,
        email: context.email ?? filenameEmail(context.fileName),
        source
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectCredentialObjects(item, source, output, context, depth + 1);
    return;
  }

  const object = asRecord(value);
  if (!object) return;

  const direct = credentialFromObject(object, source, { email: context.email, fileName: context.fileName });
  if (direct) output.push(direct);

  const accounts = object.accounts;
  if (Array.isArray(accounts)) {
    for (const account of accounts) collectCredentialObjects(account, source, output, context, depth + 1);
  } else {
    const accountMap = asRecord(accounts);
    if (accountMap) {
      for (const [key, account] of Object.entries(accountMap)) {
        collectCredentialObjects(account, source, output, { email: normalizeEmail(key) ?? context.email, fileName: context.fileName }, depth + 1);
      }
    }
  }

  const state = asRecord(object.state);
  if (state && state !== object) collectCredentialObjects(state, source, output, context, depth + 1);

  for (const key of ["items", "profiles", "entries", "data", "account", "credential", "credentials"]) {
    if (key in object && object[key] !== accounts && object[key] !== state) {
      collectCredentialObjects(object[key], source, output, context, depth + 1);
    }
  }
}

function uniqueCredentials(credentials: ParsedAntigravityCredential[]): ParsedAntigravityCredential[] {
  const seen = new Set<string>();
  const result: ParsedAntigravityCredential[] = [];
  for (const credential of credentials) {
    const key = credential.email ? `email:${credential.email}` : `token:${shaId(credential.refreshToken)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(credential);
  }
  return result;
}

export function parseAntigravityCredentialPayload(input: {
  payload: string;
  source?: string;
  fileName?: string | null;
}): ParsedAntigravityCredential[] {
  const source = input.source ?? input.fileName ?? "manual";
  const text = input.payload.trim();
  if (!text) return [];

  const credentials: ParsedAntigravityCredential[] = [];
  try {
    collectCredentialObjects(JSON.parse(text), source, credentials, { fileName: input.fileName });
  } catch {
    collectCredentialObjects(text, source, credentials, { fileName: input.fileName });
  }

  return uniqueCredentials(credentials);
}

function safeReadText(filePath: string, maxBytes = 2_000_000): string | null {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > maxBytes) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function addJsonFiles(root: string, output: AntigravityImportPayload[], source: string): void {
  if (!fs.existsSync(root)) return;
  const visit = (dir: string, depth: number): void => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.json$/i.test(entry.name)) continue;
      const payload = safeReadText(fullPath);
      if (payload) output.push({ source: `${source}:${fullPath}`, payload });
    }
  };
  visit(root, 0);
}

function readStateDbRows(filePath: string, keyPattern: RegExp): AntigravityImportPayload[] {
  if (!fs.existsSync(filePath)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ItemTable'").get() as { name: string } | undefined;
    if (!table) return [];
    const rows = db.prepare("SELECT key, value FROM ItemTable").all() as Array<{ key: string; value: string | Buffer | null }>;
    return rows
      .filter((row) => keyPattern.test(row.key))
      .flatMap((row) => {
        if (!row.value) return [];
        const payload = typeof row.value === "string" ? row.value : row.value.toString("utf8");
        if (row.key === "antigravityUnifiedStateSync.oauthToken") {
          try {
            const oauth = parseAntigravityUnifiedOAuthToken(payload);
            if (oauth?.refreshToken) {
              return [{
                source: `${path.basename(filePath)}:${row.key}`,
                payload: JSON.stringify({
                  token: {
                    access_token: oauth.accessToken,
                    refresh_token: oauth.refreshToken,
                    expiry_timestamp: oauth.expiresAt
                  }
                })
              }];
            }
          } catch {
            // Fall back to raw row payload so other import formats can still be tried.
          }
        }
        return [{ source: `${path.basename(filePath)}:${row.key}`, payload }];
      });
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function extractJsonFragments(text: string): string[] {
  const fragments: string[] = [];
  const tokenIndex = Math.max(text.indexOf("refreshToken"), text.indexOf("refresh_token"));
  if (tokenIndex < 0) return fragments;
  for (let index = tokenIndex; index >= 0; index -= 1) {
    const char = text[index];
    if (char !== "{" && char !== "[") continue;
    const close = char === "{" ? "}" : "]";
    let depth = 0;
    for (let end = index; end < Math.min(text.length, index + 200_000); end += 1) {
      if (text[end] === char) depth += 1;
      if (text[end] === close) depth -= 1;
      if (depth === 0) {
        fragments.push(text.slice(index, end + 1));
        return fragments;
      }
    }
  }
  return fragments;
}

function addLevelDbFragments(levelDbDir: string, output: AntigravityImportPayload[], source: string): void {
  if (!fs.existsSync(levelDbDir)) return;
  let files: string[];
  try {
    files = fs.readdirSync(levelDbDir)
      .filter((name) => /\.(log|ldb)$/i.test(name))
      .map((name) => path.join(levelDbDir, name));
  } catch {
    return;
  }
  for (const filePath of files) {
    let text: string;
    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile() || stats.size <= 0 || stats.size > 16_000_000) continue;
      text = fs.readFileSync(filePath).toString("utf8");
    } catch {
      continue;
    }
    for (const fragment of extractJsonFragments(text)) {
      output.push({ source: `${source}:${path.basename(filePath)}`, payload: fragment });
    }
  }
}

function windowsAppData(home: string, appData?: string | null): string {
  return appData ?? path.join(home, "AppData", "Roaming");
}

function windowsLocalAppData(home: string, localAppData?: string | null): string {
  return localAppData ?? path.join(home, "AppData", "Local");
}

function sourceRoots(input: AntigravityExternalSourceInput): { home: string; appData: string; localAppData: string } {
  const home = input.home ?? os.homedir();
  return {
    home,
    appData: input.appData ?? (input.platform === "win32" || (!input.platform && process.platform === "win32")
      ? windowsAppData(home, input.appData)
      : path.join(home, ".config")),
    localAppData: input.localAppData ?? (input.platform === "win32" || (!input.platform && process.platform === "win32")
      ? windowsLocalAppData(home, input.localAppData)
      : path.join(home, ".local", "share"))
  };
}

function shouldReadUserCredentialStore(input: AntigravityExternalSourceInput, roots: { home: string }): boolean {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") return false;
  return path.resolve(roots.home).toLowerCase() === path.resolve(os.userInfo().homedir).toLowerCase();
}

export function readAntigravityExternalCredentialPayloads(input: AntigravityExternalSourceInput): AntigravityImportPayload[] {
  const roots = sourceRoots(input);
  const payloads: AntigravityImportPayload[] = [];

  if (input.source === "antigravity_tools") {
    addJsonFiles(path.join(roots.home, ".antigravity_tools"), payloads, "antigravity_tools");
    return payloads;
  }

  if (input.source === "cockpit") {
    addJsonFiles(path.join(roots.home, ".antigravity_cockpit"), payloads, "cockpit");
    addLevelDbFragments(
      path.join(roots.localAppData, "com.jlcodes.cockpit-tools", "EBWebView", "Default", "Local Storage", "leveldb"),
      payloads,
      "cockpit_webview"
    );
    return payloads;
  }

  if (input.source === "plugin") {
    const candidates = [
      path.join(roots.appData, "Code", "User", "globalStorage", "state.vscdb"),
      path.join(roots.appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      path.join(roots.appData, "Antigravity IDE", "User", "globalStorage", "state.vscdb"),
      path.join(roots.appData, "Antigravity", "User", "globalStorage", "state.vscdb")
    ];
    for (const candidate of candidates) {
      payloads.push(...readStateDbRows(candidate, /antigravity|cockpit|autoTrigger|credential/i));
    }
    return payloads;
  }

  if (input.source === "local_db") {
    const candidates = [
      path.join(roots.appData, "Antigravity IDE", "User", "globalStorage", "state.vscdb"),
      path.join(roots.appData, "Antigravity", "User", "globalStorage", "state.vscdb")
    ];
    for (const candidate of candidates) {
      payloads.push(...readStateDbRows(candidate, /antigravityUnifiedStateSync\.oauthToken|oauth|token|google/i));
    }
    if (shouldReadUserCredentialStore(input, roots)) {
      const credentialStorePayload = readAntigravityCredentialStorePayload(input.platform ?? process.platform);
      if (credentialStorePayload) {
        payloads.push({
          source: credentialStorePayload.strategy,
          payload: credentialStorePayload.payload
        });
      }
    }
  }

  return payloads;
}
