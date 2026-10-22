# DeepScient 桌面版（deepscient/desktop）

把已存在的科研工作台插件（`@local/deepscient`）装进 Windows 桌面窗口，复用官方 DeepSeek Harness 桌面壳，不重新实现 UI。

## 形态对比

| 维度 | Web 形态（既有） | 桌面形态（本目录） |
| --- | --- | --- |
| 启动方式 | `deepscient/bin/launch.ps1` 起 dsh Web 服务 + 外部浏览器 | 官方 Electron 壳 `DeepSeek Harness.exe`，窗口内加载同一套 Web UI |
| 数据根 | `%USERPROFILE%\.deepscient` | 同左（同一批课题，两种形态可互换） |
| profile | `deepscient` | `desktop`（`DSH_PROFILE` 默认值，桌面壳固定使用） |
| profile 路径 | `~/.deepscient/profiles/deepscient` | `~/.deepscient/profiles/desktop` |
| 端口 | 固定 3081（占用时 3081–3099 顺延） | 壳自己向上游要一个空闲端口，启动器把实际 origin 写进日志 |
| 鉴权 | 无（本地回环） | 壳内注入设备 cookie；实测桌面形态只认磁盘 token（见「会话与登录」） |
| 日志 | 终端输出 | `~/.deepscient/logs/desktop-<yyyyMMdd-HHmmss>.log` |

## 关键路径

- 桌面壳安装目录（**只读**）：`%LOCALAPPDATA%\Programs\DeepSeek Harness\`
- 壳入口：`DeepSeek Harness.exe`（Electron，加载 `resources/app`）
- 壳主进程：`resources/app/lib/main.js`
- 桌面自带 CLI：`resources/runtime/cli/bin/dsh.cmd`
  - 用法：`dsh.cmd plugin --profile desktop add <path>`（`--profile` 首次使用会自动初始化 profile）
- 本机 dsh 运行时：`resources/app/dsh/node_modules`（304 个共享包 / 17261 个文件）

## 三条硬约束

1. **不改安装目录**：`%LOCALAPPDATA%\Programs\DeepSeek Harness\` 全部只读，桌面化只允许读取其中文件、复制到 `dist/` 派生目录后再改副本。
2. **不改 `~/.dsh`**：用户日常 DeepSeek Harness 的 profile 与配置一律不动；DeepScient 桌面形态只写 `~/.deepscient`。
3. **不同时双开同一份数据根**：桌面壳用单实例锁（按 userData 生效），Web 形态与桌面形态共用 `~/.deepscient` 时不要并行运行，避免课程库/会话文件互相覆盖。

## 基线锁定

`source.lock.json` 记录桌面壳版本（当前 `0.2.1-rc.2`）、构建 commit、关键文件 SHA-256/字节数。升级安装包后需重新采集，再重建 `dist/DeepScient/`。

## 脚本

| 脚本 | 作用 |
| --- | --- |
| `assemble-profile.ps1` | 初始化并装配 `~/.deepscient/profiles/desktop`（bundles + 供应商层 patch + 桌面必需的 account 覆写），幂等 |
| `deepscient-desktop.ps1` | 桌面入口：设 `DSH_HOME` / `DEEPSCIENT_DESKTOP`、单实例检查、起壳、记录实际端口、写日志、失败回退 Web 形态、`-CreateShortcuts` 建快捷方式 |
| `build-desktop.ps1` | 从安装目录派生独立应用（默认 `%LOCALAPPDATA%\Programs\DeepScient`，`dist\DeepScient` 为指向它的 junction） |

## 会话与登录（桌面形态的关键差异）

桌面壳转发请求时会把 `Cookie` 头整个换成设备 cookie，而 OAuth 回调落在系统浏览器里，所以 `deepscient_session` 这条会话 cookie **到不了后端**，表现为窗口里 API 全 401、`/api/remote.mux` 握手 401、界面一直「重新连接中...」。

处理方式：`deepscient-desktop.ps1` 给壳进程设 `DEEPSCIENT_DESKTOP=1`，`host/oauth.js` 的 `currentLogin()` 在这个标记下以磁盘 token（`~/.deepscient/science/oauth/token.json`）作为本机身份。Web 形态不设该变量，会话仍然只认 cookie，行为不变。

登录流程不变：点「登录 DeepScient」→ 系统浏览器打开 deepscient.com → 回调到 `http://127.0.0.1:<当前端口>/auth/callback` → token 落盘 → 工作台每 2 秒轮询 `/deepscient/auth/state`，发现已登录后自动重载进入工作台。

