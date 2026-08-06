[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$Apply,
  [switch]$Finalize,
  [switch]$CleanStage
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
if ($PSVersionTable.PSEdition -eq "Desktop") {
  $env:PSModulePath = @(
    (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "WindowsPowerShell\Modules"),
    (Join-Path $env:ProgramFiles "WindowsPowerShell\Modules"),
    (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules")
  ) -join ";"
}
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop

$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$sandboxRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "artifacts\sandbox\3.1.6-live-e2e"))
$stageRoot = Join-Path $sandboxRoot "stage"
$resultRoot = Join-Path $sandboxRoot "results"
$configPath = Join-Path $sandboxRoot "codex-account-manager-3.1.6-live.wsb"
$baselinePath = Join-Path $sandboxRoot "host-state-baseline.json"
$sandboxExe = Join-Path $env:SystemRoot "System32\WindowsSandbox.exe"
$electronExe = Join-Path $projectRoot "node_modules\electron\dist\electron.exe"
$hostAppData = Join-Path $env:APPDATA "Codex Account Manager"
$installer315 = Join-Path $projectRoot "release\Codex-Account-Manager-Setup-3.1.5.exe"
$installer316 = Join-Path $projectRoot "release\Egoist-Account-Manager-Setup-3.1.6.exe"
$hostCodexPackage = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction SilentlyContinue | Select-Object -First 1
$hostCodexCli = if ($hostCodexPackage) { Join-Path $hostCodexPackage.InstallLocation "app\resources\codex.exe" } else { $null }

function Assert-Inside([string]$Parent, [string]$Target) {
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $targetFull = [IO.Path]::GetFullPath($Target)
  if (-not $targetFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Target escaped its allowed root."
  }
}

function Get-ProtectedHostProcesses {
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $byPid = @{}
  foreach ($process in $all) { $byPid[[int]$process.ProcessId] = $process }
  @($all | Where-Object {
    $isDesktopRoot = $_.Name -in @("ChatGPT.exe", "Codex.exe") -and
      $_.ExecutablePath -and $_.ExecutablePath -match '\\app\\(ChatGPT|Codex)\.exe$' -and
      $_.CommandLine -notmatch '(^|\s)--type(?:=|\s)'
    $parent = $byPid[[int]$_.ParentProcessId]
    $isManagerRoot = $_.Name -in @("Codex Account Manager.exe", "Egoist Account Manager.exe") -and $_.ExecutablePath -and
      (-not $parent -or -not $parent.ExecutablePath -or -not $parent.ExecutablePath.Equals($_.ExecutablePath, [StringComparison]::OrdinalIgnoreCase))
    $isDesktopRoot -or $isManagerRoot
  } | Sort-Object Name, ProcessId | ForEach-Object {
    [ordered]@{
      name = $_.Name
      processId = [int]$_.ProcessId
      createdAt = if ($_.CreationDate) { ([DateTime]$_.CreationDate).ToUniversalTime().ToString("o") } else { $null }
      createdAtUtcTicks = if ($_.CreationDate) { ([DateTime]$_.CreationDate).ToUniversalTime().Ticks } else { 0 }
    }
  })
}

function Get-HostAuthSnapshot {
  $authPath = Join-Path $env:USERPROFILE ".codex\auth.json"
  if (-not (Test-Path -LiteralPath $authPath -PathType Leaf)) {
    return [ordered]@{ exists = $false; length = 0; lastWriteUtc = $null; sha256 = $null }
  }
  $item = Get-Item -LiteralPath $authPath
  return [ordered]@{
    exists = $true
    length = [long]$item.Length
    lastWriteUtc = $item.LastWriteTimeUtc.ToString("o")
    lastWriteUtcTicks = $item.LastWriteTimeUtc.Ticks
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $authPath).Hash
  }
}

function Get-HostInvariant {
  return [ordered]@{
    processes = @(Get-ProtectedHostProcesses)
    auth = Get-HostAuthSnapshot
  }
}

