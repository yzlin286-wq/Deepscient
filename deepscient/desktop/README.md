# DeepScient 桌面版（deepscient/desktop）

把科研工作台插件（`@local/deepscient`）装进 Windows 桌面窗口，复用 DeepSeek Harness 桌面壳（Electron），不重新实现 UI。

当前版本：`deepscient` 0.12.0、`dsh-science` 0.5.0，桌面壳 `productVersion` 0.2.1-rc.2。

## 两种桌面形态

| | 安装包形态（普通用户） | 仓库构建形态（开发者） |
| --- | --- | --- |
| 获取 | 下载 [`DeepScient-desktop-v0.12.0.zip`](https://github.com/yzlin286-wq/Deepscient/releases/tag/desktop-v0.12.0)（约 635 MB） | `git clone` 后跑本目录脚本 |
| 前置 | 无（自包含，不需要 Node / pnpm / DeepSeek Harness） | 已装 DeepSeek Harness 桌面端 + Node ≥ 22.5 |
| 启动 | 解压后双击根目录 `DeepScient 启动.cmd` | `deepscient-desktop.ps1` 或桌面快捷方式 |
| profile | 首启从包内 `resources\deepscient\*` 自动装配 | `assemble-profile.ps1` 装配 |
| 实体位置 | 解压目录本身 | `%LOCALAPPDATA%\Programs\DeepScient`，`dist\DeepScient` 为 junction |

## 形态对比

| 维度 | Web 形态（既有） | 桌面形态（本目录） |
| --- | --- | --- |
| 启动方式 | `deepscient/bin/launch.ps1` 起 dsh Web 服务 + 外部浏览器 | Electron 壳 `DeepScient.exe`（安装包）或 `DeepSeek Harness.exe`（仓库构建），窗口内加载同一套 Web UI |
| 数据根 | `%USERPROFILE%\.deepscient` | 同左（同一批课题，两种形态可互换） |
| profile | `deepscient` | `desktop`（`DSH_PROFILE` 默认值，桌面壳固定使用） |
| profile 路径 | `~/.deepscient/profiles/deepscient` | `~/.deepscient/profiles/desktop` |
| 端口 | 固定 3081（占用时 3081–3099 顺延） | 壳自己向上游要一个空闲端口，启动器把实际 origin 写进日志 |
| 鉴权 | 无（本地回环） | 壳内注入设备 cookie；桌面形态只认磁盘 token（见「会话与登录」） |
| 日志 | 终端输出 | `~/.deepscient/logs/desktop-<yyyyMMdd-HHmmss>.log` |

## 安装包目录结构

```
<解压目录>\
├─ DeepScient.exe                        Electron 壳
├─ DeepScient 启动.cmd                   入口：DSH_HOME / DEEPSCIENT_DESKTOP、起壳、写日志
├─ resources\
│  ├─ app\                               壳的主进程与渲染层（as-is 复制自桌面壳）
│  ├─ runtime\                           壳自带 node/pnpm 运行时
│  └─ deepscient\
│     ├─ deepscient\                     DeepScient 宿主（Host API + Web 界面）
│     ├─ dsh-science\                    科研与调度插件（含 scripts\demo-campaign.mjs）
│     └─ cli\dsh.cmd                     打包专用 CLI，指向本包 DeepScient.exe
└─ ...
```

- `cli\dsh.cmd` 只在包内有效：它把命令交给同包的 `DeepScient.exe`，不要拿它去操作本机已装的 DeepSeek Harness；
- 解压时 zip 内的 runtime junction 会被 tar 解引用，磁盘占用约 1.8 GB（zip 635 MB）。

## 首启装配与修复

1. `DeepScient 启动.cmd` 设 `DSH_HOME=%USERPROFILE%\.deepscient`、`DSH_PROFILE=desktop`、`DEEPSCIENT_DESKTOP=1`；
2. 检查 `%USERPROFILE%\.deepscient\profiles\desktop`；缺失或不完整时，把包内 `resources\deepscient\deepscient` 与 `resources\deepscient\dsh-science` 以本地 `link:` 方式装配进去（幂等）；
3. 起壳、等 Host 起来、写出实际端口；失败才回退 Web 形态，日志里记失败阶段；
4. 实测首启约 30–40 秒出窗口，API 工具数 47；**首次装配与启动不需要网络**（插件是本地目录，pnpm 无下载）；
5. 依赖丢失（例如 profile 里的 `node_modules` 被删）会在下次启动时自动重新装配，不需要手工修；
6. 日志在 `%USERPROFILE%\.deepscient\logs\desktop-<时间戳>.log`，同目录另有 `.shell.log`（壳自身输出）与 `.err.log`（stderr）。

## 关键路径

- 桌面壳安装目录（仓库构建形态，**只读**）：`%LOCALAPPDATA%\Programs\DeepSeek Harness\`
- 壳入口：`DeepSeek Harness.exe`（Electron，加载 `resources/app`）
- 壳主进程：`resources/app/lib/main.js`
- 桌面自带 CLI：`resources/runtime/cli/bin/dsh.cmd`
  - 用法：`dsh.cmd plugin --profile desktop add <path>`（`--profile` 首次使用会自动初始化 profile）
- 本机 dsh 运行时：`resources/app/dsh/node_modules`（304 个共享包 / 17261 个文件）

## 三条硬约束

1. **不改安装目录**：`%LOCALAPPDATA%\Programs\DeepSeek Harness\` 全部只读，桌面化只允许读取其中文件、复制到派生目录后再改副本。
2. **不改 `~/.dsh`**：用户日常 DeepSeek Harness 的 profile 与配置一律不动；DeepScient 桌面形态只写 `~/.deepscient`。构建与首启前后实测 `~/.dsh` 与已装目录的文件数/字节数完全一致。
3. **不同时双开同一份数据根**：桌面壳用单实例锁（按 userData 生效），Web 形态与桌面形态共用 `~/.deepscient` 时不要并行运行，避免课题库/会话文件互相覆盖。

## 基线锁定

`source.lock.json` 记录桌面壳版本（当前 `0.2.1-rc.2`）、构建 commit、关键文件 SHA-256/字节数。升级安装包后需重新采集，再重建派生目录。

## 脚本

| 脚本 | 作用 |
| --- | --- |
| `assemble-profile.ps1` | 初始化并装配 `~/.deepscient/profiles/desktop`（bundles + 供应商层 patch + 桌面必需的 account 覆写），幂等 |
| `deepscient-desktop.ps1` | 桌面入口：设 `DSH_HOME` / `DEEPSCIENT_DESKTOP`、单实例检查、起壳、记录实际端口、写日志、失败回退 Web 形态、`-CreateShortcuts` 建快捷方式 |
| `build-desktop.ps1` | 从安装目录派生独立应用（默认 `%LOCALAPPDATA%\Programs\DeepScient`，`dist\DeepScient` 为指向它的 junction） |
| `release-github.ps1` | 打 zip（`tar -a`）、建 GitHub Release、流式上传资产；`-SkipUpload` 可只打包，用于自测打包形态 |

## 会话与登录（桌面形态的关键差异）

桌面壳转发请求时会把 `Cookie` 头整个换成设备 cookie，而 OAuth 回调落在系统浏览器里，所以 `deepscient_session` 这条会话 cookie **到不了后端**，表现为窗口里 API 全 401、`/api/remote.mux` 握手 401、界面一直「重新连接中...」。

处理方式：入口（`DeepScient 启动.cmd` / `deepscient-desktop.ps1`）给壳进程设 `DEEPSCIENT_DESKTOP=1`，`host/oauth.js` 的 `currentLogin()` 在这个标记下以磁盘 token（`~/.deepscient/science/oauth/token.json`）作为本机身份。Web 形态不设该变量，会话仍然只认 cookie，行为不变。

登录流程不变：点「登录 DeepScient」→ 系统浏览器打开 deepscient.com → 回调到 `http://127.0.0.1:<当前端口>/auth/callback` → token 落盘 → 工作台每 2 秒轮询 `/deepscient/auth/state`，发现已登录后自动重载进入工作台。

桌面形态的细节：壳的 `setWindowOpenHandler` 会把 http(s) 外链交给系统浏览器并拒绝建窗（`window.open` 返回 null），而 `will-navigate` 又会拦下 `location.href` 跳转。所以客户端在 `dsh-app:` 下点登录后**只进入轮询等待、不导航**；另外窗口重新获得焦点或从隐藏变可见时会再对一次状态，作为轮询之外的后备。授权成功后无需手动刷新。

桌面形态同样拿不到 `webServer.tapIndex` 注入的 `<style data-deepscient="ui">`（视觉层 CSS），首屏会退化成裸文本。host 提供 `GET /deepscient/ui.css`，客户端在缺少该 `<style>` 时自行 `<link>` 过去，两种形态共用同一份样式。

单实例与回退：桌面壳第二次启动会把窗口交给已有实例后立刻退出。入口脚本在判定「提前退出」时会先复查同 userData 的实例，存在就记「桌面壳已交给已有实例」并正常退出，**不再**误回退到浏览器形态。

## 实测数据（2026-10-23，Windows 11 / 本机）

| 项 | 实测值 |
| --- | --- |
| 安装包 zip | 约 635 MB；解压后约 1.8 GB（runtime junction 被解引用） |
| 首启到窗口可交互 | 约 30–40 秒（含壳启动 + profile 装配 + Host 起 Web 服务） |
| API 工具数 | 47（含 5 个调度工具、3 个本地科学计算工具） |
| 桌面端口 | 由壳分配，每次不同，不占 3081–3099 |
| 日志 | `~/.deepscient/logs/desktop-<yyyyMMdd-HHmmss>.log`（另有 `.shell.log` / `.err.log`） |
| 窗口标题 | `DeepScient · 科研工作台` |
| 品牌标记 | `meta[data-deepscient="brand"]` 在桌面形态由客户端补齐（壳从本地 dist 出首屏，绕过 `webServer.tapIndex`） |
| 课题库 | `/deepscient/api/projects` → 200，读到 `~/.deepscient` 既有课题 |
| 六页 | 工作台 / 流程 / 工具 / 计费 / 接入 / 说明 均可在窗口内打开，无登录遮挡 |
| OAuth | `POST /deepscient/auth/authorize` → 200，`redirect_uri=http://127.0.0.1:<当前端口>/auth/callback`，PKCE challenge 43 字符 |
| 离线演示 | `node resources\deepscient\dsh-science\scripts\demo-campaign.mjs --example sleep-wm --seed 42` → n=22、t(21)=5.2858、p=3.06e-5、Cohen's dz=1.1269，同 seed 重跑 `idempotent: true` |
| 关闭窗口 | `DeepScient.exe` 及其 renderer/GPU/utility 子进程全部退出，无孤儿进程 |

## 已知限制

1. **必须解压到短路径**：Chromium 启动时要解析壳内深层 `node_modules` 路径，深层目录（尤其长中文路径）会突破 MAX_PATH，进程在开窗前崩（`0x80000003`）。安装包请放 `D:\DeepScient` 这类位置；仓库构建形态的实体固定在 `%LOCALAPPDATA%\Programs\DeepScient`。
2. **磁盘占用 1.8 GB**：zip 635 MB，解压后 runtime junction 被 tar 解引用，同一份运行时会重复存储。
3. **两种形态不能同时开**：共用 `~/.deepscient`，并行会抢 SQLite 与会话文件。
4. **`~/.dsh` 的写入者是用户日常运行的 DeepSeek Harness**，不是本目录脚本；全部脚本只写 `~/.deepscient` 与派生/解压目录。
5. **安装包不需要本机 DeepSeek Harness**；仓库构建形态仍然复用本机桌面壳，壳升级后要重跑 `assemble-profile.ps1` → `build-desktop.ps1`。
