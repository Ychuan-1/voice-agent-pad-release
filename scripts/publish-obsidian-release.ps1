$ErrorActionPreference = 'Stop'
$stage = 'D:\GPT 工作区\obsidian_updates\2026-09-05-voice-product-release'
$vault = [IO.Path]::GetFullPath('D:\Obsidian\CodexVault')
$expected = @{
  '04_项目\Voice Agent Pad - 语音输入Agent助手.md' = '1F6E1F1D6C751FA758114BE5A6DA7F23D453C5CA34AC6A695819002B4100066F'
  '09_人工智能学习\07_人工智能语音与音频\人工智能语音与音频入口.md' = 'BA89CF52AD1790AC116A0A591C996A5F487F910B7145A61D515FA98E51E4DFF6'
}
$plan = @(Get-ChildItem -LiteralPath $stage -Recurse -File -Filter '*.md' | ForEach-Object {
  $relative = $_.FullName.Substring($stage.Length + 1)
  $target = [IO.Path]::GetFullPath((Join-Path $vault $relative))
  if (!$target.StartsWith($vault + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Target escaped vault' }
  if (Test-Path -LiteralPath $target) {
    if (!$expected.ContainsKey($relative) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $expected[$relative]) { throw "Existing note changed; inspect before publishing: $relative" }
  }
  [PSCustomObject]@{Source=$_.FullName;Target=$target;Relative=$relative}
})
$backup = Join-Path $vault ('.codex-backups\voice-product-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
foreach ($item in $plan) {
  if (Test-Path -LiteralPath $item.Target) {
    $old = Join-Path $backup $item.Relative
    New-Item -ItemType Directory -Path (Split-Path $old -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $item.Target -Destination $old
  }
  New-Item -ItemType Directory -Path (Split-Path $item.Target -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $item.Source -Destination $item.Target -Force
  if ((Get-FileHash -LiteralPath $item.Source).Hash -ne (Get-FileHash -LiteralPath $item.Target).Hash) { throw "Copy check failed: $($item.Relative)" }
  Write-Output $item.Relative
}
Write-Output "Published $($plan.Count) notes; backup: $backup"
