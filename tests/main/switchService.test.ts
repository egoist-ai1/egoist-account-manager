import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SwitchService, type SwitchEventRecord } from "../../src/main/services/switchService";

const dirs: string[] = [];
const sealBackup = (contents: string) => Buffer.from(contents, "utf8").toString("base64");
const unsealBackup = (ciphertext: string) => Buffer.from(ciphertext, "base64").toString("utf8");

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-switch-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("SwitchService", () => {
  it("backs up current auth, writes target auth atomically, and can rollback", async () => {
    const codexHome = tempDir();
    const authPath = path.join(codexHome, "auth.json");
    fs.writeFileSync(authPath, JSON.stringify({ account_id: "old" }), "utf8");

    const calls: string[] = [];
    const records: SwitchEventRecord[] = [];
    const service = new SwitchService({
      codexHome,
      sealBackup,
      unsealBackup,
      stableCheckIntervalMs: 0,
      afterWrite: async () => {
        calls.push("afterWrite");
        expect(JSON.parse(fs.readFileSync(authPath, "utf8")).account_id).toBe("new");
      },
      recordEvent: async (event) => {
        records.push(event);
      }
    });

    const result = await service.switchTo({
      accountId: "new",
      previousAccountId: "old",
      authJson: JSON.stringify({ account_id: "new" })
    });

    expect(JSON.parse(fs.readFileSync(authPath, "utf8")).account_id).toBe("new");
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(calls).toEqual(["afterWrite"]);
    expect(records).toMatchObject([
      { accountId: "new", previousAccountId: "old", status: "started", completedAt: null },
      { accountId: "new", previousAccountId: "old", status: "completed", error: null }
    ]);

    await service.rollback(result.backupPath);
    expect(JSON.parse(fs.readFileSync(authPath, "utf8")).account_id).toBe("old");
  });

  it("validates nested auth account id separately from local profile id", async () => {
    const codexHome = tempDir();
    const authPath = path.join(codexHome, "auth.json");
    fs.writeFileSync(authPath, JSON.stringify({ tokens: { account_id: "old-openai-account" } }), "utf8");

    const service = new SwitchService({
      codexHome,
      sealBackup,
      unsealBackup,
      stableCheckIntervalMs: 0,
      afterWrite: async () => undefined,
      recordEvent: async () => undefined
    });

    await service.switchTo({
      accountId: "local-profile-id",
      previousAccountId: "old-openai-account",
      expectedAuthAccountId: "new-openai-account",
      authJson: JSON.stringify({ tokens: { account_id: "new-openai-account" } })
    });

    expect(JSON.parse(fs.readFileSync(authPath, "utf8")).tokens.account_id).toBe("new-openai-account");
  });

  it("records a failed switch when target auth does not match expected account", async () => {
    const codexHome = tempDir();
    const authPath = path.join(codexHome, "auth.json");
    fs.writeFileSync(authPath, JSON.stringify({ account_id: "old" }), "utf8");

    const calls: string[] = [];
    const records: SwitchEventRecord[] = [];
    const service = new SwitchService({
      codexHome,
      sealBackup,
      unsealBackup,
      stableCheckIntervalMs: 0,
      afterWrite: async () => {
        calls.push("afterWrite");
      },
      recordEvent: async (event) => {
        records.push(event);
      }
    });

    await expect(
      service.switchTo({
        accountId: "local-profile-id",
        previousAccountId: "old",
        expectedAuthAccountId: "expected",
        authJson: JSON.stringify({ account_id: "different" })
      })
    ).rejects.toMatchObject({ code: "AUTH_INVALID" });

    expect(JSON.parse(fs.readFileSync(authPath, "utf8")).account_id).toBe("old");
    expect(calls).toEqual([]);
    expect(records).toMatchObject([
      { accountId: "local-profile-id", status: "started", completedAt: null },
      { accountId: "local-profile-id", status: "failed", error: "Файл авторизации поврежден или не подходит для этого аккаунта." }
    ]);
  });
});
