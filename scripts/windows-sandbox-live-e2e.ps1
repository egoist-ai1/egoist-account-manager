[CmdletBinding(SupportsShouldProcess)]
param([switch]$Apply)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$stageRoot = [IO.Path]::GetFullPath("C:\CAM-Work\stage")
$resultRoot = [IO.Path]::GetFullPath("C:\CAM-Results")
$electronExe = "C:\CAM-Work\electron\electron.exe"
$installer315 = Join-Path $stageRoot "Codex-Account-Manager-Setup-3.1.5.exe"
$installer316 = Join-Path $stageRoot "Egoist-Account-Manager-Setup-3.1.6.exe"
$codexCliSource = Join-Path $stageRoot "Codex.exe"
$codexCliRoot = "C:\CAM-Work\codex-cli"
$codexCli = Join-Path $codexCliRoot "codex-real.exe"
$codexWrapper = Join-Path $codexCliRoot "codex.cmd"
$bundlePath = Join-Path $stageRoot "accounts.cam-export"
$passphrasePath = Join-Path $stageRoot "passphrase.txt"
$probeScript = Join-Path $stageRoot "live-e2e-probe.cjs"
$importScript = Join-Path $stageRoot "live-e2e-import.cjs"
$faultScript = Join-Path $stageRoot "live-e2e-fault.cjs"
$runtimeRoot = Join-Path $stageRoot "runtime\main"
$hostEgressPath = Join-Path $stageRoot "host-egress.sha256"
$installRoot = Join-Path $env:LOCALAPPDATA "Programs\codex-account-manager"
$installedExe315 = Join-Path $installRoot "Codex Account Manager.exe"
$installedExe316 = Join-Path $installRoot "Egoist Account Manager.exe"
$installedExe = $installedExe315
$appDataRoot = Join-Path $env:APPDATA "Codex Account Manager"
$codexHome = Join-Path $env:USERPROFILE ".codex"
$reportPath = Join-Path $resultRoot "live-e2e.json"
$completePath = Join-Path $resultRoot "complete.json"
$probeReportPath = Join-Path $resultRoot "state-probe.json"
$importReportPath = Join-Path $resultRoot "profile-import.json"
$faultReportPath = Join-Path $resultRoot "fault-injection.json"
$fixtureRoot = "C:\CAM-Work\codex-desktop-fixture"
$fixtureExe = Join-Path $fixtureRoot "app\ChatGPT.exe"
$fixtureHangFlag = "C:\CAM-Work\fixture-hang.flag"
$fixtureDelayFlag = "C:\CAM-Work\delay-cli.flag"
$fixtureCloseLog = "C:\CAM-Work\fixture-close-attempts.log"
$startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LiveE2EUser32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

function Write-Json([object]$Value, [string]$Path) {
  $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Wait-Until([scriptblock]$Predicate, [int]$Seconds, [string]$Failure) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    if (& $Predicate) { return }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $Failure
}

function Invoke-ProcessWithTimeout([string]$FilePath, [string[]]$Arguments, [int]$Seconds) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
  if (-not $process.WaitForExit($Seconds * 1000)) {
    try { $process.Kill() } catch { }
    throw "A bounded child process timed out."
  }
  if ($process.ExitCode -ne 0) { throw "A bounded child process failed." }
}

function Get-ManagerProcesses {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)
  })
}

function Stop-ManagerProcesses {
  foreach ($process in @(Get-ManagerProcesses | Sort-Object ParentProcessId -Descending)) {
    $verified = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ProcessId)" -ErrorAction SilentlyContinue
    if ($verified -and $verified.ExecutablePath -and $verified.ExecutablePath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
      Stop-Process -Id $verified.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Wait-Until { @(Get-ManagerProcesses).Count -eq 0 } 20 "Manager processes did not stop inside Sandbox."
}

function Get-ManagerWindow {
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.Equals($installedExe, [StringComparison]::OrdinalIgnoreCase) -and $_.MainWindowHandle -ne 0
  } | Select-Object -First 1
}

