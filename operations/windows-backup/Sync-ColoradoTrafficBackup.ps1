[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$SshExecutable = 'ssh.exe',
    [string]$ScpExecutable = 'scp.exe'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-LocalArchive.ps1')
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $PSScriptRoot 'backup-settings.psd1'
}

function Write-BackupLog {
    param([string]$Message)
    Write-Host "[traffic-backup] $Message"
}

function Invoke-BackupCommand {
    param(
        [System.Management.Automation.CommandInfo]$Executable,
        [string[]]$Arguments
    )

    $errorFile = [System.IO.Path]::GetTempFileName()
    try {
        $output = @(& $Executable.Source @Arguments 2> $errorFile)
        $exitCode = $LASTEXITCODE
        $errorText = (Get-Content -LiteralPath $errorFile -ErrorAction SilentlyContinue | Out-String).Trim()
        return [pscustomobject]@{
            ExitCode = $exitCode
            Output = $output
            Error = $errorText
        }
    }
    finally {
        Remove-Item -LiteralPath $errorFile -Force -ErrorAction SilentlyContinue
    }
}

function Test-TemporaryConnectionFailure {
    param([string]$Message)

    return $Message -match '(?i)(connection (timed out|refused|reset|closed|aborted)|could not resolve hostname|name or service not known|no route to host|network is unreachable|operation timed out|software caused connection abort)'
}

function Get-CommandFailureMessage {
    param(
        [string]$Operation,
        [pscustomobject]$Result
    )

    $detail = $Result.Error
    if ([string]::IsNullOrWhiteSpace($detail)) {
        $detail = "exit code $($Result.ExitCode)"
    }
    return "$Operation failed: $detail"
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
    'DestinationDirectory'
)

foreach ($name in $requiredSettings) {
    if (-not $settings.ContainsKey($name) -or [string]::IsNullOrWhiteSpace([string]$settings[$name])) {
        throw "Backup setting '$name' is required."
    }
}

if ([string]$settings.RemoteHost -notmatch '^[A-Za-z0-9.-]+$') {
    throw "Backup setting 'RemoteHost' contains unsupported characters."
}
if ([string]$settings.RemoteUser -notmatch '^[A-Za-z_][A-Za-z0-9_-]*$') {
    throw "Backup setting 'RemoteUser' contains unsupported characters."
}
foreach ($name in @('RemoteBackupDirectory', 'RemoteReceiptCommand')) {
    $remotePath = [string]$settings[$name]
    if ($remotePath -notmatch '^/[A-Za-z0-9._/-]+$' -or $remotePath -match '(^|/)\.\.(/|$)') {
        throw "Backup setting '$name' must be a simple absolute Unix path."
    }
}

$ssh = Get-Command $SshExecutable -ErrorAction Stop
$scp = Get-Command $ScpExecutable -ErrorAction Stop
$identity = [Environment]::ExpandEnvironmentVariables([string]$settings.SshKeyPath)
$destination = [Environment]::ExpandEnvironmentVariables([string]$settings.DestinationDirectory)
$remote = "$($settings.RemoteUser)@$($settings.RemoteHost)"
$sshOptions = @(
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'IdentitiesOnly=yes',
    '-i', $identity
)

