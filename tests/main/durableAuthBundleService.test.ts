import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DurableAuthActivationError,
  DurableAuthBundleService,
  type DurableAuthBundleAdapter
} from "../../src/main/services/durableAuthBundleService";

const dirs: string[] = [];
const sealBackup = (contents: string) => `sealed:${Buffer.from(contents, "utf8").toString("base64")}`;
const unsealBackup = (ciphertext: string) => Buffer.from(ciphertext.slice("sealed:".length), "base64").toString("utf8");

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cam-durable-auth-"));
  dirs.push(dir);
  return dir;
}

class FaultAdapter implements DurableAuthBundleAdapter {
  readonly operations: string[] = [];
  fault?: (operation: string) => Error | null;

  exists(filePath: string): boolean {
    this.maybeFault(`exists:${filePath}`);
    return fs.existsSync(filePath);
  }

  readUtf8(filePath: string): string {
    this.maybeFault(`read:${filePath}`);
    return fs.readFileSync(filePath, "utf8");
  }

  writeDurableUtf8(filePath: string, contents: string): void {
    this.maybeFault(`write:${filePath}`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, "utf8");
  }

  mkdir(directoryPath: string): void {
    this.maybeFault(`mkdir:${directoryPath}`);
    fs.mkdirSync(directoryPath, { recursive: true });
  }

  rename(sourcePath: string, targetPath: string): void {
    this.maybeFault(`rename:${sourcePath}->${targetPath}`);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.renameSync(sourcePath, targetPath);
  }

  remove(targetPath: string, recursive = false): void {
    this.maybeFault(`remove:${targetPath}`);
    fs.rmSync(targetPath, { force: true, recursive });
  }

  private maybeFault(operation: string): void {
    this.operations.push(operation);
    const error = this.fault?.(operation);
    if (error) throw error;
  }
}

function createService(
  codexHome: string,
  adapter = new FaultAdapter(),
  overrides: Partial<ConstructorParameters<typeof DurableAuthBundleService>[0]> = {}
) {
  return {
    adapter,
    service: new DurableAuthBundleService({
      codexHome,
      sealBackup,
      unsealBackup,
      adapter,
      stableCheckIntervalMs: 0,
      ...overrides
    })
  };
}

