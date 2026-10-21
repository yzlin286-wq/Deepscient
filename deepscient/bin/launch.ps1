# DeepScient 启动器 —— 独立 home、独立 profile、独立端口。
#
# 为什么不用 Electron 桌面壳：桌面壳是深寻自己的分发形态，装一次就绑死一个 productName
# 和一个 appId。DeepScient 现在是「第二个 harness 实例」，用同一份 runtime 起第二个
# profile 就能完全隔离数据，且不必重打包安装器。要出安装包时再按 docs/release.md
# 走构建期流程。
#
# 只做四件事：定 home、定 patch 层、挑一个空闲端口、把参数原样交给 dsh。
param(
  [int]$Port = 0,
  [switch]$NoOpen,
  [switch]$NoModelLayer,
  [switch]$DumpConfig,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'

$pkgDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Product = 'DeepScient'

function Resolve-DshCli {
  if ($env:DSH_CLI -and (Test-Path $env:DSH_CLI)) { return $env:DSH_CLI }
  $candidate = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
  if (Test-Path $candidate) { return $candidate }
  $cmd = Get-Command dsh -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "找不到 dsh。设 DSH_CLI 指向 dsh.cmd，或把 dsh 放进 PATH。"
}

function Test-PortFree([int]$p) {
  $listener = $null
  try {
    $listener = New-Object System.Net.Sockets.TcpListener -ArgumentList @([System.Net.IPAddress]::Loopback, $p)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) { $listener.Stop() }
  }
}

$dsh = Resolve-DshCli
$env:DSH_HOME = if ($env:DEEPSCIENT_HOME) { $env:DEEPSCIENT_HOME } else { Join-Path $env:USERPROFILE '.deepscient' }
New-Item -ItemType Directory -Force -Path $env:DSH_HOME | Out-Null

# 模型供应商层：由 scripts/deepscient-sync-models.mjs 生成。没有它实例也能起，
# 只是没有可用模型；此时不静默降级，明确说一句。
$patch = Join-Path $pkgDir 'local.patch.yml'
$patchArgs = @()
if ((Test-Path $patch) -and -not $NoModelLayer) {
  $patchArgs = @('--patch', $patch)
} elseif (-not $NoModelLayer) {
  Write-Warning "没有 $patch，本次不叠加供应商层。先在仓库根跑：node scripts/deepscient-sync-models.mjs"
}

# MCP 工具层：默认不叠加。DSH_ENABLE_MCP=1 才起外部 MCP 服务器（它们要靠 npx 拉包，
# 第一次需要联网）。关着时进程都不起，启动时间与工具列表都不受影响。
$mcpPatch = Join-Path $pkgDir 'mcp.patch.yml'
$mcpOn = ($env:DSH_ENABLE_MCP -eq '1')
if ($mcpOn -and (Test-Path $mcpPatch)) {
  # 给 MCP 子进程一份独立 npmrc：机器上留着指向死代理的 ~/.npmrc 时，npx 会在几毫秒内退出，
  # 表现为「MCP 开着但一个工具都没有」。这份文件只在不存在时生成，存在就不覆盖（要改代理改它）。
  $mcpNpmrc = Join-Path $env:DSH_HOME 'science\mcp-npmrc'
  if (-not (Test-Path $mcpNpmrc)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $mcpNpmrc -Parent) | Out-Null
    $npmrcLines = @(
      '# DeepScient 为 MCP 子进程生成的 npm 配置。',
      '# 你的 ~/.npmrc 里如果配了没在监听的代理，npx 会直接失败、MCP 工具全部缺席，所以这里显式清空。',
      '# 网络确实要走代理时，把下面两行改成你的代理地址。',
      'registry=https://registry.npmjs.org/',
      'proxy=',
      'https-proxy=',
      'fund=false',
      'audit=false',
      'loglevel=error',
      ''
    )
    Set-Content -Path $mcpNpmrc -Value $npmrcLines -Encoding ascii
    Write-Host "[DeepScient] MCP npmrc: $mcpNpmrc（已生成）"
  }
  $patchArgs += @('--patch', $mcpPatch)
} elseif ($mcpOn) {
  Write-Warning "DSH_ENABLE_MCP=1，但找不到 $mcpPatch，本次不叠加 MCP 层。"
}

$chosen = $Port
if ($chosen -le 0) {
  foreach ($p in 3081..3099) {
    if (Test-PortFree $p) { $chosen = $p; break }
  }
  if ($chosen -le 0) { throw "3081-3099 全被占用，指定一个端口：-Port <n>" }
}

$appArgs = @('--port', $chosen, '--host', '127.0.0.1')
if ($NoOpen) { $appArgs += '--no-open' }
if ($Rest.Count) { $appArgs += $Rest }

Write-Host "[$Product] home   : $env:DSH_HOME"
Write-Host "[$Product] profile: deepscient"
Write-Host "[$Product] url    : http://127.0.0.1:$chosen"
if ($patchArgs.Count) { Write-Host "[$Product] 供应商层: $patch" }
if ($mcpOn -and (Test-Path $mcpPatch)) { Write-Host "[$Product] MCP 层  : $mcpPatch" } else { Write-Host "[$Product] MCP 层  : 关（DSH_ENABLE_MCP=1 打开）" }

$allArgs = @('--profile', 'deepscient') + $patchArgs
if ($DumpConfig) { $allArgs += '--dump-config' } else { $allArgs += $appArgs }

& $dsh @allArgs
exit $LASTEXITCODE
