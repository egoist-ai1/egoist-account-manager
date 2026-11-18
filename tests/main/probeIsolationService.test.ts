import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProbeOperationAllowed, createProbeIsolationPolicy, createProbeNativeAdapters,
  initializeProbeIsolation, installProbeNetworkGuards } from "../../src/main/services/probeIsolationService";
import { readAntigravityCredentialStorePayload, readAntigravityCredentialStorePayloadAsync,
  writeAntigravityCredentialStoreToken } from "../../src/main/services/antigravityCredentialStore";

const roots: string[] = [];
function fixture(): NodeJS.ProcessEnv {
  const token = crypto.randomUUID();
  const root = path.join(process.env.CAM_TEST_WORK_DIR ?? os.tmpdir(), `egoist-probe-${token}`);
  fs.mkdirSync(root, { recursive: true });
  roots.push(root);
  fs.writeFileSync(path.join(root, ".egoist-probe-root.json"), JSON.stringify({ schemaVersion: 1, purpose: "egoist-isolated-probe", token }));
  const env: NodeJS.ProcessEnv = { CAM_PROBE_MODE: "isolated", CAM_PROBE_ROOT: root, CAM_PROBE_TOKEN: token };
  for (const name of ["CAM_USER_DATA_DIR", "CODEX_HOME", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
    env[name] = path.join(root, name);
    fs.mkdirSync(env[name]!);
  }
  return env;
}

afterEach(() => {
  initializeProbeIsolation({});
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("probe isolation policy", () => {
  it("fails closed when existing background probes only redirect environment folders", () => {
    expect(() => createProbeIsolationPolicy({ CAM_BACKGROUND_PROBE: "1" })).toThrow("CAM_PROBE_TOKEN");
  });

  it("requires the exact marker token and validates all redirected paths", () => {
    const env = fixture();
    expect(createProbeIsolationPolicy(env).enabled).toBe(true);
    env.CODEX_HOME = path.dirname(env.CAM_PROBE_ROOT!);
    expect(() => createProbeIsolationPolicy(env)).toThrow("CODEX_HOME must be a child");
    env.CODEX_HOME = path.join(env.CAM_PROBE_ROOT!, "CODEX_HOME");
    fs.writeFileSync(path.join(env.CAM_PROBE_ROOT!, ".egoist-probe-root.json"), JSON.stringify({ schemaVersion: 1, purpose: "egoist-isolated-probe", token: crypto.randomUUID() }));
    expect(() => createProbeIsolationPolicy(env)).toThrow("does not match");
  });

  it("rejects a junction or symlink instead of trusting its apparent boundary", () => {
    const env = fixture();
    const original = env.CODEX_HOME!;
    fs.rmdirSync(original);
    fs.symlinkSync(env.APPDATA!, original, process.platform === "win32" ? "junction" : "dir");
    expect(() => createProbeIsolationPolicy(env)).toThrow("link or non-directory");
  });

  it("blocks every native adapter before it can access host state", () => {
    const policy = createProbeIsolationPolicy(fixture());
    const callback = vi.fn();
    const adapters = createProbeNativeAdapters(policy, { "credential-manager": callback, autostart: callback,
      "external-app": callback, "provider-network": callback, "desktop-process-control": callback, "host-discovery": callback });
    for (const adapter of Object.values(adapters)) expect(() => adapter("secret")).toThrow("Isolated probe blocks");
    expect(callback).not.toHaveBeenCalled();
    expect(() => assertProbeOperationAllowed("external-url", policy)).toThrow("external-url");
  });

  it("leaves real adapters available outside probe mode", () => {
    const callback = vi.fn(() => 7);
    const adapters = createProbeNativeAdapters(createProbeIsolationPolicy({}), { autostart: callback });
    expect(adapters.autostart()).toBe(7);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("blocks both compatibility and async Credential Manager paths before a helper starts", async () => {
    initializeProbeIsolation(fixture());
    const runner = vi.fn(async () => "");
    expect(() => readAntigravityCredentialStorePayload("win32")).toThrow("credential-manager");
    expect(() => writeAntigravityCredentialStoreToken({ accessToken: "fixture", refreshToken: "fixture", expiresAt: null }, "win32")).toThrow("credential-manager");
    await expect(readAntigravityCredentialStorePayloadAsync("win32", { runner })).rejects.toThrow("credential-manager");
    expect(runner).not.toHaveBeenCalled();
  });

  it("denies fetch and Node HTTP/S even with redirected home and allows only the exact renderer origin", async () => {
    const mockFetch = vi.fn(async () => new Response("renderer"));
    vi.stubGlobal("fetch", mockFetch);
    const restore = installProbeNetworkGuards(createProbeIsolationPolicy(fixture()), "http://127.0.0.1:4188");
    try {
      await expect(fetch("https://provider.example/quota")).rejects.toThrow("provider-network");
      await expect(fetch("http://127.0.0.1:8888/runtime")).rejects.toThrow("provider-network");
      expect(() => http.request("http://provider.example/")).toThrow("provider-network");
      expect(() => https.get("https://provider.example/")).toThrow("provider-network");
      expect(() => http.request("http://127.0.0.1:4188/", { hostname: "provider.example" })).toThrow("provider-network");
      expect(() => http.request("http://127.0.0.1:4188/", { socketPath: "/host-socket" })).toThrow("custom network connections");
      expect(() => http.request("http://127.0.0.1:4188/", { agent: new http.Agent() })).toThrow("custom network connections");
      await expect(fetch("http://127.0.0.1:4188/", { dispatcher: {} } as RequestInit)).rejects.toThrow("custom network connections");
      expect(await (await fetch("http://127.0.0.1:4188/src/App.tsx")).text()).toBe("renderer");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith("http://127.0.0.1:4188/src/App.tsx", { redirect: "error" });
    } finally { restore(); }
  });
});
