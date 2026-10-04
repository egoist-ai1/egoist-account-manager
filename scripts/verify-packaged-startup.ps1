param(
  [string]$ExecutablePath,
  [switch]$Installed,
  [string]$InstallTestRoot
)

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$safeTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
# Resolve the Windows known folder before replacing the child's environment.
$realLocalAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$installedExecutable = [IO.Path]::GetFullPath((Join-Path $realLocalAppData "Programs\Account Manager EGO\Account Manager EGO.exe"))

function Test-ChildPath([string]$Path, [string]$Root) {
  $boundary = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  return [IO.Path]::GetFullPath($Path).StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)
}

if ($Installed -and $InstallTestRoot) { throw "Choose -Installed or -InstallTestRoot, not both." }
if ($Installed) {
  if ($ExecutablePath -and -not [string]::Equals([IO.Path]::GetFullPath($ExecutablePath), $installedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
    throw "-Installed accepts only the exact current-user Account Manager EGO executable."
  }
  $ExecutablePath = $installedExecutable
} elseif ($InstallTestRoot) {
  $InstallTestRoot = [IO.Path]::GetFullPath($InstallTestRoot)
  if (-not (Test-ChildPath $InstallTestRoot $safeTempRoot)) { throw "-InstallTestRoot must be a child of the current TEMP directory." }
  if (-not (Test-Path -LiteralPath (Join-Path $InstallTestRoot "installer-test.flag") -PathType Leaf)) { throw "-InstallTestRoot requires an isolated /TEST installation marker." }
  $testExecutable = Join-Path $InstallTestRoot "Account Manager EGO.exe"
  if ($ExecutablePath -and -not [string]::Equals([IO.Path]::GetFullPath($ExecutablePath), $testExecutable, [StringComparison]::OrdinalIgnoreCase)) {
    throw "-InstallTestRoot accepts only its exact Account Manager EGO executable."
  }
  $ExecutablePath = $testExecutable
} else {
  $allowedRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "release\win-unpacked"))
  if (-not $ExecutablePath) { $ExecutablePath = Join-Path $allowedRoot "Account Manager EGO.exe" }
  if (-not (Test-ChildPath $ExecutablePath $allowedRoot)) { throw "Packaged startup probe accepts only a project release/win-unpacked executable." }
  if ([IO.Path]::GetFileName($ExecutablePath) -notin @("Account Manager EGO.exe", "Egoist Account Manager.exe")) { throw "Unexpected packaged application executable." }
}
$resolvedExecutable = [IO.Path]::GetFullPath($ExecutablePath)
if (-not (Test-Path -LiteralPath $resolvedExecutable -PathType Leaf)) { throw "Packaged executable not found: $resolvedExecutable" }

$probeData = [IO.Path]::GetFullPath((Join-Path $safeTempRoot ("cam-packaged-probe-" + [Guid]::NewGuid().ToString("N"))))
if (-not (Test-ChildPath $probeData $safeTempRoot)) { throw "Probe data path escaped TEMP." }
function Get-TargetProcesses {
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and [string]::Equals([IO.Path]::GetFullPath($_.ExecutablePath), $resolvedExecutable, [StringComparison]::OrdinalIgnoreCase)
  })
}
$existing = @(Get-TargetProcesses)
if ($existing.Count) { throw "Refusing probe because the exact target build is already running: $($existing.ProcessId -join ', ')." }

$ownedProcesses = @{}
$launchedPid = 0
$probeStartedAt = [DateTime]::UtcNow
function Get-ProbeProcesses {
  $targets = @(Get-TargetProcesses)
  for ($round = 0; $round -lt $targets.Count + 1; $round += 1) {
    foreach ($candidate in $targets) {
      $identity = $candidate.CreationDate.ToUniversalTime().Ticks
      $candidateId = [int]$candidate.ProcessId
      if ($ownedProcesses.ContainsKey($candidateId)) { continue }
      if (($candidateId -eq $launchedPid -or $ownedProcesses.ContainsKey([int]$candidate.ParentProcessId)) -and $candidate.CreationDate.ToUniversalTime() -ge $probeStartedAt) {
        $ownedProcesses[$candidateId] = $identity
      }
    }
  }
  @($targets | Where-Object { $ownedProcesses.ContainsKey([int]$_.ProcessId) -and $ownedProcesses[[int]$_.ProcessId] -eq $_.CreationDate.ToUniversalTime().Ticks })
}

