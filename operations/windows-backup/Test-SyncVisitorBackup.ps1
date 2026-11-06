$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('visitor backup test ' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
function Assert-Visitor($Condition,$Message) { if (-not $Condition) { throw $Message } }
try {
    $server = Join-Path $root 'server'; $destination = Join-Path $root 'visitors'
    New-Item -ItemType Directory -Path $server | Out-Null
    $env:VISITOR_TEST_SERVER = $server
    $env:VISITOR_TEST_LOG = Join-Path $root 'receipts.txt'
    $env:VISITOR_TEST_TRANSFERS = Join-Path $root 'transfers.txt'
    $ssh = Join-Path $root 'mock ssh.ps1'; $scp = Join-Path $root 'mock scp.ps1'
    Set-Content -LiteralPath $ssh -Value @'
$command = $args[-1]
if ($env:VISITOR_TEST_OFFLINE -eq '1') { $global:LASTEXITCODE=7; return }
if ($command.StartsWith('find ')) { Get-ChildItem -LiteralPath $env:VISITOR_TEST_SERVER -Filter '*.sha256' | ForEach-Object Name }
elseif ($command.StartsWith("'/private/record-visitor' ")) { Add-Content -LiteralPath $env:VISITOR_TEST_LOG -Value $command }
else { throw 'Unexpected remote command' }
$global:LASTEXITCODE=0
'@
    Set-Content -LiteralPath $scp -Value @'
$name = [IO.Path]::GetFileName(($args[-2] -split ':',2)[1])
Copy-Item -LiteralPath (Join-Path $env:VISITOR_TEST_SERVER $name) -Destination $args[-1] -Force
if ($name.EndsWith('.sqlite')) { Add-Content -LiteralPath $env:VISITOR_TEST_TRANSFERS -Value $name }
$global:LASTEXITCODE=0
'@
    $key = Join-Path $root 'synthetic key'; Set-Content -LiteralPath $key -Value 'synthetic-only'
    $config = Join-Path $root 'settings.psd1'
    $values = @{
        RemoteHost='backup.example.test'; RemoteUser='ctt-backup'; SshKeyPath=$key
        DestinationDirectory=(Join-Path $root 'traffic'); VisitorDestinationDirectory=$destination
        VisitorRemoteBackupDirectory='/private/visitors'; VisitorReceiptCommand='/private/record-visitor'
    }
    $lines = @('@{') + @($values.GetEnumerator() | ForEach-Object { "  $($_.Key) = '$(([string]$_.Value).Replace("'","''"))'" }) + @('}')
    Set-Content -LiteralPath $config -Value $lines
    function New-VisitorFixture([string]$Name) {
        $path=Join-Path $server $Name
        Set-Content -LiteralPath $path -Value ('Encrypted fixture ' + $Name)
        $checksum=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -LiteralPath ([IO.Path]::ChangeExtension($path,'sha256')) -Value "$checksum  $Name"
    }
    $first='events-20261101T033000000000Z.sqlite'; $second='events-20261102T033000000000Z.sqlite'
    New-VisitorFixture $first; New-VisitorFixture $second
    $sync=Join-Path $PSScriptRoot 'Sync-VisitorBackup.ps1'
    & $sync -ConfigPath $config -SshExecutable $ssh -ScpExecutable $scp
    $run=Get-Content -LiteralPath (Join-Path $destination 'last-run.json') -Raw | ConvertFrom-Json
    Assert-Visitor ($run.downloadedCount -eq 2 -and $run.verifiedCount -eq 2) 'Initial visitor catch-up failed'
    & $sync -ConfigPath $config -SshExecutable $ssh -ScpExecutable $scp
    $run=Get-Content -LiteralPath (Join-Path $destination 'last-run.json') -Raw | ConvertFrom-Json
    Assert-Visitor ($run.downloadedCount -eq 0 -and $run.verifiedCount -eq 2) 'Repeated sync downloaded duplicate snapshots'
    Assert-Visitor (@(Get-Content -LiteralPath $env:VISITOR_TEST_TRANSFERS).Count -eq 2) 'Unexpected duplicate byte transfer'
    $damaged=Join-Path $destination $first; Set-Content -LiteralPath $damaged -Value 'Preserve damaged test bytes'
    $third='events-20261103T033000000000Z.sqlite'; New-VisitorFixture $third
    $failed=$false
    try { & $sync -ConfigPath $config -SshExecutable $ssh -ScpExecutable $scp } catch { $failed=$true }
    Assert-Visitor $failed 'Corruption must fail the task'
    Assert-Visitor ((Get-Content -LiteralPath $damaged -Raw).Trim() -eq 'Preserve damaged test bytes') 'Damaged completed snapshot was overwritten'
    Assert-Visitor (Test-Path -LiteralPath (Join-Path $destination $third)) 'Corruption prevented unrelated catch-up'
    $run=Get-Content -LiteralPath (Join-Path $destination 'last-run.json') -Raw | ConvertFrom-Json
    Assert-Visitor ($run.errors.Count -eq 1 -and $run.downloadedCount -eq 1) 'Partial failure status is wrong'
    $receipts=@(Get-Content -LiteralPath $env:VISITOR_TEST_LOG)
    Assert-Visitor ($receipts[-1].Contains($third)) 'Off-site receipt did not identify the newest verified snapshot'
    $env:VISITOR_TEST_OFFLINE='1';$failed=$false
    try { & $sync -ConfigPath $config -SshExecutable $ssh -ScpExecutable $scp } catch { $failed=$true }
    Assert-Visitor $failed 'Offline attempt must not claim verification'
    Assert-Visitor (@(Get-Content -LiteralPath $env:VISITOR_TEST_LOG).Count -eq $receipts.Count) 'Offline attempt updated the receipt'
    $failed=$false
    try {
        & (Join-Path $PSScriptRoot 'Install-ColoradoTrafficBackupTask.ps1') -SyncScriptName Sync-VisitorBackup.ps1 -ConfigPath $config
    } catch { $failed=$_.Exception.Message.Contains('separate task name') }
    Assert-Visitor $failed 'Visitor task installation could overwrite the traffic task'
    $values.VisitorDestinationDirectory=Join-Path $values.DestinationDirectory 'nested visitors'
    $lines = @('@{') + @($values.GetEnumerator() | ForEach-Object { "  $($_.Key) = '$(([string]$_.Value).Replace("'","''"))'" }) + @('}')
    Set-Content -LiteralPath $config -Value $lines
    $failed=$false
    try { & $sync -ConfigPath $config -SshExecutable $ssh -ScpExecutable $scp } catch { $failed=$_.Exception.Message.Contains('separate directory') }
    Assert-Visitor $failed 'Visitor and traffic archive directory boundaries were not enforced'
    Write-Host '[visitor-backup-test] Initial/repeat catch-up, corruption isolation, receipt and offline checks passed.'
} catch {
    Write-Host $_.ScriptStackTrace
    throw
} finally {
    Remove-Item Env:VISITOR_TEST_SERVER,Env:VISITOR_TEST_LOG,Env:VISITOR_TEST_TRANSFERS,Env:VISITOR_TEST_OFFLINE -ErrorAction SilentlyContinue
    try { Remove-Item -LiteralPath $root -Recurse -Force } catch { Write-Warning 'Disposable fixture cleanup failed inside the test runtime.' }
}
