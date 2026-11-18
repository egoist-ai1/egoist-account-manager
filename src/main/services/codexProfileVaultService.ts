import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ManagedAccount } from "../../shared/types.js";
import type { AccountStore } from "../db.js";
import { getAuthFilePath } from "../codexRpc.js";
import { assertManagedPath, getProfilesDir } from "../paths.js";
import type { Vault } from "../security.js";

export interface CodexAuthMaterialMetadata {
  providerAccountId: string | null;
  workspaceAccountId: string | null;
  workspaceLabel: string | null;
  email: string | null;
  inferredAuthMode: "chatgpt" | "apiKey" | null;
  authFingerprint: string;
  expiresAt: number | null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function decodeJwtClaims(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeJwtExpiry(value: unknown): number | null {
  const payload = decodeJwtClaims(value);
  return typeof payload?.exp === "number" && Number.isFinite(payload.exp) ? Math.floor(payload.exp) : null;
}

export function inspectCodexAuthJson(authJson: string): CodexAuthMaterialMetadata {
  const authFingerprint = crypto.createHash("sha256").update(authJson).digest("hex");
  const parsed = JSON.parse(authJson) as {
    account_id?: unknown;
    OPENAI_API_KEY?: unknown;
    tokens?: {
      access_token?: unknown;
      id_token?: unknown;
      account_id?: unknown;
      chatgpt_account_id?: unknown;
      organization_id?: unknown;
      organization_name?: unknown;
    };
  };
  const providerAccountId = [
    parsed.tokens?.account_id,
    parsed.tokens?.chatgpt_account_id,
    parsed.account_id
  ].map(normalizeString).find((value) => value !== null) ?? null;
  const expiries = [
    decodeJwtExpiry(parsed.tokens?.access_token),
    decodeJwtExpiry(parsed.tokens?.id_token)
  ].filter((value): value is number => value !== null);
  const idTokenClaims = decodeJwtClaims(parsed.tokens?.id_token);
  const email = normalizeString(idTokenClaims?.email);
  const inferredAuthMode = normalizeString(parsed.OPENAI_API_KEY)
    ? "apiKey"
    : normalizeString(parsed.tokens?.access_token) || normalizeString(parsed.tokens?.id_token)
      ? "chatgpt"
      : null;
  return {
    providerAccountId,
    workspaceAccountId: normalizeString(parsed.tokens?.organization_id),
    workspaceLabel: normalizeString(parsed.tokens?.organization_name),
    email,
    inferredAuthMode,
    authFingerprint,
    expiresAt: expiries.length > 0 ? Math.max(...expiries) : null
  };
}

function readStableAuthFile(filePath: string): string {
  const firstInfo = fs.statSync(filePath);
  const first = fs.readFileSync(filePath);
  const secondInfo = fs.statSync(filePath);
  const second = fs.readFileSync(filePath);
  try {
    if (firstInfo.size !== secondInfo.size || firstInfo.mtimeMs !== secondInfo.mtimeMs || !first.equals(second)) {
      throw new Error("Codex auth cache changed during vault capture");
    }
    return second.toString("utf8");
  } finally {
    first.fill(0);
    second.fill(0);
  }
}

export class CodexProfileVaultService {
  private readonly profilesDir: string;

  constructor(
    appDataDir: string,
    private readonly store: AccountStore,
    private readonly vault: Vault
  ) {
    this.profilesDir = getProfilesDir(appDataDir);
  }

  hydrate(account: ManagedAccount & { encryptedAuthJson: string }): void {
    this.assertManagedProfile(account.profileDir);
    const authPath = assertManagedPath(this.profilesDir, getAuthFilePath(account.profileDir));
    if (fs.existsSync(authPath)) {
      const plaintext = readStableAuthFile(authPath);
      const plaintextMetadata = inspectCodexAuthJson(plaintext);
      const vaulted = this.vault.decryptUtf8(account.encryptedAuthJson);
      const vaultedMetadata = inspectCodexAuthJson(vaulted);
      if (plaintextMetadata.authFingerprint !== vaultedMetadata.authFingerprint) {
        this.captureDrift(account, plaintext, plaintextMetadata.authFingerprint);
        this.removePlaintext(account.profileDir);
        throw new Error("Managed Codex profile credentials changed outside Egoist Account Manager");
      }
      return;
    }
    fs.mkdirSync(account.profileDir, { recursive: true });
    this.atomicWrite(authPath, this.vault.decryptUtf8(account.encryptedAuthJson));
  }

  sealVerified(account: ManagedAccount & { encryptedAuthJson: string }, options: { identityVerified?: boolean } = {}): ManagedAccount {
    this.assertManagedProfile(account.profileDir);
    const authPath = assertManagedPath(this.profilesDir, getAuthFilePath(account.profileDir));
    if (!fs.existsSync(authPath)) return account;
    const authJson = readStableAuthFile(authPath);
    const metadata = inspectCodexAuthJson(authJson);
    const vaultedMetadata = inspectCodexAuthJson(this.vault.decryptUtf8(account.encryptedAuthJson));
    let saved: ManagedAccount = account;
    if (metadata.authFingerprint !== vaultedMetadata.authFingerprint || account.authFingerprint !== metadata.authFingerprint) {
      saved = this.store.updateCodexAuthMaterial(account.id, {
        encryptedAuthJson: this.vault.encryptUtf8(authJson),
        authFingerprint: metadata.authFingerprint,
        providerAccountId: metadata.providerAccountId,
        workspaceAccountId: metadata.workspaceAccountId,
        workspaceLabel: metadata.workspaceLabel,
        expiresAt: metadata.expiresAt,
        credentialState: options.identityVerified ? "ready" : "needs_review",
        lastAuthenticatedAt: options.identityVerified ? Math.floor(Date.now() / 1000) : null
      });
    }
    this.removePlaintext(account.profileDir);
    return saved;
  }

  secureExistingProfiles(): { sealed: number; drifted: number } {
    let sealed = 0;
    let drifted = 0;
    for (const account of this.store.listForExport()) {
      if (account.platform !== "codex" || !this.isManagedProfile(account.profileDir)) continue;
      const authPath = assertManagedPath(this.profilesDir, getAuthFilePath(account.profileDir));
      if (!fs.existsSync(authPath)) continue;
      const plaintext = readStableAuthFile(authPath);
      try {
        const plaintextMetadata = inspectCodexAuthJson(plaintext);
        const vaultedMetadata = inspectCodexAuthJson(this.vault.decryptUtf8(account.encryptedAuthJson));
        if (plaintextMetadata.authFingerprint === vaultedMetadata.authFingerprint) {
          this.removePlaintext(account.profileDir);
          sealed += 1;
          continue;
        }
        this.captureDrift(account, plaintext, plaintextMetadata.authFingerprint);
        this.removePlaintext(account.profileDir);
        drifted += 1;
      } catch {
        this.captureDrift(
          account,
          plaintext,
          crypto.createHash("sha256").update(plaintext).digest("hex")
        );
        this.removePlaintext(account.profileDir);
        drifted += 1;
      }
    }
    return { sealed, drifted };
  }

  removePlaintext(profileDir: string): void {
    this.assertManagedProfile(profileDir);
    const authPath = assertManagedPath(this.profilesDir, getAuthFilePath(profileDir));
    fs.rmSync(authPath, { force: true });
    if (!fs.existsSync(profileDir)) return;
    const prefix = `${path.basename(authPath)}.cam-backup-`;
    for (const entry of fs.readdirSync(profileDir, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.startsWith(prefix) || entry.name.startsWith(`${path.basename(authPath)}.`) && entry.name.endsWith(".tmp"))) {
        fs.rmSync(assertManagedPath(this.profilesDir, path.join(profileDir, entry.name)), { force: true });
      }
    }
  }

  isManagedProfile(profileDir: string): boolean {
    try {
      const checked = assertManagedPath(this.profilesDir, profileDir);
      return path.dirname(checked) === path.resolve(this.profilesDir);
    } catch {
      return false;
    }
  }

  private captureDrift(
    account: { id: string },
    authJson: string,
    fingerprint: string
  ): void {
    this.store.storeAuthDriftCandidate({
      accountId: account.id,
      encryptedAuthJson: this.vault.encryptUtf8(authJson),
      fingerprint
    });
  }

  private assertManagedProfile(profileDir: string): void {
    if (!this.isManagedProfile(profileDir)) {
      throw new Error("Refusing to manage auth material outside the application profiles directory");
    }
  }

  private atomicWrite(filePath: string, data: string): void {
    assertManagedPath(this.profilesDir, filePath);
    const tempPath = assertManagedPath(this.profilesDir, `${filePath}.${process.pid}.${Date.now()}.tmp`);
    try {
      fs.writeFileSync(tempPath, data, { encoding: "utf8", mode: 0o600, flag: "wx" });
      assertManagedPath(this.profilesDir, filePath);
      fs.renameSync(tempPath, filePath);
    } finally {
      fs.rmSync(assertManagedPath(this.profilesDir, tempPath), { force: true });
    }
  }
}
