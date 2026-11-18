param(
  [ValidateRange(1, 100)][int]$Runs = 30,
  [ValidateRange(0, 14400)][int]$IdleSeconds = 600,
  [ValidateRange(250, 10000)][int]$SampleIntervalMs = 1000,
  [string]$ProbeWorkRoot = $env:CAM_TEST_WORK_DIR,
  [string]$ReportPath
)

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
if (-not $ReportPath) {
  $stamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
  $ReportPath = Join-Path $projectRoot "artifacts\3.2.0\verification\native-fresh-$stamp.json"
}
$ReportPath = [IO.Path]::GetFullPath($ReportPath)
$boundary = $projectRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
if (-not $ReportPath.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) { throw "Benchmark report must remain inside this project." }
$raw = [Collections.Generic.List[object]]::new()
$failures = [Collections.Generic.List[object]]::new()
$startedAt = [DateTimeOffset]::UtcNow.ToString("o")
for ($run = 1; $run -le $Runs; $run += 1) {
  try {
    $arguments = @{ SampleSeconds = $(if ($run -eq $Runs) { $IdleSeconds } else { 0 }); SampleIntervalMs = $SampleIntervalMs }
    if ($ProbeWorkRoot) { $arguments.ProbeWorkRoot = $ProbeWorkRoot }
    $receipt = (& (Join-Path $PSScriptRoot "verify-packaged-startup.ps1") @arguments) | ConvertFrom-Json
    $raw.Add([ordered]@{ run = $run; receipt = $receipt })
  } catch {
    $failures.Add([ordered]@{ run = $run; error = $_.Exception.Message })
  }
}

function Percentile([object[]]$Values, [double]$Quantile) {
  $sorted = @($Values | Sort-Object)
  if ($sorted.Count -eq 0) { return $null }
  return [double]$sorted[[Math]::Max(0, [Math]::Ceiling($Quantile * $sorted.Count) - 1)]
}

$receipts = @($raw.ToArray() | ForEach-Object { $_.receipt })
$startup = @($receipts | ForEach-Object { $_.launchToRendererReadyMs })
$memory = @($receipts | ForEach-Object { $_.privateBytesInitial })
$idle = @($receipts | Where-Object { $_.sampleSeconds -gt 0 } | Select-Object -Last 1)
$summary = [ordered]@{
  schemaVersion = 1; startedAt = $startedAt; finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
  version = [string]$package.version; mode = "isolated-hidden-shipping"; fixture = "fresh-empty-profile"
  hardware = [ordered]@{ os = [Environment]::OSVersion.VersionString; logicalProcessors = [Environment]::ProcessorCount }
  requestedRuns = $Runs; completedRuns = $receipts.Count; failures = @($failures.ToArray())
  startupP50Ms = Percentile $startup 0.5; startupP95Ms = Percentile $startup 0.95
  startupMinMs = Percentile $startup 0; startupMaxMs = Percentile $startup 1
  privateBytesP50 = Percentile $memory 0.5; privateBytesP95 = Percentile $memory 0.95
  idle = $(if ($idle.Count) { $idle[0] } else { $null })
  limitations = @("Not a cold-cache benchmark; Windows file cache is not purged.", "Hidden fresh shipping app; visible UI, account fixtures and competitors require separate controlled protocols.", "Process counters cover sampled owned descendants; very short-lived children may fall between samples.", "No provider identity or quota network calls occur in isolated mode.")
  runs = @($raw.ToArray())
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
$summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
[ordered]@{ reportPath = $ReportPath; completedRuns = $receipts.Count; failedRuns = $failures.Count; startupP50Ms = $summary.startupP50Ms; startupP95Ms = $summary.startupP95Ms } | ConvertTo-Json
if ($failures.Count -gt 0) { exit 1 }