if (-not (Test-Path -LiteralPath $identity -PathType Leaf)) {
    throw "SSH private key was not found: $identity"
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null

# FileShare.None prevents scheduled and manual runs from publishing the same snapshot.
# Keep the empty lock file: deleting it would create a race between waiting processes.
try {
    $archiveLock = [IO.File]::Open((Join-Path $destination '.sync.lock'),
        [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch {
    throw "Cannot acquire the backup destination lock; another sync may be running: $($_.Exception.Message)"
}
try {
    $localIndex = Initialize-LocalArchive $destination

    $listCommand = "find '$($settings.RemoteBackupDirectory)' -maxdepth 1 -type f -name 'traffic-*.dump' -printf '%f\n' | sort"
    $listResult = Invoke-BackupCommand -Executable $ssh -Arguments (@($sshOptions) + @($remote, $listCommand))
    if ($listResult.ExitCode -ne 0) {
        if (Test-TemporaryConnectionFailure $listResult.Error) {
            Write-BackupLog 'Server is unavailable; the task will retry at the next scheduled run or logon.'
            exit 0
        }
        throw (Get-CommandFailureMessage 'Listing server backups' $listResult)
    }

    $remoteFiles = @(
        $listResult.Output |
            ForEach-Object { ([string]$_).Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($remoteFiles.Count -eq 0) {
        throw 'The server did not return any completed database backups.'
    }

    foreach ($filename in $remoteFiles) {
        if (-not (Test-BackupFilename $filename)) {
            throw "The server returned a malformed backup filename: $filename"
        }
    }

    $remoteFiles = @($remoteFiles | Sort-Object -Unique)
    $downloadedCount = 0
    $verifiedCount = 0

    foreach ($filename in $remoteFiles) {
        $partialDump = Join-Path $destination "$filename.partial"
        $partialManifest = Join-Path $destination "$filename.sha256.partial"

        Remove-Item -LiteralPath $partialDump -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $partialManifest -Force -ErrorAction SilentlyContinue

        try {
            $manifestResult = Invoke-BackupCommand -Executable $scp -Arguments (
                @($sshOptions) + @("${remote}:$($settings.RemoteBackupDirectory)/$filename.sha256", $partialManifest)
            )
            if ($manifestResult.ExitCode -ne 0) {
                if (Test-TemporaryConnectionFailure $manifestResult.Error) {
                    Write-BackupLog 'Server became unavailable; the task will retry at the next scheduled run or logon.'
                    exit 0
                }
                throw (Get-CommandFailureMessage "Downloading the checksum manifest for $filename" $manifestResult)
            }

            $expectedChecksum = Read-BackupChecksum $partialManifest $filename

            if ($localIndex.ContainsKey($filename)) {
                # Initialize-LocalArchive has verified the bytes against this immutable receipt.
                if ($localIndex[$filename].sha256 -ne $expectedChecksum) {
                    throw "The existing local backup $filename does not match the server manifest."
                }
            }
            else {
                Write-BackupLog "Downloading $filename"
                $dumpResult = Invoke-BackupCommand -Executable $scp -Arguments (
                    @($sshOptions) + @("${remote}:$($settings.RemoteBackupDirectory)/$filename", $partialDump)
                )
                if ($dumpResult.ExitCode -ne 0) {
                    if (Test-TemporaryConnectionFailure $dumpResult.Error) {
                        Write-BackupLog 'Server became unavailable; the task will retry at the next scheduled run or logon.'
                        exit 0
                    }
                    throw (Get-CommandFailureMessage "Downloading $filename" $dumpResult)
                }

                $downloadedChecksum = (Get-FileHash -LiteralPath $partialDump -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($downloadedChecksum -ne $expectedChecksum) {
                    throw "The downloaded backup $filename did not match its SHA-256 checksum."
                }

                $receipt = New-BackupReceipt $filename $expectedChecksum ([DateTimeOffset]::Now) 'verified-download'
                Publish-BackupReceipt $destination $receipt
                $localIndex[$filename] = $receipt
                $downloadedCount++
            }

            $verifiedCount++
        }
        finally {
            # Keep an unfinished dump for receipt-based recovery; otherwise the next run
            # discards the incomplete transfer before retrying. Never remove a completed dump.
            Remove-Item -LiteralPath $partialManifest -Force -ErrorAction SilentlyContinue
        }
    }

    $newest = $remoteFiles[-1]
    $newestReceipt = $localIndex[$newest]
    $newestChecksum = $newestReceipt.sha256
    $receiptCommand = "'$($settings.RemoteReceiptCommand)' '$newest' '$newestChecksum'"
    $receiptResult = Invoke-BackupCommand -Executable $ssh -Arguments (@($sshOptions) + @($remote, $receiptCommand))
    if ($receiptResult.ExitCode -ne 0) {
        throw (Get-CommandFailureMessage 'Recording the server receipt' $receiptResult)
    }

    $status = [ordered]@{
        completedAt = [DateTimeOffset]::UtcNow.ToString('o')
        newestVerifiedBackup = $newest
        newestLocalBackup = $newestReceipt.localFilename
        sha256 = $newestChecksum
        verifiedCount = $verifiedCount
        downloadedCount = $downloadedCount
    }
    $statusPath = Join-Path $destination 'last-success.json'
    $partialStatusPath = "$statusPath.partial"
    try {
        $status | ConvertTo-Json | Set-Content -LiteralPath $partialStatusPath -Encoding UTF8
        Move-Item -LiteralPath $partialStatusPath -Destination $statusPath -Force
    }
    finally {
        Remove-Item -LiteralPath $partialStatusPath -Force -ErrorAction SilentlyContinue
    }

    Write-BackupLog "Verified $verifiedCount backup(s); downloaded $downloadedCount; newest is $newest."
}
finally {
    $archiveLock.Dispose()
}
