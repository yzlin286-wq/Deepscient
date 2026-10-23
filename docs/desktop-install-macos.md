# macOS 桌面版安装与使用教程

DeepScient 桌面版把科研工作台装进一个独立的 macOS 窗口（官方 DeepSeek Harness 桌面壳承载），与 Windows 版共用同一套数据根与装配规则。

当前版本：`deepscient` 0.12.0、`dsh-science` 0.5.0，桌面壳 `productVersion` 0.2.1-rc.2。

分两条路径：

- **普通用户**：下载自包含安装包，**不需要** Node.js、pnpm 或单独安装 DeepSeek Harness；
- **开发者**：从源码构建桌面壳再派生，见 [deepscient/desktop/README-macos.md](../deepscient/desktop/README-macos.md)。

> 数据根固定为 `~/.deepscient`；`~/.dsh` 与 `/Applications/DeepSeek Harness.app` 一律只读。

---

## 1. 环境要求

| 项 | 要求 |
| --- | --- |
| 系统 | macOS 13 Ventura 或更高 |
| 芯片 | Apple Silicon（arm64）。Intel 机器需按源码文档自行构建 `mac-x64` |
| 磁盘 | 安装后约 1.6 GB（dmg 479 MB / zip 499 MB） |
| 其他 | 无需 Node、pnpm、Xcode；首次登录需要能访问 `deepscient.com` |

## 2. 三步装好

