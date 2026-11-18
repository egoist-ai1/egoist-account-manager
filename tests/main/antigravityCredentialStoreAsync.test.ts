import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeProbeIsolation } from "../../src/main/services/probeIsolationService";
import { readAntigravityCredentialStorePayloadAsync, writeAntigravityCredentialStoreTokenAsync,
  writeAntigravityCredentialStorePayloadAsync, deleteAntigravityCredentialStorePayloadAsync } from "../../src/main/services/antigravityCredentialStore";

afterEach(() => initializeProbeIsolation({}));

describe("asynchronous Credential Manager adapter", () => {
  it("sends secrets via stdin and waits for helper completion", async () => {
    initializeProbeIsolation({});
    const runner = vi.fn(async (_script: string, _input: string | undefined) => "");
    await expect(writeAntigravityCredentialStoreTokenAsync({ accessToken: "private-access", refreshToken: "private-refresh", expiresAt: null }, "win32", { runner }))
      .resolves.toMatchObject({ applied: true });
    const [script, input] = runner.mock.calls[0] as unknown as [string, string];
    expect(script).not.toContain("private-access");
    expect(script).not.toContain("private-refresh");
    expect(input).toContain("private-access");
    expect(input).toContain("private-refresh");
  });

  it("reads a private backup payload without printing it and handles absence", async () => {
    initializeProbeIsolation({});
    const payload = JSON.stringify({ token: { access_token: "fixture" } });
    const runner = vi.fn(async (_script: string, _input: string | undefined) => Buffer.from(payload).toString("base64"));
    expect(await readAntigravityCredentialStorePayloadAsync("win32", { runner })).toMatchObject({ payload });
    expect(runner.mock.calls[0][1]).toBeUndefined();
    expect(await readAntigravityCredentialStorePayloadAsync("win32", { runner: async () => "" })).toBeNull();
    await expect(readAntigravityCredentialStorePayloadAsync("win32", { runner: async () => "invalid!" })).rejects.toThrow("invalid encoded");
    await expect(readAntigravityCredentialStorePayloadAsync("win32", { runner: async () => Buffer.from([0xff, 0xfe, 0x80]).toString("base64") }))
      .rejects.toThrow("cannot be restored exactly");
  });

  it("restores the exact opaque original or deletes an originally absent credential", async () => {
    initializeProbeIsolation({});
    const runner = vi.fn(async (_script: string, _input: string | undefined) => "");
    const original = '{"unknownOriginalField":true,"token":{"value":"fixture"}}';
    await writeAntigravityCredentialStorePayloadAsync(original, "win32", { runner });
    expect(runner.mock.calls[0][1]).toBe(original);
    await deleteAntigravityCredentialStorePayloadAsync("win32", { runner });
    expect(runner.mock.calls[1][0]).toContain("CredDeleteW");
    expect(runner.mock.calls[1][1]).toBeUndefined();
  });

  it("supports cancellation before invoking the helper", async () => {
    initializeProbeIsolation({});
    const controller = new AbortController();
    controller.abort(new Error("cancelled fixture"));
    const runner = vi.fn(async () => "");
    await expect(readAntigravityCredentialStorePayloadAsync("win32", { runner, signal: controller.signal })).rejects.toThrow("cancelled fixture");
    expect(runner).not.toHaveBeenCalled();
  });

  it("never invokes a Windows helper on an unsupported platform", async () => {
    const runner = vi.fn(async () => "");
    expect(await readAntigravityCredentialStorePayloadAsync("linux", { runner })).toBeNull();
    expect(await writeAntigravityCredentialStorePayloadAsync("{}", "linux", { runner })).toMatchObject({ applied: false });
    expect(await deleteAntigravityCredentialStorePayloadAsync("linux", { runner })).toMatchObject({ applied: false });
    expect(runner).not.toHaveBeenCalled();
  });
});
