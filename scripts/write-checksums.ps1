param(
  [string]$ReleaseDir = (Join-Path $PSScriptRoot "..\\release")
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

$package = Get-Content -Raw -Encoding utf8 (Join-Path $PSScriptRoot "..\\package.json") | ConvertFrom-Json
$version = $package.version
$files = Get-ChildItem -LiteralPath $ReleaseDir -File | Where-Object {
  $_.Name -in @(
    "Egoist-Account-Manager-Setup-$version.exe",
    "Egoist-Account-Manager-$version.exe",
    "Egoist-Account-Manager-Setup-$version.exe.blockmap",
    "latest.yml"
  )
}

if ($files.Count -lt 2) { throw "Release artifacts for version $version were not found in $ReleaseDir." }

$checksums = $files | Sort-Object Name | ForEach-Object {
  "{0}  {1}" -f (Get-Sha256Hex $_.FullName), $_.Name
}
Set-Content -LiteralPath (Join-Path $ReleaseDir "SHA256SUMS-$version.txt") -Value $checksums -Encoding ascii
