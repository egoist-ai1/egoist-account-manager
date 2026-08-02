[CmdletBinding(SupportsShouldProcess)]
param([switch]$Apply)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$stageRoot = [IO.Path]::GetFullPath("C:\CAM-Stage")
$resultRoot = [IO.Path]::GetFullPath("C:\CAM-Results")
$installer314 = Join-Path $stageRoot "Codex-Account-Manager-Setup-3.1.4.exe"
$installer315 = Join-Path $stageRoot "Codex-Account-Manager-Setup-3.1.5.exe"
$portable315 = Join-Path $stageRoot "Codex-Account-Manager-3.1.5.exe"
$installRoot = Join-Path $env:LOCALAPPDATA "Programs\codex-account-manager"
$installedExe = Join-Path $installRoot "Codex Account Manager.exe"
$uninstaller = Join-Path $installRoot "Uninstall Codex Account Manager.exe"
$appDataRoot = Join-Path $env:APPDATA "Codex Account Manager"
$databasePath = Join-Path $appDataRoot "accounts.sqlite"
$markerPath = Join-Path $appDataRoot "sandbox-upgrade-marker.txt"
$reportPath = Join-Path $resultRoot "release-lifecycle.json"
$completePath = Join-Path $resultRoot "complete.json"

function Write-Result([hashtable]$Value, [string]$Path) {
  $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$Failure) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw $Failure
}

function Invoke-ProcessWithTimeout([string]$FilePath, [string[]]$Arguments, [int]$Seconds) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
  if (-not $process.WaitForExit($Seconds * 1000)) {
    try { $process.Kill() } catch { }
    throw "Timed out: $FilePath $($Arguments -join ' ')"
  }
  if ($process.ExitCode -ne 0) { throw "Process failed with exit code $($process.ExitCode): $FilePath" }
}

function Get-ManagedProcesses {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)
  })
}

function Stop-ManagedProcesses {
  foreach ($process in @(Get-ManagedProcesses | Sort-Object ParentProcessId -Descending)) {
    $verified = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ProcessId)" -ErrorAction SilentlyContinue
    if ($verified -and $verified.ExecutablePath -and $verified.ExecutablePath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
      Stop-Process -Id $verified.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Wait-Until { @(Get-ManagedProcesses).Count -eq 0 } 15 "Installed application processes did not stop."
}

function Start-And-Probe([string]$Executable, [string]$UserDataDir, [int]$Seconds = 25) {
  New-Item -ItemType Directory -Path $UserDataDir -Force | Out-Null
  $previousUserData = [Environment]::GetEnvironmentVariable("CAM_USER_DATA_DIR", "Process")
  try {
    [Environment]::SetEnvironmentVariable("CAM_USER_DATA_DIR", $UserDataDir, "Process")
    [Environment]::SetEnvironmentVariable("CAM_ALLOW_MULTIPLE_INSTANCE", "1", "Process")
    [Environment]::SetEnvironmentVariable("CAM_DISABLE_AUTO_UPDATE", "1", "Process")
    [Environment]::SetEnvironmentVariable("CAM_DISABLE_EXTERNAL_OPEN", "1", "Process")
    Start-Process -FilePath $Executable | Out-Null
    $logPath = Join-Path $UserDataDir "logs\main.log"
    Wait-Until {
      if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) { return $false }
      $log = Get-Content -Raw -LiteralPath $logPath
      return $log.Contains("Renderer loaded") -and -not $log.Contains("Failed to load packaged renderer")
    } $Seconds "Packaged renderer did not become ready: $Executable"
    return @{ rendererReady = $true; logPath = $logPath }
  } finally {
    [Environment]::SetEnvironmentVariable("CAM_USER_DATA_DIR", $previousUserData, "Process")
  }
}

