[CmdletBinding(SupportsShouldProcess)]
param([switch]$Apply)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$sandboxRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "artifacts\sandbox\3.1.6-live-e2e"))
$stageRoot = Join-Path $sandboxRoot "stage"
$isolatedUserData = Join-Path $sandboxRoot "host-export-userdata"
$sourceAppData = Join-Path $env:APPDATA "Codex Account Manager"
$sourceDatabase = Join-Path $sourceAppData "accounts.sqlite"
$sourceVaultKey = Join-Path $sourceAppData "vault.key"
$sourceLocalState = Join-Path $sourceAppData "Local State"
$targetDatabase = Join-Path $isolatedUserData "accounts.sqlite"
$databaseReport = Join-Path $sandboxRoot "database-preparation.json"
$backendReport = Join-Path $sandboxRoot "backend-export.json"
$bundleReport = Join-Path $sandboxRoot "bundle-preparation.json"
$bundlePath = Join-Path $stageRoot "accounts.cam-export"
$passphrasePath = Join-Path $stageRoot "passphrase.txt"
$electronExe = Join-Path $projectRoot "node_modules\electron\dist\electron.exe"
$databaseHelper = Join-Path $PSScriptRoot "prepare-live-e2e-database.cjs"
$exportHelper = Join-Path $PSScriptRoot "export-live-e2e-bundle.cjs"
$runtimeRoot = Join-Path $projectRoot "dist\main"

function Assert-Inside([string]$Parent, [string]$Target) {
  $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $targetFull = [IO.Path]::GetFullPath($Target)
  if (-not $targetFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Target escaped its allowed root." }
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$Failure) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $Failure
}

function Quote-Argument([string]$Value) {
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Invoke-ElectronHelper([string]$ScriptPath, [string[]]$Arguments) {
  $argumentLine = @((Quote-Argument $ScriptPath)) + $Arguments
  $process = Start-Process -FilePath $electronExe -ArgumentList ($argumentLine -join " ") -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Isolated Electron helper failed." }
}

$plan = [ordered]@{
  source = "installed DPAPI vault; online database backup"
  selectedProfiles = "all inactive ready profiles (maximum 12); guest validates and retains exactly 2"
  activeProfileIncluded = $false
  exporter = "compiled 3.1.6 AccountManager backend"
  encryptedOutput = $bundlePath
  temporaryDatabaseRemoved = $true
}
if (-not $Apply) { $plan | ConvertTo-Json -Depth 5; exit 0 }
if (-not $PSCmdlet.ShouldProcess($sandboxRoot, "Export two filtered non-active profiles into an encrypted live E2E bundle")) { exit 0 }

foreach ($required in @(
  $sourceDatabase,
  $sourceVaultKey,
  $sourceLocalState,
  $electronExe,
  $databaseHelper,
  $exportHelper,
  (Join-Path $runtimeRoot "db.js"),
  (Join-Path $runtimeRoot "security.js"),
  (Join-Path $runtimeRoot "accountManager.js")
)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "A live transfer input is unavailable." }
}
Assert-Inside $sandboxRoot $isolatedUserData
Assert-Inside $sandboxRoot $bundlePath
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
if (Test-Path -LiteralPath $isolatedUserData) { Remove-Item -LiteralPath $isolatedUserData -Recurse -Force }
New-Item -ItemType Directory -Path $isolatedUserData -Force | Out-Null
Copy-Item -LiteralPath $sourceVaultKey -Destination (Join-Path $isolatedUserData "vault.key")
Copy-Item -LiteralPath $sourceLocalState -Destination (Join-Path $isolatedUserData "Local State")
foreach ($staleOutput in @($bundlePath, $passphrasePath, $databaseReport, $backendReport, $bundleReport)) {
  if (Test-Path -LiteralPath $staleOutput) { Remove-Item -LiteralPath $staleOutput -Force }
}

try {
  Invoke-ElectronHelper $databaseHelper @(
    "--source", (Quote-Argument $sourceDatabase),
    "--target", (Quote-Argument $targetDatabase),
    "--target-user-data", (Quote-Argument $isolatedUserData),
    "--allowed-root", (Quote-Argument $sandboxRoot),
    "--report", (Quote-Argument $databaseReport)
  )
  $databaseState = Get-Content -Raw -LiteralPath $databaseReport | ConvertFrom-Json
  if (-not $databaseState.passed -or $databaseState.selectedCount -lt 2 -or $databaseState.activeProfilesSelected -ne 0) {
    throw "Filtered database did not enforce the inactive two-profile boundary."
  }

  $random = [byte[]]::new(32)
  $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $randomGenerator.GetBytes($random) } finally { $randomGenerator.Dispose() }
  $passphrase = -join ($random | ForEach-Object { $_.ToString("x2") })
  [Array]::Clear($random, 0, $random.Length)
  [IO.File]::WriteAllText($passphrasePath, $passphrase, [Text.UTF8Encoding]::new($false))
  $passphrase = $null

  Invoke-ElectronHelper $exportHelper @(
    "--user-data", (Quote-Argument $isolatedUserData),
    "--allowed-root", (Quote-Argument $sandboxRoot),
    "--bundle", (Quote-Argument $bundlePath),
    "--passphrase-file", (Quote-Argument $passphrasePath),
    "--report", (Quote-Argument $backendReport),
    "--runtime-root", (Quote-Argument $runtimeRoot)
  )
  $backendState = Get-Content -Raw -LiteralPath $backendReport | ConvertFrom-Json
  if (-not $backendState.passed -or $backendState.exportedCount -ne $databaseState.selectedCount -or $backendState.exportedCount -lt 2 -or $backendState.activeProfilesExported -ne 0 -or $backendState.vaultDegraded) {
    throw "Compiled backend export did not preserve the encrypted inactive-only boundary."
  }

  [ordered]@{
    passed = $true
    selectedCount = $databaseState.selectedCount
    activeProfilesSelected = 0
    encryptedTransfer = $true
    exporter = "compiled 3.1.6 AccountManager backend"
    temporaryDatabaseRemoved = $false
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $bundleReport -Encoding UTF8
} finally {
  if (Test-Path -LiteralPath $isolatedUserData) {
    Wait-Until {
      try {
        Remove-Item -LiteralPath $isolatedUserData -Recurse -Force -ErrorAction Stop
        return $true
      } catch { return $false }
    } 15 "Ephemeral host export profile could not be removed."
  }
  if (Test-Path -LiteralPath $bundleReport) {
    $state = Get-Content -Raw -LiteralPath $bundleReport | ConvertFrom-Json
    $state.temporaryDatabaseRemoved = -not (Test-Path -LiteralPath $isolatedUserData)
    $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $bundleReport -Encoding UTF8
  }
}

$final = Get-Content -Raw -LiteralPath $bundleReport | ConvertFrom-Json
$final | ConvertTo-Json -Depth 5
if (-not $final.passed -or -not $final.temporaryDatabaseRemoved) { exit 1 }
