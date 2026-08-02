[CmdletBinding(SupportsShouldProcess)]
param([switch]$Apply, [switch]$CleanStage)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$sandboxRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "artifacts\sandbox\3.1.4"))
$stageRoot = Join-Path $sandboxRoot "stage"
$resultRoot = Join-Path $sandboxRoot "results"
$configPath = Join-Path $sandboxRoot "codex-account-manager-3.1.4.wsb"
$sandboxExe = Join-Path $env:SystemRoot "System32\WindowsSandbox.exe"
$artifacts = @(
  "Codex-Account-Manager-Setup-3.1.3.exe",
  "Codex-Account-Manager-Setup-3.1.4.exe",
  "Codex-Account-Manager-3.1.4.exe"
)

$plan = [ordered]@{
  project = $projectRoot
  sandboxAvailable = (Test-Path -LiteralPath $sandboxExe -PathType Leaf)
  stage = $stageRoot
  results = $resultRoot
  artifacts = $artifacts
  network = "Disable"
  clipboard = "Disable"
}
if ($CleanStage) {
  if (-not $Apply) { throw "-CleanStage requires -Apply." }
  if (-not $stageRoot.StartsWith($sandboxRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Stage cleanup escaped the sandbox artifact root." }
  if ($PSCmdlet.ShouldProcess($stageRoot, "Remove copied sandbox installers after a completed run")) {
    if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
  }
  [ordered]@{ cleaned = (-not (Test-Path -LiteralPath $stageRoot)); retainedResults = (Test-Path -LiteralPath (Join-Path $resultRoot "release-lifecycle.json")) } | ConvertTo-Json
  exit 0
}
if (-not $Apply) {
  $plan | ConvertTo-Json -Depth 4
  exit 0
}
if (-not $PSCmdlet.ShouldProcess($sandboxRoot, "Stage release artifacts and launch isolated Windows Sandbox lifecycle test")) { exit 0 }
if (-not (Test-Path -LiteralPath $sandboxExe -PathType Leaf)) { throw "Windows Sandbox executable is unavailable." }
if (-not $sandboxRoot.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Sandbox output escaped the project root." }

if (Test-Path -LiteralPath $sandboxRoot) { Remove-Item -LiteralPath $sandboxRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $resultRoot -Force | Out-Null
foreach ($artifact in $artifacts) {
  $source = Join-Path $projectRoot ("release\" + $artifact)
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Release artifact is missing: $source" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stageRoot $artifact)
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "windows-sandbox-release-test.ps1") -Destination (Join-Path $stageRoot "windows-sandbox-release-test.ps1")

$escapedStage = [Security.SecurityElement]::Escape($stageRoot)
$escapedResults = [Security.SecurityElement]::Escape($resultRoot)
$config = @"
<Configuration>
  <VGpu>Enable</VGpu>
  <Networking>Disable</Networking>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>$escapedStage</HostFolder><SandboxFolder>C:\CAM-Stage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$escapedResults</HostFolder><SandboxFolder>C:\CAM-Results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\CAM-Stage\windows-sandbox-release-test.ps1 -Apply</Command>
  </LogonCommand>
</Configuration>
"@
[IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))
Start-Process -FilePath $sandboxExe -ArgumentList ('"' + $configPath + '"') | Out-Null
[ordered]@{
  launched = $true
  config = $configPath
  complete = (Join-Path $resultRoot "complete.json")
  report = (Join-Path $resultRoot "release-lifecycle.json")
} | ConvertTo-Json
