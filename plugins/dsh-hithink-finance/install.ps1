#Requires -Version 5.1
<#
.SYNOPSIS
  Link dsh-hithink-finance into a DSH profile (idempotent), or remove it.

.DESCRIPTION
  Install order matters. A profile manifest that points at a package directory
  which does not exist can fail the boot, so the junction is created BEFORE the
  manifest is edited, and is rolled back if the edit fails. Uninstall does the
  reverse: the manifest is cleaned first, then the junction is removed, so a
  failure can never leave a manifest pointing at nothing.

    install:  validate slot -> create/re-point junction -> edit manifest -> (rollback slot on failure)
    remove:   edit manifest -> delete junction -> (a leftover junction is harmless)

  It never starts, stops or restarts DSH. Changing a profile manifest while DSH
  is running is unsafe (the live instance can rewrite the file), so this script
  refuses to run while a DSH process is up unless -Force is given.

  Comments and messages are ASCII on purpose: a UTF-8 .ps1 without a BOM is read
  as ANSI by Windows PowerShell 5.1, and non-ASCII text then breaks parsing.

.NOTES
  Execution policy: if the machine blocks unsigned scripts, run it as
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

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
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

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

# Returns @{ Kind = 'none' | 'junction' | 'other'; Target = <string or ''> }
function Get-SlotState {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return @{ Kind = 'none'; Target = '' } }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.LinkType -ne 'Junction') { return @{ Kind = 'other'; Target = '' } }

    $target = @($item.Target) | Select-Object -First 1
    return @{ Kind = 'junction'; Target = $(if ($target) { [string]$target } else { '' }) }
}

function Test-SamePath {
    param([string]$Left, [string]$Right)
    if (-not $Left -or -not $Right) { return $false }
    try {
        return (Resolve-Path -LiteralPath $Left).Path -eq (Resolve-Path -LiteralPath $Right).Path
    } catch {
        return $false
    }
}

# rmdir removes the reparse point only. Remove-Item -Recurse on a junction can
# walk into the target and delete real files.
function Remove-Junction {
    param([string]$Path)
    & cmd /c rmdir "$Path" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "could not remove the junction at $Path" }
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

# Pre-flight the slot before touching anything: a plain directory (or file) in
# the package name's place cannot be replaced automatically, and discovering
# that after editing the manifest would leave the profile half-changed.
$slot = Get-SlotState -Path $junctionPath
if ($slot.Kind -eq 'other' -and -not $Remove) {
    throw ("$junctionPath exists and is not a junction (probably an npm-installed copy). " +
        'Remove it first, then re-run.')
}
$slotIsOurs = ($slot.Kind -eq 'junction') -and (Test-SamePath -Left $slot.Target -Right $packageRoot)

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
    Write-Host ('[dry run] slot state: ' + $slot.Kind + $(if ($slotIsOurs) { ' (already points here)' } else { '' }))
    if ($Remove) {
        Write-Host '[dry run] order: edit manifest first, then delete the junction'
    } else {
        Write-Host '[dry run] order: create the junction first, then edit the manifest'
        if ($slot.Kind -eq 'junction' -and -not $slotIsOurs) {
            Write-Host "[dry run] would re-point the junction from '$($slot.Target)' to '$packageRoot'"
        }
    }
    exit 0
}

if ($Remove) {
    # Manifest first: a leftover junction is harmless, a manifest pointing at a
    # deleted package is not.
    & $nodeExe @profileLinkArgs
    if ($LASTEXITCODE -ne 0) { throw "profile-link.mjs failed with exit code $LASTEXITCODE" }

    $slot = Get-SlotState -Path $junctionPath
    if ($slot.Kind -eq 'junction') {
        Remove-Junction -Path $junctionPath
        Write-Host "removed junction: $junctionPath"
    } elseif ($slot.Kind -eq 'other') {
        Write-Warning "$junctionPath is not a junction; leaving it alone."
    }

    Write-Host ''
    Write-Host 'Unlinked. Restart DSH to make the tools disappear.'
    exit 0
}

# Add: junction first, so the manifest never points at a missing directory.
$createdJunction = $false
$previousTarget = $slot.Target
New-Item -ItemType Directory -Force -Path $modulesDir | Out-Null
if ($slotIsOurs) {
    Write-Host "junction already correct: $junctionPath"
} else {
    if ($slot.Kind -eq 'junction') { Remove-Junction -Path $junctionPath }
    New-Item -ItemType Junction -Path $junctionPath -Target $packageRoot | Out-Null
    $createdJunction = $true
    Write-Host "created junction: $junctionPath -> $packageRoot"
}

& $nodeExe @profileLinkArgs
if ($LASTEXITCODE -ne 0) {
    # Roll the slot back so the profile is not left pointing at a package the
    # manifest does not list.
    if ($createdJunction) {
        try {
            if (Test-Path -LiteralPath $junctionPath) { Remove-Junction -Path $junctionPath }
            if ($previousTarget -and $slot.Kind -eq 'junction') {
                New-Item -ItemType Junction -Path $junctionPath -Target $previousTarget | Out-Null
                Write-Host "restored the previous junction target: $previousTarget"
            }
        } catch {
            Write-Warning "could not roll back the junction at ${junctionPath}: $($_.Exception.Message)"
        }
    }
    throw "profile-link.mjs failed with exit code $LASTEXITCODE; the manifest was not changed"
}

Write-Host ''
Write-Host 'Done. Restart DSH to load the plugin.'
Write-Host 'Verify after restart: ask the agent to call hithink_doctor.'
