# 把扩展目录打包成 zip，供平台下载
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'extension'
$outDir = Join-Path $root 'server\public'
$out = Join-Path $outDir 'reelgraph-studio-extension.zip'

if (-not (Test-Path $src)) { Write-Host "扩展目录不存在: $src" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (Test-Path $out) { Remove-Item $out -Force }

Compress-Archive -Path (Join-Path $src '*') -DestinationPath $out -CompressionLevel Optimal
$size = [Math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host "已打包: $out  ($size KB)" -ForegroundColor Green
