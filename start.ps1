# ReelGraph Studio 一键启动
# 用法：
#   .\start.ps1          启动上游 + 平台（生产模式，需先有 web\dist）
#   .\start.ps1 -Build   先构建前端再启动
#   .\start.ps1 -Dev     额外启动前端 dev server (vite, 5173)
param(
  [switch]$Dev,
  [switch]$Build
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$upstream = Join-Path $root 'upstream\muse2api'
$server = Join-Path $root 'server'
$web = Join-Path $root 'web'

function Test-Port($port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  return [bool]$c
}

function Wait-Http($url, $seconds = 40) {
  for ($i = 0; $i -lt $seconds; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
    } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}

# 用 WMI 创建**完全脱离**当前进程树的后台进程：
# 关终端、父进程结束都不影响服务，且不闪黑窗。
function Start-Detached($exe, $argLine, $workDir, $logFile) {
  $cmd = "$env:ComSpec /c cd /d `"$workDir`" && `"$exe`" $argLine >> `"$logFile`" 2>&1"
  $startup = ([wmiclass]'Win32_ProcessStartup').CreateInstance()
  $startup.ShowWindow = 0            # 注意：不要设 CreateFlags，WMI 会拒绝并返回 21
  $res = ([wmiclass]'Win32_Process').Create($cmd, $workDir, $startup)
  return $res.ReturnValue -eq 0
}

Write-Host ""
Write-Host "=== ReelGraph Studio 启动 ===" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. Python 环境 ----------
$pyExe = Join-Path $upstream '.venv\Scripts\python.exe'
if (-not (Test-Path $pyExe)) {
  Write-Host "[1/4] 创建 Python 虚拟环境并安装依赖…" -ForegroundColor Yellow
  $py = "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe"
  if (-not (Test-Path $py)) { $py = 'python' }
  & $py -m venv (Join-Path $upstream '.venv')
  & $pyExe -m pip install -q -r (Join-Path $upstream 'requirements.txt')
} else {
  Write-Host "[1/4] Python 环境就绪" -ForegroundColor DarkGray
}

# ---------- 2. 后端依赖 ----------
if (-not (Test-Path (Join-Path $server 'node_modules'))) {
  Write-Host "[2/4] 安装后端依赖…" -ForegroundColor Yellow
  Push-Location $server; npm install --no-fund --no-audit; Pop-Location
} else {
  Write-Host "[2/4] 后端依赖就绪" -ForegroundColor DarkGray
}
if (-not (Test-Path (Join-Path $server '.env'))) {
  Copy-Item (Join-Path $server '.env.example') (Join-Path $server '.env')
  Write-Host "  已从 .env.example 生成 .env，建议改掉 ADMIN_PASSWORD / JWT_SECRET" -ForegroundColor Yellow
}

# ---------- 3. 前端产物 ----------
if ($Build -or -not (Test-Path (Join-Path $web 'dist\index.html'))) {
  if (-not (Test-Path (Join-Path $web 'node_modules'))) {
    Write-Host "[3/4] 安装前端依赖…" -ForegroundColor Yellow
    Push-Location $web; npm install --no-fund --no-audit; Pop-Location
  }
  Write-Host "[3/4] 构建前端…" -ForegroundColor Yellow
  Push-Location $web; npm run build; Pop-Location
} else {
  Write-Host "[3/4] 前端产物已存在（加 -Build 可重新构建）" -ForegroundColor DarkGray
}

# ---------- 4. 上游 muse2api ----------
if (Test-Port 18610) {
  Write-Host "[4/4] 上游 muse2api 已在运行 (18610)" -ForegroundColor DarkGray
} else {
  Write-Host "[4/4] 启动上游 muse2api (18610)…" -ForegroundColor Yellow
  $ok = Start-Detached $pyExe "-m uvicorn app:app --host 127.0.0.1 --port 18610" $upstream (Join-Path $upstream 'server.log')
  if ($ok -and (Wait-Http 'http://127.0.0.1:18610/healthz' 45)) {
    Write-Host "  上游就绪" -ForegroundColor Green
  } else {
    Write-Host "  上游启动失败，看 upstream\muse2api\server.log" -ForegroundColor Red
  }
}

# ---------- 5. 平台后端 ----------
if (Test-Port 8787) {
  Write-Host "平台后端已在运行 (8787)" -ForegroundColor DarkGray
} else {
  Write-Host "启动平台后端 (8787)…" -ForegroundColor Yellow
  $nodeExe = (Get-Command node).Source
  $ok = Start-Detached $nodeExe "src/index.js" $server (Join-Path $server 'server.log')
  if ($ok -and (Wait-Http 'http://127.0.0.1:8787/api/health' 30)) {
    Write-Host "  平台就绪" -ForegroundColor Green
  } else {
    Write-Host "  平台启动失败，看 server\server.log" -ForegroundColor Red
  }
}

# ---------- 6. 前端 dev ----------
if ($Dev) {
  if (Test-Port 5173) {
    Write-Host "前端 dev 已在运行 (5173)" -ForegroundColor DarkGray
  } else {
    Write-Host "启动前端 dev server (5173)…" -ForegroundColor Yellow
    $npmCmd = (Get-Command npm).Source
    Start-Detached $env:ComSpec "/c `"$npmCmd`" run dev" $web (Join-Path $web 'dev.log')
    Start-Sleep -Seconds 3
  }
}

# 扩展包（一键绑定用；缺了就补一份）
$zip = Join-Path $server 'public\reelgraph-studio-extension.zip'
if (-not (Test-Path $zip)) {
  $extSrc = Join-Path $root 'extension'
  if (Test-Path $extSrc) {
    New-Item -ItemType Directory -Force -Path (Join-Path $server 'public') | Out-Null
    Compress-Archive -Path (Join-Path $extSrc '*') -DestinationPath $zip -CompressionLevel Optimal
    Write-Host "已打包浏览器扩展 → server\public\reelgraph-studio-extension.zip" -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host "---------------------------------------------" -ForegroundColor Cyan
Write-Host " 平台入口   http://127.0.0.1:8787" -ForegroundColor White
if ($Dev) { Write-Host " 前端调试   http://127.0.0.1:5173" -ForegroundColor White }
Write-Host " 上游引擎   http://127.0.0.1:18610/admin" -ForegroundColor DarkGray
Write-Host " 默认管理员 admin@reelgraph.local（密码见 server\.env）" -ForegroundColor DarkGray
Write-Host " 停止服务   .\stop.ps1" -ForegroundColor DarkGray
Write-Host "---------------------------------------------" -ForegroundColor Cyan
Write-Host ""