1. 从 [desktop-v0.12.0-macos](https://github.com/yzlin286-wq/Deepscient/releases/tag/desktop-v0.12.0-macos) 下载：
   - `DeepScient-0.12.0-mac-arm64.dmg`（推荐），或
   - `DeepScient-0.12.0-mac-arm64.zip`（免挂载）。
2. 装进「应用程序」：
   - dmg：双击挂载，把 `DeepScient.app` 拖到 `Applications` 快捷方式；
   - zip：解压后把 `DeepScient.app` 拖进「应用程序」（压缩包内的 `启动 DeepScient.command` 可留在解压目录直接用）。
3. 打开 `DeepScient`。首启会自动装配桌面 profile，约 30–60 秒后出现窗口。

### 第一次打开被 Gatekeeper 拦下（正常）

这个包是**未签名构建**（没有 Apple Developer ID），首次打开会提示「无法打开，因为 Apple 无法验证」。任选一种放行：

```bash
# 方式一：Finder 里右键 DeepScient.app → 打开 → 再点一次「打开」

# 方式二：去掉隔离属性（只对这一个应用生效）
xattr -dr com.apple.quarantine /Applications/DeepScient.app
```

之后双击即可直接进。

## 3. 首启与登录

- 首启把包内 `resources/deepscient/deepscient` 与 `resources/deepscient/dsh-science` 以本地 `link:` 装配到 `~/.deepscient/profiles/desktop`；重复启动幂等，缺依赖会自动重装。
- 没登录时窗口是欢迎/登录页；点 **登录 DeepScient** → 系统浏览器打开官网 → 授权后回调 `http://127.0.0.1:<当前端口>/auth/callback` → 窗口自动进入工作台。
- 当前端口由桌面壳分配，每次不同，写在启动日志的 `dsh web:` 行里。
- 已配置模型供应商（`TREEAPI_API_KEY` / `CCAGENT_API_KEY`）时，启动会直接进工作台，不再停在欢迎页。

日志在 `~/.deepscient/logs/`：

| 文件 | 内容 |
| --- | --- |
| `desktop-<时间戳>.log` | 入口脚本：装配、壳进程、实际端口 |
| `desktop-<时间戳>.shell.log` | 壳与 Host 的标准输出（含 `dsh web:` 行） |
| `desktop-<时间戳>.err.log` | 标准错误 |

## 4. 装了什么

```
/Applications/DeepScient.app/Contents/
├─ MacOS/DeepScient                     Electron 壳（应用名与 Bundle ID 已派生）
├─ Info.plist                           com.deepscient.workbench
└─ Resources/
   ├─ app/                              壳主进程与渲染层（asar 已解包）
   ├─ runtime/                          壳自带 node / pnpm / Python 运行时
   ├─ deepscient/deepscient/            DeepScient 宿主（Host API + Web 界面）
   ├─ deepscient/dsh-science/           科研与调度插件
   ├─ deepscient/cli/dsh                包内专用 CLI（指向本包的 DeepScient）
   └─ BUILD-INFO.json                   源壳、版本、文件数、插件入口 sha256
```

数据与 Windows 版同构，都在 `~/.deepscient`：

| 路径 | 内容 |
| --- | --- |
| `profiles/desktop/` | 桌面 profile（依赖、`cordis.patch.yml` 用户补丁层） |
| `science/` | 课题库、战役、证据、交付物 |
| `logs/` | 启动与装配日志 |
| `desktop-userdata/` | 壳的 userData（单实例锁、键位覆盖） |

## 5. 退出、升级、卸载

- **退出**：`⌘Q` 或菜单「退出 DeepScient」。只点窗口红叉时 macOS 会把应用留在 Dock（系统惯例），进程仍在。
- **升级**：退出后把新版本 `DeepScient.app` 拖进「应用程序」覆盖；`~/.deepscient` 不动，课题与登录态保留。
- **卸载**：退出应用 → 把 `DeepScient.app` 移到废纸篓。要连数据一起删再执行 `rm -rf ~/.deepscient`（不可恢复，请先备份课题）。

## 6. 常见问题

| 现象 | 处理 |
| --- | --- |
| 「无法打开，因为 Apple 无法验证」 | 见第 2 节：右键打开，或 `xattr -dr com.apple.quarantine` |
| 双击没反应 / 窗口迟迟不出现 | 等满 60 秒（首启要装配 profile）；仍无窗口就看 `~/.deepscient/logs/desktop-*.err.log` |
| 窗口一直是登录页 | 未登录属预期；点「登录 DeepScient」走浏览器授权。已配供应商密钥时会直接进工作台 |
| 界面显示「重新连接中…」或接口 401 | 确认是从 `DeepScient.app` 启动而非其他窗口；删除 `~/.deepscient/desktop-userdata` 后重开一次 |
| 端口被占用 | 桌面形态由壳自动挑端口；Web 形态在 3081–3099 顺延。两种形态共用数据根，**不要同时开** |
| 想用浏览器界面 | 见下节 Web 形态 |

## 7. Web 形态（可选）

```bash
# 包内 CLI 建一个 web profile（只需一次）
/Applications/DeepScient.app/Contents/Resources/deepscient/cli/dsh plugin --profile deepscient add ./deepscient
/Applications/DeepScient.app/Contents/Resources/deepscient/cli/dsh plugin --profile deepscient add ./dsh-science

# 启动（3081 起顺延，自动开浏览器）
DSH_HOME=~/.deepscient bash path/to/Deepscient/deepscient/bin/deepscient
```

profile 的 `dsh.profile.bundles` 里需要包含 `@deepseek-ai/dsh-web-app`，否则只起 Host、不监听端口。

## 8. 从源码构建（开发者）

前置与命令见 [deepscient/desktop/README-macos.md](../deepscient/desktop/README-macos.md)：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness && pnpm install && pnpm package:desktop:mac:arm64:unsigned

cd Deepscient
bash deepscient/desktop/build-desktop.sh --shell ../deepseek-harness/apps/desktop/.desktop-build/targets/mac-arm64/artifacts/mac-arm64/DeepSeek\ Harness.app
bash deepscient/desktop/assemble-profile.sh
bash deepscient/desktop/deepscient-desktop.sh
```

## 9. 验收口径（0.12.0 实测）

| 项 | 结果 |
| --- | --- |
| 窗口标题 | `DeepScient · 科研工作台` |
| 注册工具 | 47（含 5 个调度工具、3 个本地科学计算工具） |
| `/deepscient/api/health`、`/tools`、`/workflow`、`/presets`、`/sources`、`/docs` | 200 |
| `POST /deepscient/auth/authorize` | 200，`redirect_uri` 指向当前端口 |
| 离线演示 `demo-campaign.mjs --example sleep-wm --seed 42` | t(21)=5.2858、p=3.06e-5、dz=1.1269、n=22，同 seed 重跑 `idempotent: true` |
| 退出 | 主进程与 helper 全部结束，无孤儿进程 |
| `~/.dsh` | 构建与首启前后文件数/字节数不变 |

已知限制：未签名（跨机分发需右键打开）；应用图标沿用壳自带图标；当前产物只覆盖 arm64。
