[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "ctt-windows-backup-$([Guid]::NewGuid().ToString('N'))"
$remoteRoot = Join-Path $testRoot 'remote'
$destination = Join-Path $testRoot 'destination'
$fakeSsh = Join-Path $testRoot 'fake-ssh.ps1'
$fakeScp = Join-Path $testRoot 'fake-scp.ps1'
$identity = Join-Path $testRoot 'identity'
$config = Join-Path $testRoot 'backup-settings.psd1'
$receiptLog = Join-Path $testRoot 'receipt.log'
$syncScript = Join-Path $PSScriptRoot 'Sync-ColoradoTrafficBackup.ps1'

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

    & $syncScript -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp

    foreach ($filename in $filenames) {
        Assert-Test (Test-Path -LiteralPath (Join-Path $destination $filename) -PathType Leaf) "Did not download $filename."
        Assert-Test (Test-Path -LiteralPath (Join-Path $destination "$filename.sha256") -PathType Leaf) "Did not retain the manifest for $filename."
    }

    $status = Get-Content -LiteralPath (Join-Path $destination 'last-success.json') -Raw | ConvertFrom-Json
    Assert-Test ($status.newestVerifiedBackup -eq $filenames[-1]) 'The status did not identify the newest verified backup.'
    Assert-Test ($status.verifiedCount -eq 2) 'The status did not count every verified backup.'
    Assert-Test ($status.downloadedCount -eq 2) 'The first run did not count both downloads.'
    Assert-Test ((Get-Content -LiteralPath $receiptLog -Raw) -match [regex]::Escape($filenames[-1])) 'The receipt did not identify the newest backup.'

    $olderLocal = Join-Path $destination 'traffic-20260104T033000Z.dump'
    Set-Content -LiteralPath $olderLocal -Value 'older retained backup' -NoNewline
    Set-Content -LiteralPath "$olderLocal.sha256" -Value 'retained local manifest'
    $stalePartial = Join-Path $destination "$($filenames[0]).partial"
    Set-Content -LiteralPath $stalePartial -Value 'stale partial'

    & $syncScript -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp

    $status = Get-Content -LiteralPath (Join-Path $destination 'last-success.json') -Raw | ConvertFrom-Json
    Assert-Test ($status.verifiedCount -eq 2) 'The second run did not verify both existing backups.'
    Assert-Test ($status.downloadedCount -eq 0) 'The second run downloaded an existing verified backup.'
    Assert-Test (Test-Path -LiteralPath $olderLocal -PathType Leaf) 'The sync deleted a completed Windows backup.'
    Assert-Test (-not (Test-Path -LiteralPath $stalePartial)) 'The sync left a stale partial transfer file.'

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
        Assert-Test (($offlineOutput -join "`n") -match 'retry after the next logon') 'The offline result did not explain when it will retry.'
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

    Set-Content -LiteralPath (Join-Path $destination $filenames[0]) -Value 'corrupted local copy' -NoNewline
    $corruptionRejected = $false
    try {
        & $syncScript -ConfigPath $config -SshExecutable $fakeSsh -ScpExecutable $fakeScp
    }
    catch {
        $corruptionRejected = $_.Exception.Message -match 'does not match the server manifest'
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

    $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    if ($resolvedTestRoot.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTestRoot) -like 'ctt-windows-backup-*') {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
