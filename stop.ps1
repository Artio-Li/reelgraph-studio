# 停止 ReelGraph Studio 全部服务
Get-NetTCPConnection -LocalPort 8787,18610,5173 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
    if ($p) {
      Write-Host "停止 $($p.ProcessName) (PID $_)" -ForegroundColor Yellow
      Stop-Process -Id $_ -Force
    }
  }
# 顺带清掉上游拉起的 Chrome 调试实例
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match '19210|muse2api' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "已停止。" -ForegroundColor Green
