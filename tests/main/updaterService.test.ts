import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateCheckResult } from "../../src/shared/types";

vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "3.1.0" },
  net: { fetch: vi.fn() },
  shell: { openExternal: vi.fn() }
}));

import { UpdaterService } from "../../src/main/services/updaterService";

function response(payload: unknown, status = 200) {
  const body = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => name.toLowerCase() === "content-length" ? String(Buffer.byteLength(body)) : null },
    text: vi.fn(async () => body)
  };
}

function createService(input: {
  current?: string;
  payload?: unknown;
  fetchRelease?: () => Promise<ReturnType<typeof response>>;
  packaged?: boolean;
  enabled?: boolean;
} = {}) {
  const statuses: UpdateCheckResult[] = [];
  const send = vi.fn((channel: string, result: UpdateCheckResult) => {
    if (channel === "release:updateStatus") statuses.push(result);
  });
  const openExternal = vi.fn(async () => undefined);
  const onUpdateAvailable = vi.fn();
  const fetchRelease = vi.fn(input.fetchRelease ?? (async () => response(input.payload ?? {
    tag_name: "v3.2.0",
    draft: false,
    prerelease: false
  })));
  const service = new UpdaterService(
    () => ({ webContents: { send } }) as never,
    vi.fn(),
    {
      app: { isPackaged: input.packaged ?? true, getVersion: () => input.current ?? "3.1.0" },
      fetchRelease,
      openExternal,
      onUpdateAvailable,
      updatesEnabled: input.enabled ?? true
    }
  );
  return { service, statuses, fetchRelease, openExternal, onUpdateAvailable };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("UpdaterService GitHub release discovery", () => {
  it("reports a newer stable release and emits its fixed repository URL", async () => {
    const { service, statuses, fetchRelease, onUpdateAvailable } = createService();

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      status: "available",
      version: "3.2.0",
      feedUrl: "https://github.com/egoist-ai1/egoist-account-manager/releases/tag/v3.2.0"
    });
    expect(fetchRelease).toHaveBeenCalledWith(
      "https://api.github.com/repos/egoist-ai1/egoist-account-manager/releases/latest",
      expect.objectContaining({ method: "GET", redirect: "error" })
    );
    expect(statuses.map((item) => item.status)).toEqual(["checking", "available"]);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it("does not offer an equal release", async () => {
    const { service } = createService({ current: "3.2.0", payload: { tag_name: "v3.2.0", draft: false, prerelease: false } });
    await expect(service.checkForUpdates()).resolves.toMatchObject({ status: "not_available", version: "3.2.0" });
  });

  it("opens only the release URL constructed for the fixed GitHub repository", async () => {
    const { service, openExternal, onUpdateAvailable } = createService();
    await service.checkForUpdates();

    await expect(service.openUpdateRelease()).resolves.toMatchObject({ status: "available", version: "3.2.0" });
    expect(openExternal).toHaveBeenCalledWith("https://github.com/egoist-ai1/egoist-account-manager/releases/tag/v3.2.0");
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed tags instead of opening untrusted data", async () => {
    const { service, openExternal } = createService({ payload: { tag_name: "../../malicious", draft: false, prerelease: false } });
    await expect(service.checkForUpdates()).resolves.toMatchObject({ status: "error" });
    await expect(service.openUpdateRelease()).resolves.toMatchObject({ status: "error" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("returns an actionable timeout even when the network promise ignores abort", async () => {
    vi.useFakeTimers();
    const { service } = createService({ fetchRelease: () => new Promise(() => undefined) });
    const pending = service.checkForUpdates();
    await vi.advanceTimersByTimeAsync(20_001);
    await expect(pending).resolves.toMatchObject({ status: "error" });
    expect(service.getLastResult()?.message).toContain("20 секунд");
  });

  it("stays disabled in development unless explicitly forced", async () => {
    const { service, fetchRelease } = createService({ packaged: false });
    await expect(service.checkForUpdates()).resolves.toMatchObject({ status: "not_configured" });
    expect(fetchRelease).not.toHaveBeenCalled();
  });
});
