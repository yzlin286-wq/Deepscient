# DeepScient 桌面派生构建
#
# 目标：把已安装的 DeepSeek Harness（Electron 桌面壳）派生成独立应用目录
#       %LOCALAPPDATA%\Programs\DeepScient，改名 DeepScient.exe、改 appId、把默认数据根
#       从 ~/.dsh 改成 ~/.deepscient，并让 resources\app（已解包）优先于 app.asar。
#       仓库内 dist\DeepScient 作为指向该目录的 junction，方便按约定路径找到产物。
#
# 为什么不直接建在 dist\DeepScient：Chromium 启动时会解析壳内的深层 node_modules 路径，
# 仓库根在 Documents 下，整条路径会越过 MAX_PATH，进程在创建窗口前就崩（0x80000003）。
# 因此实体目录放在短的 %LOCALAPPDATA%\Programs\DeepScient，dist 下只留一条链接。
#
# 只读约束：绝不写安装目录（%LOCALAPPDATA%\Programs\DeepSeek Harness），
#           绝不写 %USERPROFILE%\.dsh，不复制任何用户数据/密钥。
# 幂等：重复运行只覆盖壳与 resources 部分；不写 profiles / 用户数据根。
param(
  [string]$Source = '',
  [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))

if (-not $Source) {
  $Source = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'
}
$Source = [System.IO.Path]::GetFullPath($Source)

if (-not $Destination) {
  $Destination = Join-Path $env:LOCALAPPDATA 'Programs\DeepScient'
}
$Destination = [System.IO.Path]::GetFullPath($Destination)
$linkPath = Join-Path $repoRoot 'dist\DeepScient'

$sourceExe = Join-Path $Source 'DeepSeek Harness.exe'
$sourceApp = Join-Path $Source 'resources\app'
$sourceAppPkg = Join-Path $sourceApp 'package.json'
$sourceAsar = Join-Path $Source 'resources\app.asar'

$destExe = Join-Path $Destination 'DeepScient.exe'
$destApp = Join-Path $Destination 'resources\app'
$destAppPkg = Join-Path $destApp 'package.json'
$destMainJs = Join-Path $destApp 'lib\main.js'
$destAsar = Join-Path $Destination 'resources\app.asar'
$destAsarDisabled = Join-Path $Destination 'resources\app.asar.disabled'
$buildInfoPath = Join-Path $Destination 'BUILD-INFO.json'

function New-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Write-Step([string]$Message) {
  Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message)
}

# 敏感文件：不复制，命中则记入 BUILD-INFO.excluded
# cacert.pem 是 pip 内置的公共 CA 证书包（非密钥），继续复制，否则派生目录里 pip HTTPS 会失效。
$sensitivePatterns = @(
  'token.json', '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx',
  'id_rsa', 'id_rsa.*', 'id_ed25519', 'id_ed25519.*', 'credentials.json', '*.keystore'
)
$publicCaBundles = @('cacert.pem')

Write-Step 'DeepScient 桌面派生构建开始'
Write-Step "源目录   : $Source"
Write-Step "产物目录 : $Destination"

if (-not (Test-Path -LiteralPath $sourceExe)) { throw "找不到桌面壳可执行文件：$sourceExe" }
if (-not (Test-Path -LiteralPath $sourceAppPkg)) { throw "找不到已解包的 resources\app\package.json：$sourceAppPkg" }
if ($Destination.StartsWith($Source + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "产物目录不能位于只读安装目录内：$Destination"
}

# 版本取自原 resources\app\package.json
$sourceManifest = Get-Content -LiteralPath $sourceAppPkg -Raw -Encoding UTF8 | ConvertFrom-Json
$productVersion = [string]$sourceManifest.version
if (-not $productVersion) { throw "原 package.json 缺少 version 字段：$sourceAppPkg" }

New-Directory $Destination

# 源目录里的敏感文件：按名字判定，命中则排除并记入 BUILD-INFO.excluded
$sourceFiles = @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction SilentlyContinue)
$sensitiveFound = @()
foreach ($pattern in $sensitivePatterns) {
  $sensitiveFound += @($sourceFiles | Where-Object { $_.Name -like $pattern })
}
$sensitiveFound = @($sensitiveFound | Sort-Object -Property FullName -Unique)
$skippedSensitive = @($sensitiveFound | Where-Object { $publicCaBundles -notcontains $_.Name } | ForEach-Object { $_.FullName })
$skipNames = @($skippedSensitive | ForEach-Object { Split-Path -Leaf $_ } | Sort-Object -Unique)