function Test-HostInvariant([object]$Baseline, [object]$Current) {
  $baselineProcesses = @($Baseline.processes)
  $currentProcesses = @($Current.processes)
  if ($baselineProcesses.Count -ne $currentProcesses.Count) { return $false }
  foreach ($entry in $baselineProcesses) {
    $match = @($currentProcesses | Where-Object {
      $_.processId -eq $entry.processId -and $_.name -eq $entry.name -and
        [long]$_.createdAtUtcTicks -eq [long]$entry.createdAtUtcTicks
    })
    if ($match.Count -ne 1) { return $false }
  }
  return $Baseline.auth.exists -eq $Current.auth.exists -and
    $Baseline.auth.length -eq $Current.auth.length -and
    [long]$Baseline.auth.lastWriteUtcTicks -eq [long]$Current.auth.lastWriteUtcTicks -and
    $Baseline.auth.sha256 -eq $Current.auth.sha256
}

function Get-WindowsSandboxProcesses {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -in @("WindowsSandbox.exe", "WindowsSandboxClient.exe", "WindowsSandboxRemoteSession.exe", "WindowsSandboxServer.exe")
  })
}

function Write-Json([object]$Value, [string]$Path) {
  $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-Sha256Hex([string]$Value) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))
    return -join ($hash | ForEach-Object { $_.ToString("x2") })
  } finally {
    $algorithm.Dispose()
  }
}

function Remove-SensitiveStage {
  Assert-Inside $sandboxRoot $stageRoot
  if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
  if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
}

$plan = [ordered]@{
  sandboxAvailable = Test-Path -LiteralPath $sandboxExe -PathType Leaf
  sandboxBusy = @(Get-WindowsSandboxProcesses | Where-Object { $_.Name -eq "WindowsSandboxServer.exe" }).Count -gt 0
  codexIdentityRuntime = "signed OpenAI codex.exe app-server copied read-only; no Store bootstrap"
  sourceManagerVaultAvailable = (Test-Path -LiteralPath (Join-Path $hostAppData "accounts.sqlite")) -and (Test-Path -LiteralPath (Join-Path $hostAppData "vault.key"))
  candidateAvailable = Test-Path -LiteralPath $installer316 -PathType Leaf
  currentHostProcessesProtected = @((Get-HostInvariant).processes).Count
  network = "enabled; external IPv4 compared by SHA-256 only"
  transfer = "inactive ready profiles only; encrypted .cam-export; guest retains two live-verified identities"
  output = $resultRoot
}

if ($CleanStage) {
  if (-not $Apply) { throw "-CleanStage requires -Apply." }
  if ($PSCmdlet.ShouldProcess($stageRoot, "Delete the ephemeral live E2E credential stage")) {
    Remove-SensitiveStage
  }
  [ordered]@{ cleaned = -not (Test-Path -LiteralPath $stageRoot); resultsRetained = Test-Path -LiteralPath $resultRoot } | ConvertTo-Json
  exit 0
}

if ($Finalize) {
  if (-not $Apply) { throw "-Finalize requires -Apply." }
  $completePath = Join-Path $resultRoot "complete.json"
  $guestReportPath = Join-Path $resultRoot "live-e2e.json"
  if (-not (Test-Path -LiteralPath $completePath -PathType Leaf) -or -not (Test-Path -LiteralPath $guestReportPath -PathType Leaf)) {
    throw "Live E2E has not produced a complete guest report."
  }
  # Windows PowerShell 5.1 nests an array when ConvertFrom-Json is wrapped
  # directly in @(...). Materialize first so each protected PID is compared.
  $baseline = Get-Content -Raw -LiteralPath $baselinePath | ConvertFrom-Json
  $current = Get-HostInvariant
  $unchanged = Test-HostInvariant $baseline $current
  $guest = Get-Content -Raw -LiteralPath $guestReportPath | ConvertFrom-Json
  $final = [ordered]@{
    passed = [bool]$guest.passed -and $unchanged
    guestPassed = [bool]$guest.passed
    hostProtectedProcessesUnchanged = $unchanged
    hostAuthUnchanged = $baseline.auth.sha256 -eq $current.auth.sha256 -and
      [long]$baseline.auth.lastWriteUtcTicks -eq [long]$current.auth.lastWriteUtcTicks
    hostProtectedProcessCountBefore = @($baseline.processes).Count
    hostProtectedProcessCountAfter = @($current.processes).Count
    sensitiveStageRemoved = $false
    finalizedAt = [DateTime]::UtcNow.ToString("o")
  }
  if ($PSCmdlet.ShouldProcess($stageRoot, "Remove ephemeral encrypted credentials and Sandbox mapping")) {
    Remove-SensitiveStage
    $final.sensitiveStageRemoved = -not (Test-Path -LiteralPath $stageRoot)
  }
  Write-Json $final (Join-Path $resultRoot "final.json")
  $final | ConvertTo-Json -Depth 5
  if (-not $final.passed -or -not $final.sensitiveStageRemoved) { exit 1 }
  exit 0
}

