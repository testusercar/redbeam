# Upload a signed REDBEAM NSIS build to the free-tier R2 bucket.
# Installers and .sig files go up first. manifest.json goes up last.
# This script does not read, copy, or accept the updater private key.
# Signing already happened at build time (TAURI_SIGNING_PRIVATE_KEY on
# GitHub Actions, or TAURI_SIGNING_PRIVATE_KEY_PATH for a local build).
#
# The release path is .github/workflows/release.yml. It calls this script
# with -Yes. Nothing here logs into Cloudflare from a particular PC.
#
# Live upload runs only inside .github/workflows/release.yml (GITHUB_ACTIONS).
# That workflow also publishes the GitHub Release with the same notes.
# From a PC, including the XPS, plan the upload and stop:
#   .\workers\updater\publish.ps1 -Version 0.3.2 -Notes "What changed." -DryRun
#
# One architecture, smoke of the file check only — the release workflow does not pass this:
#   .\workers\updater\publish.ps1 -Version 0.3.2 -Notes "What changed." -AllowSingleArch -DryRun

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $true)]
  [string]$Notes,

  [switch]$AllowSingleArch,

  [switch]$DryRun,

  # Skip the "type yes" prompt. Also skipped when CI or GITHUB_ACTIONS is
  # true or 1. Does not skip the 512 MB stop or the two-architecture rule.
  # Does not allow an upload outside GitHub Actions; that refusal is below.
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must be dotted numbers, for example 0.3.1 (got '$Version')."
}

# R2 Standard free tier (https://developers.cloudflare.com/r2/pricing/):
# 10 GB-month storage, 1 million Class A ops, 10 million Class B ops.
# Egress is free. Infrequent Access is not in the free tier — this script
# never sets a storage class. Two NSIS installers are tens of MB. Anything
# near half a gigabyte in one publish is the wrong files, and it stops here
# so the 10 GB cap is not something a bad path can walk into.
$WarnBytes = 200MB
$StopBytes = 512MB

$WorkerHost = 'redbeam-updates.trackchairking.workers.dev'
$Bucket = 'redbeam-updates'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PublishDir = Join-Path $PSScriptRoot '.publish'

function Find-SignedInstaller {
  param([string]$Triple, [string]$Arch, [string]$Platform)
  $dir = Join-Path $RepoRoot "apps\desktop\src-tauri\target\$Triple\release\bundle\nsis"
  $exe = Join-Path $dir "REDBEAM_${Version}_${Arch}-setup.exe"
  $sig = "$exe.sig"
  $haveExe = Test-Path -LiteralPath $exe
  $haveSig = Test-Path -LiteralPath $sig
  if (-not $haveExe -or -not $haveSig) {
    return [pscustomobject]@{
      Found = $false
      Arch = $Arch
      Platform = $Platform
      Exe = $exe
      Sig = $sig
      Missing = $(if (-not $haveExe) { $exe } else { $sig })
    }
  }
  $exeName = [IO.Path]::GetFileName($exe)
  $sigName = [IO.Path]::GetFileName($sig)
  if ($exeName -notmatch '^REDBEAM_[A-Za-z0-9._-]+$' -or $sigName -notmatch '^REDBEAM_[A-Za-z0-9._-]+$') {
    throw "Refusing to upload a name the worker will not serve: $exeName"
  }
  return [pscustomobject]@{
    Found = $true
    Arch = $Arch
    Platform = $Platform
    Exe = $exe
    Sig = $sig
    ExeName = $exeName
    SigName = $sigName
    ExeBytes = (Get-Item -LiteralPath $exe).Length
    SigBytes = (Get-Item -LiteralPath $sig).Length
  }
}

$candidates = @(
  (Find-SignedInstaller 'x86_64-pc-windows-msvc' 'x64' 'windows-x86_64'),
  (Find-SignedInstaller 'aarch64-pc-windows-msvc' 'arm64' 'windows-aarch64')
)
$found = @($candidates | Where-Object { $_.Found })
$missing = @($candidates | Where-Object { -not $_.Found })

if ($found.Count -eq 0) {
  throw "No signed installer found for $Version. Build with the updater signing key set, then rerun. Looked for:`n$($missing.Exe -join "`n")"
}
if ($missing.Count -gt 0 -and -not $AllowSingleArch) {
  $lines = $missing | ForEach-Object { $_.Missing }
  throw @"
Both architectures are required (see docs/UPDATES.md). Missing:
$($lines -join "`n")
Pass -AllowSingleArch only for a one-architecture smoke.
The release workflow publishes every architecture it built.
"@
}

$total = 0
foreach ($item in $found) { $total += $item.ExeBytes + $item.SigBytes }
$mb = [math]::Round($total / 1MB, 1)

Write-Host "R2 free tier is 10 GB-month of Standard storage. This upload is $mb MB across $($found.Count) architecture(s)."
Write-Host "Infrequent Access is not free. Do not set a storage class. Do not create another bucket."
Write-Host "If the dashboard already shows about 8 GB or more, delete old REDBEAM_* objects first. DeleteObject is free."
if ($total -ge $StopBytes) {
  throw "Refusing to upload $mb MB in one publish (stop is 512 MB). These are not the NSIS installers."
}
if ($total -ge $WarnBytes) {
  Write-Warning "This publish is $mb MB, which is large for a REDBEAM installer. Confirm the paths before continuing."
}