$environmentNames = @("CAM_USER_DATA_DIR", "CAM_ALLOW_MULTIPLE_INSTANCE", "CAM_DISABLE_AUTO_UPDATE", "CAM_BACKGROUND_PROBE", "CAM_DISABLE_EXTERNAL_APP_LAUNCH", "CODEX_HOME", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA")
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
$probePassed = $false
$report = $null
New-Item -ItemType Directory -Path $probeData | Out-Null
try {
  $isolatedProfile = Join-Path $probeData "profile"
  $environment = @{
    CAM_USER_DATA_DIR = (Join-Path $probeData "user-data")
    CAM_ALLOW_MULTIPLE_INSTANCE = "1"
    CAM_DISABLE_AUTO_UPDATE = "1"
    CAM_BACKGROUND_PROBE = "1"
    CAM_DISABLE_EXTERNAL_APP_LAUNCH = "1"
    CODEX_HOME = (Join-Path $isolatedProfile ".codex")
    HOME = $isolatedProfile
    USERPROFILE = $isolatedProfile
    APPDATA = (Join-Path $isolatedProfile "AppData\Roaming")
    LOCALAPPDATA = (Join-Path $isolatedProfile "AppData\Local")
  }
  foreach ($name in $environment.Keys) {
    if ($name -in @("CAM_USER_DATA_DIR", "CODEX_HOME", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA")) {
      New-Item -ItemType Directory -Force -Path $environment[$name] | Out-Null
    }
    [Environment]::SetEnvironmentVariable($name, $environment[$name], "Process")
  }
  $launched = Start-Process -FilePath $resolvedExecutable -WindowStyle Hidden -PassThru
  $launchedPid = $launched.Id
  $deadline = [DateTime]::UtcNow.AddSeconds(12)
  $main = $null
  $rendererReady = $false
  $mainLogPath = Join-Path $environment.CAM_USER_DATA_DIR "logs\main.log"
  do {
    Start-Sleep -Milliseconds 500
    $main = @(Get-ProbeProcesses) | Where-Object { $_.ProcessId -eq $launchedPid -and $_.CommandLine -notmatch "--type=" } | Select-Object -First 1
    if ($main -and (Test-Path -LiteralPath $mainLogPath -PathType Leaf)) {
      $mainLog = Get-Content -Raw -LiteralPath $mainLogPath
      $rendererReady = $mainLog.Contains("Renderer loaded") -and -not $mainLog.Contains("Failed to load packaged renderer")
    }
  } while ((-not $main -or -not $rendererReady) -and [DateTime]::UtcNow -lt $deadline)
  if (-not $main) { throw "Packaged main process did not reach startup readiness. Probe evidence: $probeData" }
  if (-not $rendererReady) { throw "Packaged renderer did not finish loading within 12 seconds. Probe evidence: $probeData" }
  $report = [ordered]@{
    passed = $false
    runtimePassed = $true
    cleanupPassed = $false
    version = (Get-Item -LiteralPath $resolvedExecutable).VersionInfo.ProductVersion
    mainPid = $main.ProcessId
    processCount = @(Get-ProbeProcesses).Count
    rendererReady = $rendererReady
    isolatedUserData = $true
    isolatedAuthPaths = $true
    backgroundProbe = $true
    externalAppLaunchDisabled = $true
    mode = $(if ($Installed) { "installed" } elseif ($InstallTestRoot) { "test-install" } else { "unpacked" })
  }
  $probePassed = $true
} finally {
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process") }
  for ($attempt = 0; $attempt -lt 4; $attempt += 1) {
    $targets = @(Get-ProbeProcesses | Sort-Object ParentProcessId -Descending)
    if (-not $targets.Count) { break }
    foreach ($candidate in $targets) {
      $verified = Get-CimInstance Win32_Process -Filter "ProcessId = $($candidate.ProcessId)" -ErrorAction SilentlyContinue
      if ($verified -and $verified.ExecutablePath -and [string]::Equals([IO.Path]::GetFullPath($verified.ExecutablePath), $resolvedExecutable, [StringComparison]::OrdinalIgnoreCase) -and $verified.CreationDate.ToUniversalTime().Ticks -eq $ownedProcesses[[int]$candidate.ProcessId]) {
        Stop-Process -Id $verified.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Milliseconds 250
  }
  $remaining = @(Get-ProbeProcesses)
  if ($remaining.Count) { throw "Packaged probe cleanup left owned processes: $($remaining.ProcessId -join ', ')." }
  if ($probePassed -and (Test-Path -LiteralPath $probeData)) {
    if (-not (Test-ChildPath $probeData $safeTempRoot)) { throw "Unsafe probe cleanup target." }
    for ($attempt = 0; $attempt -lt 16; $attempt += 1) {
      try { Remove-Item -LiteralPath $probeData -Recurse -Force -ErrorAction Stop; break }
      catch { Start-Sleep -Milliseconds 250 }
    }
    if (Test-Path -LiteralPath $probeData) { throw "Packaged probe runtimePassed=True; cleanupPassed=False. Evidence: $probeData" }
  }
}
if ($report) { $report.passed = $true; $report.cleanupPassed = $true; $report | ConvertTo-Json }