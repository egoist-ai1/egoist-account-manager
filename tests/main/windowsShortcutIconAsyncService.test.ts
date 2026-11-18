import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildShortcutRefreshScript, getWindowsShortcutIconTargets, syncWindowsShortcutIcon,
  syncWindowsShortcutIconAsync, type ShortcutRefreshCommandOptions,
  type WindowsShortcutIconAsyncOptions } from "../../src/main/services/windowsShortcutIconService";
import { initializeProbeIsolation } from "../../src/main/services/probeIsolationService";

const roots: string[] = [];
async function fixture(): Promise<WindowsShortcutIconAsyncOptions> {
  const root = await fs.mkdtemp(path.join(process.env.CAM_TEST_WORK_DIR ?? os.tmpdir(), "shortcut-icon-"));
  roots.push(root);
  const env = { APPDATA: path.join(root, "roaming"), LOCALAPPDATA: path.join(root, "local"), USERPROFILE: path.join(root, "profile") };
  const options: WindowsShortcutIconAsyncOptions = { env, platform: "win32", productName: "Egoist", version: "3.2.0-rc.1",
    sourceIcoPath: path.join(root, "source.ico"), executablePath: path.join(root, "Egoist.exe"), iconDirectory: path.join(root, "owned-icons") };
  await fs.writeFile(options.sourceIcoPath, Buffer.from([0, 0, 1, 0, 1, 0]));
  return options;
}

async function addOfflineShortcut(options: WindowsShortcutIconAsyncOptions): Promise<void> {
  const shortcut = getWindowsShortcutIconTargets(options)!.shortcuts[0];
  await fs.mkdir(path.dirname(shortcut), { recursive: true });
  await fs.writeFile(shortcut, "offline shortcut fixture; never opened by COM");
}

afterEach(async () => {
  initializeProbeIsolation({});
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("asynchronous Windows shortcut integration", () => {
  it("keeps the event loop available while the helper waits and preserves unchanged icon files", async () => {
    const options = await fixture();
    await addOfflineShortcut(options);
    let release!: () => void;
    const runner = vi.fn(async (_script: string, _options: ShortcutRefreshCommandOptions) => new Promise<void>((resolve) => { release = resolve; }));
    const pending = syncWindowsShortcutIconAsync({ ...options, runner, timeoutMs: 20_000 });
    try {
      await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce());
      let eventLoopRan = false;
      await new Promise<void>((resolve) => setImmediate(() => { eventLoopRan = true; resolve(); }));
      expect(eventLoopRan).toBe(true);
      expect(runner.mock.calls[0][1].timeoutMs).toBe(5_000);
    } finally { release?.(); }
    await pending;
    const cachedIcon = path.join(options.iconDirectory!, "icon.ico");
    const before = await fs.stat(cachedIcon);
    expect(await fs.readFile(cachedIcon)).toEqual(await fs.readFile(options.sourceIcoPath));
    await syncWindowsShortcutIconAsync({ ...options, runner: async () => undefined });
    expect((await fs.stat(cachedIcon)).mtimeMs).toBe(before.mtimeMs);
  });

  it("does not write or launch after cancellation or on unsupported platforms", async () => {
    const options = await fixture();
    const runner = vi.fn(async () => undefined);
    const controller = new AbortController();
    controller.abort();
    await syncWindowsShortcutIconAsync({ ...options, signal: controller.signal, runner });
    await syncWindowsShortcutIconAsync({ ...options, platform: "linux", runner });
    expect(runner).not.toHaveBeenCalled();
    await expect(fs.access(options.iconDirectory!)).rejects.toThrow();
  });

  it("treats helper failure as best-effort and rejects invalid deadlines before any cache writes", async () => {
    const options = await fixture();
    await addOfflineShortcut(options);
    const log = vi.fn();
    await syncWindowsShortcutIconAsync({ ...options, log, runner: async () => { throw new Error("Fixture helper failed"); } });
    expect(log).toHaveBeenCalledWith("Failed to sync Windows shortcut icon", expect.any(Error));
    const runner = vi.fn(async () => undefined);
    const invalidDirectory = path.join(path.dirname(options.sourceIcoPath), "invalid-timeout-icons");
    await syncWindowsShortcutIconAsync({ ...options, iconDirectory: invalidDirectory, runner, timeoutMs: Number.NaN, log });
    expect(runner).not.toHaveBeenCalled();
    await expect(fs.access(invalidDirectory)).rejects.toThrow();
  });

  it("guards both compatibility and async shortcuts before any writes or helpers in probe mode", async () => {
    const options = await fixture();
    const token = crypto.randomUUID();
    const root = path.join(path.dirname(options.sourceIcoPath), `egoist-probe-${token}`);
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, ".egoist-probe-root.json"), JSON.stringify({ schemaVersion: 1, purpose: "egoist-isolated-probe", token }));
    const env: NodeJS.ProcessEnv = { CAM_PROBE_MODE: "isolated", CAM_PROBE_TOKEN: token, CAM_PROBE_ROOT: root };
    for (const key of ["CAM_USER_DATA_DIR", "CODEX_HOME", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
      env[key] = path.join(root, key);
      await fs.mkdir(env[key]!);
    }
    initializeProbeIsolation(env);
    const runner = vi.fn(async () => undefined);
    expect(() => syncWindowsShortcutIcon(options)).toThrow("desktop-integration");
    await expect(syncWindowsShortcutIconAsync({ ...options, runner })).rejects.toThrow("desktop-integration");
    expect(runner).not.toHaveBeenCalled();
    await expect(fs.access(options.iconDirectory!)).rejects.toThrow();
  });

  it("binds refresh to the owning executable and skips unchanged shortcut icons", () => {
    const script = buildShortcutRefreshScript(["C:\\O'Brien\\Egoist.lnk"], "C:\\icons\\Egoist.ico", "C:\\O'Brien\\Egoist.exe");
    expect(script).toContain("'C:\\O''Brien\\Egoist.exe'");
    expect(script).toContain("[String]::Equals($shortcut.TargetPath, $executable, [StringComparison]::OrdinalIgnoreCase)");
    expect(script).toContain("$shortcut.IconLocation -ne $icon");
  });
});
