# 將 CBDB Atlas 註冊爲 Windows 登錄自啟（後臺最小化啟動服務）

# 用法（PowerShell）：.\scripts\register-autostart.ps1

# 取消自啟：.\scripts\unregister-autostart.ps1



$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$Launcher = Join-Path $Root "啟動CBDB_atlas.bat"

$Startup = [Environment]::GetFolderPath("Startup")

$LinkPath = Join-Path $Startup "CBDB Atlas.lnk"



if (-not (Test-Path $Launcher)) {

    Write-Error "找不到啟動腳本：$Launcher"

}



$Wsh = New-Object -ComObject WScript.Shell

$Shortcut = $Wsh.CreateShortcut($LinkPath)

$Shortcut.TargetPath = $Launcher

$Shortcut.WorkingDirectory = $Root

$Shortcut.WindowStyle = 7   # Minimized

$Shortcut.Description = "CBDB Atlas 本地服務"

$Shortcut.Save()



Write-Host "已註冊開機自啟：$LinkPath"

Write-Host "下次登錄將自動在後臺啟動服務（窗口最小化）。"

Write-Host "取消請運行：scripts\unregister-autostart.ps1"

