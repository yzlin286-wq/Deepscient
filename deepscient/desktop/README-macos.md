# DeepScient 桌面版（macOS）

把科研工作台插件（`@local/deepscient`）装进 Electron 桌面窗口，复用 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 官方桌面壳，不重新实现 UI。

macOS 与 Windows 走同一条派生规则：改名、改 appId、把默认数据根从 `~/.dsh` 改成 `~/.deepscient`、把两个本地插件放进 `Contents/Resources/deepscient`。差别只在壳的来源与启动器形式：

| | Windows | macOS |
| --- | --- | --- |
| 壳来源 | 本机已安装的 `DeepSeek Harness.exe`（安装包形态） | 从 `deepseek-harness` 源码构建的 `DeepSeek Harness.app` |
| 启动 | `DeepScient 启动.cmd` / 快捷方式 | 双击 `DeepScient.app`，或 `启动 DeepScient.command` |
| 脚本 | `*.ps1`（带 BOM） | `*.sh`（`bash`） |
| 数据根 | `%USERPROFILE%\.deepscient` | `~/.deepscient` |

## 一、构建桌面壳（只需一次）

前置：macOS 13+、Xcode Command Line Tools、Node ≥ 22.19（或 ≥ 24）、pnpm `11.28.5`（与 `deepseek-harness` 的 `packageManager` 一致）。

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm package:desktop:mac:arm64:unsigned    # 或 mac:x64:unsigned
```

`--unsigned` 是本地自测路径：不做 Developer ID 签名与公证，产物落在
`apps/desktop/.desktop-build/targets/mac-arm64/`。国内网络可先设镜像：

```bash
export DSH_DESKTOP_NPM_REGISTRY=https://registry.npmmirror.com
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

## 二、派生 DeepScient.app

```bash
cd Deepscient
bash deepscient/desktop/build-desktop.sh \
  --shell ../deepseek-harness/apps/desktop/.desktop-build/targets/mac-arm64/artifacts/mac-arm64/DeepSeek Harness.app
```

不传 `--shell` 时按以下顺序自动找：`vendor/DeepSeek Harness.app`、`../deepseek-harness/apps/desktop/.desktop-build/**/DeepSeek Harness.app`、`/Applications/DeepSeek Harness.app`。

产物：

```
dist/
├─ DeepScient.app
│  └─ Contents/
│     ├─ MacOS/DeepScient                        Electron 壳（从原壳改名）
│     ├─ Info.plist                              com.deepscient.workbench
│     └─ Resources/
│        ├─ app/                                 解包后的壳主进程与渲染层
│        ├─ app.asar.disabled                    原 asar（保留，Electron 不再加载）
│        ├─ runtime/                             壳自带 node/pnpm 运行时
│        ├─ BUILD-INFO.json                      源壳、版本、文件数、插件入口 sha256
│        └─ deepscient/
│           ├─ deepscient/                       DeepScient 宿主（Host API + Web 界面）
│           ├─ dsh-science/                      科研与调度插件
│           └─ cli/dsh                           包内专用 CLI，指向本包 DeepScient
└─ 启动 DeepScient.command                       启动器（设环境变量后起壳）
```

## 三、启动

首次装配 profile（约 30–60 秒，不需要联网：插件是本地目录，pnpm 无下载）：

```bash
bash deepscient/desktop/assemble-profile.sh        # 可选：手工先装配
open dist/DeepScient.app                           # 或双击
```

或者双击 `启动 DeepScient.command`，日志写在 `~/.deepscient/logs/desktop-<时间戳>.log`，同目录另有 `.shell.log` 与 `.err.log`。

`DeepScient.app` 自己也在主进程里把默认值补齐（`DSH_HOME=~/.deepscient`、`DSH_PROFILE=desktop`、`DEEPSCIENT_DESKTOP=1`），所以 Finder 直接双击也能进工作台。

### 未签名应用的首次打开

本地构建的 `.app` 没有 Developer ID 签名。分发到别的机器后首次打开会被 Gatekeeper 拦下，任选一种：

```bash
xattr -dr com.apple.quarantine /Applications/DeepScient.app
# 或：在 Finder 里右键 → 打开 → 再次确认「打开」
```

## 四、Web 形态（可选）

```bash
# profile 必须存在，且 bundles 里要有 @deepseek-ai/dsh-web-app，否则只起 Host 不监听端口
dist/DeepScient.app/Contents/Resources/deepscient/cli/dsh plugin --profile deepscient add ./deepscient
dist/DeepScient.app/Contents/Resources/deepscient/cli/dsh plugin --profile deepscient add ./dsh-science
DSH_HOME=~/.deepscient bash deepscient/bin/deepscient        # 3081–3099 顺延，浏览器自动打开
```

桌面形态与 Web 形态共用 `~/.deepscient`，不要同时开。

## 五、脚本

| 脚本 | 作用 |
| --- | --- |
| `deepscient/desktop/assemble-profile.sh` | 初始化并装配 `~/.deepscient/profiles/desktop`（bundles + 供应商层 patch + 桌面必需的 account 覆写），幂等 |
| `deepscient/desktop/build-desktop.sh` | 从 `DeepSeek Harness.app` 派生 `dist/DeepScient.app` |
| `deepscient/desktop/deepscient-desktop.sh` | 桌面入口：设环境变量、单实例检查、起壳、记录实际端口、写日志、失败回退 Web 形态、`--create-shortcuts` 建快捷方式 |
| `deepscient/bin/deepscient` | Web 形态启动器（`launch.ps1` 的 macOS 等价物） |

## 六、Linux / macOS 差异与已知限制

1. **没有签名与公证**：`--unsigned` 构建只保证本机可运行；跨机分发需右键打开或去隔离属性。有 Developer ID 时按 `apps/desktop/.env.macos.example` 配 `DSH_DESKTOP_MACOS_SIGNING_IDENTITY` 走正式签名。
2. **图标**：派生不改 `CFBundleIconFile`，沿用壳自带图标；品牌图标需要 `.icns`，当前仓库只有 `icon.svg` 与 `icon.ico`。
3. **两种形态不能同时开**：Web 形态与桌面形态共用 `~/.deepscient`，并行会抢 SQLite 与会话文件。
4. **`~/.dsh` 的写入者是用户日常运行的 DeepSeek Harness**，不是这些脚本；全部脚本只写 `~/.deepscient` 与 `dist/`。
5. **磁盘占用**：派生目录约 1.5–2 GB（壳的 runtime 占大头）；`.dmg`/`.zip` 约 500–700 MB。
6. **桌面壳升级后**要重跑 `build-desktop.sh`；`source.lock.json` 记录的 Windows 基线不适用于 macOS 产物。

## 七、验收口径

```bash
node tools/verify-packaging.mjs                  # 打包面（零依赖）
node deepscient/scripts/verify-deepscient.mjs --token <本次启动的 token>   # 活实例
node dsh-science/scripts/demo-campaign.mjs --example sleep-wm --seed 42    # 离线演示
```

macOS 实测记录见发布说明；关键断言：窗口可打开、`/health` 与 `/deepscient/api/projects` 为 200、注册工具 47 个、六个页面可切换、`POST /deepscient/auth/authorize` 返回 200、离线演示同 seed 幂等、关闭后无孤儿进程。
