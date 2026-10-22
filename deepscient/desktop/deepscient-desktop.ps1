# DeepScient 桌面入口
#
# 用官方 DeepSeek Harness 桌面壳（Electron）承载 DeepScient：
#   - 数据根固定为 <DSH_HOME>（默认 ~/.deepscient），与 Web 形态共用同一批课题
#   - 桌面壳固定使用 profile desktop（DSH_PROFILE 默认值）
#   - userData 独立到 <DSH_HOME>\desktop-userdata，避免和日常 DeepSeek Harness 抢单实例锁
#
# 只读约束：不修改安装目录、不写 ~/.dsh。
param(
  [string]$DshHome = '',
  [string]$Executable = '',
  [switch]$NoAssemble,
  [switch]$WebFallback,
  [switch]$CreateShortcuts
)

$ErrorActionPreference = 'Stop'

if (-not $DshHome) {
  $DshHome = if ($env:DEEPSCIENT_HOME) { $env:DEEPSCIENT_HOME } else { Join-Path $env:USERPROFILE '.deepscient' }
}
$DshHome = [System.IO.Path]::GetFullPath($DshHome)

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$logsDir = Join-Path $DshHome 'logs'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $logsDir ("desktop-$stamp.log")
$errPath = Join-Path $logsDir ("desktop-$stamp.err.log")
$shellOutPath = Join-Path $logsDir ("desktop-$stamp.shell.log")

function Write-Log([string]$Message) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message)
  Write-Host $line
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Test-PortFree([int]$Port) {
  $listener = $null
  try {
    $listener = New-Object System.Net.Sockets.TcpListener -ArgumentList @([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) { $listener.Stop() }
  }
}

function Get-FreePort {
  foreach ($candidate in 3081..3099) {
    if (Test-PortFree $candidate) { return $candidate }
  }
  return 0
}

function New-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$WorkDir, [string]$Icon, [string]$Description) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $Target
  if ($Arguments) { $shortcut.Arguments = $Arguments }
  $shortcut.WorkingDirectory = $WorkDir
  if ($Icon) { $shortcut.IconLocation = $Icon }
  $shortcut.Description = $Description
  $shortcut.WindowStyle = 7
  $shortcut.Save()
}

$installedExe = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
$derivedExe = Join-Path $repoRoot 'dist\DeepScient\DeepScient.exe'
$iconPath = Join-Path $PSScriptRoot 'icon.ico'
$desktopDir = [Environment]::GetFolderPath('Desktop')
$thisScript = Join-Path $PSScriptRoot 'deepscient-desktop.ps1'

if ($CreateShortcuts) {
  if (-not (Test-Path -LiteralPath $iconPath)) { $iconPath = $installedExe }
  New-Shortcut -Path (Join-Path $desktopDir 'DeepScient 科研工作台.lnk') `
    -Target "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Arguments ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $thisScript + '"') `
    -WorkDir $repoRoot -Icon $iconPath -Description 'DeepScient 科研工作台（桌面壳）'
  Write-Log "已生成快捷方式：DeepScient 科研工作台"

  if (Test-Path -LiteralPath $derivedExe) {
    New-Shortcut -Path (Join-Path $desktopDir 'DeepScient 科研工作台 - 桌面版.lnk') `
      -Target $derivedExe -Arguments '' -WorkDir (Split-Path -Parent $derivedExe) `
      -Icon $derivedExe -Description 'DeepScient 科研工作台（独立桌面应用）'
    Write-Log "已生成快捷方式：DeepScient 科研工作台 - 桌面版"
  } else {
    Write-Log '未找到 dist\DeepScient\DeepScient.exe，跳过独立桌面版快捷方式（先跑 build-desktop.ps1）'
  }
  exit 0
}

Write-Log 'DeepScient 桌面入口'
Write-Log "DSH_HOME : $DshHome"

$profileManifest = Join-Path $DshHome 'profiles\desktop\package.json'
if (-not $NoAssemble -and -not (Test-Path -LiteralPath $profileManifest)) {
  $assemble = Join-Path $PSScriptRoot 'assemble-profile.ps1'
  if (Test-Path -LiteralPath $assemble) {
    Write-Log 'profile 尚未装配，先运行 assemble-profile.ps1'
    & $assemble -DshHome $DshHome
    if ($LASTEXITCODE -ne 0) { throw "assemble-profile.ps1 失败（exit=$LASTEXITCODE）" }
  }
}

$exe = $Executable
if (-not $exe -and (Test-Path -LiteralPath $derivedExe)) { $exe = $derivedExe }
if (-not $exe -and (Test-Path -LiteralPath $installedExe)) { $exe = $installedExe }
if (-not $exe) { throw "找不到桌面壳：$installedExe（或用 -Executable 指定）" }
if (-not (Test-Path -LiteralPath $exe)) { throw "指定的桌面壳不存在：$exe" }
Write-Log "桌面壳   : $exe"

