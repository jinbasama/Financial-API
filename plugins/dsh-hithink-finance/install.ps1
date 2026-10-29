#Requires -Version 7.0
<#
.SYNOPSIS
  Link dsh-hithink-finance into a DSH profile (idempotent), or remove it.

.DESCRIPTION
  Does exactly three things:
    1. dependencies["dsh-hithink-finance"] = "link:<this package root>"
    2. dsh.profile.bundles += "dsh-hithink-finance"
    3. node_modules\dsh-hithink-finance -> junction to this package root

  It never starts, stops or restarts DSH. Changing a profile manifest while DSH
  is running is unsafe (the live instance can rewrite the file), so this script
  refuses to run while a DSH process is up unless -Force is given.

  Comments and messages are ASCII on purpose: a UTF-8 .ps1 without a BOM is read
  as ANSI by Windows PowerShell 5.1 and non-ASCII text breaks parsing.

.PARAMETER Remove
  Undo the link: drop the dependency, drop the bundle entry, delete the junction.

.PARAMETER DryRun
  Print what would happen, change nothing.

.PARAMETER Profile
  DSH profile name. Default: desktop.

.PARAMETER Force
  Proceed even if a DSH process appears to be running.

.EXAMPLE
  .\install.ps1 -DryRun
  .\install.ps1
  .\install.ps1 -Remove
#>
[CmdletBinding()]
param(
    [switch]$Remove,
    [switch]$DryRun,
    [string]$Profile = 'desktop',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$packageName = 'dsh-hithink-finance'
$packageRoot = $PSScriptRoot
$linkScript = Join-Path $packageRoot 'scripts\profile-link.mjs'

function Get-DshHome {
    if ($env:DSH_HOME -and $env:DSH_HOME.Trim() -ne '') { return $env:DSH_HOME.Trim() }
    return (Join-Path $HOME '.dsh')
}

$dshHome = Get-DshHome
$profileDir = Join-Path (Join-Path $dshHome 'profiles') $Profile
$profileManifest = Join-Path $profileDir 'package.json'
$modulesDir = Join-Path $profileDir 'node_modules'
$junctionPath = Join-Path $modulesDir $packageName

Write-Host "package root : $packageRoot"
Write-Host "dsh home     : $dshHome"
Write-Host "profile      : $Profile"
Write-Host "action       : $(if ($Remove) { 'remove' } else { 'add' })$(if ($DryRun) { ' (dry run)' } else { '' })"
Write-Host ''

if (-not (Test-Path -LiteralPath $profileManifest)) {
    throw "No DSH profile manifest at $profileManifest. Pass -Profile <name> or set DSH_HOME."
}
if (-not (Test-Path -LiteralPath $linkScript)) {
    throw "Missing helper script: $linkScript"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) { throw 'node was not found on PATH.' }

$running = @(Get-Process -Name 'DeepSeek Harness', 'DeepSeekHarness' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0 -and -not $Force -and -not $DryRun) {
    throw "DSH appears to be running (PID $($running[0].Id)). Close DSH first, then re-run. Use -Force only if you know why."
}

$profileLinkArgs = @(
    $linkScript,
    '--action', $(if ($Remove) { 'remove' } else { 'add' }),
    '--profile', $Profile,
    '--dsh-home', $dshHome,
    '--name', $packageName,
    '--package', $packageRoot
)

if ($DryRun) {
    Write-Host "[dry run] node $($profileLinkArgs -join ' ')"
    if ($Remove) {
        Write-Host "[dry run] delete junction $junctionPath"
    } else {
        Write-Host "[dry run] create junction $junctionPath -> $packageRoot"
    }
    exit 0
}

if ($Remove) {
    if (Test-Path -LiteralPath $junctionPath) {
        $item = Get-Item -LiteralPath $junctionPath -Force
        if ($item.LinkType -eq 'Junction') {
            # rmdir removes the reparse point only; Remove-Item -Recurse on a
            # junction can walk into the target and delete real files.
            & cmd /c rmdir "$junctionPath" | Out-Null
            Write-Host "removed junction: $junctionPath"
        } else {
            Write-Warning "$junctionPath is not a junction; leaving it alone."
        }
    }
    & node @profileLinkArgs
    if ($LASTEXITCODE -ne 0) { throw "profile-link.mjs failed with exit code $LASTEXITCODE" }
    Write-Host ''
    Write-Host 'Unlinked. Restart DSH to make the tools disappear.'
    exit 0
}

& node @profileLinkArgs
if ($LASTEXITCODE -ne 0) { throw "profile-link.mjs failed with exit code $LASTEXITCODE" }

New-Item -ItemType Directory -Force -Path $modulesDir | Out-Null
if (Test-Path -LiteralPath $junctionPath) {
    $existing = Get-Item -LiteralPath $junctionPath -Force
    if ($existing.LinkType -eq 'Junction') {
        $target = @($existing.Target) | Select-Object -First 1
        if ($target -and (Resolve-Path -LiteralPath $target).Path -eq (Resolve-Path -LiteralPath $packageRoot).Path) {
            Write-Host "junction already correct: $junctionPath"
        } else {
            & cmd /c rmdir "$junctionPath" | Out-Null
            New-Item -ItemType Junction -Path $junctionPath -Target $packageRoot | Out-Null
            Write-Host "re-pointed junction: $junctionPath"
        }
    } else {
        throw "$junctionPath exists and is not a junction. Remove it manually, then re-run."
    }
} else {
    New-Item -ItemType Junction -Path $junctionPath -Target $packageRoot | Out-Null
    Write-Host "created junction: $junctionPath"
}

Write-Host ''
Write-Host 'Done. Restart DSH to load the plugin.'
Write-Host 'Verify after restart: ask the agent to call hithink_doctor.'
