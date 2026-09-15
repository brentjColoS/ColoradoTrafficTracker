[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Test-BackupLocalArchive.ps1')
. (Join-Path $PSScriptRoot 'Backup-LocalArchive.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "ctt-windows-backup-$([Guid]::NewGuid().ToString('N'))"
$remoteRoot = Join-Path $testRoot 'remote'
$destination = Join-Path $testRoot 'destination'
$config = Join-Path $testRoot 'backup-settings.psd1'
$syncScript = Join-Path $testRoot 'Sync-ColoradoTrafficBackup.ps1'
function Assert-Test {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function New-TestSnapshot {
    param([string]$Name, [string]$End = '2026-09-15 02:48:45+00')
    $path = Join-Path $remoteRoot $Name
    Set-Content -LiteralPath $path -Value "2026-04-10 05:47:10+00|$End" -NoNewline
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-ArchiveText "$path.sha256" "$hash  $Name"
    return $hash
}
function Invoke-TestSync {
    param([int]$ExpectedExit = 0)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -SshExecutable $fakeSsh -ScpExecutable $fakeScp 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    Assert-Test ($code -eq $ExpectedExit) "Unexpected exit $code (expected $ExpectedExit): $($output -join ' ')"
    return Read-ArchiveJson (Join-Path $destination 'last-run.json')
}
try {
    New-Item -ItemType Directory -Path $remoteRoot, $destination | Out-Null
    foreach ($name in @('Sync-ColoradoTrafficBackup.ps1','Backup-LocalArchive.ps1','Backup-DataRange.ps1','Test-ColoradoTrafficArchive.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $testRoot
    }
    $fakeSsh = Join-Path $testRoot 'fake-ssh.ps1'
    $fakeScp = Join-Path $testRoot 'fake-scp.ps1'
    $fakeRestore = Join-Path $testRoot 'fake-pg-restore.ps1'
    $identity = Join-Path $testRoot 'identity'
    Set-Content -LiteralPath $identity -Value 'fake'
    @'
$command = [string]$args[-1]
if ($command -like 'find *') {
    Get-ChildItem -LiteralPath $env:FAKE_BACKUP_REMOTE_ROOT -Filter '*.dump' | Sort-Object Name | ForEach-Object Name
    exit 0
}
if ($command -match 'record-offsite-backup\.sh') {
    Set-Content -LiteralPath $env:FAKE_BACKUP_RECEIPT_LOG -Value $command
    exit 0
}
exit 1
'@ | Set-Content -LiteralPath $fakeSsh
    @'
$name = Split-Path -Leaf ([string]$args[-2])
Copy-Item -LiteralPath (Join-Path $env:FAKE_BACKUP_REMOTE_ROOT $name) -Destination ([string]$args[-1])
if ($name -like '*.dump') {
    Add-Content -LiteralPath $env:FAKE_BACKUP_DOWNLOAD_LOG -Value $name
    if ($env:FAKE_BACKUP_CORRUPT -eq 'true') { Add-Content -LiteralPath ([string]$args[-1]) -Value 'bad transfer' }
}
exit 0
'@ | Set-Content -LiteralPath $fakeScp
    @'
$dates = (Get-Content -LiteralPath ([string]$args[-1]) -Raw).Split('|')
Write-Output 'COPY public.traffic_sample (id, polled_at) FROM stdin;'
Write-Output ('1' + [char]9 + $dates[1])
Write-Output '\.'
Write-Output 'COPY public.traffic_sample_archive (polled_at, id) FROM stdin;'
Write-Output ($dates[0] + [char]9 + '2')
Write-Output '\.'
'@ | Set-Content -LiteralPath $fakeRestore
    @"
@{
RemoteHost='backup.example.test'
RemoteUser='ctt-backup'
RemoteBackupDirectory='/backups'
RemoteReceiptCommand='/record-offsite-backup.sh'
SshKeyPath='$($identity.Replace("'", "''"))'
DestinationDirectory='$($destination.Replace("'", "''"))'
PgRestorePath='$($fakeRestore.Replace("'", "''"))'
}
"@ | Set-Content -LiteralPath $config
    $env:FAKE_BACKUP_REMOTE_ROOT = $remoteRoot
    $env:FAKE_BACKUP_RECEIPT_LOG = Join-Path $testRoot 'receipt.log'
    $env:FAKE_BACKUP_DOWNLOAD_LOG = Join-Path $testRoot 'downloads.log'
    $first = 'traffic-20260914T191837Z.dump'
    $second = 'traffic-20260915T024906Z.dump'
    $old = 'traffic-20260104T033000Z.dump'
    $firstHash = New-TestSnapshot $first
    $null = New-TestSnapshot $second
    $oldHash = New-TestSnapshot $old '2026-09-01 18:00:00+00'

    # One prior receipt-time copy and one canonical-name server-pruned archive.
    $at = [DateTimeOffset]::Parse('2026-09-14T18:29:47.3171881-06:00')
    $long = Get-ReceivedBackupName $first $at
    $local = Join-Path $destination $long
    Copy-Item -LiteralPath (Join-Path $remoteRoot $first) -Destination $local
    Write-ArchiveText "$local.sha256" "$firstHash  $long"
    Write-ArchiveText "$local.receipt.json" (@{
        schemaVersion=1; serverFilename=$first; localFilename=$long; sha256=$firstHash
        receivedAt=$at.ToString('o'); timeZoneId='Mountain Standard Time'; receiptTimeSource='filesystem-last-write-estimate'
    } | ConvertTo-Json)
    Copy-Item -LiteralPath (Join-Path $remoteRoot $old) -Destination $destination
    Copy-Item -LiteralPath (Join-Path $remoteRoot "$old.sha256") -Destination $destination
    Remove-Item -LiteralPath (Join-Path $remoteRoot $old), (Join-Path $remoteRoot "$old.sha256")

    $status = Invoke-TestSync
    $firstReceipt = Read-ArchiveJson (Join-Path $destination "$first.receipt.json")
    $secondReceipt = Read-ArchiveJson (Join-Path $destination "$second.receipt.json")
    $oldReceipt = Read-ArchiveJson (Join-Path $destination "$old.receipt.json")
    Assert-Test ($firstReceipt.localFilename -eq '4-9_9-14-26.dump') 'Did not migrate to actual data-range name.'
    Assert-Test ($secondReceipt.localFilename -eq '4-9_9-14-26-2.dump') 'Range collision did not use numeric suffix.'
    Assert-Test ($firstReceipt.receivedAt -ceq $at.ToString('o')) 'Migration changed receipt time.'
    Assert-Test ($firstReceipt.receiptTimeSource -eq 'filesystem-last-write-estimate') 'Migration changed receipt provenance.'
    Assert-Test ($status.verifiedCount -eq 2 -and $status.downloadedCount -eq 1) 'Incorrect fresh download/migration counts.'
    Assert-Test ($old -notin $status.verifiedSnapshots) 'Routine sync claimed a historical archive was verified.'
    foreach ($record in @($firstReceipt,$secondReceipt,$oldReceipt)) {
        Assert-Test ((Read-BackupChecksum (Join-Path $destination "$($record.localFilename).sha256") $record.localFilename) -eq $record.sha256) 'Manifest did not follow the rename.'
    }
    $before = @(Get-ChildItem -LiteralPath $destination -Filter '*.receipt.json' | Sort-Object Name | Get-FileHash | ForEach-Object Hash) -join ','
    $status = Invoke-TestSync
    $after = @(Get-ChildItem -LiteralPath $destination -Filter '*.receipt.json' | Sort-Object Name | Get-FileHash | ForEach-Object Hash) -join ','
    Assert-Test ($status.downloadedCount -eq 0 -and $before -ceq $after) 'Rerun downloaded duplicates or changed receipts.'
    Assert-Test (@(Get-Content -LiteralPath $env:FAKE_BACKUP_DOWNLOAD_LOG).Count -eq 1) 'Repeated SCP download.'

    # Cheap inventory detects a visibly damaged old file but does not block a new one.
    $oldPath = Join-Path $destination $oldReceipt.localFilename
    Add-Content -LiteralPath $oldPath -Value 'damage'
    $damagedHash = (Get-FileHash -LiteralPath $oldPath).Hash
    $third = 'traffic-20260916T033000Z.dump'
    $null = New-TestSnapshot $third
    $status = Invoke-TestSync 1
    Assert-Test ($status.status -eq 'partial-success' -and $status.downloadedCount -eq 1 -and $status.verifiedCount -eq 3) 'Damaged old archive blocked unrelated catch-up.'
    Assert-Test ($old -notin $status.verifiedSnapshots) 'Damaged archive was reported verified.'
    Assert-Test (@($status.errors | Where-Object { $_.file -eq $oldReceipt.localFilename -and $_.problem -match 'Size changed: expected.*found' }).Count -eq 1) 'Missing exact historical error.'
    Assert-Test ((Get-FileHash -LiteralPath $oldPath).Hash -eq $damagedHash) 'Damaged file was overwritten.'
    Assert-Test ((Read-ArchiveJson (Join-Path $destination "$third.receipt.json")).localFilename -eq '4-9_9-14-26-3.dump') 'Third collision suffix is wrong.'
    Assert-Test ((Get-Content -LiteralPath $env:FAKE_BACKUP_RECEIPT_LOG -Raw) -match [regex]::Escape($third)) 'Server did not receive canonical newest healthy identity.'

    # Silent historical corruption is not rehashed by routine catch-up; audit catches it.
    $oldOriginal = '2026-04-10 05:47:10+00|2026-09-01 18:00:00+00'
    Set-Content -LiteralPath $oldPath -Value ($oldOriginal.Replace('05:47:10','05:47:11')) -NoNewline
    (Get-Item -LiteralPath $oldPath).LastWriteTimeUtc = [DateTime]::Parse($oldReceipt.fileLastWriteTimeUtc).ToUniversalTime()
    $status = Invoke-TestSync
    Assert-Test ($old -notin $status.verifiedSnapshots -and $status.verifiedCount -eq 3) 'Historical snapshot was rehashed or falsely verified.'
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $auditOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $testRoot 'Test-ColoradoTrafficArchive.ps1') 2>&1)
        $auditExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    $audit = Read-ArchiveJson (Join-Path $destination 'integrity-report.json')
    Assert-Test ($auditExit -ne 0 -and @($audit.errors | Where-Object { $_.snapshot -eq $old -and $_.problem -match 'SHA-256 mismatch' }).Count -eq 1) 'Separate full audit missed silent old corruption.'
    Assert-Test ($old -notin $audit.verifiedSnapshots) 'Audit reported a damaged archive as verified.'

    # A damaged server-listed snapshot is excluded, while a newer download succeeds.
    $secondPath = Join-Path $destination $secondReceipt.localFilename
    Set-Content -LiteralPath $secondPath -Value 'damaged current archive' -NoNewline
    $fourth = 'traffic-20260917T033000Z.dump'
    $null = New-TestSnapshot $fourth
    $status = Invoke-TestSync 1
    Assert-Test ($status.downloadedCount -eq 1 -and $second -notin $status.verifiedSnapshots -and $fourth -in $status.verifiedSnapshots) 'Damaged current snapshot blocked or contaminated verification.'
    $status = Invoke-TestSync 1
    Assert-Test ($status.downloadedCount -eq 0) 'Error rerun downloaded a duplicate.'

    # A corrupt new transfer stays unpublished; a later retry can finish normally.
    $fifth = 'traffic-20260918T033000Z.dump'
    $null = New-TestSnapshot $fifth
    $env:FAKE_BACKUP_CORRUPT = 'true'
    $status = Invoke-TestSync 1
    Remove-Item Env:FAKE_BACKUP_CORRUPT
    Assert-Test ($fifth -notin $status.verifiedSnapshots -and -not (Test-Path -LiteralPath (Join-Path $destination "$fifth.receipt.json"))) 'Corrupt transfer was published or counted.'
    $status = Invoke-TestSync 1
    Assert-Test ($status.downloadedCount -eq 1 -and $fifth -in $status.verifiedSnapshots) 'Could not retry a corrupt transfer.'

    $held = [IO.File]::Open((Join-Path $destination '.sync.lock'), 'Open', 'ReadWrite', 'None')
    try {
        $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try {
            $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -SshExecutable $fakeSsh -ScpExecutable $fakeScp 2>&1)
            $lockedExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previous }
        Assert-Test ($lockedExit -ne 0 -and ($output -join ' ') -match 'destination lock') 'Concurrent sync was allowed.'
    } finally { $held.Dispose() }
    Write-Host '[test-windows-backup] ok (migration, collisions, deduplication, damage isolation, bounded hashing, audit, locking)'
    # CI's PowerShell wrapper propagates LASTEXITCODE; expected failure tests leave 1.
    exit 0
} finally {
    foreach ($name in @('FAKE_BACKUP_REMOTE_ROOT','FAKE_BACKUP_RECEIPT_LOG','FAKE_BACKUP_DOWNLOAD_LOG','FAKE_BACKUP_CORRUPT')) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $target = [IO.Path]::GetFullPath($testRoot)
    if ($target.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $target) -like 'ctt-windows-backup-*') {
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    }
}
