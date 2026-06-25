# 取消 CBDB Atlas 開機自啟

$Startup = [Environment]::GetFolderPath("Startup")
$LinkPath = Join-Path $Startup "CBDB Atlas.lnk"

if (Test-Path $LinkPath) {
    Remove-Item $LinkPath -Force
    Write-Host "已移除開機自啟：$LinkPath"
} else {
    Write-Host "未找到自啟快捷方式。"
}
