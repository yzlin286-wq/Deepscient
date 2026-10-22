# DeepScient 桌面版发布：构建 → 打 zip → 建 GitHub Release → 上传资产
#
# 令牌只从环境变量读，不写进任何文件：
#   $env:GITHUB_TOKEN = '...'
#   powershell -File deepscient/desktop/release-github.ps1 -Tag desktop-v1 -Build
#
# 为什么用 zip 走 Release 而不是入库：派生应用约 1.5 GB，普通 Git 仓库单文件上限 100 MB；
# Release 资产单文件上限 2 GB，正好放得下，也不必让每个克隆都拖一个壳。
param(
  [string]$Repo = 'yzlin286-wq/Deepscient',
  [string]$Tag = '',
  [string]$ZipPath = '',
  [switch]$Build,
  [switch]$SkipUpload
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$distDir = Join-Path $repoRoot 'dist'
$appDir = Join-Path $env:LOCALAPPDATA 'Programs\DeepScient'

function Write-Step([string]$Message) {
  Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message)
}

if (-not $Tag) { $Tag = 'desktop-' + (Get-Date -Format 'yyyyMMdd') }

if ($Build) {
  Write-Step '构建派生应用'
  & (Join-Path $PSScriptRoot 'build-desktop.ps1')
  if ($LASTEXITCODE -ne 0) { throw "build-desktop.ps1 失败（exit=$LASTEXITCODE）" }
}

if (-not (Test-Path -LiteralPath (Join-Path $appDir 'DeepScient.exe'))) {
  throw "找不到派生应用：$appDir（先运行 build-desktop.ps1 或加 -Build）"
}

$releaseDir = Join-Path $distDir 'release'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
if (-not $ZipPath) { $ZipPath = Join-Path $releaseDir ("DeepScient-$Tag.zip") }
$ZipPath = [System.IO.Path]::GetFullPath($ZipPath)

Write-Step "打包：$appDir -> $ZipPath"
if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
# Windows 自带 bsdtar 支持按扩展名出 zip；比 Compress-Archive 稳（后者对 >2GB 会失败）。
& tar -a -c -f $ZipPath -C (Split-Path -Parent $appDir) (Split-Path -Leaf $appDir)
if ($LASTEXITCODE -ne 0) { throw "tar 打包失败（exit=$LASTEXITCODE）" }
$zipInfo = Get-Item -LiteralPath $ZipPath
Write-Step ('zip 完成：{0:N0} 字节（{1:N1} MB）' -f $zipInfo.Length, ($zipInfo.Length / 1MB))

if ($SkipUpload) {
  Write-Step '已跳过上传（-SkipUpload）'
  exit 0
}

# Windows PowerShell 5.1 不支持 ?? 运算符，这里用字符串拼接兜底空值
$token = ('' + $env:GITHUB_TOKEN).Trim()
if (-not $token) { throw '未设置 GITHUB_TOKEN 环境变量；zip 已生成，设置后重跑即可上传。' }

$headers = @{
  Authorization          = 'Bearer ' + $token
  Accept                 = 'application/vnd.github+json'
  'User-Agent'           = 'deepscient-release'
  'X-GitHub-Api-Version' = '2022-11-28'
}

$api = 'https://api.github.com/repos/' + $Repo
$body = @{
  tag_name         = $Tag
  name             = 'DeepScient 桌面版 ' + $Tag
  draft            = $false
  prerelease       = $false
  generate_release_notes = $false
  body             = @'
DeepScient 桌面版（Windows x64）安装包。

## 安装
1. 解压到任意短路径目录（**不要放在很深的目录里**：Chromium 解析壳内 node_modules 会突破 MAX_PATH，进程会在开窗前退出）；
2. 确保已安装 DeepSeek Harness 桌面端，并已按仓库 `docs/desktop-install.md` 装配过一次 profile；
3. 双击 `DeepScient.exe`，或把 `deepscient/desktop/deepscient-desktop.ps1` 建成快捷方式；
4. 点「登录 DeepScient」在浏览器完成官网授权，窗口会自动进入工作台。

数据根：`%USERPROFILE%\.deepscient`（与 Web 形态共用；不要和 Web 形态同时开）。
完整说明见仓库 `docs/desktop-install.md`。
'@
} | ConvertTo-Json -Depth 4

Write-Step "创建 Release：$Tag"
$release = $null
try {
  $release = Invoke-RestMethod -Uri ($api + '/releases') -Method Post -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 60
} catch {
  $message = $_.Exception.Message
  if ($message -match '422') {
    Write-Step 'Release 已存在，复用同 tag 的发行版'
    $release = Invoke-RestMethod -Uri ($api + '/releases/tags/' + $Tag) -Headers $headers -TimeoutSec 60
  } else {
    throw ('创建 Release 失败：' + $message)
  }
}
Write-Step ('Release: ' + $release.html_url)

$assetName = Split-Path -Leaf $ZipPath
Write-Step ('上传资产 ' + $assetName + '（' + ('{0:N1}' -f ($zipInfo.Length / 1MB)) + ' MB，流式，可能需要几分钟）')

Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromHours(2)
$client.DefaultRequestHeaders.TryAddWithoutValidation('Authorization', 'Bearer ' + $token) | Out-Null
$client.DefaultRequestHeaders.TryAddWithoutValidation('Accept', 'application/vnd.github+json') | Out-Null
$client.DefaultRequestHeaders.TryAddWithoutValidation('User-Agent', 'deepscient-release') | Out-Null
$client.DefaultRequestHeaders.TryAddWithoutValidation('X-GitHub-Api-Version', '2022-11-28') | Out-Null

$stream = [System.IO.File]::OpenRead($ZipPath)
try {
  $content = New-Object System.Net.Http.StreamContent($stream)
  $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/zip')
  $uploadUrl = 'https://uploads.github.com/repos/' + $Repo + '/releases/' + $release.id + '/assets?name=' + [uri]::EscapeDataString($assetName)
  $response = $client.PostAsync($uploadUrl, $content).GetAwaiter().GetResult()
  $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if (-not $response.IsSuccessStatusCode) {
    throw ('上传失败 HTTP ' + [int]$response.StatusCode + '：' + $text.Substring(0, [Math]::Min(400, $text.Length)))
  }
  $asset = $text | ConvertFrom-Json
  Write-Step ('上传完成：' + $asset.browser_download_url)
} finally {
  $stream.Dispose()
  $client.Dispose()
}

$elapsed = ((Get-Date) - $startedAt).TotalSeconds
Write-Step ('发布完成，用时 {0:N0} 秒' -f $elapsed)
Write-Host ('Release 页面：' + $release.html_url)
exit 0
