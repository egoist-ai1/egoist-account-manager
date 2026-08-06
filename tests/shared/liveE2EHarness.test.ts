import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("Windows Sandbox live E2E harness", () => {
  it("uses file reports instead of relying on GUI Electron stdout", () => {
    const importHelper = source("scripts/live-e2e-import.cjs");
    const probeHelper = source("scripts/live-e2e-probe.mjs");
    const sandboxRunner = source("scripts/windows-sandbox-live-e2e.ps1");
    const hostStager = source("scripts/run-windows-sandbox-live-e2e.ps1");

    expect(importHelper).toContain('readArg("--report")');
    expect(importHelper).toContain("writeReport(reportPath");
    expect(probeHelper).toContain('readArg("--report")');
    expect(probeHelper).toContain('readArg("--runtime-root")');
    expect(probeHelper).toContain('createRequire(path.join(runtimeRoot, "package.json"))');
    expect(probeHelper).toContain("classifyProbeError");
    expect(probeHelper).toContain("latestTransactionErrorCode");
    expect(probeHelper).toContain("committedTransactionCount");
    expect(probeHelper).toContain("writeReport(reportPath");
    expect(sandboxRunner).toContain("$process.WaitForExit(60000)");
    expect(sandboxRunner).toContain("profile-import.json");
    expect(sandboxRunner).toContain("state-probe.json");
    expect(sandboxRunner).toContain("preSwitchFreshQuotaCount");
    expect(sandboxRunner).toContain("firstActiveQuotaFresh");
    expect(sandboxRunner).toContain('$state.PSObject.Properties.Name -contains "probeFailed"');
    expect(hostStager).toContain('"runtime\\node_modules\\nanoid"');
    expect(hostStager).toContain("rebuild:native:electron");
    expect(hostStager).toContain("<ProtectedClient>Disable</ProtectedClient>");
    expect(sandboxRunner).toContain('C:\\CAM-Work\\stage');
    expect(sandboxRunner).not.toContain('Start-Process -FilePath "C:\\CAM-Stage');
    expect(hostStager).toContain("host-state-baseline.json");
    expect(hostStager).toContain("Get-HostAuthSnapshot");
    expect(hostStager).toContain("Test-HostInvariant");
    expect(hostStager).toContain("Host Codex state changed during live E2E preparation");
    expect(hostStager).toContain("live-e2e-fault.cjs");
    expect(hostStager).toContain('Join-Path $hostCodexPackage.InstallLocation "app\\resources\\codex.exe"');
    expect(hostStager).not.toContain("get.microsoft.com/installer");
    expect(sandboxRunner).toContain("Install-CodexDesktopFixture");
    expect(sandboxRunner).toContain("officialCodexAppServerSigned");
    expect(sandboxRunner).toContain("hungDesktopRecoveredByExactTreeFallback");
    expect(sandboxRunner).toContain("crashDuringActivationRecovered");
    expect(sandboxRunner).toContain("failedAuthorizationRolledBack");
    expect(sandboxRunner.indexOf('$invalidAuthConfirmation = Open-SwitchDialog')).toBeLessThan(
      sandboxRunner.indexOf('Invoke-FaultHelper "arm-invalid-auth"')
    );
    expect(sandboxRunner).not.toContain("SetCursorPos");
    expect(sandboxRunner).not.toContain("mouse_event");
    expect(source("scripts/windows-sandbox-live-e2e-bootstrap.ps1")).toContain("VerifiedAndReputablePolicyState");
    expect(source("scripts/windows-sandbox-live-e2e-bootstrap.ps1")).toContain('CiTool.exe" -r');
    expect(sandboxRunner).not.toMatch(/\$output\s*=\s*&\s*\$electronExe/);
  });

  it("selects live profiles by recent verified authentication before plan tier", () => {
    const selector = source("scripts/prepare-live-e2e-database.cjs");
    const authenticatedOrder = selector.indexOf("COALESCE(last_authenticated_at, 0) DESC");
    const planOrder = selector.indexOf("CASE lower(plan_type)");

    expect(authenticatedOrder).toBeGreaterThan(0);
    expect(planOrder).toBeGreaterThan(authenticatedOrder);
    expect(selector).toContain('selectionPolicy: "most-recently-authenticated-inactive-ready"');
  });

  it("runs unsigned lifecycle binaries from verified guest-local copies", () => {
    const lifecycle = source("scripts/windows-sandbox-release-test.ps1");

    expect(lifecycle).toContain('$mappedStageRoot = [IO.Path]::GetFullPath("C:\\CAM-Stage")');
    expect(lifecycle).toContain('$guestWorkRoot = [IO.Path]::GetFullPath("C:\\CAM-Work")');
    expect(lifecycle).toContain("VerifiedAndReputablePolicyState");
    expect(lifecycle).toContain('CiTool.exe" -r');
    expect(lifecycle).toContain("Get-FileHash -Algorithm SHA256");
    expect(lifecycle).toContain('[Environment]::SetEnvironmentVariable("CODEX_HOME"');
  });

  it("keeps import diagnostics redacted", () => {
    const importHelper = source("scripts/live-e2e-import.cjs");

    expect(importHelper).toContain("classifyImportError");
    expect(importHelper).toContain('error: "Backend import failed"');
    expect(importHelper).not.toContain("error.message,");
    expect(importHelper).not.toContain("error.stack");
  });

  it("validates inactive identities with the official app-server before retaining two", () => {
    const validator = source("scripts/live-e2e-import.cjs");
    const faultHelper = source("scripts/live-e2e-fault.cjs");

    expect(validator).toContain("await manager.validateAuth(account.id)");
    expect(validator).toContain("identitiesVerifiedByOfficialAppServer: true");
    expect(validator).toContain("selected.length >= 2");
    expect(validator).toContain("selected.length !== 2");
    expect(validator).not.toContain("account.email,");
    expect(faultHelper).toContain('"arm-invalid-auth"');
    expect(faultHelper).toContain('"restore-auth"');
    expect(faultHelper).not.toContain("access_token:");
  });
});
