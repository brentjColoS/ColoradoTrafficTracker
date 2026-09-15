[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-LocalArchive.ps1')
. (Join-Path $PSScriptRoot 'Backup-DataRange.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "ctt-archive-test-$([Guid]::NewGuid().ToString('N'))"
function Assert-ArchiveTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $copy = @(
        'COPY public.traffic_sample (id, polled_at) FROM stdin;',
        ('1' + [char]9 + '2026-09-15 02:48:45+00'),
        '\.',
        'COPY public.traffic_sample_archive (polled_at, id) FROM stdin;',
        ('2026-04-10 05:47:10+00' + [char]9 + '2'),
        '\.'
    ) -join [Environment]::NewLine
    $range = Read-TrafficDataRange ([IO.StringReader]::new($copy))
    Assert-ArchiveTest ((Get-DataRangeStem $range) -ceq '4-9_9-14-26') 'Range did not use actual Denver traffic dates.'
    Assert-ArchiveTest ($range.sampleCount -eq 2) 'Did not scan both current and archived samples.'
    $crossYear = [pscustomobject]@{ startDate='2025-12-31'; endDate='2026-01-01'; timeZoneId='Mountain Standard Time' }
    Assert-ArchiveTest ((Get-DataRangeStem $crossYear) -eq '12-31-25_1-1-26') 'Cross-year range is ambiguous.'
    $dstCopy = $copy.Replace('2026-04-10 05:47:10+00', '2026-11-01 07:30:00+00').Replace('2026-09-15 02:48:45+00', '2026-11-01 08:30:00+00')
    Assert-ArchiveTest ((Get-DataRangeStem (Read-TrafficDataRange ([IO.StringReader]::new($dstCopy)))) -eq '11-1_11-1-26') 'DST fallback changed traffic date.'
    $rejected = $false
    try { Read-TrafficDataRange ([IO.StringReader]::new('no COPY data')) | Out-Null }
    catch { $rejected = $true }
    Assert-ArchiveTest $rejected 'Invented a range without traffic rows.'

    $snapshot = 'traffic-20260915T024906Z.dump'
    $at = [DateTimeOffset]::Parse('2026-09-14T21:08:15.1234567-06:00')
    foreach ($sourceType in @('canonical', 'received', 'partial')) {
        foreach ($phase in @('intent', 'moved', 'manifest')) {
            $directory = Join-Path $testRoot "$sourceType-$phase"
            New-Item -ItemType Directory -Path $directory | Out-Null
            $sourceName = $snapshot
            if ($sourceType -eq 'received') { $sourceName = Get-ReceivedBackupName $snapshot $at }
            if ($sourceType -eq 'partial') { $sourceName = "$snapshot.partial" }
            $source = Join-Path $directory $sourceName
            Set-Content -LiteralPath $source -Value 'original archive bytes' -NoNewline
            $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($sourceType -ne 'partial') { Write-ArchiveText "$source.sha256" "$hash  $sourceName" }
            if ($sourceType -eq 'received') {
                Write-ArchiveText "$source.receipt.json" (@{
                    schemaVersion=1; serverFilename=$snapshot; localFilename=$sourceName; sha256=$hash
                    receivedAt=$at.ToString('o'); timeZoneId='Mountain Standard Time'; receiptTimeSource='verified-download'
                } | ConvertTo-Json)
            }
            $receipt = [pscustomobject]@{
                schemaVersion=2; serverFilename=$snapshot; localFilename='4-9_9-14-26.dump'; sha256=$hash
                receivedAt=$at.ToString('o'); timeZoneId='Mountain Standard Time'; receiptTimeSource='verified-download'
                dataRange=$range; sourceFilename=$sourceName; publicationPending=$true; byteLength=0L; fileLastWriteTimeUtc=''
            }
            $metadata = Join-Path $directory "$snapshot.receipt.json"
            Write-ArchiveText $metadata ($receipt | ConvertTo-Json -Depth 5)
            $final = Join-Path $directory $receipt.localFilename
            if ($phase -ne 'intent') { Move-Item -LiteralPath $source -Destination $final }
            if ($phase -eq 'manifest') { Write-ArchiveText "$final.sha256" "$hash  $($receipt.localFilename)" }
            $state = Initialize-LocalArchive $directory 'must-not-be-invoked'
            Assert-ArchiveTest ($state.Errors.Count -eq 0) "Recovery failed: $sourceType/$phase"
            Assert-ArchiveTest ($state.Index[$snapshot].receivedAt -ceq $at.ToString('o')) 'Recovery changed receipt time.'
            Assert-ArchiveTest ((Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLowerInvariant() -eq $hash) 'Recovery changed bytes.'
            Assert-ArchiveTest ((Read-BackupChecksum "$final.sha256" $receipt.localFilename) -eq $hash) 'Manifest references the wrong name.'
            $before = Get-Content -LiteralPath $metadata -Raw
            $again = Initialize-LocalArchive $directory 'must-not-be-invoked'
            Assert-ArchiveTest ($again.Errors.Count -eq 0) 'Rerun was not idempotent.'
            Assert-ArchiveTest ((Get-Content -LiteralPath $metadata -Raw) -ceq $before) 'Rerun changed metadata.'
            Assert-ArchiveTest (@(Get-ChildItem -LiteralPath $directory -Filter '*.dump').Count -eq 1) 'Recovery duplicated a dump.'
        }
    }
    Write-Host '[test-local-archive] ok (actual ranges, Denver/DST, cross-year, nine interrupted migrations)'
} finally {
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $target = [IO.Path]::GetFullPath($testRoot)
    if ($target.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $target) -like 'ctt-archive-test-*') {
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    }
}
