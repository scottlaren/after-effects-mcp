param(
    [string]$BackupRoot = (Join-Path $env:LOCALAPPDATA 'ae-mcp-bridge\install-backups'),
    [string]$RestoreSnapshot
)
$ErrorActionPreference = 'Stop'

if ($RestoreSnapshot) {
    $snapshot = Get-Content -LiteralPath $RestoreSnapshot -Raw | ConvertFrom-Json
    foreach ($entry in $snapshot.files) {
        if ($entry.existed) {
            Copy-Item -LiteralPath $entry.backup -Destination $entry.target -Force
        } elseif (Test-Path -LiteralPath $entry.target -PathType Leaf) {
            Remove-Item -LiteralPath $entry.target
        }
    }
    foreach ($entry in $snapshot.registry) {
        if ($entry.existed) {
            New-ItemProperty -Path $entry.path -Name PlayerDebugMode -Value $entry.value -PropertyType String -Force | Out-Null
        } else {
            Remove-ItemProperty -Path $entry.path -Name PlayerDebugMode -ErrorAction SilentlyContinue
        }
    }
    Write-Output 'Files and CEP debug settings restored. Restart After Effects.'
    exit
}

$build = Join-Path $PSScriptRoot 'build\cep'
if (!(Test-Path -LiteralPath (Join-Path $build 'mcp-bridge-auto.jsx'))) {
    throw 'Run npm ci and npm run build before installing.'
}
$backupDir = Join-Path $BackupRoot (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$manifest = @{ files = @(); registry = @() }
$snapshotPath = Join-Path $backupDir 'snapshot.json'
function Save-Snapshot {
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $snapshotPath -Encoding UTF8
}
function Backup-File([string]$Target) {
    $existed = Test-Path -LiteralPath $Target -PathType Leaf
    $backup = Join-Path $backupDir ('file-' + $manifest.files.Count)
    if ($existed) { Copy-Item -LiteralPath $Target -Destination $backup }
    $manifest.files += @{ target = $Target; existed = $existed; backup = $backup }
    Save-Snapshot
}

$extension = Join-Path $env:APPDATA 'Adobe\CEP\extensions\local.aemcp.modalsafe'
foreach ($file in Get-ChildItem -LiteralPath $build -File -Recurse) {
    $relative = $file.FullName.Substring($build.Length).TrimStart('\')
    $target = Join-Path $extension $relative
    Backup-File $target
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
}

# Update only existing per-user copies. The new panel preserves local Unicode
# handling and stops legacy timers when the CEP marker is present.
$aeRoot = Join-Path $env:APPDATA 'Adobe\After Effects'
if (Test-Path -LiteralPath $aeRoot) {
    foreach ($version in Get-ChildItem -LiteralPath $aeRoot -Directory) {
        $target = Join-Path $version.FullName 'Scripts\ScriptUI Panels\mcp-bridge-auto.jsx'
        if (Test-Path -LiteralPath $target) {
            Backup-File $target
            Copy-Item -LiteralPath (Join-Path $build 'mcp-bridge-auto.jsx') -Destination $target -Force
        }
    }
}
$bridgeFolder = if ($env:AE_MCP_BRIDGE_DIR) { $env:AE_MCP_BRIDGE_DIR } else { Join-Path $env:LOCALAPPDATA 'ae-mcp-bridge' }
New-Item -ItemType Directory -Path $bridgeFolder -Force | Out-Null
$marker = Join-Path $bridgeFolder 'cep-enabled'
Backup-File $marker
Set-Content -LiteralPath $marker -Value 'Open Window > Extensions > MCP Bridge.' -Encoding ASCII

# A local unsigned CEP extension needs developer mode. Save the prior values so
# rollback restores them; this does not change execution policy or AE preferences.
foreach ($runtime in @(11, 12)) {
    $key = "HKCU:\Software\Adobe\CSXS.$runtime"
    $previous = Get-ItemProperty -Path $key -Name PlayerDebugMode -ErrorAction SilentlyContinue
    $manifest.registry += @{ path = $key; existed = ($null -ne $previous); value = $(if ($previous) { $previous.PlayerDebugMode } else { $null }) }
    Save-Snapshot
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null
}
Write-Output "Installed: $extension"
Write-Output "Rollback snapshot: $snapshotPath"
Write-Output 'Restart After Effects, then open Window > Extensions > MCP Bridge.'
