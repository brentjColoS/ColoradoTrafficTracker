[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Test-BackupLocalArchive.ps1')
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "ctt-windows-backup-$([Guid]::NewGuid().ToString('N'))"
$remoteRoot = Join-Path $testRoot 'remote'
$destination = Join-Path $testRoot 'destination'
$fakeSsh = Join-Path $testRoot 'fake-ssh.ps1'
$fakeScp = Join-Path $testRoot 'fake-scp.ps1'
$identity = Join-Path $testRoot 'identity'
$config = Join-Path $testRoot 'backup-settings.psd1'
$receiptLog = Join-Path $testRoot 'receipt.log'
$syncScript = Join-Path $PSScriptRoot 'Sync-ColoradoTrafficBackup.ps1'
. (Join-Path $PSScriptRoot 'Backup-LocalArchive.ps1')

function Assert-Test {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

try {
    New-Item -ItemType Directory -Path $remoteRoot, $destination -Force | Out-Null
    Set-Content -LiteralPath $identity -Value 'test identity'

    @'
$command = [string]$args[-1]
if ($env:FAKE_BACKUP_UNREACHABLE -eq 'true') {
    Write-Error 'ssh: connect to host backup.example.test port 22: Connection timed out' -ErrorAction Continue
    exit 255
}
if ($env:FAKE_BACKUP_AUTH_FAILURE -eq 'true') {
    Write-Error 'backup.example.test: Permission denied (publickey).' -ErrorAction Continue
    exit 255
}
if ($command -like 'find *') {
    Get-ChildItem -LiteralPath $env:FAKE_BACKUP_REMOTE_ROOT -Filter 'traffic-*.dump' -File |
        Sort-Object Name |
        ForEach-Object { $_.Name }
    if ($env:FAKE_BACKUP_MALFORMED_LIST -eq 'true') {
        Write-Output 'traffic-20260231T033000Z.dump'
    }
    exit 0
}
if ($command -match 'record-offsite-backup\.sh') {
    Set-Content -LiteralPath $env:FAKE_BACKUP_RECEIPT_LOG -Value $command
    exit 0
}
Write-Error "Unexpected fake SSH command: $command"
exit 1
'@ | Set-Content -LiteralPath $fakeSsh -Encoding UTF8

    @'
$source = [string]$args[-2]
$destination = [string]$args[-1]
$separator = $source.IndexOf(':')
if ($separator -lt 0) {
    Write-Error "Invalid fake SCP source: $source"
    exit 1
}
$filename = Split-Path -Leaf $source.Substring($separator + 1)
$remoteFile = Join-Path $env:FAKE_BACKUP_REMOTE_ROOT $filename
if (-not (Test-Path -LiteralPath $remoteFile -PathType Leaf)) {
    Write-Error "Missing fake remote file: $filename"
    exit 1
}
Copy-Item -LiteralPath $remoteFile -Destination $destination -Force
if ($filename -like '*.dump') {
    Add-Content -LiteralPath $env:FAKE_BACKUP_DOWNLOAD_LOG -Value $filename
    if ($env:FAKE_BACKUP_CORRUPT_DOWNLOAD -eq 'true') {
        Add-Content -LiteralPath $destination -Value 'corrupt transfer'
    }
}
exit 0
'@ | Set-Content -LiteralPath $fakeScp -Encoding UTF8

    $filenames = @(
        'traffic-20260830T033100Z.dump',
        'traffic-20260906T033200Z.dump'
    )
    foreach ($filename in $filenames) {
        $dumpPath = Join-Path $remoteRoot $filename
        Set-Content -LiteralPath $dumpPath -Value "contents for $filename" -NoNewline
        $checksum = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -LiteralPath "$dumpPath.sha256" -Value "$checksum  $filename"
    }

    @"
@{
    RemoteHost = 'backup.example.test'
    RemoteUser = 'ctt-backup'
    RemoteBackupDirectory = '/var/backups/colorado-traffic-tracker/database'
    RemoteReceiptCommand = '/opt/colorado-traffic-tracker/scripts/backups/record-offsite-backup.sh'
    SshKeyPath = '$($identity.Replace("'", "''"))'
    DestinationDirectory = '$($destination.Replace("'", "''"))'
}
"@ | Set-Content -LiteralPath $config -Encoding UTF8

    $env:FAKE_BACKUP_REMOTE_ROOT = $remoteRoot
    $env:FAKE_BACKUP_RECEIPT_LOG = $receiptLog
    $env:FAKE_BACKUP_DOWNLOAD_LOG = Join-Path $testRoot 'downloads.log'

    # Reproduce Windows PowerShell -File invocation without an explicit ConfigPath.
    # Use only test settings and fake transports, never the real ignored settings.
    Copy-Item -LiteralPath $syncScript -Destination $testRoot
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Backup-LocalArchive.ps1') -Destination $testRoot
    $started = [DateTimeOffset]::Now
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $testRoot 'Sync-ColoradoTrafficBackup.ps1') `
        -SshExecutable $fakeSsh -ScpExecutable $fakeScp
    Assert-Test ($LASTEXITCODE -eq 0) 'Default ConfigPath failed under Windows PowerShell.'
    $firstReceipts = @{}

    foreach ($filename in $filenames) {
        $metadata = @(Get-ChildItem -LiteralPath $destination -Filter '*.receipt.json' | ForEach-Object { Read-BackupReceipt $_ } |
            Where-Object { $_.serverFilename -eq $filename })
        Assert-Test ($metadata.Count -eq 1) "Did not retain exactly one receipt for $filename."
        $receipt = $metadata[0]
        $firstReceipts[$filename] = $receipt
        $local = Join-Path $destination $receipt.localFilename
        Assert-Test (Test-Path -LiteralPath $local) "Did not download $filename."
        Assert-Test ((Read-BackupChecksum "$local.sha256" $receipt.localFilename) -eq $receipt.sha256) 'Local manifest names the wrong file.'
        Assert-Test ($receipt.receiptTimeSource -eq 'verified-download') 'New receipt was not marked exact.'
        Assert-Test ($receipt.timeZoneId -eq [TimeZoneInfo]::Local.Id) 'Missing local timezone ID.'
        Assert-Test ([DateTimeOffset]::Parse($receipt.receivedAt) -ge $started) 'Receipt predates the download.'
        Assert-Test ([DateTimeOffset]::Parse($receipt.receivedAt) -le [DateTimeOffset]::Now) 'Receipt is in the future.'
    }

    $status = Get-Content -LiteralPath (Join-Path $destination 'last-success.json') -Raw | ConvertFrom-Json
    Assert-Test ($status.newestVerifiedBackup -eq $filenames[-1]) 'The status did not identify the newest verified backup.'
    Assert-Test ($status.verifiedCount -eq 2) 'The status did not count every verified backup.'
    Assert-Test ($status.downloadedCount -eq 2) 'The first run did not count both downloads.'
    Assert-Test ((Get-Content -LiteralPath $receiptLog -Raw) -match [regex]::Escape($filenames[-1])) 'The receipt did not identify the newest backup.'
    Assert-Test ((Get-Content -LiteralPath $receiptLog -Raw) -notmatch 'traffic-received') 'Windows display name was sent to the server.'
    Assert-Test ($status.newestLocalBackup -eq $firstReceipts[$filenames[-1]].localFilename) 'Status omitted the local display filename.'

    $olderLocal = Join-Path $destination 'traffic-20260104T033000Z.dump'
    Set-Content -LiteralPath $olderLocal -Value 'older retained backup' -NoNewline
    $olderHash = (Get-FileHash -LiteralPath $olderLocal -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$olderLocal.sha256" -Value "$olderHash  $(Split-Path -Leaf $olderLocal)"
    $olderTime = [DateTimeOffset]::Parse('2026-01-04T18:12:13-07:00')
    (Get-Item -LiteralPath $olderLocal).LastWriteTimeUtc = $olderTime.UtcDateTime
    $stalePartial = Join-Path $destination "$($filenames[0]).partial"
    Set-Content -LiteralPath $stalePartial -Value 'stale partial'

    & $syncScript -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp

    $status = Get-Content -LiteralPath (Join-Path $destination 'last-success.json') -Raw | ConvertFrom-Json
    Assert-Test ($status.verifiedCount -eq 2) 'The second run did not verify both existing backups.'
    Assert-Test ($status.downloadedCount -eq 0) 'The second run downloaded an existing verified backup.'
    $olderReceipt = @(Get-ChildItem -LiteralPath $destination -Filter '*.receipt.json' | ForEach-Object { Read-BackupReceipt $_ } |
        Where-Object { $_.serverFilename -eq (Split-Path -Leaf $olderLocal) })[0]
    $olderRenamed = Join-Path $destination $olderReceipt.localFilename
    Assert-Test (Test-Path -LiteralPath $olderRenamed) 'The sync lost a backup no longer on the server.'
    Assert-Test ((Get-FileHash -LiteralPath $olderRenamed -Algorithm SHA256).Hash.ToLowerInvariant() -eq $olderHash) 'Migration changed old backup bytes.'
    Assert-Test ($olderReceipt.receiptTimeSource -eq 'filesystem-last-write-estimate') 'Migration presented a filesystem estimate as exact.'
    Assert-Test ([DateTimeOffset]::Parse($olderReceipt.receivedAt) -eq $olderTime) 'Migration invented a new receipt time.'
    Assert-Test (-not (Test-Path -LiteralPath $stalePartial)) 'The sync left a stale partial transfer file.'
    foreach ($filename in $filenames) {
        $originalReceipt = $firstReceipts[$filename]
        $receiptPath = Join-Path $destination "$($originalReceipt.localFilename).receipt.json"
        $currentReceipt = Read-BackupReceipt (Get-Item -LiteralPath $receiptPath)
        Assert-Test ($currentReceipt.receivedAt -ceq $originalReceipt.receivedAt) 'Reverification changed receipt time.'
    }
    Assert-Test (@(Get-ChildItem -LiteralPath $destination -Filter '*.dump').Count -eq 3) 'Duplicate full-dump copies were created.'
    Assert-Test (@(Get-Content -LiteralPath $env:FAKE_BACKUP_DOWNLOAD_LOG).Count -eq 2) 'SCP downloaded a duplicate dump.'

    $changedManifest = Join-Path $remoteRoot "$($filenames[0]).sha256"
    $originalManifest = Get-Content -LiteralPath $changedManifest -Raw
    $serverMismatchRejected = $false
    try {
        Set-Content -LiteralPath $changedManifest -Value "$('0' * 64)  $($filenames[0])"
        try { & $syncScript -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp }
        catch { $serverMismatchRejected = $_.Exception.Message -match 'does not match the server manifest' }
    } finally { Set-Content -LiteralPath $changedManifest -Value $originalManifest }
    Assert-Test $serverMismatchRejected 'Changed server checksum was accepted for a known snapshot.'

    $heldLock = [IO.File]::Open((Join-Path $destination '.sync.lock'), 'Open', 'ReadWrite', 'None')
    try {
        $locked = $false
        try { & $syncScript -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp }
        catch { $locked = $_.Exception.Message -match 'destination lock' }
        Assert-Test $locked 'A concurrent sync was allowed to modify the archive.'
    } finally { $heldLock.Dispose() }

    $env:FAKE_BACKUP_MALFORMED_LIST = 'true'
    $malformedRejected = $false
    try {
        & $syncScript -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp
    }
    catch {
        $malformedRejected = $_.Exception.Message -match 'malformed backup filename'
    }
    Assert-Test $malformedRejected 'The sync accepted a malformed server filename.'
    Remove-Item Env:FAKE_BACKUP_MALFORMED_LIST -ErrorAction SilentlyContinue

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $env:FAKE_BACKUP_UNREACHABLE = 'true'
        $offlineOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript `
            -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp 2>&1)
        $offlineExitCode = $LASTEXITCODE
        Assert-Test ($offlineExitCode -eq 0) "A temporarily unreachable server failed the scheduled run (exit $offlineExitCode): $($offlineOutput -join ' ')"
        Assert-Test (($offlineOutput -join "`n") -match 'retry at the next scheduled run or logon') 'The offline result did not explain when it will retry.'
        Remove-Item Env:FAKE_BACKUP_UNREACHABLE -ErrorAction SilentlyContinue

        $env:FAKE_BACKUP_AUTH_FAILURE = 'true'
        $authOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript `
            -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp 2>&1)
        $authExitCode = $LASTEXITCODE
        Assert-Test ($authExitCode -ne 0) 'An SSH authentication failure was treated as a temporary outage.'
        Assert-Test (($authOutput -join "`n") -match 'Permission denied') 'The authentication failure did not preserve its explanation.'
        Remove-Item Env:FAKE_BACKUP_AUTH_FAILURE -ErrorAction SilentlyContinue
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    # A corrupt new transfer must never become a completed received dump.
    $newFilename = 'traffic-20260913T033000Z.dump'
    $newRemote = Join-Path $remoteRoot $newFilename
    Set-Content -LiteralPath $newRemote -Value 'new backup' -NoNewline
    $newHash = (Get-FileHash -LiteralPath $newRemote -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$newRemote.sha256" -Value "$newHash  $newFilename"
    $env:FAKE_BACKUP_CORRUPT_DOWNLOAD = 'true'
    $transferRejected = $false
    try { & $syncScript -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp }
    catch { $transferRejected = $_.Exception.Message -match 'did not match its SHA-256 checksum' }
    Remove-Item Env:FAKE_BACKUP_CORRUPT_DOWNLOAD
    Assert-Test $transferRejected 'A corrupt download was published.'
    Assert-Test (@(Get-ChildItem -LiteralPath $destination -Filter '*snapshot-20260913T033000Z.dump').Count -eq 0) 'Corrupt download has a receipt filename.'

    Set-Content -LiteralPath (Join-Path $destination $firstReceipts[$filenames[0]].localFilename) -Value 'corrupted local copy' -NoNewline
    $corruptionRejected = $false
    try {
        & $syncScript -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp
    }
    catch {
        $corruptionRejected = $_.Exception.Message -match 'Local checksum mismatch'
    }
    Assert-Test $corruptionRejected 'The sync accepted a corrupt existing local backup.'

    Write-Host '[test-windows-backup] ok'
}
finally {
    Remove-Item Env:FAKE_BACKUP_REMOTE_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_BACKUP_RECEIPT_LOG -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_BACKUP_MALFORMED_LIST -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_BACKUP_UNREACHABLE -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_BACKUP_AUTH_FAILURE -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_BACKUP_DOWNLOAD_LOG -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_BACKUP_CORRUPT_DOWNLOAD -ErrorAction SilentlyContinue

    $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    if ($resolvedTestRoot.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTestRoot) -like 'ctt-windows-backup-*') {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
