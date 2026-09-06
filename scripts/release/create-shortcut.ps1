$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root 'VoiceAgentPad.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Keep the complete extracted folder together.' }
$desktop = [Environment]::GetFolderPath('Desktop')
$destination = Join-Path $desktop 'Voice Agent Pad.lnk'
if (Test-Path -LiteralPath $destination) { throw 'Shortcut already exists. Remove it manually if you intend to replace it.' }
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($destination)
$link.TargetPath = $exe
$link.WorkingDirectory = $root
$link.IconLocation = "$exe,0"
$link.Description = 'Voice Agent Pad - local voice input'
$link.Save()
Write-Host 'Desktop shortcut created.'
