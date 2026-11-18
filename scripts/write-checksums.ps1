param(
  [string]$ReleaseDir
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
if (-not $ReleaseDir) { $ReleaseDir = Join-Path (Split-Path -Parent $PSScriptRoot) ([string]$package.build.directories.output) }
$version = $package.version
$setupName = ([string]$package.build.nsis.artifactName).Replace('${version}', $version).Replace('${ext}', 'exe')
$portableName = ([string]$package.build.portable.artifactName).Replace('${version}', $version).Replace('${ext}', 'exe')
$files = Get-ChildItem -LiteralPath $ReleaseDir -File | Where-Object {
  $_.Name -in @(
    $setupName,
    $portableName,
    "$setupName.blockmap",
    "latest.yml"
  )
}

if ($files.Count -lt 2) { throw "Release artifacts for version $version were not found in $ReleaseDir." }

$checksums = $files | Sort-Object Name | ForEach-Object {
  "{0}  {1}" -f (Get-Sha256Hex $_.FullName), $_.Name
}
Set-Content -LiteralPath (Join-Path $ReleaseDir "SHA256SUMS-$version.txt") -Value $checksums -Encoding ascii
