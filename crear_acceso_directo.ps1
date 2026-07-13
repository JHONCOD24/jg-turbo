# Crea un acceso directo en el escritorio para JG Turbo.
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath = Join-Path $projectRoot "iniciar_server.bat"
$iconPath = Join-Path $projectRoot "jg-turbo.ico"
if (-not (Test-Path $iconPath)) {
    $iconPath = Join-Path $projectRoot "logo.ico"
}
$cmdPath = Join-Path $env:WINDIR "System32\cmd.exe"

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "JG Turbo.lnk"

Get-ChildItem $desktop -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -like "*JG Turbo*"
} | Remove-Item -Force -ErrorAction SilentlyContinue

$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $cmdPath
$shortcut.Arguments = "/c `"$batPath`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "Inicia JG Turbo - Speech to Text en localhost"
$shortcut.WindowStyle = 1
$shortcut.Save()

if (-not (Test-Path -LiteralPath $shortcutPath)) {
    throw "No se pudo crear el acceso directo."
}

$lnk = $ws.CreateShortcut($shortcutPath)
if (-not $lnk.TargetPath) {
    throw "El acceso directo se creó, pero no quedó con destino válido."
}
if ($lnk.TargetPath -notmatch 'cmd\.exe$') {
    throw "El acceso directo se creó, pero el destino esperado era cmd.exe."
}
if ($lnk.Arguments -notmatch 'iniciar_server\.bat') {
    throw "El acceso directo se creó, pero no apunta al script de arranque."
}

Write-Host "Acceso directo listo: $shortcutPath"
Write-Host "Destino: $($lnk.TargetPath) $($lnk.Arguments)"
