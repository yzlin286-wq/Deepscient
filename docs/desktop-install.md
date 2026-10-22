# 桌面版安装与使用教程

DeepScient 桌面版把科研工作台装进一个独立的 Windows 窗口：双击图标即开，不依赖浏览器标签页。
它复用官方 **DeepSeek Harness** 桌面壳（Electron），数据根、profile、端口都与日常的 DeepSeek Harness 完全隔离。

> 数据根固定为 `%USERPROFILE%\.deepscient`；`%USERPROFILE%\.dsh` 与已安装的 DeepSeek Harness 一律只读。

---

## 1. 前置条件

| 依赖 | 要求 | 用途 |
| --- | --- | --- |
| Windows | 10 / 11 x64 | 桌面壳只提供 Windows 构建 |
| DeepSeek Harness 桌面端 | 已安装（`%LOCALAPPDATA%\Programs\DeepSeek Harness\`） | 提供 Electron 壳与 dsh 运行时 |
| Node.js | ≥ 22.5 | 跑装配/构建脚本与本地工具 |
| Python | ≥ 3.10（可选） | `local_numeric` / `local_symbolic` 用 numpy / scipy / sympy |

Python 包建议：

```powershell
python -m pip install numpy scipy sympy
```

有 GPU 时再装对应框架（`torch`）；工具会自己探测 CUDA / MPS / CPU，不装也能用 CPU。

---

## 2. 安装（三步）

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

也可以直接从 [Releases](https://github.com/yzlin286-wq/Deepscient/releases) 下载打包好的 zip，解压后双击 `DeepScient.exe`。
首次启动仍需执行一次 ①（profile 在数据根里，不在安装目录）。

---

## 3. 启动与登录

1. 双击桌面「DeepScient 科研工作台」；
2. 窗口标题为 `DeepScient · 科研工作台`，未登录时显示登录卡片；
3. 点 **登录 DeepScient** → 系统浏览器打开 deepscient.com 授权页 → 授权完成；
4. 回到窗口，**无需手动刷新**：工作台每 2 秒对一次 `/deepscient/auth/state`，看到登录态就自动重载进入。

重复双击不会开第二个后端：新进程把窗口交给已有实例后退出；入口日志会写「桌面壳已交给已有实例」。

---

## 4. 数据与隔离

| 路径 | 内容 |
| --- | --- |
| `%USERPROFILE%\.deepscient\` | 数据根：课题库、实验、稿件、技能、登录 token |
| `%USERPROFILE%\.deepscient\profiles\desktop\` | 桌面 profile（bundles + `cordis.patch.yml` 供应商层） |
| `%USERPROFILE%\.deepscient\logs\` | 启动日志 `desktop-<时间戳>.log` / `.shell.log` / `.err.log` |
| `%LOCALAPPDATA%\Programs\DeepScient\` | 派生应用实体（可随时重建，不含用户数据） |
| `<仓库>\dist\DeepScient` | 指向上面实体的 junction（Windows 快捷方式用） |

**两种形态不要同时开**：桌面形态与 `deepscient/bin/launch.ps1` 的 Web 形态共用同一个数据根。

---

## 5. 本地科学计算工具

桌面版内置三个本地工具（不联网，模型可在科研模式里直接调用）：

| 工具 | 能做什么 |
| --- | --- |
| `local_compute_devices` | 探测 python / numpy / scipy / sympy / torch，报告 CUDA、MPS（仅 macOS）、CPU 是否可用，并给出推荐后端（CUDA → MPS → CPU） |
| `local_numeric` | 描述统计（含 95% CI）、矩阵（行列式/秩/逆/乘法）、特征值、线性方程组、数值积分、最优化、FFT |
| `local_symbolic` | 化简、求导（可指定阶数）、不定/定积分、解方程、级数展开、LaTeX 输出 |

说明：

- 解释器默认是 PATH 上的 `python`，可用环境变量 `DEEPSCIENT_PYTHON` 指定；
- 缺包时返回具体缺项（不是异常栈），装完即用；
- 工具页「工具」里的 S7 统计分析阶段能看到这三个名字。

---

## 6. 清理残留课题

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

## 7. 常见问题

**窗口没有出现 / 一闪而过**
看 `~/.deepscient/logs/desktop-*.log` 与 `.shell.log`；入口脚本在判定失败后才回退 Web 形态，日志里会写失败阶段。

**界面是裸文本、样式全丢**
桌面壳从本地 dist 出首屏，拿不到 `tapIndex` 注入的样式。正常版本会自动 `link` 到 `/deepscient/ui.css`。若仍是裸文本，确认 `deepscient/host/index.js` 里有这条 exact 路由，并重启窗口。

**登录成功但窗口还是登录页**
确认入口脚本设置了 `DEEPSCIENT_DESKTOP=1`（`deepscient-desktop.ps1` 已内置）。桌面形态用磁盘 token 认身份；没有这个标记会一直 401。

**构建产物双击就退出（0x80000003）**
派生目录路径太长。Chromium 解析壳内深层 `node_modules` 会突破 MAX_PATH，所以实体必须放在短路径（默认 `%LOCALAPPDATA%\Programs\DeepScient`），不要直接放在仓库里。

**端口冲突**
桌面壳自己向上游要空闲端口（每次不同，日志里会写实际 `http://127.0.0.1:<port>`），不占用 3081–3099；只有 Web 回退形态才在这些端口里顺延。

**想回到 Web 形态**
```powershell
powershell -File deepscient/bin/launch.ps1 -Port 3081
```

---

## 8. 重新构建

安装的 DeepSeek Harness 升级后，重新跑一次 `build-desktop.ps1` 即可（幂等：只覆盖壳与 `resources`，保留 `~/.deepscient` 里的用户数据）。
版本与源哈希记录在 `deepscient/desktop/source.lock.json`，构建元数据在 `dist\DeepScient\BUILD-INFO.json`。
