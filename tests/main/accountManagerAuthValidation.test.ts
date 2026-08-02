import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountManager } from "../../src/main/accountManager";
import { AccountStore } from "../../src/main/db";
import { Vault } from "../../src/main/security";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-auth-validation-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("AccountManager auth validation", () => {
  it("returns needs_reauth for Antigravity accounts when the local IDE profile is missing", async () => {
    const appDir = tempDir();
    const store = new AccountStore(appDir);
    try {
      const vault = new Vault(appDir);
      const fakeHome = tempDir();
      const missingProfileDir = path.join(fakeHome, "AppData", "Roaming", "missing-antigravity-profile");
      const account = store.upsert({
        id: "ag-auth",
        platform: "antigravity",
        label: "AG",
        email: "ag@example.com",
        planType: "unknown",
        profileDir: missingProfileDir,
        encryptedAuthJson: vault.encryptUtf8(JSON.stringify({ refreshToken: "refresh-secret-token-value" })),
        antigravity: {
          googleProjectId: null,
          fingerprintId: null,
          lastQuotaRefreshAt: null,
          forbidden: false,
          ideStateDetected: false
        }
      });
      const manager = new AccountManager(store, vault, appDir, "codex");

      await expect(manager.validateAuth(account.id)).resolves.toMatchObject({
        state: "needs_reauth",
        errorReason: "Antigravity local profile was not detected."
      });
    } finally {
      store.close();
    }
  });
});
