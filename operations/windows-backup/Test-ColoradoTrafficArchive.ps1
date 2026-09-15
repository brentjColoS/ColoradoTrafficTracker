[CmdletBinding()]
param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-LocalArchive.ps1')
if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Join-Path $PSScriptRoot 'backup-settings.psd1' }
$settings = Import-PowerShellDataFile -LiteralPath $ConfigPath
$directory = [Environment]::ExpandEnvironmentVariables($settings.DestinationDirectory)
$lock = [IO.File]::Open((Join-Path $directory '.sync.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
    $state = [pscustomobject]@{ Errors = [Collections.Generic.List[object]]::new() }
    $verified = [Collections.Generic.List[string]]::new()
    $seen = @{}
    foreach ($file in Get-ChildItem -LiteralPath $directory -Filter '*.dump.receipt.json' -File) {
        $receipt = $null
        try {
            $receipt = Read-BackupReceipt $file
            $seen[$receipt.localFilename] = $true
            if ($receipt.schemaVersion -eq 2 -and $receipt.publicationPending) { throw 'Incomplete publication; run sync recovery first.' }
            Test-LocalReceipt $directory $receipt -Hash
            $verified.Add($receipt.serverFilename)
        } catch {
            $id = ''
            $problemFile = $file.Name
            if ($receipt) { $id = $receipt.serverFilename; $problemFile = $receipt.localFilename }
            Add-ArchiveIssue $state $id $problemFile $_.Exception.Message
        }
    }
    foreach ($file in Get-ChildItem -LiteralPath $directory -Filter '*.dump' -File) {
        if (-not $seen.ContainsKey($file.Name)) { Add-ArchiveIssue $state '' $file.Name 'No usable receipt metadata; archive was not verified.' }
    }
    Write-ArchiveText (Join-Path $directory 'integrity-report.json') (@{
        checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
        verifiedCount = $verified.Count
        verifiedSnapshots = @($verified.ToArray())
        errors = @($state.Errors.ToArray())
    } | ConvertTo-Json -Depth 5)
    Write-Host "[archive-audit] Verified $($verified.Count); issues $($state.Errors.Count)."
    if ($state.Errors.Count -gt 0) { throw 'Integrity audit found problems; see integrity-report.json. No files were repaired or removed.' }
} finally { $lock.Dispose() }
