#Requires -Version 5.1
<#
  CodeStreak Windows environment check.
  Usage (PowerShell or cmd, repo root):  pnpm check:setup
                         or:      powershell -ExecutionPolicy Bypass -File scripts/doctor.ps1
  Checks Node, pnpm, Git, hooks, WSL, then runs the WSL doctor and the env validator.
#>
$ErrorActionPreference = 'Continue'
$script:failures = 0
$script:warnings = 0
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Write-Result([string]$Status, [string]$Name, [string]$Detail) {
  $color = switch ($Status) { 'OK' { 'Green' } 'WARN' { 'Yellow' } default { 'Red' } }
  Write-Host ("[{0,-4}] {1,-22} {2}" -f $Status, $Name, $Detail) -ForegroundColor $color
  if ($Status -eq 'FAIL') { $script:failures++ }
  if ($Status -eq 'WARN') { $script:warnings++ }
}

function Get-FirstLine([string]$Cmd, [string[]]$CmdArgs) {
  if (-not (Get-Command $Cmd -ErrorAction SilentlyContinue)) { return $null }
  try { return ((& $Cmd @CmdArgs 2>&1) | Select-Object -First 1 | Out-String).Trim() } catch { return $null }
}

Write-Host "== Windows toolchain ==" -ForegroundColor Cyan

$nodeVer = Get-FirstLine 'node' @('--version')
if (-not $nodeVer) {
  Write-Result 'FAIL' 'node' 'not found. Install Node 20+ (LTS).'
} else {
  $major = [int](($nodeVer.TrimStart('v') -split '\.')[0])
  if ($major -ge 20) { Write-Result 'OK' 'node' $nodeVer } else { Write-Result 'FAIL' 'node' "$nodeVer (need 20+)" }
}

$pnpmVer = Get-FirstLine 'pnpm' @('--version')
if ($pnpmVer) { Write-Result 'OK' 'pnpm' $pnpmVer } else { Write-Result 'FAIL' 'pnpm' 'not found: corepack enable; corepack prepare pnpm@latest --activate' }

$gitVer = Get-FirstLine 'git' @('--version')
if ($gitVer) { Write-Result 'OK' 'git' $gitVer } else { Write-Result 'FAIL' 'git' 'not found' }

if ($repoRoot -match 'OneDrive') {
  Write-Result 'WARN' 'repo location' "$repoRoot is synced by OneDrive (file locks, node_modules upload, .env.local copied to the cloud). Move it to e.g. C:\dev\CodeStreak"
} elseif ($repoRoot -match '\s') {
  Write-Result 'WARN' 'repo location' "$repoRoot contains spaces; some build tools break on that"
} else {
  Write-Result 'OK' 'repo location' $repoRoot
}

Push-Location $repoRoot
try {
  $hooks = (git config --get core.hooksPath 2>$null)
  if ($hooks -eq '.githooks') { Write-Result 'OK' 'git hooks' '.githooks' }
  else { Write-Result 'WARN' 'git hooks' 'not installed: pnpm hooks:install' }
} finally { Pop-Location }

Write-Host ""
Write-Host "== WSL ==" -ForegroundColor Cyan

$wsl = Get-Command 'wsl.exe' -ErrorAction SilentlyContinue
$ubuntu = $false
if (-not $wsl) {
  Write-Result 'FAIL' 'wsl' 'not installed: wsl --install (then restart)'
} else {
  # wsl -l -q prints UTF-16; strip NUL characters before matching.
  $distros = ((wsl.exe -l -q) -join "`n") -replace "`0", ''
  $distroName = ($distros -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match 'Ubuntu' } | Select-Object -First 1)
  if ($distroName) { $ubuntu = $true; Write-Result 'OK' 'wsl distro' $distroName }
  else { Write-Result 'FAIL' 'wsl distro' 'Ubuntu not found: wsl --install -d Ubuntu' }
}

# Converts a Windows path to its WSL path without passing backslashes through a shell.
#   C:\dev\CodeStreak                    -> /mnt/c/dev/CodeStreak
#   \\wsl$\Ubuntu\home\me\CodeStreak     -> /home/me/CodeStreak
#   \\wsl.localhost\Ubuntu\home\me\Code  -> /home/me/Code
function ConvertTo-WslPath([string]$WinPath) {
  if ($WinPath -match '^\\\\wsl(\$|\.localhost)\\[^\\]+(\\.*)?$') {
    $rest = $Matches[2]
    if (-not $rest) { return '/' }
    return ($rest -replace '\\', '/')
  }
  if ($WinPath -match '^([A-Za-z]):(\\.*)?$') {
    $drive = $Matches[1].ToLower()
    $rest = if ($Matches[2]) { $Matches[2] -replace '\\', '/' } else { '' }
    return "/mnt/$drive$rest"
  }
  return $null
}

if ($ubuntu) {
  $wslRepo = ConvertTo-WslPath $repoRoot
  Write-Host ""
  Write-Host "== WSL doctor ($wslRepo) ==" -ForegroundColor Cyan
  if (-not $wslRepo) {
    Write-Result 'FAIL' 'wsl doctor' "cannot map $repoRoot to a WSL path; run in Ubuntu: bash scripts/wsl/doctor.sh"
  } else {
    # -i so ~/.bashrc PATH entries (cargo, solana, avm) are loaded. Single quotes keep spaces safe.
    $escaped = $wslRepo -replace "'", "'\''"
    wsl.exe -d $distroName -e bash -lic "cd '$escaped' && bash scripts/wsl/doctor.sh"
    if ($LASTEXITCODE -ne 0) { Write-Result 'FAIL' 'wsl doctor' 'see failures above' } else { Write-Result 'OK' 'wsl doctor' 'passed' }
  }
}

Write-Host ""
Write-Host "== Environment file ==" -ForegroundColor Cyan
$envFile = Join-Path $repoRoot '.env.local'
if (Test-Path $envFile) {
  Push-Location $repoRoot
  try {
    node scripts/check-env.mjs --file .env.local
    if ($LASTEXITCODE -ne 0) { Write-Result 'FAIL' 'check-env' 'fix the rows marked MISSING/INVALID' } else { Write-Result 'OK' 'check-env' 'passed' }
  } finally { Pop-Location }
} else {
  Write-Result 'FAIL' '.env.local' 'missing: Copy-Item .env.example .env.local'
}

Write-Host ""
Write-Host ("{0} failure(s), {1} warning(s)" -f $script:failures, $script:warnings)
if ($script:failures -gt 0) { exit 1 } else { exit 0 }