function Start-Manager {
  [Environment]::SetEnvironmentVariable("CAM_DISABLE_AUTO_UPDATE", "1", "Process")
  [Environment]::SetEnvironmentVariable("CAM_DISABLE_UPDATE_CHECK", "1", "Process")
  $env:PATH = "$codexCliRoot;$env:PATH"
  Start-Process -FilePath $installedExe -WorkingDirectory $stageRoot -ArgumentList @("--force-renderer-accessibility") | Out-Null
  Wait-Until { $null -ne (Get-ManagerWindow) } 40 "Manager window did not become visible."
  $window = Get-ManagerWindow
  [LiveE2EUser32]::SetForegroundWindow([IntPtr]$window.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 2
  return $window
}

function Dismiss-ReleaseNotes {
  $root = Get-ManagerRoot
  $dialogCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, "Что нового")
  $dialog = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $dialogCondition)
  if (-not $dialog) { return }
  foreach ($label in @("Понятно", "Закрыть")) {
    $buttonCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, $label)
    $button = $dialog.FindFirst([Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    if ($button -and $button.Current.IsEnabled -and -not $button.Current.IsOffscreen) {
      Click-Element $button
      Start-Sleep -Milliseconds 500
      return
    }
  }
  throw "The release notes dialog blocked the Manager test flow."
}

function Get-ManagerRoot {
  $window = Get-ManagerWindow
  if (-not $window) { throw "Manager window is unavailable." }
  return [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.MainWindowHandle)
}

function Find-NamedElement([Windows.Automation.AutomationElement]$Root, [string]$Name, [int]$Seconds = 20) {
  $automationCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, $Name)
  Wait-Until {
    $script:found = $Root.FindFirst([Windows.Automation.TreeScope]::Descendants, $automationCondition)
    return $null -ne $script:found
  } $Seconds "Required accessible control '$Name' was not found."
  return $script:found
}

function Click-Element([Windows.Automation.AutomationElement]$Element) {
  Wait-Until {
    try { return $Element.Current.IsEnabled -and -not $Element.Current.IsOffscreen } catch { return $false }
  } 30 "Accessible control '$($Element.Current.Name)' did not become actionable."
  try {
    $pattern = $Element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    ([Windows.Automation.InvokePattern]$pattern).Invoke()
    return
  } catch { }
  try {
    $pattern = $Element.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern)
    ([Windows.Automation.ExpandCollapsePattern]$pattern).Expand()
    return
  } catch { }
  throw "Accessible control '$($Element.Current.Name)' exposes no safe invoke pattern; coordinate input is forbidden in live E2E."
}

