# 桌面版安装与使用教程

DeepScient 桌面版把科研工作台装进一个独立的 Windows 窗口：双击即开，不依赖浏览器标签页。

当前版本：`deepscient` 0.12.0、`dsh-science` 0.5.0，桌面壳 `productVersion` 0.2.1-rc.2。

分发有两条路径：

- **普通用户**：下载自包含安装包。**不需要 clone 仓库，也不需要单独安装 DeepSeek Harness**。
- **开发者**：从仓库构建，仍复用本机已安装的 DeepSeek Harness 桌面壳。

> 数据根固定为 `%USERPROFILE%\.deepscient`；`%USERPROFILE%\.dsh` 与已安装的 DeepSeek Harness 目录一律只读。

---

## 1. 普通用户：下载安装包（推荐）

下载页：<https://github.com/yzlin286-wq/Deepscient/releases/tag/desktop-v0.12.0>

资产：`DeepScient-desktop-v0.12.0.zip`，约 635 MB。

### 三步开始

1. **下载并解压到短路径**，例如 `D:\DeepScient`。不要放在层层嵌套的目录里——路径过长时 Chromium 会在开窗前崩溃。
2. **双击根目录的 `DeepScient 启动.cmd`**。
3. 点窗口里的 **登录 DeepScient**，在系统浏览器完成官网授权，窗口自动进入工作台。

不需要预装 Node.js、pnpm 或 DeepSeek Harness：安装包是自包含的。

### 首启会发生什么

- 启动脚本把包内 `resources\deepscient\deepscient` 与 `resources\deepscient\dsh-science` 装配成桌面 profile，落到 `%USERPROFILE%\.deepscient\profiles\desktop`；已有且完整时跳过，幂等。
- 实测首启约 30–40 秒出现窗口（含壳启动、profile 装配、Host 起服务），之后启动更快。
- 窗口起来后模型可见 API 工具数 47（含 5 个调度工具与 3 个本地科学计算工具）。
- 启动日志：`%USERPROFILE%\.deepscient\logs\desktop-<时间戳>.log`（同目录另有 `.shell.log` / `.err.log`）。
- 首次装配与启动**不依赖网络**：插件是包内本地 `link:` 目录，pnpm 不会下载任何东西。

### 安装包结构

| 路径 | 内容 |
| --- | --- |
| `DeepScient.exe` | Electron 桌面壳 |
| `DeepScient 启动.cmd` | 入口：设 `DSH_HOME` / `DEEPSCIENT_DESKTOP`、起壳、写日志 |
| `resources\deepscient\deepscient` | DeepScient 宿主（Host API + Web 界面） |
| `resources\deepscient\dsh-science` | 科研与调度插件（工具、preset、学科数据、技能） |
| `resources\deepscient\cli\dsh.cmd` | 打包专用 CLI，指向本包的 `DeepScient.exe` |

---

## 2. 开发者：从仓库构建

前置条件：

| 依赖 | 要求 | 用途 |
| --- | --- | --- |
| Windows | 10 / 11 x64 | 桌面壳只提供 Windows 构建 |
| DeepSeek Harness 桌面端 | 已安装（`%LOCALAPPDATA%\Programs\DeepSeek Harness\`） | 仓库构建形态复用它提供 Electron 壳与 dsh 运行时 |
| Node.js | ≥ 22.5 | 跑装配/构建脚本与本地工具 |
| Python | ≥ 3.10（可选） | `local_numeric` / `local_symbolic` 用 numpy / scipy / sympy |

```powershell
git clone https://github.com/yzlin286-wq/Deepscient.git
cd Deepscient

# ① 装配桌面 profile（写到 ~/.deepscient/profiles/desktop，幂等）
powershell -NoProfile -ExecutionPolicy Bypass -File deepscient/desktop/assemble-profile.ps1

# ② 构建独立应用（复制壳到 %LOCALAPPDATA%\Programs\DeepScient，约 1.5 GB）
powershell -NoProfile -ExecutionPolicy Bypass -File deepscient/desktop/build-desktop.ps1

