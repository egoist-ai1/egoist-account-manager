import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexCapabilityService,
  extractLoginCapabilities
} from "../../src/main/services/codexCapabilityService";

const tempDirs: string[] = [];

function tempDir(): string {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), "cam-capability-"));
  tempDirs.push(created);
  return created;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Codex capability schema", () => {
  it("classifies stable and internal login methods from the installed schema", () => {
    const methods = extractLoginCapabilities({
      oneOf: [
        { properties: { type: { enum: ["apiKey"] } } },
        { properties: { type: { enum: ["chatgpt"] } } },
        { properties: { type: { enum: ["chatgptDeviceCode"] } } },
        {
          description: "[UNSTABLE] FOR OPENAI INTERNAL USE ONLY",
          properties: { type: { enum: ["chatgptAuthTokens"] } }
        }
      ]
    });

    expect(methods).toEqual([
      { id: "chatgpt", available: true, stability: "stable", reason: null },
      { id: "chatgptDeviceCode", available: true, stability: "stable", reason: null },
      { id: "apiKey", available: true, stability: "stable", reason: null },
      {
        id: "enterpriseAccessToken",
        available: false,
        stability: "experimental",
        reason: "Not advertised by the installed Codex schema."
      },
      {
        id: "chatgptAuthTokens",
        available: true,
        stability: "internal",
        reason: "Installed Codex marks this method for internal use only."
      }
    ]);
  });

  it("probes versioned schema and verified identity, then reuses the cache", async () => {
    const appDataDir = tempDir();
    let schemaGenerations = 0;
    let rpcStarts = 0;
    const service = new CodexCapabilityService({
      appDataDir,
      codexHome: path.join(appDataDir, "global-home"),
      codexPath: "C:\\Tools\\codex.cmd",
      now: () => 1_700_000_000_000,
      runCommand: async (_codexPath, args) => {
        if (args[0] === "--version") {
          return { stdout: "codex-cli 0.144.0\n", stderr: "", exitCode: 0 };
        }
        if (args[0] === "login") {
          return { stdout: "Usage: codex login [OPTIONS]\n  --with-access-token\n", stderr: "", exitCode: 0 };
        }
        schemaGenerations += 1;
        const outDir = args.at(-1)!;
        const v2 = path.join(outDir, "v2");
        fs.mkdirSync(v2, { recursive: true });
        fs.writeFileSync(path.join(v2, "LoginAccountParams.json"), JSON.stringify({
          oneOf: [
            { properties: { type: { enum: ["apiKey"] } } },
            { properties: { type: { enum: ["chatgpt"] } } },
            { properties: { type: { enum: ["chatgptDeviceCode"] } } },
            {
              description: "FOR OPENAI INTERNAL USE ONLY",
              properties: { type: { enum: ["chatgptAuthTokens"] } }
            }
          ]
        }));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      createRpcClient: () => ({
        start: async () => {
          rpcStarts += 1;
        },
        stop: async () => undefined,
        readAccount: async () => ({
          account: { type: "chatgpt", email: "owner@example.com", planType: "pro" },
          requiresOpenaiAuth: true
        }),
        getInitializeResponse: () => ({
          userAgent: "codex_cli_rs/0.144.0",
          codexHome: path.join(appDataDir, "global-home"),
          platformFamily: "windows",
          platformOs: "windows"
        })
      })
    });

    const first = await service.getReport();
    const second = await service.getReport();

    expect(first.cliVersion).toBe("codex-cli 0.144.0");
    expect(first.protocol.compatible).toBe(true);
    expect(first.identity).toMatchObject({
      signedIn: true,
      authMode: "chatgpt",
      email: "owner@example.com",
      planType: "pro"
    });
    expect(first.protocol.schemaVersionKey).toMatch(/^codex-cli-0\.144\.0-/);
    expect(first.loginMethods).toContainEqual({
      id: "enterpriseAccessToken",
      available: true,
      stability: "experimental",
      reason: "Supported by the installed Codex CLI through the official --with-access-token flow."
    });
    expect(second).toEqual(first);
    expect(schemaGenerations).toBe(1);
    expect(rpcStarts).toBe(1);
  });

  it("fails closed when the generated schema is malformed", async () => {
    const appDataDir = tempDir();
    const service = new CodexCapabilityService({
      appDataDir,
      codexHome: path.join(appDataDir, "home"),
      codexPath: "codex",
      runCommand: async (_codexPath, args) => {
        if (args[0] === "--version") {
          return { stdout: "codex-cli test\n", stderr: "", exitCode: 0 };
        }
        if (args[0] === "login") {
          return { stdout: "Usage: codex login\n", stderr: "", exitCode: 0 };
        }
        const outDir = args.at(-1)!;
        const v2 = path.join(outDir, "v2");
        fs.mkdirSync(v2, { recursive: true });
        fs.writeFileSync(path.join(v2, "LoginAccountParams.json"), "{}");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      createRpcClient: () => ({
        start: async () => undefined,
        stop: async () => undefined,
        readAccount: async () => ({ account: null, requiresOpenaiAuth: true }),
        getInitializeResponse: () => ({
          userAgent: "test",
          codexHome: path.join(appDataDir, "home"),
          platformFamily: "windows",
          platformOs: "windows"
        })
      })
    });

    const report = await service.getReport();

    expect(report.protocol.compatible).toBe(false);
    expect(report.protocol.error).toContain("no oneOf variants");
    expect(report.loginMethods.every((method) => !method.available)).toBe(true);
  });
});
