#Requires -Version 5.1
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
  as ANSI by Windows PowerShell 5.1, and non-ASCII text then breaks parsing.

.PARAMETER Remove
  Undo the link: drop the dependency, drop the bundle entry, delete the junction.

.PARAMETER DryRun
  Print what would happen, change nothing.

.PARAMETER Profile
  DSH profile name. Default: desktop.

.PARAMETER NodePath
  Path to node.exe. Default: resolved from $env:DSH_NODE, then PATH, then the
  usual install locations.

.PARAMETER Force
  Proceed even if a DSH process appears to be running.

.EXAMPLE
  .\install.ps1 -DryRun

.EXAMPLE
  .\install.ps1 -NodePath 'C:\Program Files\nodejs\node.exe'

.EXAMPLE
  .\install.ps1 -Remove
#>
[CmdletBinding()]
param(
    [switch]$Remove,
    [switch]$DryRun,
    [string]$Profile = 'desktop',
    [string]$NodePath = '',
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

function Resolve-NodeExecutable {
    param([string]$Explicit)

    if ($Explicit -and $Explicit.Trim() -ne '') {
        if (-not (Test-Path -LiteralPath $Explicit)) { throw "node not found at $Explicit" }
        return $Explicit
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:DSH_NODE -and $env:DSH_NODE.Trim() -ne '') { $candidates.Add($env:DSH_NODE.Trim()) }
    $onPath = Get-Command node -ErrorAction SilentlyContinue
    if ($null -ne $onPath) { $candidates.Add($onPath.Source) }
    if ($env:ProgramFiles) { $candidates.Add((Join-Path $env:ProgramFiles 'nodejs\node.exe')) }
    if ($env:LOCALAPPDATA) { $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')) }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }

    throw ('node was not found. Install Node.js (>= 22.12), put it on PATH, or pass ' +
        '-NodePath <path to node.exe>. This script edits the profile manifest with node ' +
        'so that key order and line endings survive.')
}

$dshHome = Get-DshHome
$profileDir = Join-Path (Join-Path $dshHome 'profiles') $Profile
$profileManifest = Join-Path $profileDir 'package.json'
$modulesDir = Join-Path $profileDir 'node_modules'
$junctionPath = Join-Path $modulesDir $packageName

Write-Host "package root : $packageRoot"
Write-Host "dsh home     : $dshHome"
Write-Host "profile      : $Profile"
Write-Host ('action       : ' + $(if ($Remove) { 'remove' } else { 'add' }) + $(if ($DryRun) { ' (dry run)' } else { '' }))
Write-Host ''

if (-not (Test-Path -LiteralPath $profileManifest)) {
    throw "No DSH profile manifest at $profileManifest. Pass -Profile <name> or set DSH_HOME."
}
if (-not (Test-Path -LiteralPath $linkScript)) {
    throw "Missing helper script: $linkScript"
}
if (-not (Test-Path -LiteralPath (Join-Path $packageRoot 'cordis.patch.yml'))) {
    throw "Missing cordis.patch.yml in $packageRoot - is this the package root?"
}

$declaredName = $null
$match = [regex]::Match((Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw),
    '"name"\s*:\s*"([^"]+)"')
if ($match.Success) { $declaredName = $match.Groups[1].Value }
if ($declaredName -ne $packageName) {
    throw "package.json name is '$declaredName', expected '$packageName'. Refusing to link a misnamed package."
}

$nodeExe = Resolve-NodeExecutable -Explicit $NodePath

$running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
if ($running.Count -eq 0) {
    $running = @(Get-Process -Name 'DeepSeekHarness' -ErrorAction SilentlyContinue)
}
if ($running.Count -gt 0 -and -not $Force) {
    if ($DryRun) {
        Write-Host "warning: DSH appears to be running (PID $($running[0].Id)); a real run would refuse."
    } else {
        throw ("DSH appears to be running (PID " + $running[0].Id + "). Close DSH first, then re-run. " +
            'Use -Force only if you know why.')
    }
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
    Write-Host ('[dry run] node "' + $nodeExe + '" ' + ($profileLinkArgs -join ' '))
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
            # rmdir removes the reparse point only. Remove-Item -Recurse on a
            # junction can walk into the target and delete real files.
            & cmd /c rmdir "$junctionPath" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "could not remove the junction at $junctionPath" }
            Write-Host "removed junction: $junctionPath"
        } else {
            Write-Warning "$junctionPath is not a junction; leaving it alone."
        }
    }
    & $nodeExe @profileLinkArgs
    if ($LASTEXITCODE -ne 0) { throw "profile-link.mjs failed with exit code $LASTEXITCODE" }
    Write-Host ''
    Write-Host 'Unlinked. Restart DSH to make the tools disappear.'
    exit 0
}

& $nodeExe @profileLinkArgs
if ($LASTEXITCODE -ne 0) { throw "profile-link.mjs failed with exit code $LASTEXITCODE" }

New-Item -ItemType Directory -Force -Path $modulesDir | Out-Null
if (Test-Path -LiteralPath $junctionPath) {
    $existing = Get-Item -LiteralPath $junctionPath -Force
    if ($existing.LinkType -ne 'Junction') {
        throw "$junctionPath exists and is not a junction. Remove it manually, then re-run."
    }
    $target = @($existing.Target) | Select-Object -First 1
    $sameTarget = $false
    if ($target) {
        try {
            $sameTarget = (Resolve-Path -LiteralPath $target).Path -eq (Resolve-Path -LiteralPath $packageRoot).Path
        } catch {
            $sameTarget = $false
        }
    }
    if ($sameTarget) {
        Write-Host "junction already correct: $junctionPath"
    } else {
        & cmd /c rmdir "$junctionPath" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "could not re-point the junction at $junctionPath" }
        New-Item -ItemType Junction -Path $junctionPath -Target $packageRoot | Out-Null
        Write-Host "re-pointed junction: $junctionPath"
    }
} else {
    New-Item -ItemType Junction -Path $junctionPath -Target $packageRoot | Out-Null
    Write-Host "created junction: $junctionPath"
}

Write-Host ''
Write-Host 'Done. Restart DSH to load the plugin.'
Write-Host 'Verify after restart: ask the agent to call hithink_doctor.'
