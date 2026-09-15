# Local naming and recoverable publication. Called only while the destination lock is held.
function Test-BackupFilename {
    param([string]$Filename)
    if ($Filename -notmatch '^traffic-([0-9]{8}T[0-9]{6}Z)\.dump$') { return $false }
    $timestamp = [DateTime]::MinValue
    return [DateTime]::TryParseExact($Matches[1], 'yyyyMMddTHHmmssZ',
        [Globalization.CultureInfo]::InvariantCulture,
        ([Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal),
        [ref]$timestamp)
}

function Get-ReceivedBackupName {
    param([string]$ServerFilename, [DateTimeOffset]$ReceivedAt)
    if (-not (Test-BackupFilename $ServerFilename)) { throw 'Invalid canonical snapshot name.' }
    $stamp = $ReceivedAt.ToString('yyyy-MM-dd_HH-mm-ss', [Globalization.CultureInfo]::InvariantCulture)
    $offset = $ReceivedAt.ToString('zzz', [Globalization.CultureInfo]::InvariantCulture).Replace(':', '')
    $snapshot = $ServerFilename.Substring(8)
    return "traffic-received-${stamp}_UTC${offset}__snapshot-$snapshot"
}

function Read-BackupChecksum {
    param([string]$Path, [string]$Filename)
    $lines = @(Get-Content -LiteralPath $Path | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($lines.Count -ne 1 -or $lines[0].Trim() -notmatch '^([0-9a-fA-F]{64})[ \t]+([^ \t]+)$') {
        throw "The checksum manifest for $Filename is invalid."
    }
    $checksum = $Matches[1].ToLowerInvariant()
    if ($Matches[2] -cne $Filename) { throw "The checksum manifest for $Filename names a different backup file." }
    return $checksum
}

function Write-ArchiveText {
    param([string]$Path, [string]$Text)
    # Only small sidecars are replaced. Completed dump bytes are never overwritten.
    $partial = "$Path.partial"
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text + [Environment]::NewLine)
    $stream = [IO.File]::Open($partial, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally { $stream.Dispose() }
    Move-Item -LiteralPath $partial -Destination $Path -Force
}

function Read-ArchiveJson {
    param([string]$Path)
    $json = Get-Content -LiteralPath $Path -Raw
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) {
        return $json | ConvertFrom-Json -DateKind String
    }
    return $json | ConvertFrom-Json
}

function Get-DataRangeStem {
    param($Range)
    $start = [DateTime]::ParseExact($Range.startDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    $end = [DateTime]::ParseExact($Range.endDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    if ($start -gt $end -or $Range.timeZoneId -ne 'Mountain Standard Time') { throw 'Invalid Denver traffic date range.' }
    $startFormat = 'M-d'
    if ($start.Year -ne $end.Year) { $startFormat = 'M-d-yy' }
    return $start.ToString($startFormat, [Globalization.CultureInfo]::InvariantCulture) + '_' + $end.ToString('M-d-yy', [Globalization.CultureInfo]::InvariantCulture)
}

function Read-BackupReceipt {
    param([IO.FileInfo]$File)
    $receipt = Read-ArchiveJson $File.FullName
    if ($receipt.schemaVersion -notin @(1, 2) -or -not (Test-BackupFilename $receipt.serverFilename) -or
        $receipt.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
        $receipt.receiptTimeSource -notin @('verified-download', 'filesystem-last-write-estimate') -or
        [string]::IsNullOrWhiteSpace($receipt.timeZoneId) -or
        $receipt.receivedAt -notmatch '(Z|[+-][0-9]{2}:[0-9]{2})$') {
        throw "Invalid backup receipt: $($File.Name)"
    }
    $received = [DateTimeOffset]::Parse($receipt.receivedAt, [Globalization.CultureInfo]::InvariantCulture)
    $oldName = Get-ReceivedBackupName $receipt.serverFilename $received
    if ($receipt.schemaVersion -eq 1) {
        if ($receipt.localFilename -cne $oldName -or $File.Name -cne "$oldName.receipt.json") {
            throw "Backup receipt filename conflict: $($File.Name)"
        }
    } else {
        $stem = [regex]::Escape((Get-DataRangeStem $receipt.dataRange))
        if ($receipt.localFilename -cnotmatch "^$stem(-([2-9]|[1-9][0-9]+))?\.dump$" -or
            $File.Name -cne "$($receipt.serverFilename).receipt.json" -or
            $receipt.sourceFilename -cnotin @($oldName, $receipt.serverFilename, "$($receipt.serverFilename).partial") -or
            $receipt.publicationPending -isnot [bool]) {
            throw "Backup receipt filename conflict: $($File.Name)"
        }
    }
    return $receipt
}

function Add-ArchiveIssue {
    param($State, [string]$Snapshot, [string]$File, [string]$Problem)
    $State.Errors.Add([pscustomobject]@{ snapshot = $Snapshot; file = $File; problem = $Problem })
    Write-Warning "$File : $Problem"
}

function Test-LocalReceipt {
    param([string]$Directory, $Receipt, [switch]$Hash)
    $path = Join-Path $Directory $Receipt.localFilename
    $file = Get-Item -LiteralPath $path -ErrorAction Stop
    if ($Receipt.schemaVersion -eq 2) {
        if ($file.Length -ne $Receipt.byteLength) {
            throw "Size changed: expected $($Receipt.byteLength) bytes, found $($file.Length)."
        }
        if (-not $Hash -and $file.LastWriteTimeUtc.ToString('o') -cne $Receipt.fileLastWriteTimeUtc) {
            throw "Last-write time changed: expected $($Receipt.fileLastWriteTimeUtc), found $($file.LastWriteTimeUtc.ToString('o')); run the integrity audit."
        }
    }
    $manifestHash = Read-BackupChecksum "$path.sha256" $Receipt.localFilename
    if ($manifestHash -cne $Receipt.sha256) { throw "Manifest checksum conflicts with receipt: expected $($Receipt.sha256), found $manifestHash." }
    if ($Hash) {
        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -cne $Receipt.sha256) { throw "SHA-256 mismatch: expected $($Receipt.sha256), found $actual." }
    }
}

function Complete-BackupPublication {
    param([string]$Directory, $Receipt)
    $final = Join-Path $Directory $Receipt.localFilename
    $source = Join-Path $Directory $Receipt.sourceFilename
    $sourceExists = Test-Path -LiteralPath $source
    if ((Test-Path -LiteralPath $final) -and $sourceExists) { throw 'Both source and destination exist; preserving both.' }
    $verifyPath = $final
    if ($sourceExists) { $verifyPath = $source }
    $actual = (Get-FileHash -LiteralPath $verifyPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $Receipt.sha256) { throw "SHA-256 mismatch: expected $($Receipt.sha256), found $actual." }
    if (Test-Path -LiteralPath "$source.sha256") {
        if ((Read-BackupChecksum "$source.sha256" $Receipt.sourceFilename) -cne $Receipt.sha256) { throw 'Source manifest conflicts with receipt.' }
    }
    if (Test-Path -LiteralPath "$final.sha256") {
        if ((Read-BackupChecksum "$final.sha256" $Receipt.localFilename) -cne $Receipt.sha256) { throw 'Destination manifest conflicts with receipt.' }
    }
    if ($sourceExists) { Move-Item -LiteralPath $source -Destination $final }
    Write-ArchiveText "$final.sha256" "$($Receipt.sha256)  $($Receipt.localFilename)"
    $file = Get-Item -LiteralPath $final
    $Receipt.byteLength = $file.Length
    $Receipt.fileLastWriteTimeUtc = $file.LastWriteTimeUtc.ToString('o')
    # The canonical receipt already contains all original receipt details.
    foreach ($obsolete in @("$source.sha256", "$source.receipt.json")) {
        $canonicalMetadata = Join-Path $Directory "$($Receipt.serverFilename).receipt.json"
        if ($obsolete -ne $canonicalMetadata -and (Test-Path -LiteralPath $obsolete)) { Remove-Item -LiteralPath $obsolete }
    }
    $Receipt.publicationPending = $false
    Write-ArchiveText (Join-Path $Directory "$($Receipt.serverFilename).receipt.json") ($Receipt | ConvertTo-Json -Depth 5)
}

function Publish-BackupReceipt {
    param([string]$Directory, $Receipt, [string]$SourceFilename, [string]$PgRestoreExecutable, $Reserved)
    $source = Join-Path $Directory $SourceFilename
    $actual = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -cne $Receipt.sha256) { throw "SHA-256 mismatch: expected $($Receipt.sha256), found $actual." }
    $range = Get-BackupDataRange $source $PgRestoreExecutable
    $stem = Get-DataRangeStem $range
    $name = "$stem.dump"
    $suffix = 2
    while ($Reserved.ContainsKey($name) -or (Test-Path -LiteralPath (Join-Path $Directory $name)) -or
        (Test-Path -LiteralPath (Join-Path $Directory "$name.sha256"))) {
        $name = "$stem-$suffix.dump"
        $suffix++
    }
    $Reserved[$name] = $true
    $record = [pscustomobject][ordered]@{
        schemaVersion = 2
        serverFilename = $Receipt.serverFilename
        localFilename = $name
        sha256 = $Receipt.sha256
        receivedAt = $Receipt.receivedAt
        timeZoneId = $Receipt.timeZoneId
        receiptTimeSource = $Receipt.receiptTimeSource
        dataRange = $range
        sourceFilename = $SourceFilename
        publicationPending = $true
        byteLength = 0L
        fileLastWriteTimeUtc = ''
    }
    # Reserve the name durably before moving any verified bytes.
    Write-ArchiveText (Join-Path $Directory "$($record.serverFilename).receipt.json") ($record | ConvertTo-Json -Depth 5)
    Complete-BackupPublication $Directory $record
    Write-Host "[traffic-backup] Published $($record.serverFilename) as $name."
    return $record
}

function New-BackupReceipt {
    param([string]$ServerFilename, [string]$Checksum, [DateTimeOffset]$ReceivedAt,
        [ValidateSet('verified-download', 'filesystem-last-write-estimate')][string]$Source)
    return [pscustomobject]@{
        serverFilename = $ServerFilename
        sha256 = $Checksum
        receivedAt = $ReceivedAt.ToString('o')
        timeZoneId = [TimeZoneInfo]::Local.Id
        receiptTimeSource = $Source
    }
}

function Initialize-LocalArchive {
    param([string]$Directory, [string]$PgRestoreExecutable)
    $state = [pscustomobject]@{ Index = @{}; Reserved = @{}; Errors = [Collections.Generic.List[object]]::new() }
    $files = @(Get-ChildItem -LiteralPath $Directory -Filter '*.dump.receipt.json' -File | Sort-Object Name)
    # Metadata reads are cheap. Reserve even suspect claims; never overwrite their files.
    foreach ($file in $files) {
        try {
            $raw = Read-ArchiveJson $file.FullName
            if ($raw.localFilename) { $state.Reserved[[string]$raw.localFilename] = $true }
        } catch { }
    }
    $canonical = @($files | Where-Object { Test-BackupFilename ($_.Name -replace '\.receipt\.json$', '') })
    foreach ($file in $canonical) {
        $id = $file.Name -replace '\.receipt\.json$', ''
        $state.Index[$id] = $null
        $receipt = $null
        try {
            $receipt = Read-BackupReceipt $file
            if ($receipt.schemaVersion -ne 2) { throw 'Expected range-name receipt metadata.' }
            if ($receipt.publicationPending) { Complete-BackupPublication $Directory $receipt }
            Test-LocalReceipt $Directory $receipt
            $state.Index[$id] = $receipt
        } catch {
            $problemFile = $file.Name
            if ($receipt) { $problemFile = $receipt.localFilename }
            Add-ArchiveIssue $state $id $problemFile $_.Exception.Message
        }
    }
    foreach ($file in $files | Where-Object { $_.Name -like 'traffic-received-*' }) {
        if (-not (Test-Path -LiteralPath $file.FullName)) { continue }
        $id = ''
        if ($file.Name -match '__snapshot-([0-9]{8}T[0-9]{6}Z)\.dump\.receipt\.json$') { $id = "traffic-$($Matches[1]).dump" }
        if ($state.Index.ContainsKey($id)) { continue }
        $state.Index[$id] = $null
        try {
            $receipt = Read-BackupReceipt $file
            Test-LocalReceipt $Directory $receipt -Hash
            $state.Index[$id] = Publish-BackupReceipt $Directory $receipt $receipt.localFilename $PgRestoreExecutable $state.Reserved
        } catch { Add-ArchiveIssue $state $id $file.Name $_.Exception.Message }
    }
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter 'traffic-*.dump' -File | Sort-Object Name) {
        if (-not (Test-BackupFilename $file.Name) -or $state.Index.ContainsKey($file.Name)) { continue }
        $state.Index[$file.Name] = $null
        try {
            $hash = Read-BackupChecksum "$($file.FullName).sha256" $file.Name
            $at = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::new($file.LastWriteTimeUtc), [TimeZoneInfo]::Local)
            $receipt = New-BackupReceipt $file.Name $hash $at 'filesystem-last-write-estimate'
            $state.Index[$file.Name] = Publish-BackupReceipt $Directory $receipt $file.Name $PgRestoreExecutable $state.Reserved
        } catch { Add-ArchiveIssue $state $file.Name $file.Name $_.Exception.Message }
    }
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter '*.dump' -File) {
        if (-not $state.Reserved.ContainsKey($file.Name) -and -not $state.Index.ContainsKey($file.Name)) {
            Add-ArchiveIssue $state '' $file.Name 'No usable receipt metadata; preserving unrecognized archive.'
        }
    }
    return $state
}
