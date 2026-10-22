# DeepScient 桌面 profile 装配器
#
# 目标：把 @local/deepscient 与 @local/dsh-science 装进桌面壳专用的 dsh profile
# （默认 <DSH_HOME>\profiles\desktop），并补齐无密钥的供应商层。
#
# 幂等：重复运行只会重新 link 两个本地包、补缺字段，不覆盖用户已经写过的配置。
# 约束：不写 ~/.dsh；不改 %LOCALAPPDATA%\Programs\DeepSeek Harness 下任何文件。
param(
  [string]$DshHome = '',
  [string]$Profile = 'desktop',
  [string]$DshCli = '',
  [switch]$SkipProviders
)

$ErrorActionPreference = 'Stop'

if (-not $DshHome) {
  $DshHome = if ($env:DEEPSCIENT_HOME) { $env:DEEPSCIENT_HOME } else { Join-Path $env:USERPROFILE '.deepscient' }
}
$DshHome = [System.IO.Path]::GetFullPath($DshHome)

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$packages = @(
  (Join-Path $repoRoot 'deepscient'),
  (Join-Path $repoRoot 'dsh-science')
)
$bundleNames = @('@local/deepscient', '@local/dsh-science')

$logsDir = Join-Path $DshHome 'logs'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$script:LogPath = Join-Path $logsDir ('assemble-profile-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')

function Write-Log([string]$Message) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message)
  Write-Host $line
  Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Resolve-DshCli {
  if ($DshCli) {
    if (-not (Test-Path -LiteralPath $DshCli)) { throw "指定的 -DshCli 不存在：$DshCli" }
    return (Resolve-Path -LiteralPath $DshCli).Path
  }
  if ($env:DSH_CLI -and (Test-Path -LiteralPath $env:DSH_CLI)) { return (Resolve-Path -LiteralPath $env:DSH_CLI).Path }
  $candidate = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  $cmd = Get-Command dsh -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw '找不到 dsh。安装 DeepSeek Harness 桌面版，或用 -DshCli 指向 dsh.cmd。'
}

Write-Log "DeepScient desktop profile 装配开始"
Write-Log "DSH_HOME : $DshHome"
Write-Log "profile  : $Profile"
Write-Log "repoRoot : $repoRoot"
Write-Log "log      : $script:LogPath"

foreach ($packageDir in $packages) {
  $manifest = Join-Path $packageDir 'package.json'
  if (-not (Test-Path -LiteralPath $manifest)) { throw "缺少本地包：$manifest" }
}

$dsh = Resolve-DshCli
Write-Log "dsh CLI  : $dsh"

$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$manifestPath = Join-Path $profileDir 'package.json'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

