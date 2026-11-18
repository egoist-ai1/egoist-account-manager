param(
  [string]$ExecutablePath,
  [switch]$Installed,
  [string]$InstallTestRoot,
  [string]$ProbeWorkRoot = $env:CAM_TEST_WORK_DIR,
  [ValidateRange(0, 14400)][int]$SampleSeconds = 0,
  [ValidateRange(0, 60)][int]$SampleWarmupSeconds = 3,
  [ValidateRange(250, 10000)][int]$SampleIntervalMs = 1000,
  [string]$ReportPath
)

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$productName = [string]$package.build.productName
$outputRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot ([string]$package.build.directories.output)))
$safeTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
if (-not $ProbeWorkRoot) { $ProbeWorkRoot = $safeTempRoot }
$ProbeWorkRoot = [IO.Path]::GetFullPath($ProbeWorkRoot).TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath $ProbeWorkRoot -PathType Container)) { throw "Probe work root does not exist." }
# Resolve the Windows known folder before replacing the child's environment.
$realLocalAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$installedExecutable = [IO.Path]::GetFullPath((Join-Path $realLocalAppData "Programs\$productName\$productName.exe"))

function Test-ChildPath([string]$Path, [string]$Root) {
  $boundary = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  return [IO.Path]::GetFullPath($Path).StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)
}

