[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'backup-settings.psd1')
)

$ErrorActionPreference = 'Stop'

function Write-BackupLog {
    param([string]$Message)
    Write-Host "[traffic-backup] $Message"
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Backup settings were not found: $ConfigPath"
}

$settings = Import-PowerShellDataFile -LiteralPath $ConfigPath
$requiredSettings = @(
    'RemoteHost',
    'RemoteUser',
    'RemoteBackupDirectory',
    'RemoteReceiptCommand',
    'SshKeyPath',
    'DestinationDirectory',
    'MaximumBackups'
)

foreach ($name in $requiredSettings) {
    if (-not $settings.ContainsKey($name) -or [string]::IsNullOrWhiteSpace([string]$settings[$name])) {
        throw "Backup setting '$name' is required."
    }
}

if ([int]$settings.MaximumBackups -lt 1) {
    throw 'MaximumBackups must be at least 1.'
}

$ssh = Get-Command 'ssh.exe' -ErrorAction Stop
$scp = Get-Command 'scp.exe' -ErrorAction Stop
$identity = [Environment]::ExpandEnvironmentVariables([string]$settings.SshKeyPath)
$destination = [Environment]::ExpandEnvironmentVariables([string]$settings.DestinationDirectory)
$remote = "$($settings.RemoteUser)@$($settings.RemoteHost)"
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-i', $identity)

if (-not (Test-Path -LiteralPath $identity -PathType Leaf)) {
    throw "SSH private key was not found: $identity"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null

$listCommand = "find '$($settings.RemoteBackupDirectory)' -maxdepth 1 -type f -name 'traffic-*.dump' -printf '%f\n' | sort | tail -n 1"
$listOutput = & $ssh.Source @sshOptions $remote $listCommand 2>$null
$listExitCode = $LASTEXITCODE

if ($listExitCode -ne 0) {
    Write-BackupLog 'Server is unavailable; the scheduled task will retry later.'
    exit 0
}

$latest = ([string]($listOutput | Select-Object -First 1)).Trim()
if ($latest -notmatch '^traffic-[0-9]{8}T[0-9]{6}Z\.dump$') {
    throw 'The server did not return a valid backup filename.'
}

$localDump = Join-Path $destination $latest
$localManifest = "$localDump.sha256"
$partialDump = "$localDump.partial"
$partialManifest = "$localManifest.partial"

try {
    & $scp.Source @sshOptions "${remote}:$($settings.RemoteBackupDirectory)/$latest.sha256" $partialManifest
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not download the backup checksum manifest.'
    }

    $manifestLine = (Get-Content -LiteralPath $partialManifest -TotalCount 1).Trim()
    if ($manifestLine -notmatch '^([0-9a-fA-F]{64})\s+(.+)$') {
        throw 'The downloaded checksum manifest is invalid.'
    }

    $expectedChecksum = $Matches[1].ToLowerInvariant()
    $manifestFilename = $Matches[2].Trim()
    if ($manifestFilename -ne $latest) {
        throw 'The checksum manifest names a different backup file.'
    }

    $needsDownload = $true
    if (Test-Path -LiteralPath $localDump -PathType Leaf) {
        $existingChecksum = (Get-FileHash -LiteralPath $localDump -Algorithm SHA256).Hash.ToLowerInvariant()
        $needsDownload = $existingChecksum -ne $expectedChecksum
    }

    if ($needsDownload) {
        Write-BackupLog "Downloading $latest"
        & $scp.Source @sshOptions "${remote}:$($settings.RemoteBackupDirectory)/$latest" $partialDump
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not download the database backup.'
        }

        $downloadedChecksum = (Get-FileHash -LiteralPath $partialDump -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($downloadedChecksum -ne $expectedChecksum) {
            throw 'The downloaded backup did not match its SHA-256 checksum.'
        }

        Move-Item -LiteralPath $partialDump -Destination $localDump -Force
    }

    Move-Item -LiteralPath $partialManifest -Destination $localManifest -Force

    $receiptCommand = "'$($settings.RemoteReceiptCommand)' '$latest' '$expectedChecksum'"
    & $ssh.Source @sshOptions $remote $receiptCommand
    if ($LASTEXITCODE -ne 0) {
        throw 'The backup was verified locally, but the server receipt could not be recorded.'
    }

    $status = [ordered]@{
        completedAt = [DateTimeOffset]::UtcNow.ToString('o')
        backupFile = $latest
        sha256 = $expectedChecksum
    }
    $status | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'last-success.json') -Encoding UTF8

    $expired = Get-ChildItem -LiteralPath $destination -Filter 'traffic-*.dump' -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -Skip ([int]$settings.MaximumBackups)

    foreach ($file in $expired) {
        Remove-Item -LiteralPath $file.FullName -Force
        Remove-Item -LiteralPath "$($file.FullName).sha256" -Force -ErrorAction SilentlyContinue
    }

    Write-BackupLog "Verified $latest; $(@($expired).Count) expired backup(s) removed."
}
finally {
    Remove-Item -LiteralPath $partialDump -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $partialManifest -Force -ErrorAction SilentlyContinue
}
