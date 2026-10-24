$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell

function New-TimePostmanShortcut {
  param(
    [string]$Directory,
    [string]$Name,
    [string]$Target,
    [int]$WindowStyle
  )
  $path = Join-Path $Directory "$Name.lnk"
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $Target
  $shortcut.WorkingDirectory = $root
  $shortcut.WindowStyle = $WindowStyle
  $shortcut.Description = "TimePostman 照片/视频日期修正"
  $shortcut.Save()
  Write-Output $path
}

$desktop = [Environment]::GetFolderPath("Desktop")
$startup = [Environment]::GetFolderPath("Startup")
Get-ChildItem $startup -Filter "TimePostman*.lnk" -ErrorAction SilentlyContinue | Remove-Item -Force
New-TimePostmanShortcut -Directory $desktop -Name "TimePostman" -Target (Join-Path $root "start.bat") -WindowStyle 1
New-TimePostmanShortcut -Directory $startup -Name "TimePostman Service" -Target (Join-Path $root "startup.bat") -WindowStyle 7