$userDataDir = Join-Path $DshHome 'desktop-userdata'
New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null

$env:DSH_HOME = $DshHome
$env:DSH_PROFILE = 'desktop'
# 桌面壳转发请求时会用设备 cookie 覆盖 Cookie 头，deepscient_session 到不了后端；
# 这个标记让 host 以「磁盘 token = 本机身份」认账（Web 形态不设，行为不变）。
$env:DEEPSCIENT_DESKTOP = '1'
# 桌面壳默认每 10 分钟检查一次 DeepSeek Harness 更新；DeepScient 不是它的发布通道，拉长到上限。
$env:DSH_DESKTOP_UPDATE_CHECK_INTERVAL_MS = '2147483647'
$env:DSH_DESKTOP_DIAGNOSTIC_FILE = Join-Path $logsDir ("desktop-diagnostic-$stamp.log")

$arguments = '--user-data-dir="' + $userDataDir + '"'

$processName = Split-Path -Leaf $exe
$existing = @(Get-CimInstance Win32_Process -Filter ("Name = '" + $processName + "'") -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine.Contains($userDataDir)
})
if ($existing.Count -gt 0) {
  Write-Log ("已有一个使用同一数据根的实例（PID " + (($existing | ForEach-Object { $_.ProcessId }) -join ', ') + '），请求聚焦后退出')
  Start-Process -FilePath $exe -ArgumentList $arguments | Out-Null
  exit 0
}

if ($WebFallback) {
  Write-Log '按参数要求走 Web 回退'
} else {
  Write-Log "启动桌面壳，日志：$logPath"
  # 不能用 -WindowStyle Hidden：STARTUPINFO 的 SW_HIDE 会覆盖 Electron 首次 window.show()，
  # 结果是窗口已创建、页面已加载，但始终不可见（托盘里能看到）。桌面壳是 GUI 子系统程序，
  # 输出已重定向到文件，本来也不会弹控制台。
  $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $exe) `
    -RedirectStandardOutput $shellOutPath -RedirectStandardError $errPath -PassThru
  Write-Log "桌面壳 PID：$($process.Id)"

  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline -and -not $process.HasExited) { Start-Sleep -Milliseconds 500 }
  if (-not $process.HasExited) {
    # 端口不归我们挑：桌面壳自己向上游要一个空闲端口（--port 0），所以这里只把实际 origin 记进日志。
    $origin = ''
    $originDeadline = (Get-Date).AddSeconds(20)
    while (-not $origin -and (Get-Date) -lt $originDeadline) {
      if (Test-Path -LiteralPath $shellOutPath) {
        $hit = Select-String -Path $shellOutPath -Pattern 'dsh web:\s*(http://127\.0\.0\.1:\d+)' -List
        if ($hit) { $origin = $hit.Matches[0].Groups[1].Value }
      }
      if (-not $origin) { Start-Sleep -Milliseconds 500 }
    }
    if ($origin) { Write-Log "桌面端口 : $origin（壳内 URL，不占 3081-3099）" }
    else { Write-Log '桌面端口 : 壳尚未打印（端口由桌面壳分配，日志里没有 dsh web 行）' }
    Write-Log '桌面窗口已就绪（进程存活），本脚本退出'
    exit 0
  }
  # 提前退出不等于失败：桌面壳有单实例锁，第二次启动的新进程会把窗口交给已有实例后立刻退出。
  # 先确认同一 userData 下确实没有活着的实例，再判定失败并回退 Web。
  $still = @(Get-CimInstance Win32_Process -Filter ("Name = '" + $processName + "'") -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains($userDataDir)
  })
  if ($still.Count -gt 0) {
    Write-Log ("桌面壳已交给已有实例（PID " + (($still | ForEach-Object { $_.ProcessId }) -join ', ') + '），不启动 Web 回退')
    exit 0
  }
  Write-Log "桌面壳提前退出（exit=$($process.ExitCode)），回退到 Web 形态"
}

$launch = Join-Path $repoRoot 'deepscient\bin\launch.ps1'
if (-not (Test-Path -LiteralPath $launch)) { throw "桌面壳启动失败，且找不到回退启动器：$launch" }

$port = Get-FreePort
if ($port -le 0) {
  Write-Log '3081-3099 全部被占用，无法回退到 Web 形态'
  throw '桌面壳启动失败，且 3081-3099 无空闲端口。详见日志：' + $logPath
}
Write-Log "回退 Web 形态：http://127.0.0.1:$port"
& $launch -Port $port
exit $LASTEXITCODE