function Capture-Desktop([string]$Path) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Show-InstalledWindow {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CamWindowProbe {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
  $main = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.Equals($installedExe, [StringComparison]::OrdinalIgnoreCase) -and $_.MainWindowHandle -ne 0
  } | Select-Object -First 1
  if ($main) {
    [CamWindowProbe]::ShowWindowAsync($main.MainWindowHandle, 9) | Out-Null
    [CamWindowProbe]::SetForegroundWindow($main.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 750
  }
}

$plan = [ordered]@{
  sandbox = $true
  network = "disabled by host config"
  tests = @("fresh-install-3.1.4", "running-upgrade-3.1.5", "data-persistence", "uninstall", "reinstall-3.1.5", "portable-startup")
}
if (-not $Apply) {
  $plan | ConvertTo-Json -Depth 4
  exit 0
}

if (-not $PSCmdlet.ShouldProcess("Windows Sandbox", "Run isolated install, upgrade, uninstall, reinstall and portable probes")) { exit 0 }
foreach ($required in @($installer314, $installer315, $portable315)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing staged artifact: $required" }
}
New-Item -ItemType Directory -Path $resultRoot -Force | Out-Null
$results = [ordered]@{
  passed = $false
  startedAt = [DateTime]::UtcNow.ToString("o")
  machine = [ordered]@{
    user = $env:USERNAME
    admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    os = (Get-CimInstance Win32_OperatingSystem).Caption
  }
  checks = [ordered]@{}
}

try {
  Invoke-ProcessWithTimeout $installer314 @("/S") 120
  Wait-Until { Test-Path -LiteralPath $installedExe -PathType Leaf } 30 "3.1.4 executable was not installed."
  $results.checks.install314 = ((Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion -like "3.1.4*")

  $probe314 = Join-Path $env:TEMP "cam-sandbox-314"
  $results.checks.start314 = (Start-And-Probe $installedExe $probe314).rendererReady
  Stop-ManagedProcesses

  New-Item -ItemType Directory -Path $appDataRoot -Force | Out-Null
  Set-Content -LiteralPath $markerPath -Value "preserve-across-upgrade-and-uninstall" -Encoding UTF8
  [Environment]::SetEnvironmentVariable("CAM_DISABLE_AUTO_UPDATE", "1", "Process")
  [Environment]::SetEnvironmentVariable("CAM_DISABLE_EXTERNAL_OPEN", "1", "Process")
  Start-Process -FilePath $installedExe | Out-Null
  Wait-Until { @(Get-ManagedProcesses).Count -gt 0 } 20 "3.1.4 did not start before upgrade."
  Wait-Until { Test-Path -LiteralPath $databasePath -PathType Leaf } 20 "3.1.4 did not create accounts.sqlite."
  $preUpgradeProcessIds = @(Get-ManagedProcesses | Select-Object -ExpandProperty ProcessId)
  if ($preUpgradeProcessIds.Count -eq 0) { throw "No 3.1.4 process tree was captured before upgrade." }
  Invoke-ProcessWithTimeout $installer315 @("/S") 150
  Wait-Until {
    (Test-Path -LiteralPath $installedExe -PathType Leaf) -and ((Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion -like "3.1.5*")
  } 45 "Running upgrade did not install 3.1.5."
  try {
    Wait-Until {
      @($preUpgradeProcessIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -eq 0
    } 30 "Installer did not close the captured 3.1.4 process tree."
  } catch { }
  $results.checks.installerClosedPreviousProcesses = @($preUpgradeProcessIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -eq 0
  Stop-ManagedProcesses
  $results.checks.runningUpgrade315 = $true
  $results.checks.markerPreservedAfterUpgrade = (Test-Path -LiteralPath $markerPath -PathType Leaf)
  $results.checks.databasePreservedAfterUpgrade = (Test-Path -LiteralPath $databasePath -PathType Leaf)

  $probe315 = Join-Path $env:TEMP "cam-sandbox-315"
  $results.checks.start315 = (Start-And-Probe $installedExe $probe315).rendererReady
  Start-Sleep -Seconds 3
  Show-InstalledWindow
  Capture-Desktop (Join-Path $resultRoot "installed-3.1.5.png")
  Stop-ManagedProcesses

  $shortcutCandidates = @(
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Codex Account Manager.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Codex Account Manager\Codex Account Manager.lnk")
  )
  $desktopShortcutCandidates = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Codex Account Manager.lnk"),
    (Join-Path $env:PUBLIC "Desktop\Codex Account Manager.lnk")
  )
  $allShortcutCandidates = @($shortcutCandidates + $desktopShortcutCandidates)
  $results.checks.startMenuShortcutCreated = @($shortcutCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }).Count -gt 0
  $results.checks.desktopShortcutCreated = @($desktopShortcutCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }).Count -gt 0

  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Uninstaller was not found." }
  Invoke-ProcessWithTimeout $uninstaller @("/S") 120
  Wait-Until { -not (Test-Path -LiteralPath $installedExe) } 45 "Uninstall left the installed executable."
  try {
    Wait-Until {
      @($allShortcutCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }).Count -eq 0
    } 30 "Uninstall left shortcuts after the asynchronous cleanup window."
  } catch { }
  $results.checks.uninstallRemovedProgram = $true
  $results.checks.uninstallPreservedUserData = (Test-Path -LiteralPath $markerPath -PathType Leaf) -and (Test-Path -LiteralPath $databasePath -PathType Leaf)
  $results.checks.uninstallRemovedShortcut = @($allShortcutCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }).Count -eq 0

  Invoke-ProcessWithTimeout $installer315 @("/S") 120
  Wait-Until { Test-Path -LiteralPath $installedExe -PathType Leaf } 30 "3.1.5 clean reinstall failed."
  $results.checks.reinstall315 = ((Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion -like "3.1.5*")
  $results.checks.reinstallPreservedUserData = (Test-Path -LiteralPath $markerPath -PathType Leaf)
  $reinstallProbe = Join-Path $env:TEMP "cam-sandbox-reinstall"
  $results.checks.reinstallStartup = (Start-And-Probe $installedExe $reinstallProbe).rendererReady
  Stop-ManagedProcesses

  $portableProbe = Join-Path $env:TEMP "cam-sandbox-portable"
  $results.checks.portableStartup = (Start-And-Probe $portable315 $portableProbe 45).rendererReady
  $portableRoot = Split-Path -Parent $portable315
  foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($portableRoot, [StringComparison]::OrdinalIgnoreCase) -and $_.Name -like "Codex-Account-Manager-3.1.5*"
  })) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }

  if (Test-Path -LiteralPath $uninstaller -PathType Leaf) { Invoke-ProcessWithTimeout $uninstaller @("/S") 120 }
  $failedChecks = @($results.checks.GetEnumerator() | Where-Object { $_.Value -ne $true } | ForEach-Object { $_.Key })
  $results.failedChecks = $failedChecks
  $results.passed = $failedChecks.Count -eq 0
} catch {
  $results.error = $_.Exception.Message
  try { Stop-ManagedProcesses } catch { }
} finally {
  $results.finishedAt = [DateTime]::UtcNow.ToString("o")
  Write-Result $results $reportPath
  Write-Result @{ passed = $results.passed; report = $reportPath; finishedAt = $results.finishedAt } $completePath
}

if (-not $results.passed) { exit 1 }
