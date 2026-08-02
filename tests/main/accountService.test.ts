import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountStore } from "../../src/main/db";
import { AccountService } from "../../src/main/services/accountService";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-account-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("AccountService", () => {
  it("stores tags, favorite flag and archive flag", () => {
    const store = new AccountStore(tempDir());
    const service = new AccountService(store);

    try {
      store.upsert({
        id: "acc_1",
        label: "Рабочий аккаунт",
        email: "work@example.com",
        planType: "plus",
        profileDir: "C:\\profiles\\acc_1",
        encryptedAuthJson: "encrypted"
      });

      service.updateMetadata("acc_1", { tags: ["work", "backup"], favorite: true, archived: false });
      expect(service.getMetadata("acc_1")).toEqual({ tags: ["backup", "work"], favorite: true, archived: false });
      expect(store.get("acc_1")).toMatchObject({ tags: ["backup", "work"], favorite: true, archived: false });
    } finally {
      store.close();
    }
  });

  it("returns recent limit history in chronological order", () => {
    const store = new AccountStore(tempDir());

    try {
      store.upsert({
        id: "acc_1",
        label: "Рабочий аккаунт",
        email: "work@example.com",
        planType: "plus",
        profileDir: "C:\\profiles\\acc_1",
        encryptedAuthJson: "encrypted"
      });
      store.insertRateLimitSnapshot({
        id: "snap_2",
        accountId: "acc_1",
        capturedAt: 200,
        status: "active",
        statusReason: null,
        limits: {
          limitId: null,
          limitName: null,
          primary: { usedPercent: 40, resetsAt: null, windowDurationMins: 300 },
          secondary: { usedPercent: 10, resetsAt: null, windowDurationMins: 10_080 },
          credits: null,
          planType: "plus",
          rateLimitReachedType: null
        }
      });
      store.insertRateLimitSnapshot({
        id: "snap_1",
        accountId: "acc_1",
        capturedAt: 100,
        status: "near_limit",
        statusReason: "Высокая нагрузка",
        limits: {
          limitId: null,
          limitName: null,
          primary: { usedPercent: 80, resetsAt: null, windowDurationMins: 300 },
          secondary: { usedPercent: 30, resetsAt: null, windowDurationMins: 10_080 },
          credits: null,
          planType: "plus",
          rateLimitReachedType: null
        }
      });

      expect(store.listRateLimitHistory("acc_1")).toMatchObject([
        { capturedAt: 100, fiveHourUsedPercent: 80, weeklyUsedPercent: 30 },
        { capturedAt: 200, fiveHourUsedPercent: 40, weeklyUsedPercent: 10 }
      ]);
    } finally {
      store.close();
    }
  });

  it("updates stored plan type from quota snapshots when provider reports a newer plan", () => {
    const store = new AccountStore(tempDir());

    try {
      store.upsert({
        id: "acc_1",
        label: "Рабочий аккаунт",
        email: "work@example.com",
        planType: "plus",
        profileDir: "C:\\profiles\\acc_1",
        encryptedAuthJson: "encrypted"
      });

      const updated = store.setRateLimits(
        "acc_1",
        {
          limitId: "codex",
          limitName: null,
          primary: { usedPercent: 12, resetsAt: null, windowDurationMins: 300 },
          secondary: { usedPercent: 4, resetsAt: null, windowDurationMins: 10_080 },
          credits: null,
          planType: "pro",
          rateLimitReachedType: null
        },
        "active",
        null
      );

      expect(updated.planType).toBe("pro");
      expect(store.get("acc_1")?.planType).toBe("pro");
    } finally {
      store.close();
    }
  });

  it("does not invent a fresh quota snapshot when upserting metadata without rate limits", () => {
    const store = new AccountStore(tempDir());

    try {
      const created = store.upsert({
        id: "acc_1",
        label: "Antigravity",
        email: "ag@example.com",
        planType: "unknown",
        profileDir: "C:\\profiles\\ag",
        encryptedAuthJson: "encrypted",
        platform: "antigravity",
        status: "unknown",
        rateLimits: null
      });

      expect(created.lastRefreshAt).toBeNull();

      const refreshed = store.setRateLimits(
        "acc_1",
        {
          limitId: "ag",
          limitName: null,
          primary: { usedPercent: 20, resetsAt: 1_800_000_000, windowDurationMins: 300 },
          secondary: null,
          credits: null,
          planType: "unknown",
          rateLimitReachedType: null
        },
        "active",
        null
      );

      expect(refreshed.lastRefreshAt).not.toBeNull();

      const afterMetadataUpsert = store.upsert({
        id: "acc_1",
        label: "Antigravity renamed",
        email: "ag@example.com",
        planType: "unknown",
        profileDir: "C:\\profiles\\ag",
        encryptedAuthJson: "encrypted-2",
        platform: "antigravity",
        status: "unknown",
        rateLimits: null
      });

      expect(afterMetadataUpsert.lastRefreshAt).toBe(refreshed.lastRefreshAt);
      expect(afterMetadataUpsert.primaryUsedPercent).toBe(20);
    } finally {
      store.close();
    }
  });

  it("keeps the last good quota snapshot when a later provider probe fails", () => {
    const store = new AccountStore(tempDir());
    try {
      store.upsert({
        id: "stable-quota",
        label: "Stable quota",
        email: "stable@example.com",
        planType: "plus",
        profileDir: "C:\\profiles\\stable",
        encryptedAuthJson: "encrypted",
        status: "active"
      });
      const good = store.setRateLimits(
        "stable-quota",
        {
          limitId: "codex",
          limitName: null,
          primary: { usedPercent: 31, resetsAt: 1_900_000_000, windowDurationMins: 300 },
          secondary: { usedPercent: 8, resetsAt: 1_900_100_000, windowDurationMins: 10_080 },
          credits: null,
          planType: "plus",
          rateLimitReachedType: null
        },
        "active",
        null
      );

      const failed = store.recordRateLimitFailure("stable-quota", "synthetic network timeout");
      expect(failed).toMatchObject({
        status: "active",
        credentialState: "ready",
        lastRefreshAt: good.lastRefreshAt,
        lastRefreshError: "synthetic network timeout",
        fiveHourUsedPercent: 31,
        weeklyUsedPercent: 8
      });
      expect(failed.lastRefreshErrorAt).not.toBeNull();
    } finally {
      store.close();
    }
  });

  it("clears an older quota failure when reauthentication upserts a fresh snapshot", () => {
    const store = new AccountStore(tempDir());
    const limits = {
      limitId: "codex",
      limitName: null,
      primary: { usedPercent: 0, resetsAt: 1_900_000_000, windowDurationMins: 300 },
      secondary: { usedPercent: 0, resetsAt: 1_900_100_000, windowDurationMins: 10_080 },
      credits: null,
      planType: "plus" as const,
      rateLimitReachedType: null
    };
    try {
      store.upsert({
        id: "reauth-fresh",
        label: "Reauthenticated",
        email: "reauth@example.com",
        planType: "plus",
        profileDir: "C:\\profiles\\reauth",
        encryptedAuthJson: "encrypted-old",
        status: "active"
      });
      store.recordRateLimitFailure("reauth-fresh", "old quota failure");

      const saved = store.upsert({
        id: "reauth-fresh",
        label: "Reauthenticated",
        email: "reauth@example.com",
        planType: "plus",
        profileDir: "C:\\profiles\\reauth-new",
        encryptedAuthJson: "encrypted-new",
        credentialState: "ready",
        rateLimits: limits,
        status: "active"
      });

      expect(saved.lastRefreshAt).not.toBeNull();
      expect(saved.lastRefreshErrorAt).toBeNull();
      expect(saved.lastRefreshError).toBeNull();
      expect(saved.credentialState).toBe("ready");
    } finally {
      store.close();
    }
  });

  it("clears an older quota failure after successful reauthentication without a fresh quota snapshot", () => {
    const store = new AccountStore(tempDir());
    try {
      store.upsert({
        id: "reauth-no-quota",
        label: "Reauthenticated",
        email: "reauth-no-quota@example.com",
        planType: "plus",
        profileDir: "C:\\profiles\\reauth-no-quota",
        encryptedAuthJson: "encrypted-old",
        status: "active"
      });
      store.recordRateLimitFailure("reauth-no-quota", "old quota failure");

      const saved = store.upsert({
        id: "reauth-no-quota",
        label: "Reauthenticated",
        email: "reauth-no-quota@example.com",
        planType: "plus",
        profileDir: "C:\\profiles\\reauth-no-quota-new",
        encryptedAuthJson: "encrypted-new",
        credentialState: "ready",
        clearRefreshError: true,
        rateLimits: null,
        status: "active"
      });

      expect(saved.lastRefreshErrorAt).toBeNull();
      expect(saved.lastRefreshError).toBeNull();
      expect(saved.credentialState).toBe("ready");
    } finally {
      store.close();
    }
  });
});
