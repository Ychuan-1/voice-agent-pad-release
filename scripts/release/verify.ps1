$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$failed = @()
foreach ($entry in $manifest.files) {
  $file = [IO.Path]::GetFullPath((Join-Path $root $entry.path))
  if (!$file.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest path' }
  if (!(Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { $failed += $entry.path }
}
if ($failed.Count) { $failed | ForEach-Object { Write-Host "FAILED: $_" }; exit 1 }
Write-Host "PASS: $($manifest.files.Count) files match the release manifest."
Write-Host 'This checks file integrity, not publisher identity or malware safety.'
