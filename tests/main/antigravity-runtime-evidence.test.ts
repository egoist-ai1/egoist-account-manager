import { describe, expect, it, vi } from "vitest";
import { inspectAntigravityRuntimeBinding, type AntigravityRuntimeNativeSnapshot } from "../../src/main/services/antigravityProcessService";
import { verifyAntigravityRuntimeIdentity } from "../../src/main/services/antigravityProfileReader";
const input = { platform: "win32" as const, appData: "C:\\Fixture\\Roaming", home: "C:\\Fixture", exePath: "C:\\Tools\\Antigravity\\Antigravity.exe" };
function snapshot(): AntigravityRuntimeNativeSnapshot {
  return { processes: [
    { pid: 100, parentPid: 1, creationTime: "2026-10-06T00:00:00Z", executablePath: input.exePath, commandLine: `"${input.exePath}" --user-data-dir "${input.appData}\\Antigravity IDE"` },
    { pid: 110, parentPid: 100, creationTime: "2026-10-06T00:00:01Z", executablePath: "C:\\Tools\\Antigravity\\resources\\language_server_windows_x64.exe", commandLine: '--csrf_token abcdef01-2345-6789-abcdef012345' }
  ], listeners: [{ pid: 110, port: 43123, localAddress: "127.0.0.1" }] };
}
describe("OS-bound Antigravity runtime identity", () => {
  it("confirms exactly the email returned by the bound process", async () => {
    const result = await verifyAntigravityRuntimeIdentity("target@example.com", { ...input, readNativeSnapshot: async () => snapshot(), getUserStatus: async () => ({ email: "target@example.com", name: null, tier: null }) });
    expect(result).toMatchObject({ runtime: "verified", runtimeSource: "antigravity.get_user_status.os_bound_email", observedEmail: "target@example.com", runtimePid: 110, runtimeCreationTime: "2026-10-06T00:00:01Z" });
  });
  it("reports an actual different runtime email as mismatch", async () => {
    const result = await verifyAntigravityRuntimeIdentity("target@example.com", { ...input, readNativeSnapshot: async () => snapshot(), getUserStatus: async () => ({ email: "old@example.com", name: null, tier: null }) });
    expect(result.runtime).toBe("mismatch"); expect(result.observedEmail).toBe("old@example.com");
  });
  it.each(["profile", "listener", "ancestry", "pid_reuse", "foreign_server", "ambiguous"])("rejects invalid %s ownership without making an account request", async (fault) => {
    const native = snapshot();
    if (fault === "profile") native.processes[0].commandLine = `"${input.exePath}"`;
    if (fault === "listener") native.listeners[0].localAddress = "0.0.0.0";
    if (fault === "ancestry") native.processes[1].parentPid = 200;
    if (fault === "pid_reuse") native.processes[0].creationTime = "2026-10-06T00:01:00Z";
    if (fault === "foreign_server") native.processes[1].executablePath = "C:\\Foreign\\language_server_windows_x64.exe";
    if (fault === "ambiguous") native.listeners.push({ ...native.listeners[0], port: 43124 });
    const getUserStatus = vi.fn(async () => ({ email: "target@example.com", name: null, tier: null }));
    expect(await inspectAntigravityRuntimeBinding({ ...input, readNativeSnapshot: async () => native })).toBeNull();
    const result = await verifyAntigravityRuntimeIdentity("target@example.com", { ...input, readNativeSnapshot: async () => native, getUserStatus });
    expect(result.runtime).toBe("unsupported"); expect(getUserStatus).not.toHaveBeenCalled();
  });
  it("rejects a recycled process after the account response", async () => {
    let calls = 0;
    const result = await verifyAntigravityRuntimeIdentity("target@example.com", { ...input, readNativeSnapshot: async () => { const native = snapshot(); if (++calls > 1) native.processes[1].creationTime = "2026-10-06T00:00:02Z"; return native; }, getUserStatus: async () => ({ email: "target@example.com", name: null, tier: null }) });
    expect(result.runtime).toBe("unsupported"); expect(result.runtimePid).toBeNull();
  });
});
