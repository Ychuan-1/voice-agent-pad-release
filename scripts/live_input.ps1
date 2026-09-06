$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'live_input.cs') -ReferencedAssemblies 'System.Core','System.Windows.Forms','UIAutomationClient','UIAutomationTypes','WindowsBase'
  [VoicePadLiveInput]::Start()
  [Console]::WriteLine('{"event":"ready"}')
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
      $request = $line | ConvertFrom-Json
      switch ($request.op) {
        'arm' { $result = [VoicePadLiveInput]::Arm([long]$request.hwnd, [int]$request.hotkey, [int]$request.excludedProcess, [bool]$request.compatible) }
        'append' {
          if ([string]$request.text -match '[\x00-\x1f\x7f]' -or ([string]$request.text).Length -gt 128) { throw 'Invalid append data' }
          $result = [VoicePadLiveInput]::Append([string]$request.text)
        }
        'end' { [VoicePadLiveInput]::End(); $result = @{ ok = $true } }
        default { throw 'Unsupported operation' }
      }
      [Console]::WriteLine((@{ id = $request.id; result = $result } | ConvertTo-Json -Compress -Depth 4))
    } catch {
      [VoicePadLiveInput]::End()
      [Console]::WriteLine((@{ id = $request.id; error = $_.Exception.Message } | ConvertTo-Json -Compress))
    }
  }
} catch {
  [Console]::WriteLine((@{ event = 'error'; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  exit 1
} finally { if ('VoicePadLiveInput' -as [type]) { [VoicePadLiveInput]::End() } }
