[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-LocalArchive.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "ctt-archive-test-$([Guid]::NewGuid().ToString('N'))"

function Assert-ArchiveTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $snapshot = 'traffic-20260915T024906Z.dump'
    $dates = @(
        @('2026-11-01T01:30:00-06:00', '2026-11-01_01-30-00_UTC-0600'),
        @('2026-11-01T01:30:00-07:00', '2026-11-01_01-30-00_UTC-0700'),
        @('2026-03-08T01:59:59-07:00', '2026-03-08_01-59-59_UTC-0700'),
        @('2026-03-08T03:00:00-06:00', '2026-03-08_03-00-00_UTC-0600'),
        @('2026-09-15T08:19:06+05:30', '2026-09-15_08-19-06_UTC+0530'),
        @('2026-09-15T02:49:06+00:00', '2026-09-15_02-49-06_UTC+0000')
    )
    foreach ($case in $dates) {
        $name = Get-ReceivedBackupName $snapshot ([DateTimeOffset]::Parse($case[0]))
        Assert-ArchiveTest ($name -ceq "traffic-received-$($case[1])__snapshot-20260915T024906Z.dump") "Wrong UTC offset format: $name"
    }
    $denver = [TimeZoneInfo]::FindSystemTimeZoneById('Mountain Standard Time')
    $firstHour = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::Parse('2026-11-01T07:30:00Z'), $denver)
    $secondHour = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::Parse('2026-11-01T08:30:00Z'), $denver)
    Assert-ArchiveTest ((Get-ReceivedBackupName $snapshot $firstHour) -ne (Get-ReceivedBackupName $snapshot $secondHour)) 'Repeated DST hour produced the same name.'
    Assert-ArchiveTest ((Get-ReceivedBackupName $snapshot $firstHour) -ne
        (Get-ReceivedBackupName 'traffic-20260914T191837Z.dump' $firstHour)) 'Two snapshots received in one second collide.'

    # Simulate process termination at each publication boundary, for both migrations
    # and newly verified transfers. Recovery must use the already-recorded timestamp.
    foreach ($sourceType in @('filesystem-last-write-estimate', 'verified-download')) {
        foreach ($phase in @('intent-written', 'dump-moved', 'manifest-written')) {
            $directory = Join-Path $testRoot "$sourceType-$phase"
            New-Item -ItemType Directory -Path $directory | Out-Null
            $legacy = Join-Path $directory $snapshot
            $source = $legacy
            if ($sourceType -eq 'verified-download') { $source = "$legacy.partial" }
            Set-Content -LiteralPath $source -Value 'full original dump bytes' -NoNewline
            $checksum = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($sourceType -eq 'filesystem-last-write-estimate') {
                Set-Content -LiteralPath "$legacy.sha256" -Value "$checksum  $snapshot"
            }
            $receipt = New-BackupReceipt $snapshot $checksum ([DateTimeOffset]::Parse('2026-09-14T20:49:12.1234567-06:00')) $sourceType
            $final = Join-Path $directory $receipt.localFilename
            Write-ArchiveText "$final.receipt.json" ($receipt | ConvertTo-Json)
            $metadataBefore = Get-Content -LiteralPath "$final.receipt.json" -Raw
            if ($phase -ne 'intent-written') { Move-Item -LiteralPath $source -Destination $final }
            if ($phase -eq 'manifest-written') { Write-ArchiveText "$final.sha256" "$checksum  $($receipt.localFilename)" }
            $index = Initialize-LocalArchive $directory
            Assert-ArchiveTest ($index.Count -eq 1) "Recovery failed: $sourceType/$phase"
            Assert-ArchiveTest ((Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLowerInvariant() -eq $checksum) 'Recovery changed dump bytes.'
            Assert-ArchiveTest ((Read-BackupChecksum "$final.sha256" $receipt.localFilename) -eq $checksum) 'Recovery did not repair local manifest.'
            Assert-ArchiveTest ((Get-Content -LiteralPath "$final.receipt.json" -Raw) -ceq $metadataBefore) 'Recovery rewrote the receipt.'
            Assert-ArchiveTest (-not (Test-Path -LiteralPath $legacy)) 'Recovery left an unnecessary full-dump copy.'
            Assert-ArchiveTest (-not (Test-Path -LiteralPath "$legacy.sha256")) 'Recovery left the old-name manifest.'
            $again = Initialize-LocalArchive $directory
            Assert-ArchiveTest ($again[$snapshot].localFilename -ceq $receipt.localFilename) 'Recovery is not idempotent.'
        }
    }

    $corruptDirectory = Join-Path $testRoot 'corrupt-migration'
    New-Item -ItemType Directory -Path $corruptDirectory | Out-Null
    $original = Join-Path $corruptDirectory $snapshot
    Set-Content -LiteralPath $original -Value 'retain these bytes' -NoNewline
    Set-Content -LiteralPath "$original.sha256" -Value "$('0' * 64)  $snapshot"
    $rejected = $false
    try { Initialize-LocalArchive $corruptDirectory | Out-Null }
    catch { $rejected = $_.Exception.Message -match 'Local checksum mismatch' }
    Assert-ArchiveTest $rejected 'A corrupt legacy dump was renamed.'
    Assert-ArchiveTest (Test-Path -LiteralPath $original) 'Mismatch did not preserve the original path.'
    Assert-ArchiveTest (@(Get-ChildItem -LiteralPath $corruptDirectory -Filter '*.receipt.json').Count -eq 0) 'Mismatch published receipt metadata.'

    # Conflicting evidence must stop rather than choose or overwrite a completed copy.
    $conflictDirectory = Join-Path $testRoot 'filesystem-last-write-estimate-dump-moved'
    $existing = @(Get-ChildItem -LiteralPath $conflictDirectory -Filter '*.dump')[0]
    $receiptFile = Get-Item -LiteralPath "$($existing.FullName).receipt.json"
    $receipt = Read-BackupReceipt $receiptFile
    $legacy = Join-Path $conflictDirectory $snapshot
    Copy-Item -LiteralPath $existing.FullName -Destination $legacy
    $rejected = $false
    try { Initialize-LocalArchive $conflictDirectory | Out-Null }
    catch { $rejected = $_.Exception.Message -match 'Both original and received copies exist' }
    Assert-ArchiveTest $rejected 'Conflicting original and receipt copies were accepted.'
    Assert-ArchiveTest (Test-Path -LiteralPath $legacy) 'Conflict handling deleted the original.'

    $receipt.localFilename = '..\outside.dump'
    Write-ArchiveText $receiptFile.FullName ($receipt | ConvertTo-Json)
    $rejected = $false
    try { Read-BackupReceipt $receiptFile | Out-Null }
    catch { $rejected = $_.Exception.Message -match 'filename conflict' }
    Assert-ArchiveTest $rejected 'Unsafe receipt filename was accepted.'
    Write-Host '[test-local-archive] ok (offsets, migration refusal, publication recovery, immutable receipts)'
}
finally {
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    if ($resolvedTestRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTestRoot) -like 'ctt-archive-test-*') {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