# 桌面壳把 desktop 视为保留 profile：先由应用初始化，CLI 才肯接管。
# 这里按壳内 initProfile 的模板预置同样的骨架，等价于「已启动过一次」。
if (-not (Test-Path -LiteralPath $manifestPath)) {
  $skeleton = [ordered]@{
    name         = "dsh-profile-$Profile"
    private      = $true
    dependencies = [ordered]@{}
    dsh          = [ordered]@{ profile = [ordered]@{ bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app') } }
  }
  Write-Utf8NoBom $manifestPath (($skeleton | ConvertTo-Json -Depth 8) + "`n")
  Write-Log "已写入 profile 骨架：$manifestPath"
} else {
  Write-Log "profile 已存在：$manifestPath"
}

$workspacePath = Join-Path $profileDir 'pnpm-workspace.yaml'
if (-not (Test-Path -LiteralPath $workspacePath)) {
  $workspace = "packages:`n  - .`n`nnodeLinker: hoisted`nautoInstallPeers: false`n"
  Write-Utf8NoBom $workspacePath $workspace
  Write-Log "已写入 pnpm-workspace.yaml"
}

$patchPath = Join-Path $profileDir 'cordis.patch.yml'
if (-not (Test-Path -LiteralPath $patchPath)) {
  Write-Utf8NoBom $patchPath "# DeepScient 桌面 profile 的用户补丁层（由 deepscient/desktop/assemble-profile.ps1 维护）`n# 只写 apiKeyEnv 名称，不写密钥。`n[]`n"
  Write-Log "已写入空的 cordis.patch.yml"
}

$env:DSH_HOME = $DshHome
$env:DSH_PROFILE = $Profile

foreach ($packageDir in $packages) {
  Write-Log "link 本地包：$packageDir"
  $output = & $dsh plugin --profile $Profile add $packageDir 2>&1
  $code = $LASTEXITCODE
  foreach ($line in $output) { Write-Log ("  " + [string]$line) }
  if ($code -ne 0) {
    throw ("dsh plugin add 失败（exit=$code）。命令：`"$dsh`" plugin --profile $Profile add `"$packageDir`"。日志：$script:LogPath")
  }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$bundles = @()
if ($manifest.dsh -and $manifest.dsh.profile -and $manifest.dsh.profile.bundles) { $bundles = @($manifest.dsh.profile.bundles) }

$missing = @($bundleNames | Where-Object { $bundles -notcontains $_ })
if ($missing.Count -gt 0) {
  $manifest.dsh.profile.bundles = @($bundles + $missing)
  Write-Utf8NoBom $manifestPath (($manifest | ConvertTo-Json -Depth 8) + "`n")
  Write-Log ("已补写 bundles：" + ($missing -join ', '))
} else {
  Write-Log "bundles 已包含：$($bundleNames -join ', ')"
}

if (-not $SkipProviders) {
  $providerBlock = @'
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      treeapi:
        displayName: treeapi
        apiKeyEnv: TREEAPI_API_KEY
        api: openai-responses
        baseURL: https://api.treeapi.online/v1
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
      ccagent:
        displayName: ccagent
        apiKeyEnv: CCAGENT_API_KEY
        api: openai-responses
        baseURL: https://un.ccagent.cn/v1
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: ccagent
    model: deepseek-v4.1-flash
'@

  $patchText = Get-Content -LiteralPath $patchPath -Raw
  if (-not $patchText) { $patchText = '' }
  $normalized = ($patchText -replace "`r`n", "`n").Trim()

  $hasTreeapi = $normalized -match '(?m)^\s*treeapi:\s*$'
  $hasCcagent = $normalized -match '(?m)^\s*ccagent:\s*$'
  $stripped = ((($normalized -split "`n") | Where-Object {
    $_.Trim() -ne '' -and -not $_.TrimStart().StartsWith('#')
  }) -join "`n").Trim()

  if ($hasTreeapi -and $hasCcagent) {
    Write-Log '供应商层已包含 treeapi / ccagent，跳过'
  } elseif ($stripped -eq '' -or $stripped -eq '[]') {
    $header = "# DeepScient 桌面 profile 的用户补丁层（由 deepscient/desktop/assemble-profile.ps1 维护）`n# 只写 apiKeyEnv 名称，不写密钥；密钥请设系统环境变量 TREEAPI_API_KEY / CCAGENT_API_KEY。`n"
    Write-Utf8NoBom $patchPath ($header + $providerBlock + "`n")
    Write-Log '已写入供应商层（treeapi / ccagent + 默认模型）'
  } elseif ($normalized -notmatch 'id:\s*llm-pi-ai') {
    Write-Utf8NoBom $patchPath ($patchText.TrimEnd() + "`n" + $providerBlock + "`n")
    Write-Log '已追加供应商层（treeapi / ccagent + 默认模型）'
  } else {
    Write-Log '警告：cordis.patch.yml 已有 llm-pi-ai 配置但缺少 treeapi / ccagent，保留用户改动，请手工补齐'
  }
}

# 桌面壳必需的覆写：openInitialWindow → readWelcomeState 会调用 account/getState。
# DeepScient 公共补丁关闭了 account-controller，该 RPC 于是 404，壳报
# "desktop welcome: Web request failed" 且不创建任何窗口；这里只在本 profile 层重新启用。
# 幂等：已出现 account-controller 条目就整块跳过，不覆盖用户之后的手工改动。
$desktopBlock = @'
# 桌面壳需要 account/getState 才能建窗；只在桌面层重新启用，不改公共补丁。
- id: account-controller
  name: "@deepseek-ai/dsh-api-account-controller"
  disabled: false
- id: deepseek-account
  name: "@deepseek-ai/dsh-deepseek-account-platform"
  disabled: false
'@

$currentPatch = ''
if (Test-Path -LiteralPath $patchPath) { $currentPatch = Get-Content -LiteralPath $patchPath -Raw }
if (-not $currentPatch) { $currentPatch = '' }
if ($currentPatch -match 'id:\s*account-controller') {
  Write-Log '桌面覆写已包含 account-controller / deepseek-account，跳过'
} else {
  Write-Utf8NoBom $patchPath ($currentPatch.TrimEnd() + "`n" + $desktopBlock + "`n")
  Write-Log '已追加桌面覆写（account-controller / deepseek-account 重新启用）'
}

Write-Log '装配完成。下一步：运行 deepscient-desktop.ps1 启动桌面窗口。'
Write-Log "日志已保存：$script:LogPath"
exit 0
