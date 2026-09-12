[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'backup-settings.psd1'),
    [string]$TaskName = 'Colorado Traffic Tracker Backup',
    [TimeSpan]$LogonDelay = (New-TimeSpan -Minutes 5)
)

$ErrorActionPreference = 'Stop'

$syncScript = Join-Path $PSScriptRoot 'Sync-ColoradoTrafficBackup.ps1'
if (-not (Test-Path -LiteralPath $syncScript -PathType Leaf)) {
    throw "Backup sync script was not found: $syncScript"
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Backup settings were not found: $ConfigPath"
}
if ($LogonDelay -lt [TimeSpan]::Zero) {
    throw 'LogonDelay cannot be negative.'
}

$arguments = "-NoProfile -ExecutionPolicy RemoteSigned -File `"$syncScript`" -ConfigPath `"$ConfigPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$logonTrigger.Delay = [Xml.XmlConvert]::ToString($LogonDelay)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $logonTrigger `
    -Settings $settings `
    -Description 'Pull and verify every missing Colorado Traffic Tracker database backup after this user logs on.' `
    -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName'."
