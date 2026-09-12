[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'backup-settings.psd1'),
    [string]$SshExecutable = 'ssh.exe',
    [string]$ScpExecutable = 'scp.exe'
)

$ErrorActionPreference = 'Stop'

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

function Test-BackupFilename {
    param([string]$Filename)

    if ($Filename -notmatch '^traffic-([0-9]{8}T[0-9]{6}Z)\.dump$') {
        return $false
    }

    $parsedTimestamp = [DateTime]::MinValue
    return [DateTime]::TryParseExact(
        $Matches[1],
        'yyyyMMddTHHmmssZ',
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal,
        [ref]$parsedTimestamp
    )
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

$listCommand = "find '$($settings.RemoteBackupDirectory)' -maxdepth 1 -type f -name 'traffic-*.dump' -printf '%f\n' | sort"
$listResult = Invoke-BackupCommand -Executable $ssh -Arguments (@($sshOptions) + @($remote, $listCommand))
if ($listResult.ExitCode -ne 0) {
    if (Test-TemporaryConnectionFailure $listResult.Error) {
        Write-BackupLog 'Server is unavailable; the scheduled task will retry after the next logon.'
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
    $localDump = Join-Path $destination $filename
    $localManifest = "$localDump.sha256"
    $partialDump = "$localDump.partial"
    $partialManifest = "$localManifest.partial"

    Remove-Item -LiteralPath $partialDump -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $partialManifest -Force -ErrorAction SilentlyContinue

    try {
        $manifestResult = Invoke-BackupCommand -Executable $scp -Arguments (
            @($sshOptions) + @("${remote}:$($settings.RemoteBackupDirectory)/$filename.sha256", $partialManifest)
        )
        if ($manifestResult.ExitCode -ne 0) {
            if (Test-TemporaryConnectionFailure $manifestResult.Error) {
                Write-BackupLog 'Server became unavailable; the scheduled task will retry after the next logon.'
                exit 0
            }
            throw (Get-CommandFailureMessage "Downloading the checksum manifest for $filename" $manifestResult)
        }

        $manifestLines = @(Get-Content -LiteralPath $partialManifest | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($manifestLines.Count -ne 1) {
            throw "The checksum manifest for $filename is invalid."
        }
        $manifestLine = $manifestLines[0].Trim()
        if (-not ($manifestLine -match '^([0-9a-fA-F]{64})[ \t]+([^ \t]+)$')) {
            throw "The checksum manifest for $filename is invalid."
        }

        $expectedChecksum = $Matches[1].ToLowerInvariant()
        $manifestFilename = $Matches[2]
        if ($manifestFilename -ne $filename) {
            throw "The checksum manifest for $filename names a different backup file."
        }

        if (Test-Path -LiteralPath $localDump -PathType Leaf) {
            $existingChecksum = (Get-FileHash -LiteralPath $localDump -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($existingChecksum -ne $expectedChecksum) {
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
                    Write-BackupLog 'Server became unavailable; the scheduled task will retry after the next logon.'
                    exit 0
                }
                throw (Get-CommandFailureMessage "Downloading $filename" $dumpResult)
            }

            $downloadedChecksum = (Get-FileHash -LiteralPath $partialDump -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($downloadedChecksum -ne $expectedChecksum) {
                throw "The downloaded backup $filename did not match its SHA-256 checksum."
            }

            Move-Item -LiteralPath $partialDump -Destination $localDump
            $downloadedCount++
        }

        Move-Item -LiteralPath $partialManifest -Destination $localManifest -Force
        $verifiedCount++
    }
    finally {
        Remove-Item -LiteralPath $partialDump -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $partialManifest -Force -ErrorAction SilentlyContinue
    }
}

$newest = $remoteFiles[-1]
$newestManifest = "$((Join-Path $destination $newest)).sha256"
$newestManifestLine = (Get-Content -LiteralPath $newestManifest -TotalCount 1).Trim()
$newestChecksum = ($newestManifestLine -split '[ \t]+', 2)[0].ToLowerInvariant()
$receiptCommand = "'$($settings.RemoteReceiptCommand)' '$newest' '$newestChecksum'"
$receiptResult = Invoke-BackupCommand -Executable $ssh -Arguments (@($sshOptions) + @($remote, $receiptCommand))
if ($receiptResult.ExitCode -ne 0) {
    throw (Get-CommandFailureMessage 'Recording the server receipt' $receiptResult)
}

$status = [ordered]@{
    completedAt = [DateTimeOffset]::UtcNow.ToString('o')
    newestVerifiedBackup = $newest
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
