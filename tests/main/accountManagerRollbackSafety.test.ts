import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AccountManager } from "../../src/main/accountManager";
import { AccountStore } from "../../src/main/db";
import { Vault } from "../../src/main/security";

describe("Manual rollback snapshot eligibility", () => {
  it.each(["newer-write", "already-restored", "selection-changed"])("rejects %s before touching provider files", async (scenario) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "egoist-rollback-test-"));
    const store = new AccountStore(root);
    const vault = new Vault(root);
    const manager = new AccountManager(store, vault, root, null, { codexHome: path.join(root, "codex") });
    try {
      const id = "fixture-profile";
      store.upsert({ id, email: "fixture@example.com", label: "fixture", profileDir: path.join(root, "profiles", id),
        planType: "unknown", encryptedAuthJson: vault.encryptUtf8('{"tokens":{"access_token":"synthetic"}}'),
        rateLimits: null, credentialState: "ready" });
      store.setActive(id);
      const snapshot = path.join(root, "sealed-snapshot");
      fs.mkdirSync(snapshot);
      const sentinel = path.join(snapshot, "sentinel");
      fs.writeFileSync(sentinel, "unchanged");
      const created = store.createSwitchTransaction({ id: crypto.randomUUID(), platform: "codex", targetAccountId: id,
        previousAccountId: null, targetFingerprint: null, previousFingerprint: null });
      const saved = store.updateSwitchTransaction(created.id, { status: "committed", phase: "committed", backupPath: snapshot }, created.version);
      const eventId = crypto.randomUUID();
      store.recordSwitchEvent({ id: eventId, accountId: id, previousAccountId: null, startedAt: 10,
        completedAt: 11, status: "completed", backupPath: snapshot, error: null });
      if (scenario === "newer-write") {
        const next = store.createSwitchTransaction({ id: crypto.randomUUID(), platform: "codex", targetAccountId: id,
          previousAccountId: null, targetFingerprint: null, previousFingerprint: null });
        store.updateSwitchTransaction(next.id, { status: "committed", phase: "committed", backupPath: path.join(root, "newer") }, next.version);
      } else if (scenario === "already-restored") {
        store.updateSwitchTransaction(saved.id, { status: "rolled_back", phase: "rolled_back" }, saved.version);
      } else store.clearActive("codex");
      await expect(manager.rollbackSwitch(eventId)).rejects.toThrow(/latest applied|selected provider profile/);
      expect(fs.readFileSync(sentinel, "utf8")).toBe("unchanged");
      expect(fs.existsSync(path.join(root, "codex", "auth.json"))).toBe(false);
      expect(store.getSwitchTransaction(saved.id)?.status).toBe(scenario === "already-restored" ? "rolled_back" : "committed");
    } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
});
