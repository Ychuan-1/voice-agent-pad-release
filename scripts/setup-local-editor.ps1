param([ValidateSet('https://huggingface.co', 'https://hf-mirror.com', 'https://modelscope.cn')][string]$ModelBaseUrl = 'https://modelscope.cn')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$modelDir = Join-Path $root 'models\text-editor'
$runtimeDir = Join-Path $root 'runtime\llama-b10816'
New-Item -ItemType Directory -Path $modelDir,$runtimeDir -Force | Out-Null

function Download-Verified($url, $destination, $hash) {
  if ((Test-Path -LiteralPath $destination) -and ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $hash)) { return }
  $partial = "$destination.part"
  & curl.exe -4 --silent --show-error --fail --location --retry 2 --connect-timeout 25 --max-time 1800 --speed-limit 1000 --speed-time 60 --output $partial $url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
  if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $hash) { throw "SHA256 mismatch: $partial" }
  Move-Item -LiteralPath $partial -Destination $destination -Force
}

$zip = Join-Path $runtimeDir 'runtime.zip'
Download-Verified 'https://github.com/ggml-org/llama.cpp/releases/download/b10816/llama-b10816-bin-win-cpu-x64.zip' $zip 'b25d1044a9d6061129ce6f3439697b04996c63b9bdccf025a24a10d6d4954766'
Expand-Archive -LiteralPath $zip -DestinationPath $runtimeDir -Force
$modelUrl = if ($ModelBaseUrl -eq 'https://modelscope.cn') { 'https://modelscope.cn/models/Qwen/Qwen3-1.7B-GGUF/resolve/master/Qwen3-1.7B-Q8_0.gguf' } else { "$ModelBaseUrl/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf" }
Download-Verified $modelUrl (Join-Path $modelDir 'Qwen3-1.7B-Q8_0.gguf') '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a'
Write-Output 'Local editor runtime and model verified.'
