[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'backup-settings.psd1'),
    [string]$TaskName = 'Colorado Traffic Tracker Backup'
)

$ErrorActionPreference = 'Stop'

$syncScript = Join-Path $PSScriptRoot 'Sync-ColoradoTrafficBackup.ps1'
if (-not (Test-Path -LiteralPath $syncScript -PathType Leaf)) {
    throw "Backup sync script was not found: $syncScript"
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Backup settings were not found: $ConfigPath"
}

$arguments = "-NoProfile -ExecutionPolicy RemoteSigned -File `"$syncScript`" -ConfigPath `"$ConfigPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$repeatTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(5) `
    -RepetitionInterval (New-TimeSpan -Hours 6) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger @($logonTrigger, $repeatTrigger) `
    -Settings $settings `
    -Description 'Pull and verify the newest Colorado Traffic Tracker database backup when this computer is online.' `
    -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName'."
