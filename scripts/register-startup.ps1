param([string]$TaskName = 'Local Digital Signage')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe).Source
$action = New-ScheduledTaskAction -Execute $nodePath -Argument '--env-file-if-exists=.env dist/server.js' -WorkingDirectory $projectPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Local LAN signage server at user sign-in' | Out-Null
Write-Host "Registered $TaskName. Runs at sign-in, not before sign-in. Remove with Unregister-ScheduledTask."