function Get-Sha256Hex([string]$Path) {
  $stream = $null
  $sha256 = $null
  try {
    $stream = [IO.File]::OpenRead($Path)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    if ($sha256) { $sha256.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
}

if ($ReportPath) {
  $ReportPath = [IO.Path]::GetFullPath($ReportPath)
  if (-not (Test-ChildPath $ReportPath $projectRoot) -and -not (Test-ChildPath $ReportPath $ProbeWorkRoot)) { throw "Report path must remain inside project or task work." }
}

if ($Installed -and $InstallTestRoot) { throw "Choose -Installed or -InstallTestRoot, not both." }
if ($Installed) {
  if ($ExecutablePath -and -not [string]::Equals([IO.Path]::GetFullPath($ExecutablePath), $installedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
    throw "-Installed accepts only the exact current-user $productName executable."
  }
  $ExecutablePath = $installedExecutable
} elseif ($InstallTestRoot) {
  $InstallTestRoot = [IO.Path]::GetFullPath($InstallTestRoot)
  if (-not (Test-ChildPath $InstallTestRoot $safeTempRoot) -and -not (Test-ChildPath $InstallTestRoot $ProbeWorkRoot)) { throw "-InstallTestRoot must be a child of the current TEMP or task work directory." }
  if (-not (Test-Path -LiteralPath (Join-Path $InstallTestRoot "installer-test.flag") -PathType Leaf)) { throw "-InstallTestRoot requires an isolated /TEST installation marker." }
  $testExecutable = Join-Path $InstallTestRoot "$productName.exe"
  if ($ExecutablePath -and -not [string]::Equals([IO.Path]::GetFullPath($ExecutablePath), $testExecutable, [StringComparison]::OrdinalIgnoreCase)) {
    throw "-InstallTestRoot accepts only its exact $productName executable."
  }
  $ExecutablePath = $testExecutable
} else {
  $allowedRoot = Join-Path $outputRoot "win-unpacked"
  if (-not $ExecutablePath) { $ExecutablePath = Join-Path $allowedRoot "$productName.exe" }
  if (-not (Test-ChildPath $ExecutablePath $allowedRoot)) { throw "Packaged startup probe accepts only the current project release/win-unpacked output boundary." }
  if ([IO.Path]::GetFileName($ExecutablePath) -ne "$productName.exe") { throw "Unexpected packaged application executable." }
}
$resolvedExecutable = [IO.Path]::GetFullPath($ExecutablePath)
if (-not (Test-Path -LiteralPath $resolvedExecutable -PathType Leaf)) { throw "Packaged executable not found: $resolvedExecutable" }

$probeToken = [Guid]::NewGuid().ToString()
$probeData = [IO.Path]::GetFullPath((Join-Path $ProbeWorkRoot "egoist-probe-$probeToken"))
if (-not (Test-ChildPath $probeData $ProbeWorkRoot)) { throw "Probe data path escaped its work boundary." }
function Get-TargetProcesses {
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and [string]::Equals([IO.Path]::GetFullPath($_.ExecutablePath), $resolvedExecutable, [StringComparison]::OrdinalIgnoreCase)
  })
}
$existing = @(Get-TargetProcesses)
if ($existing.Count) { throw "Refusing probe because the exact target build is already running: $($existing.ProcessId -join ', ')." }

$ownedProcesses = @{}
$cpuByIdentity = @{}
$launchedPid = 0
$probeStartedAt = [DateTime]::UtcNow
function Get-ProbeProcesses {
  $targets = @(Get-CimInstance Win32_Process)
  $byId = @{}
  foreach ($candidate in $targets) { $byId[[int]$candidate.ProcessId] = $candidate }
  for ($round = 0; $round -lt $targets.Count + 1; $round += 1) {
    $changed = $false
    foreach ($candidate in $targets) {
      $identity = $candidate.CreationDate.ToUniversalTime().Ticks
      $candidateId = [int]$candidate.ProcessId
      if ($ownedProcesses.ContainsKey($candidateId)) { continue }
      $parentId = [int]$candidate.ParentProcessId
      $parentMatches = $ownedProcesses.ContainsKey($parentId) -and $byId.ContainsKey($parentId) -and $byId[$parentId].CreationDate.ToUniversalTime().Ticks -eq $ownedProcesses[$parentId] -and $ownedProcesses[$parentId] -le $identity
      $rootMatches = $candidateId -eq $launchedPid -and $candidate.ExecutablePath -and [string]::Equals([IO.Path]::GetFullPath($candidate.ExecutablePath), $resolvedExecutable, [StringComparison]::OrdinalIgnoreCase)
      if (($rootMatches -or $parentMatches) -and $candidate.CreationDate.ToUniversalTime() -ge $probeStartedAt) {
        $ownedProcesses[$candidateId] = $identity
        $changed = $true
      }
    }
    if (-not $changed) { break }
  }
  @($targets | Where-Object { $ownedProcesses.ContainsKey([int]$_.ProcessId) -and $ownedProcesses[[int]$_.ProcessId] -eq $_.CreationDate.ToUniversalTime().Ticks })
}

function Get-TreeSample([double]$ElapsedMs) {
  $tree = @(Get-ProbeProcesses)
  $privateBytes = [double]0
  $metricProcesses = 0
  foreach ($candidate in $tree) {
    $identity = "$($candidate.ProcessId):$($candidate.CreationDate.ToUniversalTime().Ticks)"
    $cpuByIdentity[$identity] = ([double]$candidate.KernelModeTime + [double]$candidate.UserModeTime) / 10000000
    $native = $null
    try {
      $native = [Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId)
      $native.Refresh()
      if ($native.StartTime.ToUniversalTime().ToString('yyyyMMddHHmmss.ffffff') -eq $candidate.CreationDate.ToUniversalTime().ToString('yyyyMMddHHmmss.ffffff')) {
        $privateBytes += [double]$native.PrivateMemorySize64
        $metricProcesses += 1
      }
    } catch { }
    finally { if ($native) { $native.Dispose() } }
  }
  if ($tree.Count -gt 0 -and $metricProcesses -eq 0) { throw "Unable to read private memory of the verified process tree." }
  $cpuSeconds = [double]0
  foreach ($value in $cpuByIdentity.Values) { $cpuSeconds += [double]$value }
  [ordered]@{ elapsedMs = $ElapsedMs; processCount = $tree.Count; metricProcessCount = $metricProcesses; privateBytes = $privateBytes; cpuSeconds = $cpuSeconds }
}

$environmentNames = @("CAM_USER_DATA_DIR", "CAM_ALLOW_MULTIPLE_INSTANCE", "CAM_DISABLE_AUTO_UPDATE", "CAM_BACKGROUND_PROBE", "CAM_DISABLE_EXTERNAL_APP_LAUNCH", "CAM_DISABLE_EXTERNAL_OPEN", "CAM_PROBE_MODE", "CAM_PROBE_ROOT", "CAM_PROBE_TOKEN", "CAM_PROBE_READY_FILE", "CODEX_HOME", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA")
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
$probePassed = $false
$report = $null
New-Item -ItemType Directory -Path $probeData | Out-Null
@{ schemaVersion = 1; purpose = "egoist-isolated-probe"; token = $probeToken } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $probeData ".egoist-probe-root.json") -Encoding UTF8
try {
  $isolatedProfile = Join-Path $probeData "profile"
  $environment = @{
    CAM_USER_DATA_DIR = (Join-Path $probeData "user-data")
    CAM_ALLOW_MULTIPLE_INSTANCE = "1"
    CAM_DISABLE_AUTO_UPDATE = "1"
    CAM_BACKGROUND_PROBE = "1"
    CAM_DISABLE_EXTERNAL_APP_LAUNCH = "1"
    CAM_DISABLE_EXTERNAL_OPEN = "1"
    CAM_PROBE_MODE = "isolated"
    CAM_PROBE_ROOT = $probeData
    CAM_PROBE_TOKEN = $probeToken
    CAM_PROBE_READY_FILE = (Join-Path $probeData "renderer-ready.json")
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
  $probeStartedAt = [DateTime]::UtcNow
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $launchUnixMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $launched = Start-Process -FilePath $resolvedExecutable -WindowStyle Hidden -PassThru
  $launchedPid = $launched.Id
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while (-not (Test-Path -LiteralPath $environment.CAM_PROBE_READY_FILE -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline) {
    if ($launched.HasExited) { throw "Packaged application exited before readiness. Probe evidence: $probeData" }
    Start-Sleep -Milliseconds 25
    $launched.Refresh()
  }
  if (-not (Test-Path -LiteralPath $environment.CAM_PROBE_READY_FILE -PathType Leaf)) { throw "Packaged renderer did not signal readiness within 20 seconds. Probe evidence: $probeData" }
  $ready = Get-Content -LiteralPath $environment.CAM_PROBE_READY_FILE -Raw | ConvertFrom-Json
  if ($ready.schemaVersion -ne 1 -or $ready.token -ne $probeToken -or [int]$ready.pid -ne $launchedPid) { throw "Readiness signal does not belong to this launch." }
  if ([string]$ready.version -ne [string]$package.version) { throw "Readiness version does not match the current package." }
  foreach ($guard in @("credentialManager", "autostart", "externalLaunch", "providerNetwork")) {
    if ($ready.guards.$guard -ne $true) { throw "Native probe guard missing: $guard" }
  }
  if ([double]$ready.rendererReadyAtUnixMs -lt $launchUnixMs -or [double]$ready.processUptimeMs -le 0) { throw "Invalid readiness timestamps." }
  $observedMs = $clock.Elapsed.TotalMilliseconds
  if ($SampleSeconds -gt 0 -and $SampleWarmupSeconds -gt 0) { Start-Sleep -Seconds $SampleWarmupSeconds }
  $initial = Get-TreeSample $clock.Elapsed.TotalMilliseconds
  if (-not $ownedProcesses.ContainsKey($launchedPid)) { throw "Unable to verify launched process creation identity." }
  $samples = [Collections.Generic.List[object]]::new()
  $samples.Add($initial)
  $sampleClock = [Diagnostics.Stopwatch]::StartNew()
  while ($sampleClock.Elapsed.TotalSeconds -lt $SampleSeconds) {
    Start-Sleep -Milliseconds $SampleIntervalMs
    $sample = Get-TreeSample $clock.Elapsed.TotalMilliseconds
    if ($sample.processCount -eq 0) { throw "Probe process tree exited during sampling." }
    $samples.Add($sample)
  }
  $final = $samples[$samples.Count - 1]
  $sampleElapsedSeconds = ([double]$final.elapsedMs - [double]$initial.elapsedMs) / 1000
  $idleCpuPercentOneCore = $null
  if ($sampleElapsedSeconds -gt 0) { $idleCpuPercentOneCore = 100 * ([double]$final.cpuSeconds - [double]$initial.cpuSeconds) / $sampleElapsedSeconds }
  $report = [ordered]@{
    passed = $false
    runtimePassed = $true
    cleanupPassed = $false
    schemaVersion = 1
    version = [string]$ready.version
    executablePath = $resolvedExecutable
    executableSha256 = Get-Sha256Hex $resolvedExecutable
    mainPid = $launchedPid
    processCount = $initial.processCount
    rendererReady = $true
    processUptimeAtRendererReadyMs = [double]$ready.processUptimeMs
    launchToRendererReadyMs = [double]$ready.rendererReadyAtUnixMs - $launchUnixMs
    readinessObservedMs = $observedMs
    sampleSeconds = $sampleElapsedSeconds
    sampleIntervalMs = $SampleIntervalMs
    sampleWarmupSeconds = $(if ($SampleSeconds -gt 0) { $SampleWarmupSeconds } else { 0 })
    idleCpuPercentOneCore = $idleCpuPercentOneCore
    privateBytesInitial = $initial.privateBytes
    privateBytesFinal = $final.privateBytes
    privateBytesGrowth = [double]$final.privateBytes - [double]$initial.privateBytes
    wholeOwnedProcessTree = $true
    guardedNativeAdapters = $true
    providerNetworkDisabled = $true
    measurementMode = "isolated-hidden-shipping"
    fixture = "fresh-empty-profile"
    samples = @($samples.ToArray())
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
      if ($verified -and $verified.CreationDate.ToUniversalTime().Ticks -eq $ownedProcesses[[int]$candidate.ProcessId]) {
        Stop-Process -Id $verified.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Milliseconds 250
  }
  $remaining = @(Get-ProbeProcesses)
  if ($remaining.Count) { throw "Packaged probe cleanup left owned processes: $($remaining.ProcessId -join ', ')." }
  if ($probePassed -and (Test-Path -LiteralPath $probeData)) {
    if (-not (Test-ChildPath $probeData $ProbeWorkRoot) -or ((Get-Item -LiteralPath $probeData).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Unsafe probe cleanup target." }
    $directories = [Collections.Generic.Stack[string]]::new()
    $directories.Push($probeData)
    while ($directories.Count -gt 0) {
      foreach ($entry in Get-ChildItem -LiteralPath $directories.Pop() -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing cleanup of a probe containing a reparse point." }
        if ($entry.PSIsContainer) { $directories.Push($entry.FullName) }
      }
    }
    for ($attempt = 0; $attempt -lt 16; $attempt += 1) {
      try { Remove-Item -LiteralPath $probeData -Recurse -Force -ErrorAction Stop; break }
      catch { Start-Sleep -Milliseconds 250 }
    }
    if (Test-Path -LiteralPath $probeData) { throw "Packaged probe runtimePassed=True; cleanupPassed=False. Evidence: $probeData" }
  }
}
if ($report) {
  $report.passed = $true; $report.cleanupPassed = $true
  $json = $report | ConvertTo-Json -Depth 8
  if ($ReportPath) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
    $json | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  }
  $json
}
