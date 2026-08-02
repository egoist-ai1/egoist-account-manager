param(
  [string]$ExecutablePath
)

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "release\win-unpacked"))
if (-not $ExecutablePath) {
  $ExecutablePath = Join-Path $allowedRoot "Codex Account Manager.exe"
}
$resolvedExecutable = [IO.Path]::GetFullPath($ExecutablePath)
if (-not $resolvedExecutable.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Packaged startup probe accepts only the project release/win-unpacked executable."
}
if (-not (Test-Path -LiteralPath $resolvedExecutable -PathType Leaf)) {
  throw "Packaged executable not found: $resolvedExecutable"
}

$executableRoot = [IO.Path]::GetDirectoryName($resolvedExecutable)
$probeData = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ("cam-packaged-probe-" + [Guid]::NewGuid().ToString("N"))))
$safeTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $probeData.StartsWith($safeTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Probe data path escaped the system temp directory."
}

function Get-TargetProcesses {
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($executableRoot, [StringComparison]::OrdinalIgnoreCase)
  })
}

$existing = @(Get-TargetProcesses)
if ($existing.Count) {
  throw "Refusing packaged probe because the target build is already running: $($existing.ProcessId -join ', ')."
}

$environmentNames = @("CAM_USER_DATA_DIR", "CAM_ALLOW_MULTIPLE_INSTANCE", "CAM_DISABLE_AUTO_UPDATE")
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

$probePassed = $false
$cleanupPassed = $false
$report = $null
New-Item -ItemType Directory -Path $probeData | Out-Null
try {
  [Environment]::SetEnvironmentVariable("CAM_USER_DATA_DIR", $probeData, "Process")
  [Environment]::SetEnvironmentVariable("CAM_ALLOW_MULTIPLE_INSTANCE", "1", "Process")
  [Environment]::SetEnvironmentVariable("CAM_DISABLE_AUTO_UPDATE", "1", "Process")
  Start-Process -FilePath $resolvedExecutable -WindowStyle Hidden | Out-Null

  $deadline = [DateTime]::UtcNow.AddSeconds(12)
  $main = $null
  $rendererReady = $false
  $mainLogPath = Join-Path $probeData "logs\main.log"
  do {
    Start-Sleep -Milliseconds 500
    $targetProcesses = @(Get-TargetProcesses)
    $main = $targetProcesses | Where-Object {
      $_.Name -eq "Codex Account Manager.exe" -and $_.CommandLine -notmatch "--type="
    } | Select-Object -First 1
    if ($main -and (Test-Path -LiteralPath $mainLogPath -PathType Leaf)) {
      $mainLog = Get-Content -Raw -LiteralPath $mainLogPath
      $rendererReady = $mainLog.Contains("Renderer loaded") -and -not $mainLog.Contains("Failed to load packaged renderer")
    }
  } while ((-not $main -or -not $rendererReady) -and [DateTime]::UtcNow -lt $deadline)

  if (-not $main) { throw "Packaged main process did not reach startup readiness." }
  if (-not $rendererReady) { throw "Packaged renderer did not finish loading within 12 seconds." }
  $logFiles = @(Get-ChildItem -LiteralPath $probeData -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "\.log$|crash" })
  $report = [ordered]@{
    passed = $false
    runtimePassed = $true
    cleanupPassed = $false
    version = (Get-Item -LiteralPath $resolvedExecutable).VersionInfo.ProductVersion
    mainPid = $main.ProcessId
    processCount = @(Get-TargetProcesses).Count
    rendererReady = $rendererReady
    isolatedUserData = $true
    logFiles = $logFiles.Count
  }
  $probePassed = $true
}
finally {
  foreach ($name in $environmentNames) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
  }

  for ($attempt = 0; $attempt -lt 4; $attempt += 1) {
    $targets = @(Get-TargetProcesses | Sort-Object ParentProcessId -Descending)
    if (-not $targets.Count) { break }
    foreach ($candidate in $targets) {
      $verified = Get-CimInstance Win32_Process -Filter "ProcessId = $($candidate.ProcessId)" -ErrorAction SilentlyContinue
      $verifiedPath = if ($verified) { [string]$verified.ExecutablePath } else { "" }
      if ($verifiedPath -and $verifiedPath.StartsWith($executableRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $verified.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Milliseconds 250
  }

  $remaining = @(Get-TargetProcesses)
  if ($remaining.Count) {
    throw "Packaged probe cleanup left target processes: $($remaining.ProcessId -join ', ')."
  }
  if ($probePassed -and (Test-Path -LiteralPath $probeData)) {
    $cleanupError = $null
    for ($attempt = 0; $attempt -lt 16; $attempt += 1) {
      try {
        Remove-Item -LiteralPath $probeData -Recurse -Force -ErrorAction Stop
        $cleanupError = $null
        break
      } catch {
        $cleanupError = $_
        Start-Sleep -Milliseconds 250
      }
    }
    if (Test-Path -LiteralPath $probeData) {
      $detail = if ($cleanupError) { $cleanupError.Exception.Message } else { "unknown filesystem lock" }
      throw "Packaged probe runtimePassed=True; cleanupPassed=False: $detail"
    }
  }
  $cleanupPassed = $probePassed
}

if ($report) {
  $report.passed = $report.runtimePassed -and $cleanupPassed
  $report.cleanupPassed = $cleanupPassed
  $report | ConvertTo-Json
}