if (-not $Apply) {
  $plan | ConvertTo-Json -Depth 6
  exit 0
}

if (-not $PSCmdlet.ShouldProcess($sandboxRoot, "Prepare two encrypted non-active profiles and launch isolated live E2E")) { exit 0 }
if (-not (Test-Path -LiteralPath $sandboxExe -PathType Leaf)) { throw "Windows Sandbox executable is unavailable." }
$existingOwnSession = Get-WindowsSandboxProcesses | Where-Object {
  $_.Name -eq "WindowsSandboxRemoteSession.exe" -and
  $_.CommandLine -and
  $_.CommandLine.IndexOf($configPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
} | Select-Object -First 1
if ($existingOwnSession) { throw "The Egoist Account Manager live Sandbox is already running." }
if (@(Get-WindowsSandboxProcesses | Where-Object { $_.Name -eq "WindowsSandboxServer.exe" }).Count -gt 0) {
  throw "A real Windows Sandbox VM is already running. Error-only RemoteSession windows are ignored."
}
foreach ($required in @($installer315, $installer316, $electronExe, $hostCodexCli, (Join-Path $hostAppData "accounts.sqlite"), (Join-Path $hostAppData "vault.key"))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required live E2E input is unavailable: $required" }
}
$initialInvariant = Get-HostInvariant
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
& $pnpm run rebuild:native:electron
if ($LASTEXITCODE -ne 0) { throw "Electron-native dependency rebuild failed before live E2E preparation." }
Assert-Inside $projectRoot $sandboxRoot
if (Test-Path -LiteralPath $sandboxRoot) { Remove-Item -LiteralPath $sandboxRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $resultRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageRoot "runtime\node_modules") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageRoot "runtime\main") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageRoot "runtime\shared") -Force | Out-Null

Copy-Item -LiteralPath $installer315 -Destination (Join-Path $stageRoot (Split-Path -Leaf $installer315))
Copy-Item -LiteralPath $installer316 -Destination (Join-Path $stageRoot (Split-Path -Leaf $installer316))
$codexCliStagePath = Join-Path $stageRoot "Codex.exe"
$codexCliSignature = Get-AuthenticodeSignature -LiteralPath $hostCodexCli
if ($codexCliSignature.Status.ToString() -ne "Valid" -or
    -not $codexCliSignature.SignerCertificate -or
    $codexCliSignature.SignerCertificate.Subject -notmatch "OpenAI") {
  throw "The installed official Codex CLI signature is not valid."
}
Copy-Item -LiteralPath $hostCodexCli -Destination $codexCliStagePath
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "windows-sandbox-live-e2e.ps1") -Destination (Join-Path $stageRoot "windows-sandbox-live-e2e.ps1")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "windows-sandbox-live-e2e-bootstrap.ps1") -Destination (Join-Path $stageRoot "windows-sandbox-live-e2e-bootstrap.ps1")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "live-e2e-probe.mjs") -Destination (Join-Path $stageRoot "live-e2e-probe.mjs")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "live-e2e-probe.cjs") -Destination (Join-Path $stageRoot "live-e2e-probe.cjs")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "live-e2e-import.cjs") -Destination (Join-Path $stageRoot "live-e2e-import.cjs")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "live-e2e-fault.cjs") -Destination (Join-Path $stageRoot "live-e2e-fault.cjs")
Copy-Item -LiteralPath (Join-Path $projectRoot "package.json") -Destination (Join-Path $stageRoot "runtime\package.json")
Copy-Item -Path (Join-Path $projectRoot "dist\main\*") -Destination (Join-Path $stageRoot "runtime\main") -Recurse
Copy-Item -Path (Join-Path $projectRoot "dist\shared\*") -Destination (Join-Path $stageRoot "runtime\shared") -Recurse

