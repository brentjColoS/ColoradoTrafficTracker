[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'backup-settings.psd1'),
    [string]$SshExecutable = 'ssh.exe',
    [string]$ScpExecutable = 'scp.exe'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-LocalArchive.ps1')
$config = Import-PowerShellDataFile -LiteralPath $ConfigPath
foreach ($name in @('RemoteHost','RemoteUser','SshKeyPath','VisitorRemoteBackupDirectory','VisitorDestinationDirectory','VisitorReceiptCommand')) {
    if ([string]::IsNullOrWhiteSpace([string]$config[$name])) { throw "Visitor backup setting '$name' is required." }
}
if ($config.RemoteHost -notmatch '^[A-Za-z0-9.-]+$' -or $config.RemoteUser -notmatch '^[A-Za-z_][A-Za-z0-9_-]*$') {
    throw 'Invalid visitor backup SSH destination.'
}
foreach ($name in @('VisitorRemoteBackupDirectory','VisitorReceiptCommand')) {
    if ($config[$name] -notmatch '^/[A-Za-z0-9._/-]+$' -or $config[$name] -match '(^|/)\.\.(/|$)') { throw 'Invalid visitor backup remote path.' }
}
$destination = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($config.VisitorDestinationDirectory))
if ($config.DestinationDirectory) {
    $traffic = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($config.DestinationDirectory)).TrimEnd('\','/')
    $visitor=$destination.TrimEnd('\','/')
    $separator=[IO.Path]::DirectorySeparatorChar
    if ($visitor -eq $traffic -or $visitor.StartsWith($traffic+$separator,[StringComparison]::OrdinalIgnoreCase) -or
        $traffic.StartsWith($visitor+$separator,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Visitor backups must use a separate directory from traffic archives.'
    }
}
$identity = [Environment]::ExpandEnvironmentVariables($config.SshKeyPath)
if (-not (Test-Path -LiteralPath $identity -PathType Leaf)) { throw 'Backup SSH key file is missing.' }
$ssh = (Get-Command $SshExecutable -ErrorAction Stop).Source
$scp = (Get-Command $ScpExecutable -ErrorAction Stop).Source
$options = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','IdentitiesOnly=yes','-i',$identity)
$remote = "$($config.RemoteUser)@$($config.RemoteHost)"
function Invoke-VisitorCommand {
    param([string]$Executable,[string[]]$Arguments)
    $errors = [IO.Path]::GetTempFileName()
    try {
        $output = @(& $Executable @Arguments 2> $errors)
        $code = $LASTEXITCODE
        if ($code -ne 0) { throw "Visitor backup command failed (exit $code); no success receipt was sent." }
        return $output
    } finally { Remove-Item -LiteralPath $errors -Force -ErrorAction SilentlyContinue }
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$lock = [IO.File]::Open((Join-Path $destination '.sync.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
    $listed = @(Invoke-VisitorCommand $ssh (@($options) + @($remote,
        "find '$($config.VisitorRemoteBackupDirectory)' -maxdepth 1 -type f -name 'events-*.sha256' -printf '%f\n' | sort")))
    if (-not $listed.Count) { throw 'No completed visitor snapshots are available.' }
    $verified = @(); $problems = @(); $downloaded = 0
    foreach ($line in ($listed | Sort-Object -Unique)) {
        $manifestName = ([string]$line).Trim()
        if ($manifestName -notmatch '^events-[0-9]{8}T[0-9]{12}Z\.sha256$') { throw 'Invalid visitor snapshot name.' }
        $filename = [IO.Path]::ChangeExtension($manifestName,'sqlite')
        $final = Join-Path $destination $filename
        $manifest = Join-Path $destination $manifestName
        $incoming = "$final.partial"
        $manifestIncoming = "$manifest.partial"
        try {
            Invoke-VisitorCommand $scp (@($options) + @("${remote}:$($config.VisitorRemoteBackupDirectory)/$manifestName",$manifestIncoming)) | Out-Null
            $expected = Read-BackupChecksum $manifestIncoming $filename
            if (Test-Path -LiteralPath $final) {
                if ((Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected) {
                    throw 'A completed visitor snapshot is damaged; preserve it for recovery.'
                }
                if ((Test-Path -LiteralPath $manifest) -and (Read-BackupChecksum $manifest $filename) -cne $expected) {
                    throw 'Existing visitor manifest conflicts with the server; preserve it for inspection.'
                }
            } else {
                Invoke-VisitorCommand $scp (@($options) + @("${remote}:$($config.VisitorRemoteBackupDirectory)/$filename",$incoming)) | Out-Null
                if ((Get-FileHash -LiteralPath $incoming -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected) { throw 'Visitor snapshot transfer checksum failed.' }
                Move-Item -LiteralPath $incoming -Destination $final
                $downloaded++
            }
            Write-ArchiveText $manifest "$expected  $filename"
            $verified += [pscustomobject]@{ filename=$filename; sha256=$expected }
        } catch { $problems += "$filename : $($_.Exception.Message)" }
        finally { Remove-Item -LiteralPath $manifestIncoming -Force -ErrorAction SilentlyContinue }
    }
    if ($verified.Count) {
        $newest = $verified[-1]
        Invoke-VisitorCommand $ssh (@($options) + @($remote,"'$($config.VisitorReceiptCommand)' '$($newest.filename)' '$($newest.sha256)'")) | Out-Null
    }
    Write-ArchiveText (Join-Path $destination 'last-run.json') (@{
        completedAt=[DateTimeOffset]::UtcNow.ToString('o'); verifiedCount=$verified.Count
        downloadedCount=$downloaded; errors=$problems; verifiedSnapshots=$verified
    } | ConvertTo-Json -Depth 4)
    if ($problems.Count -or -not $verified.Count) { throw 'Visitor backup needs attention; see its separate last-run.json.' }
    Write-Host "[visitor-backup] Verified $($verified.Count) encrypted snapshots; downloaded $downloaded."
} finally { $lock.Dispose() }
