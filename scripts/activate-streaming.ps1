$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$modelRoot = Join-Path $projectRoot 'models\paraformer-streaming-zh-en'
foreach ($modelFile in @('encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt')) {
  if (-not (Test-Path -LiteralPath (Join-Path $modelRoot $modelFile))) {
    throw "Local streaming model missing: $modelFile"
  }
}
$settingsPath = Join-Path $env:APPDATA 'voice-agent-pad\settings.json'
$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$backup = "$settingsPath.before-streaming-$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
Copy-Item -LiteralPath $settingsPath -Destination $backup
$settings | Add-Member -NotePropertyName provider -NotePropertyValue 'local' -Force
$settings | Add-Member -NotePropertyName localEngine -NotePropertyValue 'paraformer' -Force
$settings | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $settingsPath -Encoding utf8NoBOM
Write-Output 'Activated local Paraformer streaming. Other settings preserved.'
Write-Output "Settings backup: $backup"