# ③ 生成桌面快捷方式（「DeepScient 科研工作台」「… - 桌面版」）
powershell -NoProfile -ExecutionPolicy Bypass -File deepscient/desktop/deepscient-desktop.ps1 -CreateShortcuts
```

想自测「打包形态」是否等价于安装包，用 `deepscient/desktop/release-github.ps1` 打一个 zip：

```powershell
# 只打包不上传，产物在 dist\release\DeepScient-<tag>.zip
powershell -NoProfile -ExecutionPolicy Bypass -File deepscient/desktop/release-github.ps1 -Tag desktop-selftest -SkipUpload
```

解压到另一个短路径，双击或运行其中的 `DeepScient 启动.cmd`，即可验证「别人拿到 zip 能不能直接用」。

---

## 3. 数据与隔离

| 路径 | 内容 |
| --- | --- |
| `%USERPROFILE%\.deepscient\` | 数据根：课题库、实验、稿件、技能、登录 token |
| `%USERPROFILE%\.deepscient\profiles\desktop\` | 桌面 profile（bundles + `cordis.patch.yml` 供应商层），首启自动装配 |
| `%USERPROFILE%\.deepscient\logs\` | 启动日志 `desktop-<时间戳>.log` / `.shell.log` / `.err.log` |
| `%USERPROFILE%\.deepscient\science\campaigns\` | 调度层产生的 campaign（`deliverables/` 下有报告、稿件、图、证据） |
| `%LOCALAPPDATA%\Programs\DeepScient\` | 仓库构建形态的派生应用实体（可随时重建，不含用户数据） |
| `<仓库>\dist\DeepScient` | 指向上面实体的 junction（Windows 快捷方式用） |

隔离约束（构建与首启前后实测一致）：

- `%USERPROFILE%\.dsh` 与已安装的 DeepSeek Harness 目录**只读**，文件数与字节数在构建、首启前后完全一致；
- **两种形态不要同时开**：桌面形态与 `deepscient/bin/launch.ps1` 的 Web 回退形态共用同一个数据根，并行会抢 SQLite 与会话文件。

---

## 4. 启动与登录

1. 双击 `DeepScient 启动.cmd`（仓库构建形态则双击桌面「DeepScient 科研工作台」）；
2. 窗口标题为 `DeepScient · 科研工作台`，未登录时显示登录卡片；
3. 点 **登录 DeepScient** → 系统浏览器打开 deepscient.com 授权页 → 授权完成；
4. 回到窗口，**无需手动刷新**：工作台每 2 秒对一次 `/deepscient/auth/state`，看到登录态就自动重载进入。

重复双击不会开第二个后端：新进程把窗口交给已有实例后退出；入口日志会写「桌面壳已交给已有实例」。

---

## 5. 调度层（M7）

`dsh-science` 内的 orchestra 负责把一个大课题拆成可并行、可恢复、可审计的科研生产链。

**编制：4 级 13 岗**——`pi` / `lead` / `project-manager` / `survey` / `strategist` / `experimenter` / `analyst` / `data-steward` / `methodologist` / `writer` / `critic` / `rebuttal` / `shard-worker`。

**工具（5 个）**：

| 工具 | 作用 |
| --- | --- |
| `science_org_chart` | 查看 4 级 13 岗编制与汇报关系 |
| `science_campaign_plan` | 把课题拆成 Campaign → Workstream → Task → Shard 的计划 |
| `science_campaign_run` | 启动/推进 campaign（原子领取 + 租约 + 心跳） |
| `science_campaign_status` | 查看进度、租约、背压与预算状态 |
| `science_campaign_report` | 汇总产出与统计 |

**新增岗位 preset**：`science-lead`、`science-data-steward`、`science-methodologist`。

**拆分层级**：Campaign → Workstream（S0/S1/S2/S6/S7/S8/S9）→ Task（12 类）→ Shard（默认 138，可扩到 12,000+）。

**执行语义**：原子领取、租约、心跳、指数退避、背压、预算熔断、崩溃恢复。逻辑槽位 10k+；物理并发 `local = CPU-1`、`llm = 6`。

### 离线演示

安装包里带一份可离线跑通的 campaign 示例（用系统 `node`，在解压目录内执行）：

```powershell
node "D:\DeepScient\resources\deepscient\dsh-science\scripts\demo-campaign.mjs" --example sleep-wm --seed 42
```

产出落在 `<DSH_HOME>\science\campaigns\<id>\deliverables\`：`report.md` / `paper.md` / `evidence.json` / `manifest.json` / `figures/*.pdf,png`；同 seed 重跑标记 `idempotent: true`。

实测统计（`--example sleep-wm --seed 42`）：n=22、t(21)=5.2858、p=3.06e-5、Cohen's dz=1.1269。

**边界**：

- 10k 是**逻辑智能体槽位**，不是 10k 并发 LLM 请求；
- LLM 产出必须过 gate 才算数；
- 无网络时文献层显式标记缺口，不伪造 DOI。

---

## 6. 本地科学计算工具

桌面版内置三个本地工具（不联网，模型可在科研模式里直接调用）：

| 工具 | 能做什么 |
| --- | --- |
| `local_compute_devices` | 探测 python / numpy / scipy / sympy / torch，报告 CUDA、MPS（仅 macOS）、CPU 是否可用，并给出推荐后端（CUDA → MPS → CPU） |
| `local_numeric` | 描述统计（含 95% CI）、矩阵（行列式/秩/逆/乘法）、特征值、线性方程组、数值积分、最优化、FFT |
| `local_symbolic` | 化简、求导（可指定阶数）、不定/定积分、解方程、级数展开、LaTeX 输出 |

说明：

- 解释器默认是 PATH 上的 `python`，可用环境变量 `DEEPSCIENT_PYTHON` 指定；
- 缺包时返回具体缺项（不是异常栈），装完即用；建议 `python -m pip install numpy scipy sympy`；
- 工具页「工具」里的 S7 统计分析阶段能看到这三个名字。

---

## 7. 清理残留课题

内置排查/自检产生的课题可以一键清理（默认只清 `e2e-链路自检*`）：

```powershell
# 先看会删什么
node deepscient/scripts/purge-projects.mjs --dry-run

# 真正执行：先导出 JSON 备份到 ~/.deepscient/backup/，再删库与课题目录
node deepscient/scripts/purge-projects.mjs --apply

# 换成别的匹配前缀，并保留某个课题
node deepscient/scripts/purge-projects.mjs --apply --pattern my-test- --keep <课题 id>
```

---

## 8. 常见问题

**首启装配失败 / 窗口一直不出来，怎么看日志**
先看 `%USERPROFILE%\.deepscient\logs\desktop-<时间戳>.log`，再翻同目录的 `.shell.log`（壳自身输出）与 `.err.log`（stderr）。入口脚本在判定失败后才回退 Web 形态，日志里会写清失败阶段（装配 / 起壳 / 起 Host）。

**profile 依赖缺失会不会要手动修**
不会。首启时若 `profiles\desktop` 缺失或依赖丢失，启动脚本会自动重新装配；装配是幂等的，不覆盖用户数据。

**包里的 `cli\dsh.cmd` 是干什么的**
打包专用 CLI，指向安装包内的 `DeepScient.exe`，用法与桌面壳自带 CLI 一致，例如：

```powershell
& "D:\DeepScient\resources\deepscient\cli\dsh.cmd" plugin --profile desktop list
```

它服务于安装包自身，不需要再用仓库里的脚本。

**解压后要占多少磁盘**
zip 约 635 MB，解压约 1.8 GB——zip 内的 runtime junction 被 tar 解引用，同一份运行时会在包内多存一份。这是已知的、可接受的代价。

**界面是裸文本、样式全丢**
桌面壳从本地 dist 出首屏，拿不到 `tapIndex` 注入的样式。正常版本会自动 `link` 到 `/deepscient/ui.css`。若仍是裸文本，确认 `deepscient/host/index.js` 里有这条 exact 路由，并重启窗口。

**登录成功但窗口还是登录页**
确认入口设置了 `DEEPSCIENT_DESKTOP=1`（`DeepScient 启动.cmd` 与 `deepscient-desktop.ps1` 均已内置）。桌面形态用磁盘 token 认身份；没有这个标记会一直 401。

**双击就退出（0x80000003）**
路径太长。Chromium 解析壳内深层 `node_modules` 会突破 MAX_PATH，所以安装包要解压到短路径（如 `D:\DeepScient`），仓库构建形态的实体也固定放在 `%LOCALAPPDATA%\Programs\DeepScient`。

**端口冲突**
桌面壳自己向上游要空闲端口（每次不同，日志里会写实际 `http://127.0.0.1:<port>`），不占用 3081–3099；只有 Web 回退形态才在这些端口里顺延。

**想回到 Web 形态**
```powershell
powershell -File deepscient/bin/launch.ps1 -Port 3081
```

---

## 9. 重新构建

- **安装包形态**：直接下载新版 zip 解压到新目录即可；数据在 `%USERPROFILE%\.deepscient`，不受影响。
- **仓库构建形态**：本机 DeepSeek Harness 升级或仓库更新后，重跑 `assemble-profile.ps1` → `build-desktop.ps1` 即可（幂等：只覆盖壳与 `resources`，保留 `~/.deepscient` 里的用户数据）。

版本与源哈希记录在 `deepscient/desktop/source.lock.json`，构建元数据在 `dist\DeepScient\BUILD-INFO.json`。