if (-not (Test-Path -LiteralPath $PublishDir)) {
  New-Item -ItemType Directory -Path $PublishDir | Out-Null
}

$specPath = Join-Path $PublishDir 'spec.json'
$manifestPath = Join-Path $PublishDir 'manifest.json'
$writerPath = Join-Path $PublishDir 'write-manifest.cjs'
$pubDate = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')

$specPlatforms = @()
foreach ($item in $found) {
  $specPlatforms += [ordered]@{
    platform = $item.Platform
    sigPath = $item.Sig
    fileName = $item.ExeName
  }
}
$spec = [ordered]@{
  version = $Version
  notes = $Notes
  pubDate = $pubDate
  origin = "https://$WorkerHost"
  outPath = $manifestPath
  platforms = $specPlatforms
}
$utf8 = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText($specPath, ($spec | ConvertTo-Json -Depth 6), $utf8)

$writer = @'
const fs = require('fs')
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const list = Array.isArray(spec.platforms) ? spec.platforms : [spec.platforms]
const platforms = {}
for (const item of list) {
  const signature = fs.readFileSync(item.sigPath, 'utf8').replace(/\r?\n$/, '')
  if (!signature.trim()) {
    console.error('empty signature: ' + item.sigPath)
    process.exit(1)
  }
  platforms[item.platform] = {
    signature,
    url: spec.origin + '/files/' + item.fileName,
  }
}
const manifest = {
  version: spec.version,
  notes: spec.notes,
  pub_date: spec.pubDate,
  platforms,
}
fs.writeFileSync(spec.outPath, JSON.stringify(manifest, null, 2) + '\n')
'@
[IO.File]::WriteAllText($writerPath, $writer, $utf8)
& node $writerPath $specPath
if ($LASTEXITCODE -ne 0) { throw 'Could not write manifest.json from the .sig files.' }

Write-Host "Wrote $manifestPath"
Write-Host "Upload order (manifest last, every put uses --remote):"
foreach ($item in $found) {
  Write-Host ("  npx wrangler r2 object put {0}/{1} --remote" -f $Bucket, $item.ExeName)
  Write-Host ("  npx wrangler r2 object put {0}/{1} --remote" -f $Bucket, $item.SigName)
}
Write-Host "  npx wrangler r2 object put $Bucket/manifest.json --remote"

if ($DryRun) {
  Write-Host 'Dry run: no wrangler upload, no prompt.'
  return
}

# The release workflow is the only live publish. It opens the GitHub Release
# in the same run. -Yes, CI=true, and a typed "yes" do not override this.
$actions = [Environment]::GetEnvironmentVariable('GITHUB_ACTIONS')
if ($actions -ne 'true' -and $actions -ne '1') {
  throw @"
Refusing to upload from this machine. Live R2 publish runs only in
.github/workflows/release.yml, which also publishes the GitHub Release
with the same notes. Use -DryRun to write the manifest and print the put order.
"@
}

function Test-NonInteractivePublish {
  if ($Yes) { return $true }
  foreach ($name in @('CI', 'GITHUB_ACTIONS')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($null -eq $value) { continue }
    if ($value -eq 'true' -or $value -eq '1') { return $true }
  }
  return $false
}

if (Test-NonInteractivePublish) {
  Write-Host 'Non-interactive publish (-Yes, or CI=true). The 512 MB stop still applies.'
  Write-Host "This does not read the Cloudflare dashboard. If bucket $Bucket is already near 8 GB, delete old REDBEAM_* objects first. DeleteObject is free."
} else {
  Write-Host "Confirm the Cloudflare dashboard for bucket $Bucket is under 8 GB Standard before continuing."
  $answer = Read-Host 'Type yes to upload'
  if ($answer -ne 'yes') { throw 'Stopped before any upload.' }
}

function Put-R2Object {
  param([string]$Key, [string]$File, [string]$ContentType)
  # --remote is required. Without it, wrangler writes to local Miniflare and
  # the live worker's /health stays on whatever was published last.
  Write-Host "put $Bucket/$Key --remote"
  Push-Location $PSScriptRoot
  try {
    & npx --yes wrangler r2 object put "$Bucket/$Key" --file $File --content-type $ContentType --remote
    if ($LASTEXITCODE -ne 0) { throw "wrangler put failed for $Key. manifest.json was not uploaded." }
  } finally {
    Pop-Location
  }
}

foreach ($item in $found) {
  Put-R2Object -Key $item.ExeName -File $item.Exe -ContentType 'application/octet-stream'
  Put-R2Object -Key $item.SigName -File $item.Sig -ContentType 'text/plain; charset=utf-8'
}
Put-R2Object -Key 'manifest.json' -File $manifestPath -ContentType 'application/json'

Write-Host 'Uploaded. Check from the installed older copy:'
Write-Host "  curl.exe https://$WorkerHost/health"
Write-Host "  curl.exe https://$WorkerHost/windows/x86_64/<installed-version>"
Write-Host 'A newer manifest returns 200. The same version returns 204. An empty channel returns 503.'
