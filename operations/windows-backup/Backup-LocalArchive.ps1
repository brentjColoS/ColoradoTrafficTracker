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

function New-BackupReceipt {
    param([string]$ServerFilename, [string]$Checksum, [DateTimeOffset]$ReceivedAt,
        [ValidateSet('verified-download', 'filesystem-last-write-estimate')][string]$Source)
    return [pscustomobject][ordered]@{
        schemaVersion = 1
        serverFilename = $ServerFilename
        localFilename = Get-ReceivedBackupName $ServerFilename $ReceivedAt
        sha256 = $Checksum
        receivedAt = $ReceivedAt.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        timeZoneId = [TimeZoneInfo]::Local.Id
        receiptTimeSource = $Source
    }
}

function Read-BackupReceipt {
    param([System.IO.FileInfo]$File)
    $json = Get-Content -LiteralPath $File.FullName -Raw
    # Recent PowerShell versions otherwise coerce ISO strings to DateTime and
    # discard the recorded offset. Windows PowerShell 5.1 already keeps strings.
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) {
        $receipt = $json | ConvertFrom-Json -DateKind String
    } else {
        $receipt = $json | ConvertFrom-Json
    }
    if ($receipt.schemaVersion -ne 1 -or -not (Test-BackupFilename $receipt.serverFilename) -or
        $receipt.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
        $receipt.receiptTimeSource -notin @('verified-download', 'filesystem-last-write-estimate') -or
        [string]::IsNullOrWhiteSpace($receipt.timeZoneId) -or
        $receipt.receivedAt -notmatch '(Z|[+-][0-9]{2}:[0-9]{2})$') {
        throw "Invalid backup receipt: $($File.Name)"
    }
    $receivedAt = [DateTimeOffset]::Parse($receipt.receivedAt, [Globalization.CultureInfo]::InvariantCulture)
    $expectedName = Get-ReceivedBackupName $receipt.serverFilename $receivedAt
    if ($receipt.localFilename -cne $expectedName -or $File.Name -cne "$expectedName.receipt.json") {
        throw "Backup receipt filename conflict: $($File.Name)"
    }
    return $receipt
}

function Complete-BackupPublication {
    param([string]$Directory, $Receipt)
    $final = Join-Path $Directory $Receipt.localFilename
    $legacy = Join-Path $Directory $Receipt.serverFilename
    $source = $legacy
    if ($Receipt.receiptTimeSource -eq 'verified-download') { $source = "$legacy.partial" }
    if (Test-Path -LiteralPath $final -PathType Leaf) {
        if (Test-Path -LiteralPath $legacy -PathType Leaf) {
            throw "Both original and received copies exist for $($Receipt.serverFilename); preserving both."
        }
        $verifyPath = $final
    } else {
        $verifyPath = $source
    }
    if (-not (Test-Path -LiteralPath $verifyPath -PathType Leaf)) {
        throw "Receipt has no recoverable dump for $($Receipt.serverFilename); preserving metadata."
    }
    $actual = (Get-FileHash -LiteralPath $verifyPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Receipt.sha256) { throw "Local checksum mismatch for $($Receipt.serverFilename); preserving the original." }
    $manifest = "$final.sha256"
    if (Test-Path -LiteralPath $manifest) {
        if ((Read-BackupChecksum $manifest $Receipt.localFilename) -ne $Receipt.sha256) {
            throw "Local manifest conflict for $($Receipt.serverFilename)."
        }
    }
    if (Test-Path -LiteralPath "$legacy.sha256") {
        if ((Read-BackupChecksum "$legacy.sha256" $Receipt.serverFilename) -ne $Receipt.sha256) {
            throw "Original manifest conflict for $($Receipt.serverFilename)."
        }
    }
    if ($verifyPath -ne $final) { Move-Item -LiteralPath $source -Destination $final }
    if (-not (Test-Path -LiteralPath $manifest)) {
        Write-ArchiveText $manifest "$($Receipt.sha256)  $($Receipt.localFilename)"
    }
    # A crash after moving the dump is repaired above before removing its old manifest.
    if (Test-Path -LiteralPath "$legacy.sha256") {
        Remove-Item -LiteralPath "$legacy.sha256"
    }
}

function Publish-BackupReceipt {
    param([string]$Directory, $Receipt)
    $receiptPath = Join-Path $Directory "$($Receipt.localFilename).receipt.json"
    if (Test-Path -LiteralPath $receiptPath) { throw "Receipt already exists: $($Receipt.localFilename)" }
    # Durable intent comes first: recovery uses this same timestamp, never a new one.
    Write-ArchiveText $receiptPath ($Receipt | ConvertTo-Json)
    Complete-BackupPublication $Directory $Receipt
}

function Initialize-LocalArchive {
    param([string]$Directory)
    $index = @{}
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter 'traffic-received-*.dump.receipt.json' -File) {
        $receipt = Read-BackupReceipt $file
        if ($index.ContainsKey($receipt.serverFilename)) { throw "Duplicate receipts for $($receipt.serverFilename)." }
        $index[$receipt.serverFilename] = $receipt
    }
    foreach ($receipt in $index.Values) { Complete-BackupPublication $Directory $receipt }
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter 'traffic-received-*.dump' -File) {
        if (-not (Test-Path -LiteralPath "$($file.FullName).receipt.json")) {
            throw "Received backup has no receipt metadata: $($file.Name); preserving it."
        }
    }
    # Includes snapshots already pruned from the server. Their local manifests suffice.
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter 'traffic-*.dump' -File) {
        if (-not (Test-BackupFilename $file.Name)) { continue }
        $checksum = Read-BackupChecksum "$($file.FullName).sha256" $file.Name
        if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum) {
            throw "Local checksum mismatch for $($file.Name); preserving the original."
        }
        $receivedAt = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::new($file.LastWriteTimeUtc), [TimeZoneInfo]::Local)
        $receipt = New-BackupReceipt $file.Name $checksum $receivedAt 'filesystem-last-write-estimate'
        Publish-BackupReceipt $Directory $receipt
        $index[$file.Name] = $receipt
        Write-Host "[traffic-backup] Migrated $($file.Name) to $($receipt.localFilename) (filesystem receipt estimate)."
    }
    return $index
}