function bundle(target = "target-secret") {
  return [
    { relativePath: "auth.json" as const, contents: JSON.stringify({ account_id: "target", token: target }) },
    {
      relativePath: ".codex-global-state.json" as const,
      contents: JSON.stringify({ creator_id: "target" })
    }
  ];
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("DurableAuthBundleService", () => {
  it("activates and rolls back a multi-file bundle with only sealed previous bytes in the manifest", async () => {
    const codexHome = tempDir();
    const previousAuth = JSON.stringify({ account_id: "previous", token: "previous-secret" });
    const previousState = JSON.stringify({ creator_id: "previous" });
    fs.writeFileSync(path.join(codexHome, "auth.json"), previousAuth, "utf8");
    fs.writeFileSync(path.join(codexHome, ".codex-global-state.json"), previousState, "utf8");
    const { service } = createService(codexHome);

    const result = await service.activate({ transactionId: "tx-happy-path", files: bundle() });

    expect(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")).toContain("target-secret");
    expect(fs.readFileSync(path.join(codexHome, ".codex-global-state.json"), "utf8")).toContain("target");
    expect(result.stableChecks).toBe(3);
    const manifest = fs.readFileSync(path.join(result.backupPath, "manifest.json"), "utf8");
    expect(manifest).not.toContain("previous-secret");
    expect(manifest).not.toContain("target-secret");
    expect(manifest).toContain("sealed:");

    await service.rollback(result.backupPath);

    expect(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")).toBe(previousAuth);
    expect(fs.readFileSync(path.join(codexHome, ".codex-global-state.json"), "utf8")).toBe(previousState);
    expect(service.readActivation(result.backupPath).status).toBe("rolled_back");
  });

  it("retries only bounded Windows lock errors 5/32/33", async () => {
    const codexHome = tempDir();
    fs.writeFileSync(path.join(codexHome, "auth.json"), JSON.stringify({ account_id: "previous" }), "utf8");
    const adapter = new FaultAdapter();
    let lockFailures = 0;
    const sleeps: number[] = [];
    adapter.fault = (operation) => {
      if (
        operation.includes("\\stage\\")
        && operation.endsWith(`->${path.join(codexHome, "auth.json")}`)
        && lockFailures < 2
      ) {
        lockFailures += 1;
        return Object.assign(new Error("sharing violation"), { code: "EBUSY", win32Code: 32 });
      }
      return null;
    };
    const { service } = createService(codexHome, adapter, {
      platform: "win32",
      renameRetryDelaysMs: [5, 15, 30],
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });

    await service.activate({
      transactionId: "tx-sharing-retry",
      files: [{ relativePath: "auth.json", contents: JSON.stringify({ account_id: "target" }) }]
    });

    expect(lockFailures).toBe(2);
    expect(sleeps).toEqual([5, 15]);
    expect(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")).toContain("target");
  });

  it("does not retry unrelated rename errors and verifies automatic rollback", async () => {
    const codexHome = tempDir();
    const previous = JSON.stringify({ account_id: "previous" });
    fs.writeFileSync(path.join(codexHome, "auth.json"), previous, "utf8");
    const adapter = new FaultAdapter();
    let failed = false;
    adapter.fault = (operation) => {
      if (!failed && operation.includes("\\stage\\") && operation.endsWith(`->${path.join(codexHome, "auth.json")}`)) {
        failed = true;
        return Object.assign(new Error("disk full"), { code: "ENOSPC" });
      }
      return null;
    };
    const { service } = createService(codexHome, adapter, {
      platform: "win32",
      renameRetryDelaysMs: [1, 2, 3]
    });

    const error = await service.activate({
      transactionId: "tx-no-retry",
      files: [{ relativePath: "auth.json", contents: JSON.stringify({ account_id: "target" }) }]
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DurableAuthActivationError);
    expect((error as DurableAuthActivationError).rollbackVerified).toBe(true);
    expect(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")).toBe(previous);
    expect(adapter.operations.filter((operation) =>
      operation.includes("\\stage\\") && operation.endsWith(`->${path.join(codexHome, "auth.json")}`)
    )).toHaveLength(1);
  });

  it("detects a living process rewriting target auth between stable checks and restores previous bytes", async () => {
    const codexHome = tempDir();
    const authPath = path.join(codexHome, "auth.json");
    const previous = JSON.stringify({ account_id: "previous", token: "safe" });
    fs.writeFileSync(authPath, previous, "utf8");
    let rewrites = 0;
    const { service } = createService(codexHome, new FaultAdapter(), {
      stableCheckCount: 3,
      stableCheckIntervalMs: 1,
      sleep: async () => {
        if (rewrites === 0) {
          rewrites += 1;
          fs.writeFileSync(authPath, JSON.stringify({ account_id: "intruder" }), "utf8");
        }
      }
    });

    const error = await service.activate({
      transactionId: "tx-live-rewrite",
      files: [{ relativePath: "auth.json", contents: JSON.stringify({ account_id: "target" }) }]
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DurableAuthActivationError);
    expect((error as DurableAuthActivationError).rollbackVerified).toBe(true);
    expect(rewrites).toBe(1);
    expect(fs.readFileSync(authPath, "utf8")).toBe(previous);
  });

  it.each([
    ["stage directory", (operation: string) => operation.includes("mkdir:") && operation.endsWith("\\stage")],
    ["stage write", (operation: string) => operation.includes("write:") && operation.includes("\\stage\\0-auth.json.tmp")],
    ["first manifest write", (operation: string) => operation.includes("write:") && operation.includes("manifest.json.")],
    ["auth replace", (operation: string) => operation.includes("rename:") && operation.includes("\\stage\\0-auth.json.tmp->")],
    ["compatibility replace", (operation: string) => operation.includes("rename:") && operation.includes("\\stage\\1-.codex-global-state.json.tmp->")]
  ])("restores the previous bundle after a one-shot %s failure", async (_label, matches) => {
    const codexHome = tempDir();
    const previousAuth = JSON.stringify({ account_id: "previous" });
    const previousState = JSON.stringify({ creator_id: "previous" });
    fs.writeFileSync(path.join(codexHome, "auth.json"), previousAuth, "utf8");
    fs.writeFileSync(path.join(codexHome, ".codex-global-state.json"), previousState, "utf8");
    const adapter = new FaultAdapter();
    let injected = false;
    adapter.fault = (operation) => {
      if (!injected && matches(operation)) {
        injected = true;
        return Object.assign(new Error("injected durable transition failure"), { code: "EIO" });
      }
      return null;
    };
    const { service } = createService(codexHome, adapter, { renameRetryDelaysMs: [] });

    const error = await service.activate({
      transactionId: `tx-fault-${_label.replace(/\s+/g, "-")}`,
      files: bundle()
    }).catch((caught: unknown) => caught);

    expect(injected).toBe(true);
    expect(error).toBeInstanceOf(DurableAuthActivationError);
    expect((error as DurableAuthActivationError).rollbackVerified).toBe(true);
    expect(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")).toBe(previousAuth);
    expect(fs.readFileSync(path.join(codexHome, ".codex-global-state.json"), "utf8")).toBe(previousState);
  });
});
