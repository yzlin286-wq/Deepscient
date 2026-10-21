# DeepScient

**让 AI 与人类一起攻克真正的科学难题。**

DeepScient 是一个跑在 [DeepSeek Harness](https://github.com/deepseek-ai)（dsh）运行时上的**科研工作台**：
它把「选题 → 检索 → 实验 → 分析 → 作图 → 写作 → 投稿 → 审稿回应」做成看得见的 12 个阶段、
55 个可判定的门，配上 36 个科研工具、98 条技能和一套可审计的证据链。

它不是聊天框套壳，也不是论文生成器。它坚持三件事：

- **证据链**：每条结论都要能追到数据、数据要能追到能重跑的实验；`science_*` 工具里没有「编一个数」的出口。
- **可复现**：实验记录、环境、版本、随机种子都落盘，换台机器能重跑出同样的表。
- **人保留判断权**：凡是系统算不出来的（构念效度、创新性、伦理取舍），工具只给检查清单，不替你下结论。

---

## 它长什么样

```
        ┌─────────────────────────────────────────────────┐
        │  DeepScient 工作台（deepscient/）                │
        │  12 阶段 · 55 门 · 课题库 · 计费 · 引导 · 设置   │
        └──────────────┬──────────────────────────────────┘
                       │ 同一个 dsh 运行时，独立数据根/profile/端口
        ┌──────────────┴──────────────────────────────────┐
        │  科研后端（dsh-science/）                        │
        │  36 工具 · 55 门学科数据 · 12 阶段流程定义       │
        │  证据链 / 统计 / 作图 / 写作 / 审稿 / 前沿扫描   │
        └──────────────┬──────────────────────────────────┘
                       │ 技能与外部工具
        ┌──────────────┴──────────────────────────────────┐
        │  98 条技能（随包 17 + 第三方 81）                │
        │  MCP 工具层（可选，papers 23 + pubmed 11）       │
        └─────────────────────────────────────────────────┘
```

两个包各自独立、可分开用：

| 包 | 版本 | 作用 | 依赖 |
|---|---|---|---|
| [`deepscient/`](deepscient/) | 0.4.0 | 产品壳：启动器、Host API、Web 界面、技能与 MCP 装配、验收脚本 | dsh 运行时 + `dsh-science` |
| [`dsh-science/`](dsh-science/) | 0.1.0 | 科研内核：工具、学科数据、流程定义、preset、技能 | 只需 dsh（`@deepseek-ai/cordis`） |

## 快速开始

前置：Windows 10/11、Node ≥ 22.5、已装 DeepSeek Harness 桌面版。

```powershell
git clone https://github.com/yzlin286-wq/Deepscient.git
cd Deepscient

# 1) 把科研后端挂进一个独立 profile（只需一次）
#    在 dsh 会话里执行：
#      plugin_manager install_bundle <仓库根>\dsh-science
#    或打开 dsh 的 Plugins 页，安装本目录下的 dsh-science/

# 2) 从你现有 dsh profile 抽供应商层（不含密钥，只抽 apiKeyEnv 这类变量名）
node scripts/deepscient-sync-models.mjs

# 3) 起实例
deepscient\bin\deepscient.cmd
```

浏览器会自动打开 `http://127.0.0.1:3081`（端口占用则顺延 3082–3099）。首次打开有六步引导，
见 [docs/guide.md](deepscient/docs/guide.md)。

可选：

```powershell
# 装 81 条第三方科研技能（联网一次，pin 到 commit，可校验可卸载）
node deepscient/scripts/install-skills.mjs --plan     # 先看会装什么
node deepscient/scripts/install-skills.mjs --apply    # 真装

# 开 MCP 工具层（多源文献检索 + PubMed 全文）
$env:DSH_ENABLE_MCP = '1'
deepscient\bin\deepscient.cmd
```

## 它能做什么

| 能力 | 规模 | 说明 |
|---|---|---|
| 流程 | 12 阶段 / 55 门 | 每道门对着库里的真实状态判定，不是让模型「觉得可以了」 |
| 工具 | 36 个 | 23 个挂在具体阶段，13 个跨阶段（查历史、溯源、教练、期刊情报、前沿扫描） |
| 学科 | 55 门 | 每门的方法、统计口径、报告规范、常见坑 |
| 技能 | 98 条 | 随包 17 条 + 第三方 81 条（8 个 MIT 仓库，pin 到 commit） |
| 文献源 | 8 个内置 + 自定义 | Crossref / OpenAlex / arXiv / PubMed / Semantic Scholar / Europe PMC 等 |
| MCP | 34 个工具（可选） | `papers` 23 个多源检索下载 + `pubmed` 11 个全文与 MeSH |
| 期刊情报 | 5000+ 刊 | 分区、周期、格式、投稿要求，用于选刊与排版 |

界面里有五个页签：**工作台**（阶段与门）、**课题库**、**接入**（数据源与凭据）、
**计费**（token 真值 + 按你填的价目估算）、**说明**（这套东西怎么用、边界在哪）。

## 仓库结构

```
.
├─ README.md                  ← 你在这里
├─ LICENSE                    MIT
├─ CHANGELOG.md               0.1.0 → 0.4.0
├─ CONTRIBUTING.md            怎么改、怎么验、什么不能提交
├─ ROADMAP.md                 已知边界与后续计划
├─ docs/
│  ├─ README.md               文档总索引（两张包各自的 docs 都在这张表里）
│  ├─ spec.md                 技术规格：实例形态、组合、验收口径
│  └─ third-party.md          81 条第三方技能的来源、许可与署名
├─ deepscient/                产品壳（0.4.0）
│  ├─ bin/                    启动器（PowerShell，必须带 BOM）
│  ├─ host/                   Host API：/health /skills /presets /projects …
│  ├─ client/                 界面
│  ├─ docs/                   9 篇使用文档
│  ├─ scripts/                验收与技能安装（零依赖）
│  ├─ cordis.patch.yml        组合层
│  └─ mcp.patch.yml           MCP 层（默认不加载）
├─ dsh-science/               科研内核（0.1.0）
│  ├─ lib/                    工具注册与流程引擎（ESM）
│  ├─ data/                   55 门学科、统计口径、期刊情报、流程定义
│  ├─ presets/                科研模式 preset
│  ├─ skills/                 随包 17 条技能
│  ├─ skills-vendor/          第三方技能清单（只有 manifest，没有正文）
│  └─ docs/                   7 篇方法论文档
├─ scripts/                   供应商层抽取脚本
├─ tools/                     仓库级工具（打包面校验、发布）
└─ .github/                   CI、Issue/PR 模板、安全策略
```

## 怎么验它真的能用

这个仓库的规矩是：**声称的每一件事都要有一条能跑的命令对上**。

```powershell
# 打包面（零依赖，CI 与本地同一份）：语法、files 完整性、清单 pin、.ps1 BOM、隐私、文档链接
node tools/verify-packaging.mjs

# 活实例验收（需要实例在跑）：294 项 HTTP/文件断言
node deepscient/scripts/verify-deepscient.mjs --token <本次启动的 token>

# 端到端：真 key 真模型真回答 + 建课题 + 预设体检 + 技能与 MCP 装配
node deepscient/scripts/e2e-science-run.mjs --run --base http://127.0.0.1:3081

# 第三方技能安装器自检（10 项）与干跑
node deepscient/scripts/install-skills.mjs --self-test
node deepscient/scripts/install-skills.mjs --plan

# 运行时面的便携性检查（78 个文件：无提示词变量、无本机路径、无私有插件痕迹）
node dsh-science/scripts/verify-portability.mjs

# MCP 服务器单独握手（绕开 dsh，出错时把 npx 的报错打出来）
node deepscient/scripts/probe-mcp.mjs pubmed
```

最近一次全绿记录：打包面 20 项、活实例 294 项（不带 token 285 项）、端到端六段 PASS、
技能清单 81/81 pin 正确、MCP 开启后注册 34 个工具。

## 已知边界

诚实列在这里，也写在 [ROADMAP.md](ROADMAP.md)：

- **headless 不组合 agent preset**，所以「会话里看到几条技能」只能在 Web 会话里验，不能从命令行验。
- **MCP 只验到「工具已注册」**，还没有一次「让模型真的调 `mcp__pubmed__*` 查到一篇」的完整往返记录。
- **界面没做截图回归**：改动后靠人工看一眼，没有像素级基线。
- **只在 Windows 上验证过**。启动器是 PowerShell，`bin/launch.ps1` 依赖 BOM；Linux/macOS 需要另写启动器。

## 路线图

见 [ROADMAP.md](ROADMAP.md)。近期三条：巨型技能包的折叠路由、MCP 真实调用链、界面截图基线。

## 许可与致谢

本仓库代码 MIT，见 [LICENSE](LICENSE)。

第三方技能各自沿用来时许可（全部 MIT 系），清单与署名见 [docs/third-party.md](docs/third-party.md)——
包括 [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills)（42 条）、
[Aperivue/medsci-skills](https://github.com/Aperivue/medsci-skills)（20 条）、
[jxtse/scientific-research-skills](https://github.com/jxtse/scientific-research-skills)（7 条）等 8 个仓库。
它们的正文不进本仓库，装的时候按 commit 拉取并校验 sha256。

运行在 [DeepSeek Harness](https://github.com/deepseek-ai) 之上：组合层、preset、Host API、Web 界面全部复用它的插件体系。