Write-Step '复制壳与 resources（robocopy，跳过 app.dshpurge-prev / profiles / 敏感文件）'
$rcArgs = @(
  $Source,
  $Destination,
  '/E',
  '/MT:8',
  '/R:1',
  '/W:1',
  '/NFL',
  '/NDL',
  '/NJH',
  '/NJS',
  '/NP',
  '/XJ',
  '/XD', (Join-Path $Source 'resources\app.dshpurge-prev'), (Join-Path $Source 'profiles'), (Join-Path $Source 'resources\app\profiles')
)
if ($skipNames.Count -gt 0) {
  $rcArgs += '/XF'
  $rcArgs += $skipNames
}
& robocopy @rcArgs
$roboExit = $LASTEXITCODE
if ($roboExit -gt 7) { throw "robocopy 复制失败（exit=$roboExit）：$Source -> $Destination" }

# 原安装目录里 resources\app\runtime 是指向 resources\runtime 的 junction；
# robocopy /XJ 不跟随它，这里在产物里重建同样的一条链接，避免 runtime 被复制两份。
$destRuntime = Join-Path $Destination 'resources\runtime'
$destAppRuntime = Join-Path $destApp 'runtime'
if (Test-Path -LiteralPath $destAppRuntime) {
  $existing = Get-Item -LiteralPath $destAppRuntime -Force
  if (-not ($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    Remove-Item -LiteralPath $destAppRuntime -Recurse -Force
  }
}
if (-not (Test-Path -LiteralPath $destAppRuntime)) {
  try {
    New-Item -ItemType Junction -Path $destAppRuntime -Target $destRuntime | Out-Null
  } catch {
    throw ("创建 resources\app\runtime junction 失败：" + $_.Exception.GetType().Name + ': ' + $_.Exception.Message)
  }
}
$junction = Get-Item -LiteralPath $destAppRuntime -Force
if (-not ($junction.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
  throw "resources\app\runtime 不是链接，runtime 会被复制两份：$destAppRuntime"
}

# 可执行文件改名：DeepSeek Harness.exe -> DeepScient.exe
Write-Step '派生可执行文件 DeepScient.exe'
try {
  Copy-Item -LiteralPath $sourceExe -Destination $destExe -Force
} catch {
  throw ("复制可执行文件失败（$destExe 可能被占用）：" + $_.Exception.GetType().Name + ': ' + $_.Exception.Message)
}
$staleExe = Join-Path $Destination 'DeepSeek Harness.exe'
if (Test-Path -LiteralPath $staleExe) { Remove-Item -LiteralPath $staleExe -Force }

# package.json：name / productName / appId
Write-Step '改写 resources\app\package.json'
$pkgText = [System.IO.File]::ReadAllText($destAppPkg)
$pkgText = $pkgText -replace '"name"\s*:\s*"[^"]*"', '"name": "DeepScient"'
if ($pkgText -notmatch '"productName"\s*:') {
  $pkgText = $pkgText -replace '("name":\s*"DeepScient")', ('$1,' + "`r`n" + '  "productName": "DeepScient"')
}
$pkgText = $pkgText -replace '"dshDesktopAppId"\s*:\s*"[^"]*"', '"dshDesktopAppId": "com.deepscient.workbench"'

$pkgCheck = $pkgText | ConvertFrom-Json
if ($pkgCheck.name -ne 'DeepScient') { throw "package.json name 改写失败：$($pkgCheck.name)" }
if ($pkgCheck.productName -ne 'DeepScient') { throw "package.json productName 改写失败：$($pkgCheck.productName)" }
if ($pkgCheck.dshDesktopAppId -ne 'com.deepscient.workbench') { throw "package.json appId 改写失败：$($pkgCheck.dshDesktopAppId)" }
Write-Utf8NoBom $destAppPkg $pkgText

# main.js：只替换默认数据根字面量，DSH_HOME（及显式配置）优先级不变
Write-Step '改写 resources\app\lib\main.js 默认数据根'
$mainJs = [System.IO.File]::ReadAllText($destMainJs)
$mainJsBefore = $mainJs
$mainJs = $mainJs.Replace('const DSH_HOME_DIR_NAME = ".dsh";', 'const DSH_HOME_DIR_NAME = ".deepscient";')
$mainJs = $mainJs.Replace('const home = process.env.DSH_HOME || join(homedir(), ".dsh");', 'const home = process.env.DSH_HOME || join(homedir(), ".deepscient");')
$mainJs = $mainJs.Replace('* `~/.dsh`. The harness keeps all user data under one root.', '* `~/.deepscient`. The harness keeps all user data under one root.')

if (-not $mainJs.Contains('const DSH_HOME_DIR_NAME = ".deepscient";')) { throw 'main.js：默认数据根未改成 .deepscient' }
if (-not $mainJs.Contains('const home = process.env.DSH_HOME || join(homedir(), ".deepscient");')) { throw 'main.js：更新器回退路径未改成 .deepscient' }
if ($mainJs.Contains('DSH_HOME_DIR_NAME = ".dsh"')) { throw 'main.js：仍存在指向 ~/.dsh 的默认根' }
if (-not $mainJs.Contains('const DSH_HOME_ENV = "DSH_HOME";')) { throw 'main.js：DSH_HOME 环境变量入口丢失' }
if (-not $mainJs.Contains('function resolveRoot(configured, env, envName, fallback)')) { throw 'main.js：resolveRoot 优先级逻辑丢失' }
if (-not $mainJs.Contains('const LINK_PROJECTION_DIR = ".dsh-module-fallback";')) { throw 'main.js：.dsh-module-fallback 目录名被误改' }

if ($mainJs -ne $mainJsBefore) { Write-Utf8NoBom $destMainJs $mainJs }

# 让 Electron 读 resources\app 而不是 app.asar
Write-Step 'app.asar -> app.asar.disabled'
if (Test-Path -LiteralPath $destAsar) {
  try {
    if (Test-Path -LiteralPath $destAsarDisabled) { Remove-Item -LiteralPath $destAsarDisabled -Force }
    Move-Item -LiteralPath $destAsar -Destination $destAsarDisabled -Force
  } catch {
    throw ("重命名 app.asar 失败：" + $_.Exception.GetType().Name + ': ' + $_.Exception.Message)
  }
}
if (-not (Test-Path -LiteralPath $destAsarDisabled)) { throw "缺少 $destAsarDisabled，Electron 可能仍会加载 app.asar" }

# 内置插件：把两个本地包以源码形态放进 resources\deepscient，供打包形态装配 profile 使用
Write-Step '内置插件 -> resources\deepscient'
$bundleRoot = Join-Path $Destination 'resources\deepscient'
New-Item -ItemType Directory -Force -Path $bundleRoot | Out-Null
$pluginSpecs = @(
  @{ Name = 'deepscient'; Source = (Join-Path $repoRoot 'deepscient') },
  @{ Name = 'dsh-science'; Source = (Join-Path $repoRoot 'dsh-science') }
)

foreach ($spec in $pluginSpecs) {
  $pluginSource = $spec.Source
  $pluginTarget = Join-Path $bundleRoot $spec.Name
  if (-not (Test-Path -LiteralPath (Join-Path $pluginSource 'package.json'))) {
    throw "找不到内置插件源码：$pluginSource"
  }
  New-Item -ItemType Directory -Force -Path $pluginTarget | Out-Null
  Write-Step ("复制插件 {0}" -f $spec.Name)
  $pluginRcArgs = @(
    $pluginSource,
    $pluginTarget,
    '/E',
    '/MT:8',
    '/R:1',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP',
    '/XD', 'node_modules', 'dist', '.git', (Join-Path $pluginSource 'desktop\vendor'), 'skills-vendor', 'logs', 'backup',
    '/XF', '*.log', 'local.patch.yml', '*.tgz', 'token.json', '.env', '.env.*', '*.pem', '*.key'
  )
  & robocopy @pluginRcArgs
  $pluginRcExit = $LASTEXITCODE
  if ($pluginRcExit -gt 7) { throw "robocopy 复制插件失败（exit=$pluginRcExit）：$pluginSource -> $pluginTarget" }
}

$requiredPluginFiles = @(
  (Join-Path $bundleRoot 'deepscient\package.json'),
  (Join-Path $bundleRoot 'dsh-science\package.json'),
  (Join-Path $bundleRoot 'dsh-science\lib\science\orchestra\scheduler.js'),
  (Join-Path $bundleRoot 'dsh-science\data\org\roles.json')
)
foreach ($requiredFile in $requiredPluginFiles) {
  if (-not (Test-Path -LiteralPath $requiredFile)) { throw "内置插件缺少关键文件：$requiredFile" }
}

# CLI 垫片：让产物内可以直接 `dsh`（Electron 以 Node 模式跑壳内的 desktop-host CLI）
$cliShimDir = Join-Path $bundleRoot 'cli'
New-Item -ItemType Directory -Force -Path $cliShimDir | Out-Null
$cliShimPath = Join-Path $cliShimDir 'dsh.cmd'
$cliEntryRel = 'app\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
$cliEntryPath = Join-Path (Join-Path $Destination 'resources') $cliEntryRel
if (-not (Test-Path -LiteralPath $cliEntryPath)) {
  throw "CLI 垫片入口不存在：$cliEntryPath（既不是 app 解包目录，也没有对应的 app.asar.unpacked 路径）"
}
$cliShim = @'
@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
set "entry=%~dp0..\..\app\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"
if not exist "%entry%" set "entry=%~dp0..\..\app.asar.unpacked\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"
"%~dp0..\..\..\DeepScient.exe" --expose-internals "%entry%" %*
exit /b %errorlevel%
'@
Write-Utf8NoBom $cliShimPath (($cliShim -replace "`r`n", "`n") -replace "`n", "`r`n")
Write-Step "已写入 CLI 垫片：$cliShimPath"

# 应用根启动器（文件名中文，内容纯 ASCII）
$launcherPath = Join-Path $Destination 'DeepScient 启动.cmd'
$launcher = @"
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0resources\deepscient\deepscient\desktop\deepscient-desktop.ps1"
"@
Write-Utf8NoBom $launcherPath (($launcher -replace "`r`n", "`n") -replace "`n", "`r`n")
Write-Step "已写入启动器：$launcherPath"

# 硬约束自检：插件目录只含源码与随包数据（robocopy 已排除，这里再兜底一次）
foreach ($spec in $pluginSpecs) {
  $pluginTarget = Join-Path $bundleRoot $spec.Name
  foreach ($bad in @('node_modules', 'skills-vendor')) {
    if (Test-Path -LiteralPath (Join-Path $pluginTarget $bad)) { throw "插件目录里出现了不应存在的目录：$(Join-Path $pluginTarget $bad)" }
  }
  foreach ($badFile in @('token.json', '.env')) {
    if (Test-Path -LiteralPath (Join-Path $pluginTarget $badFile)) { throw "插件目录里出现了不应存在的文件：$(Join-Path $pluginTarget $badFile)" }
  }
}

# 硬约束自检：产物里不能有 profiles / 用户数据根
foreach ($forbidden in @((Join-Path $Destination 'profiles'), (Join-Path $Destination 'resources\profiles'), (Join-Path $Destination '.deepscient'))) {
  if (Test-Path -LiteralPath $forbidden) { throw "产物里出现了不应存在的目录：$forbidden" }
}

# 仓库内 dist\DeepScient 只留一条指向实体的 junction：约定路径仍可用，实体落在短路径上
Write-Step "建立 dist\DeepScient -> $Destination"
$distDir = Split-Path -Parent $linkPath
if (-not (Test-Path -LiteralPath $distDir)) { New-Item -ItemType Directory -Force -Path $distDir | Out-Null }
if (Test-Path -LiteralPath $linkPath) {
  $existingLink = Get-Item -LiteralPath $linkPath -Force
  if ($existingLink.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    $existingLink.Delete()
  } else {
    Write-Step 'dist\DeepScient 是旧版实体目录（含超额路径的旧产物），清空后改为链接'
    # Remove-Item 会栽在超长路径上（正是要改布局的原因）；用 robocopy /MIR 从空目录镜像清空。
    $emptyDir = Join-Path ([System.IO.Path]::GetTempPath()) ('ds-empty-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $emptyDir | Out-Null
    & robocopy $emptyDir $linkPath /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
    Remove-Item -LiteralPath $emptyDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $linkPath -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $linkPath) {
      $longPath = '\\?\' + $linkPath
      Remove-Item -LiteralPath $longPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $linkPath) { throw "旧产物目录无法清空：$linkPath" }
  }
}
try {
  New-Item -ItemType Junction -Path $linkPath -Target $Destination | Out-Null
} catch {
  throw ("创建 dist\DeepScient junction 失败：" + $_.Exception.GetType().Name + ': ' + $_.Exception.Message)
}

# BUILD-INFO.json
Write-Step '写入 BUILD-INFO.json'
# 统计物理文件：跳过 BUILD-INFO.json 自身，也不重复统计 junction 指向的 runtime
$junctionPrefix = $destAppRuntime + [System.IO.Path]::DirectorySeparatorChar
$inventory = @(Get-ChildItem -LiteralPath $Destination -Recurse -File -Force | Where-Object {
  $_.FullName -ne $buildInfoPath -and -not $_.FullName.StartsWith($junctionPrefix, [System.StringComparison]::OrdinalIgnoreCase)
})
$fileCount = $inventory.Count
$totalBytes = [int64]0
foreach ($file in $inventory) { $totalBytes += $file.Length }

$excludedNote = '未复制任何用户数据或密钥：不含 %USERPROFILE%\.deepscient、profiles\、token.json、.env、私钥；仅派生桌面壳与 resources（app + runtime）。pip 内置的公共 CA 包 cacert.pem 不属于密钥，照常复制。插件只含源码与随包数据，不含 node_modules / 用户数据 / 密钥'

$bundledPlugins = @()
foreach ($spec in $pluginSpecs) {
  $pluginTarget = Join-Path $bundleRoot $spec.Name
  $pluginManifestText = [System.IO.File]::ReadAllText((Join-Path $pluginTarget 'package.json'), [System.Text.Encoding]::UTF8)
  $pluginManifest = $pluginManifestText | ConvertFrom-Json
  $pluginMain = ''
  $manifestProps = @($pluginManifest.PSObject.Properties.Name)
  if ($manifestProps -contains 'main' -and $pluginManifest.main) {
    $pluginMain = [string]$pluginManifest.main
  } elseif ($manifestProps -contains 'exports' -and $pluginManifest.exports -and $pluginManifest.exports.PSObject.Properties['.']) {
    $pluginMain = [string]$pluginManifest.exports.PSObject.Properties['.'].Value
  }
  if (-not $pluginMain) { $pluginMain = './lib/index.js' }
  $pluginEntryRel = ($pluginMain -replace '/', '\').TrimStart('.', '\')
  $pluginEntryPath = Join-Path $pluginTarget $pluginEntryRel
  $pluginEntrySha = ''
  if (Test-Path -LiteralPath $pluginEntryPath) {
    $pluginEntrySha = (Get-FileHash -Algorithm SHA256 -LiteralPath $pluginEntryPath).Hash.ToLower()
  }
  $pluginFiles = @(Get-ChildItem -LiteralPath $pluginTarget -Recurse -File -Force)
  $pluginBytes = [int64]0
  foreach ($pluginFile in $pluginFiles) { $pluginBytes += $pluginFile.Length }
  $bundledPlugins += [ordered]@{
    name        = $spec.Name
    version     = [string]$pluginManifest.version
    files       = $pluginFiles.Count
    bytes       = $pluginBytes
    entry       = $pluginEntryRel
    entrySha256 = $pluginEntrySha
  }
}

$buildInfo = [ordered]@{
  source         = $Source
  destination    = $Destination
  link           = $linkPath
  productVersion = $productVersion
  builtAt        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  files          = $fileCount
  bytes          = $totalBytes
  excluded       = [ordered]@{
    note               = $excludedNote
    skippedFiles       = @($skippedSensitive)
    skippedDirectories = @('resources\app.dshpurge-prev')
  }
  bundledPlugins = $bundledPlugins
}
Write-Utf8NoBom $buildInfoPath (($buildInfo | ConvertTo-Json -Depth 6) + "`n")

$elapsed = ((Get-Date) - $startedAt).TotalSeconds
Write-Host ''
Write-Host '构建完成'
Write-Host ("产物路径 : " + $Destination)
Write-Host ("版本     : " + $productVersion)
Write-Host ("文件数   : " + $fileCount + "（不含 BUILD-INFO.json）")
Write-Host ("总字节   : " + $totalBytes)
Write-Host ("耗时     : " + [math]::Round($elapsed, 1) + ' 秒')
if ($skippedSensitive.Count -gt 0) {
  Write-Host ("已跳过敏感文件：" + ($skippedSensitive -join ', '))
}
exit 0
