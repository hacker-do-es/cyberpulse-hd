<#
CyberPulse inventory agent for Windows.

Reports what this computer runs (Windows build, installed programs) to
CyberPulse once a day, so vulnerabilities are checked against the versions
really installed. Read-only: it changes nothing on the computer except its own
config, scheduled task and this script.

  # As Administrator:
  .\cyberpulse-agent.ps1 -Install -Url https://cyberpulse.example -Token cpi_... [-Type workstation|laptop|server]
  .\cyberpulse-agent.ps1 -Print       # show the report that would be sent, send nothing
  .\cyberpulse-agent.ps1 -Run         # send now (the scheduled task does this daily)
  .\cyberpulse-agent.ps1 -Uninstall

Needs: Windows PowerShell 5.1 or PowerShell 7. Outbound HTTPS to the CyberPulse URL only.
#>
[CmdletBinding(DefaultParameterSetName = 'Help')]
param(
  [Parameter(ParameterSetName = 'Install')][switch]$Install,
  [Parameter(ParameterSetName = 'Install', Mandatory = $true)][string]$Url,
  [Parameter(ParameterSetName = 'Install', Mandatory = $true)][string]$Token,
  [Parameter(ParameterSetName = 'Install')][ValidateSet('workstation', 'laptop', 'server')][string]$Type,
  [Parameter(ParameterSetName = 'Run')][switch]$Run,
  [Parameter(ParameterSetName = 'Print')][switch]$Print,
  [Parameter(ParameterSetName = 'Uninstall')][switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$AgentVersion = '1.0.1'
$InstallDir = Join-Path $env:ProgramFiles 'CyberPulse'
$DataDir = Join-Path $env:ProgramData 'CyberPulse'
$ConfFile = Join-Path $DataDir 'agent.json'
$TaskName = 'CyberPulse inventory agent'

function ConvertTo-Field {
  param([object]$Value)
  if ($null -eq $Value) { return '' }
  return (([string]$Value) -replace "[`t`r`n]", ' ').Trim()
}

function Line {
  param([object[]]$Fields)
  $clean = foreach ($f in $Fields) { ConvertTo-Field $f }
  return ($clean -join "`t")
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Report([string]$type) {
  $out = New-Object System.Collections.Generic.List[string]
  $out.Add((Line @('agent', $AgentVersion)))
  $out.Add((Line @('host', $env:COMPUTERNAME)))
  try { $out.Add((Line @('fqdn', [System.Net.Dns]::GetHostEntry('').HostName))) } catch { }

  # Only a hash of the machine GUID leaves the computer.
  $guid = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes("cyberpulse:$guid")) | ForEach-Object { $_.ToString('x2') }) -join ''
  $out.Add((Line @('machine', $hash)))

  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  if (-not $type) {
    if ($os.ProductType -ne 1) { $type = 'server' }
    else {
      $chassis = @((Get-CimInstance Win32_SystemEnclosure).ChassisTypes)
      $type = if ($chassis | Where-Object { $_ -in 8, 9, 10, 14, 31, 32 }) { 'laptop' } else { 'workstation' }
    }
  }
  $out.Add((Line @('type', $type)))

  # Microsoft states affected ranges as full builds: 10.0.<build>.<UBR>.
  $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  $build = "10.0.$($cv.CurrentBuild).$($cv.UBR)"
  $out.Add((Line @('winos', $os.Caption, $build)))
  $out.Add((Line @('vendor', $cs.Manufacturer)))
  $out.Add((Line @('model', $cs.Model)))

  try {
    Get-NetIPAddress -ErrorAction Stop |
      Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.|::1$|fe80:)' } |
      Select-Object -First 16 |
      ForEach-Object { $out.Add((Line @('ip', $_.IPAddress))) }
  } catch { }

  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $seen = @{}
  foreach ($k in $keys) {
    Get-ItemProperty $k -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -and -not $_.ParentKeyName } |
      ForEach-Object {
        $id = "$($_.DisplayName)|$($_.DisplayVersion)"
        if (-not $seen.ContainsKey($id)) {
          $seen[$id] = $true
          $out.Add((Line @('app', $_.DisplayName, $_.DisplayVersion, $_.Publisher)))
        }
      }
  }
  return ($out -join "`n") + "`n"
}

function Send-Report {
  if (-not (Test-Path $ConfFile)) { throw "Not installed: $ConfFile missing (run -Install first)" }
  $conf = Get-Content $ConfFile -Raw | ConvertFrom-Json
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $body = [Text.Encoding]::UTF8.GetBytes((Get-Report $conf.type))
  $uri = ($conf.url.TrimEnd('/')) + '/api/inventory/report'
  $attempt = 0
  while ($true) {
    try {
      $r = Invoke-RestMethod -Method Post -Uri $uri -Body $body -ContentType 'text/plain; charset=utf-8' `
        -Headers @{ Authorization = "Bearer $($conf.token)" } -TimeoutSec 120 -UseBasicParsing
      Write-Output ("CyberPulse: asset '{0}', {1} technologies" -f $r.asset, $r.technologies)
      return
    } catch {
      $attempt++
      if ($attempt -ge 3) { throw }
      Start-Sleep -Seconds 30
    }
  }
}

function Install-Agent {
  if (-not (Test-Admin)) { throw 'Run PowerShell as Administrator to install.' }
  if ($Url -notmatch '^https://') { throw '-Url must be the https:// address of CyberPulse' }
  if ($Token -notmatch '^cpi_[A-Za-z0-9_-]{40,60}$') { throw '-Token must be an inventory token (cpi_...)' }

  New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir | Out-Null
  $script = Join-Path $InstallDir 'cyberpulse-agent.ps1'
  Copy-Item -Path $PSCommandPath -Destination $script -Force

  # The config holds the token: SYSTEM and Administrators only, set BEFORE
  # the file is written. Well-known SIDs, not names: group names are
  # localised ("Administradores", "Administrateurs"...).
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $who = New-Object System.Security.Principal.SecurityIdentifier($sid)
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($who, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  Set-Acl -Path $DataDir -AclObject $acl
  @{ url = $Url.TrimEnd('/'); token = $Token; type = $Type } | ConvertTo-Json | Set-Content -Path $ConfFile -Encoding UTF8

  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`" -Run"
  $start = (Get-Date).Date.AddHours(9).AddMinutes((Get-Random -Minimum 0 -Maximum 120))
  $trigger = New-ScheduledTaskTrigger -Daily -At $start
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
  $system = (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')).Translate([System.Security.Principal.NTAccount]).Value
  $principal = New-ScheduledTaskPrincipal -UserId $system -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Output "Installed: scheduled task '$TaskName' (daily). Sending the first report..."
  Send-Report
}

function Uninstall-Agent {
  if (-not (Test-Admin)) { throw 'Run PowerShell as Administrator to uninstall.' }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $DataDir, $InstallDir
  Write-Output 'CyberPulse agent removed. The asset stays in CyberPulse until you delete it there.'
}

switch ($PSCmdlet.ParameterSetName) {
  'Install' { Install-Agent }
  'Run' { Send-Report }
  'Print' { Get-Report $null }
  'Uninstall' { Uninstall-Agent }
  default { Get-Help $PSCommandPath; exit 1 }
}
