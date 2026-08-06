$ErrorActionPreference = "Stop"

$resultRoot = "C:\CAM-Results"
$mappedStageRoot = "C:\CAM-Stage"
$mappedElectronRoot = "C:\CAM-Electron"
$workRoot = "C:\CAM-Work"
$localStageRoot = Join-Path $workRoot "stage"
$localElectronRoot = Join-Path $workRoot "electron"
$mainScript = Join-Path $localStageRoot "windows-sandbox-live-e2e.ps1"
$bootstrapPath = Join-Path $resultRoot "bootstrap.json"
New-Item -ItemType Directory -Path $resultRoot -Force | Out-Null

$state = [ordered]@{
  started = $true
  mainScriptPresent = Test-Path -LiteralPath $mainScript -PathType Leaf
  smartAppControlDisabledForTest = $false
  codeIntegrityPolicyRefreshed = $false
  mainExitCode = $null
  completePresent = $false
  reportPresent = $false
  bootstrapFailed = $false
  finishedAt = $null
}
$state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $bootstrapPath -Encoding UTF8

try {
  # Microsoft documents this registry override plus CiTool refresh for testing
  # unsigned apps. It changes only this disposable Sandbox instance.
  $policyPath = "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy"
  New-Item -Path $policyPath -Force | Out-Null
  Set-ItemProperty -Path $policyPath -Name "VerifiedAndReputablePolicyState" -Type DWord -Value 0
  $state.smartAppControlDisabledForTest = (Get-ItemPropertyValue -Path $policyPath -Name "VerifiedAndReputablePolicyState") -eq 0
  & "$env:SystemRoot\System32\CiTool.exe" -r | Out-Null
  $state.codeIntegrityPolicyRefreshed = $LASTEXITCODE -eq 0
  if (-not $state.smartAppControlDisabledForTest -or -not $state.codeIntegrityPolicyRefreshed) {
    throw "Disposable unsigned-test execution mode did not activate."
  }
  Start-Sleep -Seconds 2
  # Windows Sandbox can apply stricter Application Control rules to executables
  # launched directly from host-mapped folders. Copy the immutable inputs to the
  # guest's ephemeral disk first; the entire work tree disappears with the VM.
  if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $localStageRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $localElectronRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $mappedStageRoot "*") -Destination $localStageRoot -Recurse -Force
  Copy-Item -Path (Join-Path $mappedElectronRoot "*") -Destination $localElectronRoot -Recurse -Force
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $mainScript -Apply
  $state.mainExitCode = $LASTEXITCODE
} catch {
  $state.mainExitCode = 1
  $state.bootstrapFailed = $true
} finally {
  $state.completePresent = Test-Path -LiteralPath (Join-Path $resultRoot "complete.json") -PathType Leaf
  $state.reportPresent = Test-Path -LiteralPath (Join-Path $resultRoot "live-e2e.json") -PathType Leaf
  $state.finishedAt = [DateTime]::UtcNow.ToString("o")
  $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $bootstrapPath -Encoding UTF8
  Start-Process -FilePath shutdown.exe -ArgumentList @("/s", "/t", "10", "/f") -WindowStyle Hidden | Out-Null
}

if ($state.mainExitCode -ne 0 -or -not $state.completePresent -or -not $state.reportPresent) { exit 1 }