$betterSqlite = (Get-Item -LiteralPath (Join-Path $projectRoot "node_modules\better-sqlite3")).Target
$bindingsLink = Join-Path (Split-Path -Parent $betterSqlite) "bindings"
$bindings = (Get-Item -LiteralPath $bindingsLink).Target
$fileUriLink = Join-Path (Split-Path -Parent $bindings) "file-uri-to-path"
$fileUri = (Get-Item -LiteralPath $fileUriLink).Target
$nanoid = (Get-Item -LiteralPath (Join-Path $projectRoot "node_modules\nanoid")).Target
Copy-Item -LiteralPath $betterSqlite -Destination (Join-Path $stageRoot "runtime\node_modules\better-sqlite3") -Recurse
Copy-Item -LiteralPath $bindings -Destination (Join-Path $stageRoot "runtime\node_modules\bindings") -Recurse
Copy-Item -LiteralPath $fileUri -Destination (Join-Path $stageRoot "runtime\node_modules\file-uri-to-path") -Recurse
Copy-Item -LiteralPath $nanoid -Destination (Join-Path $stageRoot "runtime\node_modules\nanoid") -Recurse

$transferOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "prepare-live-e2e-transfer.ps1") -Apply
if ($LASTEXITCODE -ne 0) { throw "Packaged live E2E transfer preparation failed." }
$bundleReport = Get-Content -Raw -LiteralPath (Join-Path $sandboxRoot "bundle-preparation.json") | ConvertFrom-Json
if (-not $bundleReport.passed -or $bundleReport.selectedCount -lt 2 -or $bundleReport.activeProfilesSelected -ne 0 -or -not $bundleReport.temporaryDatabaseRemoved) {
  throw "Packaged live E2E transfer did not preserve the inactive-only boundary."
}

$hostIp = (& curl.exe -4 --silent --show-error --fail --max-time 20 "https://api.ipify.org").Trim()
if (-not $hostIp) { throw "Could not establish the host IPv4 egress for comparison." }
$hostIpHash = Get-Sha256Hex $hostIp
[IO.File]::WriteAllText((Join-Path $stageRoot "host-egress.sha256"), $hostIpHash, [Text.UTF8Encoding]::new($false))
$hostIp = $null

$preLaunchInvariant = Get-HostInvariant
if (-not (Test-HostInvariant $initialInvariant $preLaunchInvariant)) {
  Remove-SensitiveStage
  throw "Host Codex state changed during live E2E preparation; Sandbox launch was blocked."
}
Write-Json $initialInvariant $baselinePath

$escapedStage = [Security.SecurityElement]::Escape($stageRoot)
$escapedResults = [Security.SecurityElement]::Escape($resultRoot)
$escapedElectron = [Security.SecurityElement]::Escape((Split-Path -Parent $electronExe))
$config = @"
<Configuration>
  <VGpu>Enable</VGpu>
  <ProtectedClient>Disable</ProtectedClient>
  <Networking>Enable</Networking>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>$escapedStage</HostFolder><SandboxFolder>C:\CAM-Stage</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$escapedResults</HostFolder><SandboxFolder>C:\CAM-Results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$escapedElectron</HostFolder><SandboxFolder>C:\CAM-Electron</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\CAM-Stage\windows-sandbox-live-e2e-bootstrap.ps1</Command>
  </LogonCommand>
</Configuration>
"@
[IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))
Start-Process -FilePath $sandboxExe -ArgumentList ('"' + $configPath + '"') | Out-Null
$remoteSession = $null
$sessionDeadline = [DateTime]::UtcNow.AddSeconds(25)
do {
  Start-Sleep -Milliseconds 500
  $remoteSession = Get-WindowsSandboxProcesses | Where-Object {
    $_.Name -eq "WindowsSandboxRemoteSession.exe" -and
    $_.CommandLine -and
    $_.CommandLine.IndexOf($configPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
  } | Select-Object -First 1
} while (-not $remoteSession -and [DateTime]::UtcNow -lt $sessionDeadline)
if (-not $remoteSession) { throw "Windows Sandbox did not create an isolated remote session." }
[ordered]@{
  launched = $true
  currentHostProcessesProtected = @((Get-HostInvariant).processes).Count
  activeHostProfileIncluded = $false
  encryptedProfileCount = [int]$bundleReport.selectedCount
  complete = Join-Path $resultRoot "complete.json"
  report = Join-Path $resultRoot "live-e2e.json"
} | ConvertTo-Json -Depth 5