桌面形态的细节：壳的 `setWindowOpenHandler` 会把 http(s) 外链交给系统浏览器并拒绝建窗（`window.open` 返回 null），而 `will-navigate` 又会拦下 `location.href` 跳转。所以客户端在 `dsh-app:` 下点登录后**只进入轮询等待、不导航**；另外窗口重新获得焦点或从隐藏变可见时会再对一次状态，作为轮询之外的后备。授权成功后无需手动刷新。

桌面形态同样拿不到 `webServer.tapIndex` 注入的 `<style data-deepscient="ui">`（视觉层 CSS），首屏会退化成裸文本。现在 host 提供 `GET /deepscient/ui.css`，客户端在缺少该 `<style>` 时自行 `<link>` 过去，两种形态共用同一份样式。

单实例与回退：桌面壳第二次启动会把窗口交给已有实例后立刻退出。入口脚本在判定「提前退出」时会先复查同 userData 的实例，存在就记「桌面壳已交给已有实例」并正常退出，**不再**误回退到浏览器形态。

## 实测数据（2026-10-22，Windows 11 / 本机）

| 项 | 实测值 |
| --- | --- |
| 冷启动到窗口可交互 | 约 22–30 秒（含壳启动 + dsh host 起 Web 服务 + 插件装配） |
| 桌面端口 | 由壳分配，本轮实测 `51010` / `59952`（每次不同，不占 3081–3099） |
| 日志 | `~/.deepscient/logs/desktop-<yyyyMMdd-HHmmss>.log`（另有 `.shell.log` / `.err.log`） |
| 窗口标题 | `DeepScient · 科研工作台` |
| 品牌标记 | `meta[data-deepscient="brand"]` 在桌面形态由客户端补齐（壳从本地 dist 出首屏，绕过 `webServer.tapIndex`） |
| 课题库 | `/deepscient/api/projects` → 200，读到 `~/.deepscient` 既有 6 个课题 |
| 六页 | 工作台 / 流程 / 工具 / 计费 / 接入 / 说明 均可在窗口内打开，无登录遮挡 |
| OAuth | `POST /deepscient/auth/authorize` → 200，`redirect_uri=http://127.0.0.1:<当前端口>/auth/callback`，PKCE challenge 43 字符 |
| 回归 | `node deepscient/scripts/verify-deepscient.mjs --url http://127.0.0.1:3081 --token <token>` → 354 项全绿 |
| 派生应用 | `dist\DeepScient\`（junction）→ `%LOCALAPPDATA%\Programs\DeepScient`，26,126 文件 / 1,527,225,980 字节，构建约 16 秒 |
| 关闭窗口 | DeepScient.exe 及其 renderer/GPU/utility 子进程全部退出，无孤儿进程 |

### 已知限制

1. **派生目录不能放在仓库里**：Chromium 启动时要解析壳内深层 `node_modules` 路径，仓库根在 `Documents` 下会突破 MAX_PATH，进程在开窗前崩（`0x80000003`）。所以实体在 `%LOCALAPPDATA%\Programs\DeepScient`，`dist\DeepScient` 只是 junction。
2. **首次装配要装依赖**：`assemble-profile.ps1` 会让桌面自带 CLI 建 `node_modules`，首次需要网络；之后的运行幂等。
3. **两种形态不能同时开**：共用 `~/.deepscient`，并行会抢 SQLite 与会话文件。
4. **`~/.dsh` 的写入者是用户日常运行的 DeepSeek Harness**，不是本目录脚本；全部脚本只写 `~/.deepscient` 与派生目录。
