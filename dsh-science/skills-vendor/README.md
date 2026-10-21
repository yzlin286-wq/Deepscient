# 第三方科研技能清单（skills-vendor）

这里只有**清单和说明**，没有一条第三方技能的正文。原因很实在：发布包要能在任何干净机器上装起来，
里面不该夹带别人仓库的几千个文件、也不该替你决定装哪些。

真正落盘由 `deepscient/scripts/install-skills.mjs` 完成，目标目录是
`<DSH_HOME>/science/skills-vendor/<技能名>/SKILL.md`，和随包科研技能（`<DSH_HOME>/science/skills`）分开，
互不覆盖。科学预设按 **用户 → 随包 → vendor** 的顺序扫这三个根，同名时前面的赢。

## 清单里有什么（81 条 / 8 个仓库）

| 仓库 | 条数 | 许可 | 装的是什么 |
|---|---|---|---|
| `K-Dense-AI/scientific-agent-skills` | 42 | MIT | 文献检索、实验设计、统计与功效、写作投稿、审稿、作图与海报、平台集成 |
| `Aperivue/medsci-skills` | 20 | MIT | 研究设计到投稿的一整条线：方案、样本量、清洗、meta 分析、报告规范、引文核验 |
| `ai4s-research/ai4s-skills` | 7 | MIT | 选题探索、文献综述、实验套件、诚信审计、成稿、思维导图 |
| `jxtse/scientific-research-skills` | 7 | MIT | 检索、全文抓取、精读、相关工作、Zotero 管理、论文卡片分诊 |
| `anthropics/skills` | 2 | 逐技能 MIT | `skill-creator`（写新技能）、`mcp-builder`（写 MCP 服务器） |
| `wp-a/nature-academic-search` | 1 | MIT | 跨 Crossref / PubMed / arXiv / OpenAlex / Europe PMC 的检索去重 |
| `MrLee2R/Intelligrapher` | 1 | MIT | 科研配图 |
| `YuanZHAO321/Scientific-Writing-zh` | 1 | MIT | 中文科研写作 |

没进的：`lingzhi227/agent-research-skills`（无许可）、`WenyuChiou/ai-research-skills`（顶层没有 `SKILL.md`），
以及三个巨型包（`GPTomics/bioSkills` 562 条、`AlterLab-IEU` 243 条、`SciAgent-Skills` 208 条）——
它们不适合平铺注册（技能目录会挤占上下文），要点名装哪天再按「路由技能 + 嵌套引用」折叠进来。

## 为什么 pin 到 commit

每条都带两个字段：

- `ref`：40 位 commit SHA（禁分支名）—— 上游改了 `main`，我们的行为不会跟着变；
- `sha256`：该技能 `SKILL.md` 的内容哈希 —— 上游悄悄换内容时，`--diff` / `--lock` 立刻能发现。

## 常用命令

```powershell
node deepscient/scripts/install-skills.mjs --list        # 清单 + 装没装
node deepscient/scripts/install-skills.mjs --plan        # 只打印计划，不写盘
node deepscient/scripts/install-skills.mjs --apply       # 真装
node deepscient/scripts/install-skills.mjs --check       # 校验已装（dsh 的 frontmatter 规则）
node deepscient/scripts/install-skills.mjs --self-test   # tar 解析 + 归一化的单测
node deepscient/scripts/install-skills.mjs --remove --only literature-review --apply
```

## 装进来时做了哪些改动（只碰语法，不碰正文）

第三方用的是 Claude 的 frontmatter 约定，dsh 有两条硬要求：

1. 必须有 `name` + `description`；
2. `disableModelInvocation` / `modelInvocable` / `userInvocable` 这三个旧键会**直接报错** —— 改名为
   `disable-model-invocation` / `user-invocable`，语义按布尔取反保住；其余字段（`license`、`allowed-tools`…）原样留着。

另外：超长 `description` 压成单行并截到 480 字（原全文进索引的 `notes`）；撞上非 vendor 技能时加 `vendor-` 前缀，
绝不覆盖用户自己的技能。

## 网络说明

取包走 `codeload.github.com`，取 commit 走 `commits.atom`（都不吃 GitHub API 的 60 次/小时额度）。
本机 git 若配了不通的代理，脚本会自动走 atom，不需要你改全局配置。