function Invoke-Probe {
  if (Test-Path -LiteralPath $probeReportPath) { Remove-Item -LiteralPath $probeReportPath -Force }
  $argumentList = @(
    ('"{0}"' -f $probeScript),
    '--app-data', ('"{0}"' -f $appDataRoot),
    '--codex-home', ('"{0}"' -f $codexHome),
    '--runtime-root', ('"{0}"' -f $runtimeRoot),
    '--started-at', [string]$startedAt,
    '--report', ('"{0}"' -f $probeReportPath)
  ) -join ' '
  $process = Start-Process -FilePath $electronExe -ArgumentList $argumentList -PassThru
  if (-not $process.WaitForExit(60000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Redacted state probe timed out."
  }
  if (-not (Test-Path -LiteralPath $probeReportPath -PathType Leaf)) { throw "Redacted state probe report is missing." }
  $state = Get-Content -LiteralPath $probeReportPath -Raw | ConvertFrom-Json
  $probeFailed = $state.PSObject.Properties.Name -contains "probeFailed" -and [bool]$state.probeFailed
  if ($process.ExitCode -ne 0 -or $probeFailed) {
    $errorStage = if ($state.PSObject.Properties.Name -contains "errorStage") { $state.errorStage } else { "unknown" }
    $errorClass = if ($state.PSObject.Properties.Name -contains "errorClass") { $state.errorClass } else { "unknown" }
    throw "Redacted state probe failed at ${errorStage}: ${errorClass}."
  }
  return $state
}

function Import-TestProfiles {
  if (Test-Path -LiteralPath $importReportPath) { Remove-Item -LiteralPath $importReportPath -Force }
  $argumentList = @(
    ('"{0}"' -f $importScript),
    '--app-data', ('"{0}"' -f $appDataRoot),
    '--bundle', ('"{0}"' -f $bundlePath),
    '--passphrase-file', ('"{0}"' -f $passphrasePath),
    '--codex-path', ('"{0}"' -f $codexCli),
    '--runtime-root', ('"{0}"' -f $runtimeRoot),
    '--report', ('"{0}"' -f $importReportPath)
  ) -join ' '
  $process = Start-Process -FilePath $electronExe -ArgumentList $argumentList -PassThru
  if (-not $process.WaitForExit(180000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Compiled encrypted profile import timed out."
  }
  if (-not (Test-Path -LiteralPath $importReportPath -PathType Leaf)) { throw "Compiled encrypted profile import report is missing." }
  $state = Get-Content -LiteralPath $importReportPath -Raw | ConvertFrom-Json
  if ($process.ExitCode -ne 0) {
    throw "Compiled encrypted profile import failed at $($state.errorStage): $($state.errorClass)."
  }
  if (-not $state.passed -or $state.importedCount -lt 2 -or $state.selectedCount -ne 2 -or $state.validCount -ne 2 -or -not $state.identitiesVerifiedByOfficialAppServer -or $state.activeProfilesImported -ne 0 -or $state.vaultDegraded) {
    throw "Compiled encrypted profile import violated the Sandbox boundary."
  }
  return $state
}

function Initialize-CodexRuntime {
  New-Item -ItemType Directory -Path $codexCliRoot -Force | Out-Null
  $signature = Get-AuthenticodeSignature -LiteralPath $codexCliSource
  if ($signature.Status.ToString() -ne "Valid" -or -not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch "OpenAI") {
    throw "The staged official Codex app-server binary has no valid OpenAI signature."
  }
  Copy-Item -LiteralPath $codexCliSource -Destination $codexCli -Force
  @"
@echo off
if exist "$fixtureDelayFlag" powershell.exe -NoProfile -Command "Start-Sleep -Seconds 20"
"$codexCli" %*
"@ | Set-Content -LiteralPath $codexWrapper -Encoding ASCII
  $env:PATH = "$codexCliRoot;$env:PATH"
}

function Install-CodexDesktopFixture {
  if (Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction SilentlyContinue) {
    throw "A real OpenAI.Codex package is present in the disposable guest; fixture registration was refused."
  }
  $appRoot = Join-Path $fixtureRoot "app"
  $assetRoot = Join-Path $fixtureRoot "assets"
  New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null
  $source = @'
using System;
using System.IO;
using System.Windows.Forms;
public static class Program {
  [STAThread]
  public static void Main() {
    Application.EnableVisualStyles();
    var form = new Form { Text = "Codex Live E2E Fixture", Width = 720, Height = 480, StartPosition = FormStartPosition.CenterScreen };
    form.FormClosing += (sender, args) => {
      if (File.Exists(@"C:\CAM-Work\fixture-hang.flag")) {
        File.AppendAllText(@"C:\CAM-Work\fixture-close-attempts.log", DateTime.UtcNow.ToString("o") + Environment.NewLine);
        args.Cancel = true;
      }
    };
    Application.Run(form);
  }
}
'@
  Add-Type -TypeDefinition $source -OutputAssembly $fixtureExe -OutputType WindowsApplication -ReferencedAssemblies @("System.Windows.Forms.dll", "System.Drawing.dll")
  Add-Type -AssemblyName System.Drawing
  foreach ($asset in @(@{ Name = "logo.png"; Size = 64 }, @{ Name = "Square44x44Logo.png"; Size = 44 }, @{ Name = "Square150x150Logo.png"; Size = 150 })) {
    $bitmap = New-Object Drawing.Bitmap($asset.Size, $asset.Size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([Drawing.Color]::FromArgb(124, 58, 237))
      $bitmap.Save((Join-Path $assetRoot $asset.Name), [Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
  $manifest = @'
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
  <Identity Name="OpenAI.Codex" ProcessorArchitecture="x64" Version="0.0.0.1" Publisher="CN=Egoist Live E2E" />
  <Properties><DisplayName>Codex Live E2E Fixture</DisplayName><PublisherDisplayName>Egoist Test</PublisherDisplayName><Logo>assets\logo.png</Logo></Properties>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
  <Applications>
    <Application Id="App" Executable="app\ChatGPT.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="Codex Live E2E Fixture" Description="Codex desktop lifecycle fixture" Square44x44Logo="assets\Square44x44Logo.png" Square150x150Logo="assets\Square150x150Logo.png" BackgroundColor="#7C3AED" />
    </Application>
  </Applications>
</Package>
'@
  $manifestPath = Join-Path $fixtureRoot "AppxManifest.xml"
  [IO.File]::WriteAllText($manifestPath, $manifest, [Text.UTF8Encoding]::new($false))
  New-Item -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Force | Out-Null
  Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name "AllowDevelopmentWithoutDevLicense" -Type DWord -Value 1
  Add-AppxPackage -Register $manifestPath
  $package = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction Stop | Select-Object -First 1
  if (-not $package -or -not $package.InstallLocation.StartsWith($fixtureRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The disposable Codex desktop fixture did not register in the guest."
  }
  Start-Process -FilePath $fixtureExe | Out-Null
  Wait-Until { @(Get-CodexPackageProcesses $fixtureRoot | Where-Object { $_.Name -eq "ChatGPT.exe" }).Count -ge 1 } 20 "Codex desktop fixture did not start."
  return $package
}

function Invoke-FaultHelper([string]$Operation) {
  if (Test-Path -LiteralPath $faultReportPath) { Remove-Item -LiteralPath $faultReportPath -Force }
  $argumentList = @(
    ('"{0}"' -f $faultScript),
    '--app-data', ('"{0}"' -f $appDataRoot),
    '--runtime-root', ('"{0}"' -f $runtimeRoot),
    '--operation', $Operation,
    '--report', ('"{0}"' -f $faultReportPath)
  ) -join ' '
  $process = Start-Process -FilePath $electronExe -ArgumentList $argumentList -PassThru
  if (-not $process.WaitForExit(60000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; throw "Fault helper timed out." }
  $state = if (Test-Path -LiteralPath $faultReportPath) { Get-Content -Raw -LiteralPath $faultReportPath | ConvertFrom-Json } else { $null }
  if ($process.ExitCode -ne 0 -or -not $state -or -not $state.passed) { throw "Fault helper failed safely." }
  return $state
}

function Open-SwitchDialog {
  $switchNameCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, "Переключить")
  $script:actionableSwitchButton = $null
  Wait-Until {
    $root = Get-ManagerRoot
    $buttons = $root.FindAll([Windows.Automation.TreeScope]::Descendants, $switchNameCondition)
    foreach ($candidate in $buttons) {
      try {
        if ($candidate.Current.IsEnabled -and -not $candidate.Current.IsOffscreen) {
          $script:actionableSwitchButton = $candidate
          return $true
        }
      } catch { }
    }
    return $false
  } 45 "No switch button became actionable after background refresh settled."
  Click-Element $script:actionableSwitchButton
  $root = Get-ManagerRoot
  $dialog = Find-NamedElement $root "Переключить аккаунт" 30
  return (Find-NamedElement $dialog "Переключить")
}

function Invoke-SwitchButton([int]$ExpectedCommitCount) {
  Click-Element (Open-SwitchDialog)
  Wait-Until {
    $probe = Invoke-Probe
    return $probe.committedTransactionCount -ge $ExpectedCommitCount -and $probe.activeCount -eq 1 -and $probe.globalMatchesActive
  } 150 "Live account switch did not reach a verified commit."
}

function Invoke-SwitchExpectRollback(
  [int]$ExpectedRollbackCount,
  [int]$PreviousOrdinal,
  [Windows.Automation.AutomationElement]$PreparedConfirmation
) {
  Click-Element $PreparedConfirmation
  Wait-Until {
    $probe = Invoke-Probe
    return $probe.rolledBackTransactionCount -ge $ExpectedRollbackCount -and
      $probe.activeOrdinal -eq $PreviousOrdinal -and $probe.globalMatchesActive -and
      $probe.latestTransactionErrorCode -eq "POST_ACTIVATION_VERIFICATION_FAILED"
  } 150 "Failed authorization did not produce a verified automatic rollback."
}

function Get-CodexPackageProcesses([string]$PackageRoot) {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($PackageRoot, [StringComparison]::OrdinalIgnoreCase)
  })
}

function Sanitize-Error([string]$Message) {
  $value = $Message -replace '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+', '[email]'
  $value = $value -replace 'C:\\Users\\[^\\\s]+', 'C:\Users\[user]'
  return $value -replace '(?i)(token|secret|password)[=: ]+[^\s]+', '$1=[redacted]'
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

$plan = [ordered]@{
  sandbox = $true
  sourceProfiles = "all inactive ready candidates; exactly two retained after live identity validation"
  activeHostProfileIncluded = $false
  upgrade = "3.1.5 -> 3.1.6"
  liveSwitches = 4
  failureScenarios = @("desktop hang with exact-tree fallback", "manager crash during activation", "invalid authorization rollback")
  codexRuntime = "signed official codex.exe app-server plus disposable desktop lifecycle fixture"
  egress = "same IPv4 hash as host"
}
if (-not $Apply) { $plan | ConvertTo-Json -Depth 5; exit 0 }
if (-not $PSCmdlet.ShouldProcess("Windows Sandbox", "Run isolated live identity, upgrade, switch and recovery verification")) { exit 0 }

$results = [ordered]@{
  schemaVersion = 1
  startedAt = [DateTime]::UtcNow.ToString("o")
  finishedAt = $null
  passed = $false
  checks = [ordered]@{}
  observations = [ordered]@{}
  failedChecks = @()
  error = $null
}

try {
  foreach ($required in @($electronExe, $installer315, $installer316, $codexCliSource, $bundlePath, $passphrasePath, $probeScript, $importScript, $faultScript, (Join-Path $runtimeRoot "accountManager.js"), $hostEgressPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "A staged live E2E input is missing." }
  }
  New-Item -ItemType Directory -Path $resultRoot -Force | Out-Null

  $hostEgress = (Get-Content -Raw -LiteralPath $hostEgressPath).Trim()
  $guestIp = (& curl.exe -4 --silent --show-error --fail --max-time 20 "https://api.ipify.org").Trim()
  $guestEgress = Get-Sha256Hex $guestIp
  $guestIp = $null
  $results.checks.samePublicEgress = $hostEgress -eq $guestEgress

  Initialize-CodexRuntime
  $results.checks.officialCodexAppServerSigned = (Get-AuthenticodeSignature -LiteralPath $codexCli).Status.ToString() -eq "Valid"

  Invoke-ProcessWithTimeout $installer315 @("/S") 150
  Wait-Until { (Test-Path -LiteralPath $installedExe) -and ((Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion -like "3.1.5*") } 45 "3.1.5 did not install."
  $results.checks.freshInstall315 = $true
  $importState = Import-TestProfiles
  $results.observations.importedInactiveCandidateCount = [int]$importState.importedCount
  $results.checks.twoInactiveIdentitiesLiveVerified = $importState.selectedCount -eq 2 -and $importState.validCount -eq 2 -and $importState.identitiesVerifiedByOfficialAppServer
  $results.observations.liveIdentityAttempts = [int]$importState.attemptedCount
  $results.observations.invalidSavedIdentitiesSkipped = [int]$importState.invalidCount
  Start-Manager | Out-Null
  Dismiss-ReleaseNotes
  $imported = Invoke-Probe
  $results.checks.importedTwoReadyProfiles = $imported.accountCount -eq 2 -and $imported.readyCount -eq 2 -and $imported.activeCount -eq 0 -and $imported.identitiesDistinct

  $previousManagerIds = @(Get-ManagerProcesses | Select-Object -ExpandProperty ProcessId)
  Invoke-ProcessWithTimeout $installer316 @("/S") 180
  $installedExe = $installedExe316
  Wait-Until { (Test-Path -LiteralPath $installedExe) -and ((Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion -like "3.1.6*") } 45 "3.1.6 did not replace 3.1.5."
  try {
    Wait-Until { @($previousManagerIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -eq 0 } 30 "Upgrade left the previous Manager process tree running."
  } catch { }
  $results.checks.runningUpgrade316 = $true
  $results.checks.upgradeClosed315Tree = @($previousManagerIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -eq 0
  Stop-ManagerProcesses
  Start-Manager | Out-Null
  Dismiss-ReleaseNotes
  $afterUpgrade = Invoke-Probe
  $results.checks.vaultPreservedAcrossUpgrade = $afterUpgrade.accountCount -eq 2 -and $afterUpgrade.readyCount -eq 2 -and -not $afterUpgrade.vaultDegraded
  $results.checks.managedPlaintextSealed = $afterUpgrade.managedPlaintextCount -eq 0

  $codexPackage = Install-CodexDesktopFixture
  $results.checks.isolatedDesktopFixtureRegistered = $null -ne $codexPackage -and $codexPackage.InstallLocation.StartsWith($fixtureRoot, [StringComparison]::OrdinalIgnoreCase)

  $root = Get-ManagerRoot
  Click-Element (Find-NamedElement $root "Аккаунты")
  Start-Sleep -Seconds 1
  $root = Get-ManagerRoot
  $switchControl = Find-NamedElement $root "Переключить"
  $results.checks.switchButtonInvokable = $switchControl.Current.IsEnabled -and -not $switchControl.Current.IsOffscreen

  $refreshCandidates = $root.FindAll(
    [Windows.Automation.TreeScope]::Descendants,
    (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, "Обновить"))
  )
  $refreshButton = $null
  foreach ($candidate in $refreshCandidates) {
    if ($candidate.Current.IsEnabled -and -not $candidate.Current.IsOffscreen) {
      if (-not $refreshButton -or $candidate.Current.BoundingRectangle.Left -gt $refreshButton.Current.BoundingRectangle.Left) { $refreshButton = $candidate }
    }
  }
  if (-not $refreshButton) { throw "Refresh-all control was unavailable." }
  Click-Element $refreshButton
  try {
    Wait-Until { (Invoke-Probe).freshQuotaCount -eq 2 } 45 "Both pre-switch quota snapshots did not refresh."
    $results.observations.preSwitchFreshQuotaCount = 2
  } catch {
    $results.observations.preSwitchFreshQuotaCount = (Invoke-Probe).freshQuotaCount
  }

  Invoke-SwitchButton 1
  $first = Invoke-Probe
  $firstCodex = @(Get-CodexPackageProcesses $codexPackage.InstallLocation)
  $results.checks.firstSwitchCommitted = $first.committedTransactionCount -eq 1 -and $first.failedTransactionCount -eq 0 -and $first.globalMatchesActive
  $results.checks.codexLaunched = $firstCodex.Count -gt 0
  $results.observations.firstActiveQuotaFresh = $first.freshQuotaCount -ge 1

  $firstCodexIds = @($firstCodex | Select-Object -ExpandProperty ProcessId)
  New-Item -ItemType File -Path $fixtureHangFlag -Force | Out-Null
  try { Invoke-SwitchButton 2 } finally { Remove-Item -LiteralPath $fixtureHangFlag -Force -ErrorAction SilentlyContinue }
  $second = Invoke-Probe
  $secondCodex = @(Get-CodexPackageProcesses $codexPackage.InstallLocation)
  $results.checks.secondSwitchCommitted = $second.committedTransactionCount -eq 2 -and $second.activeOrdinal -ne $first.activeOrdinal -and $second.failedTransactionCount -eq 0
  $results.checks.codexRestartedForSecondProfile = $secondCodex.Count -gt 0 -and @($firstCodexIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -eq 0
  $results.checks.hungDesktopRecoveredByExactTreeFallback = (Test-Path -LiteralPath $fixtureCloseLog) -and @($firstCodexIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -eq 0

  $confirm = Open-SwitchDialog
  New-Item -ItemType File -Path $fixtureDelayFlag -Force | Out-Null
  Click-Element $confirm
  Wait-Until {
    $phase = (Invoke-Probe).latestTransactionPhase
    return $phase -in @("launching", "verifying")
  } 60 "The crash injection point after auth activation was not reached."
  Stop-ManagerProcesses
  Remove-Item -LiteralPath $fixtureDelayFlag -Force -ErrorAction SilentlyContinue
  Start-Manager | Out-Null
  Dismiss-ReleaseNotes
  Wait-Until {
    $script:afterCrashRecovery = Invoke-Probe
    return $afterCrashRecovery.committedTransactionCount -ge 3 -and $afterCrashRecovery.activeOrdinal -ne $second.activeOrdinal -and $afterCrashRecovery.globalMatchesActive
  } 150 "Startup did not recover the transaction interrupted after activation."
  $results.checks.crashDuringActivationRecovered = $afterCrashRecovery.latestTransactionStatus -eq "committed" -and $afterCrashRecovery.recoveryRequiredTransactionCount -eq 0

  Stop-ManagerProcesses
  Start-Manager | Out-Null
  Dismiss-ReleaseNotes
  $afterManagerRestart = Invoke-Probe
  $results.checks.managerHardRestartPreservedIdentity = $afterManagerRestart.activeOrdinal -eq $afterCrashRecovery.activeOrdinal -and $afterManagerRestart.globalMatchesActive
  $root = Get-ManagerRoot
  Click-Element (Find-NamedElement $root "Аккаунты")
  Start-Sleep -Seconds 1

  $previousOrdinal = [int]$afterManagerRestart.activeOrdinal
  $invalidAuthConfirmation = Open-SwitchDialog
  Invoke-FaultHelper "arm-invalid-auth" | Out-Null
  try {
    Invoke-SwitchExpectRollback 1 $previousOrdinal $invalidAuthConfirmation
  } finally {
    Invoke-FaultHelper "restore-auth" | Out-Null
  }
  $afterRollback = Invoke-Probe
  $results.checks.failedAuthorizationRolledBack = $afterRollback.rolledBackTransactionCount -eq 1 -and $afterRollback.activeOrdinal -eq $previousOrdinal -and $afterRollback.globalMatchesActive

  Invoke-SwitchButton 4
  $finalSwitch = Invoke-Probe
  $finalCodex = @(Get-CodexPackageProcesses $codexPackage.InstallLocation)
  $results.checks.restoredProfileSwitchesAfterRollback = $finalSwitch.committedTransactionCount -eq 4 -and $finalSwitch.activeOrdinal -ne $previousOrdinal -and $finalSwitch.globalMatchesActive
  $results.checks.desktopFixtureAliveAfterRecovery = $finalCodex.Count -gt 0
  $results.checks.noRecoveryRequiredTransactions = $finalSwitch.recoveryRequiredTransactionCount -eq 0 -and $finalSwitch.failedTransactionCount -eq 0

  $failedChecks = @($results.checks.GetEnumerator() | Where-Object { $_.Value -ne $true } | ForEach-Object { $_.Key })
  $results.failedChecks = $failedChecks
  $results.passed = $failedChecks.Count -eq 0
} catch {
  $results.error = Sanitize-Error $_.Exception.Message
  $results.failedChecks = @($results.checks.GetEnumerator() | Where-Object { $_.Value -ne $true } | ForEach-Object { $_.Key })
} finally {
  Remove-Item -LiteralPath $fixtureHangFlag -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $fixtureDelayFlag -Force -ErrorAction SilentlyContinue
  try { Stop-ManagerProcesses } catch { }
  $results.finishedAt = [DateTime]::UtcNow.ToString("o")
  Write-Json $results $reportPath
  Write-Json ([ordered]@{ passed = $results.passed; report = $reportPath; finishedAt = $results.finishedAt }) $completePath
  Start-Sleep -Seconds 3
  Start-Process -FilePath shutdown.exe -ArgumentList @("/s", "/t", "5", "/f") -WindowStyle Hidden | Out-Null
}

if (-not $results.passed) { exit 1 }
