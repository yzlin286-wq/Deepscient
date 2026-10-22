# 工具清单：38 个工具，按"你会什么时候用到它"排

每个工具都在 `lib/*-tools.js` 里注册。这份清单是给人看的索引，
权威定义在代码与 `data/tools/registry.json`。

**读法**：先看「阶段」列——它对应 `data/workflow.json` 的 S0–S11。
你不需要记住全部 38 个，只需要知道当前阶段该调哪几个。`science_study_coach` 会直接告诉你。

---

## M0 环境与检索（3 个）

| 工具 | 阶段 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `science_preflight` | S0 | 体检：数据根、SQLite、Python、检索源可用性 | 每次开工第一句 |
| `science_retrieval_doctor` | S1 | 检索源诊断：哪个源挂了、为什么 | 检索结果少得可疑时 |
| `science_source_status` | S1 | 各源配额与状态 | 连续检索前 |

## M1 文献检索（2 个）

| 工具 | 阶段 | 做什么 |
| --- | --- | --- |
| `science_lit_query` | S1 | 多源检索（OpenAlex / Crossref / arXiv / PubMed / Semantic Scholar），落库并给 DOI |
| `science_search` | S1 | 同上的别名入口，参数更宽 |

两个工具的产出都进 `paper` 表，`science_gap_matrix` 与 `science_manuscript_lint` 都靠它。

## M2 前沿与缺口（4 个）

| 工具 | 阶段 | 做什么 |
| --- | --- | --- |
| `science_frontier_scan` | S1 | 按方向扫前沿：近期高影响工作、方法趋势 |
| `science_gap_matrix` | S1 | 把已有结论排成矩阵，定位空白格 |
| `science_novelty` | S1 | 判断你的想法与库内工作重叠到什么程度 |
| `science_knowledge_distill` | S1 | 把若干文献压成可引用的事实条目 |

## M3 期刊情报（4 个）

| 工具 | 阶段 | 做什么 |
| --- | --- | --- |
| `science_journal_intel` | S2/S9 | 期刊画像：范围、格式要求、报告规范、审稿周期来源 |
| `science_journal_fit` | S2/S9 | 稿件与期刊的匹配（按范围与格式，不给录用概率） |
| `science_journal_refresh` | — | 刷新期刊数据缓存 |
| `science_submission_route` | S11 | 投稿路径：系统、文件命名、作者顺序、声明项 |

**不给中稿概率。** 这是硬规则，任何工具都不输出录用可能性的判断。

## M4 贡献设计（2 个）

| 工具 | 阶段 | 做什么 |
| --- | --- | --- |
| `science_contribution_design` | S2 | 把「一个发现」设计成「一篇论文的贡献结构」 |
| `science_paper_plan` | S2/S9 | 论文骨架：每段要回答什么、需要哪些证据 |

## M5 稿件与排版（5 个）

| 工具 | 阶段 | 做什么 |
| --- | --- | --- |
| `science_manuscript_new` | S9 | 按 `journals` 模板建 `paper.md` |
| `science_manuscript_lint` | S9 | 查要件：字数、摘要、图数、引用完整性、交叉引用 |
| `science_manuscript_build` | S11 | 出 PDF + DOCX + JATS + HTML |
| `science_format_check` | S11 | LaTeX 环境：缺哪个文档类、哪个宏包 |
| `science_cover_letter` | S11 | 投稿信草稿 |

13 个期刊族 + 46 个出版社别名，解析到具体格式要求。换刊只改 front matter 的 `journal`。

## M6a 学科方法（2 个）

| 工具 | 阶段 | 做什么 |
| --- | --- | --- |
| `science_discipline_profile` | S2/S4/S7 | 学科画像：设计、测量、方法、工具、报告规范、审稿攻击、方法学门槛 |
| `science_discipline_list` | S0 | 列 13 个学科包与各自规模 |

`science_discipline_profile` 是 M6 里信息密度最高的一个：一次调用能拿到 S2–S7 全部需要的领域约束。

## M6b 实验管理（5 个）

| 工具 | 阶段 | 做什么 |
| --- | --- | --- |
| `science_project_open` | S0 | 建/开/列课题，建目录骨架，登记伦理与数据许可 |
| `science_exp_plan` | S2/S3 | 方案：前置条件、威胁、样本量（或 MDE）、预注册草稿、关口检查 |
| `science_exp_run` | S5/S6 | 受控执行：受控目录、Python 层断网、输入输出哈希、环境、seed |
| `science_exp_query` | 全程 | 课题总览、执行列表、分析列表、图列表 |
| `science_provenance` | S10 | 链式 hash 溯源，能查出被删/被改/错序的记录 |

`science_exp_run` 只往 `experiments/<slug>/<runId>/` 写，路径越界直接拒绝。

## M6c 分析与作图（2 个）

| 工具 | 阶段 | 做什么 |
| --- | --- | --- |
| `science_stats` | S7 | 25 个检验族：统计量 + df + p + 效应量 + CI + 假设检查 + 备选方案 |
| `science_figure` | S8 | 期刊毫米尺寸作图：PDF/SVG/PNG + 四项自检（字号、矢量、dpi、宽度） |

`science_stats` 对未实现的检验返回 `method: "unsupported"` 加 `py` 片段，不硬凑近似方法。

## M6d 流程与教学（2 个）

| 工具 | 阶段 | 做什么 |
| --- | --- | --- |
| `science_study_coach` | 全程 | 对着库里的真实状态逐门判定 S0–S11，给出下一步 |
| `science_workflow_stages` | 全程 | 打印流程本身：每阶段目标、门、工具、产出、常见错误 |

门的状态有四种：`pass` / `fail` / `skip`（查不到，不算过关）/ `manual`（机器判不了，要人核对）。

## M5 辅助（1 个）

| 工具 | 阶段 | 做什么 |
| --- | --- | --- |
| `science_rebuttal` | S11 | 按审稿意见逐条生成回应草稿 |

## M7 多智能体调度（5 个）

| 工具 | 阶段 | 输入要点 | 输出要点 | 不做什么 |
| --- | --- | --- | --- | --- |
| `science_org_chart` | S0（全流程可查） | 空参列全部岗位；可选 `role`；再给 `tool`（支持 `science_*` 前缀通配）或 `action`（decide / approve / review / execute / veto / schedule）做越权检查 | 13 个岗位的层级、职责、权限、容量与工具面，一票否决席位与批策略；检查时给通过/不通过与上报路径 | 不改编制、不派人；编制只从 `data/org/roles.json` 与 `org-chart.json` 读，不在这里判断科学问题 |
| `science_campaign_plan` | S0 | `question`（必填）；`discipline`、`seed`、`projectId`、`example`、`literatureCount` / `dataColumns` / `figureCount` / `sections` / `votes` / `budgetUsd` / `maxWallClockMin` | `campaignId`、`planHash`、7 个 Workstream / 12 个 Task / 分片数（默认 138）、按岗位的分片预算、批次数与关键路径 | 不执行分片；同 `planHash` 默认复用已有战役，只有 `force:true` 才换一整套 id 另起一轮 |
| `science_campaign_run` | S0–S9 | `campaignId`（必填）；`mode`（local / delegate / ingest / auto）、`maxShards`、`localConcurrency`、`llmConcurrency`、`delegateBatch`、`highWatermark`；ingest 另给 `results[]` | 本轮 processed / done / failed / needsReview / needsHuman、队列剩余、吞吐、花费与委派单（最多 6 条） | 不生成结论、不判科学对错；delegate 只出 brief 不执行，ingest 只落库并投票，不替人决定证据够不够 |
| `science_campaign_status` | S0–S9 | `campaignId`；省略则列最近 10 个战役 | 进度百分比、六态分片计数（queued / leased / done / failed / needs-review / needs-human）、花费、按执行器与岗位分布、最近事件 | 不改状态、不推进调度；也不把 `needs-review` 当成 done 报 |
| `science_campaign_report` | S9 | `campaignId`（必填）；可选 `outDir` | `report.md` / `paper.md` / `evidence.json` / `manifest.json` 与图件副本，逐文件 sha256；`idempotent` 表示与上次逐字节相同 | 不补造数字：只汇总已完成分片，缺证据写进 gaps；战役没跑完就照实标缺口，不填占位 DOI |

`science_campaign_run` 的三种委派语义：`mode:"delegate"` 返回委派单，`mode:"ingest"` 回收结果，`local` 只跑确定性分片，`auto` 先 local 再返回一批委派单。

三条边界：上万个智能体指上万个**逻辑智能体槽位**（agent slot / shard），不是同时发一万个 LLM 请求；LLM 产出必须过 task 声明的 gate 工具，否则停在 `needs-review`；默认不联网，文献类任务无网络时复用本地参考并标记缺口，不生成占位 DOI。

---

## 典型调用序列

### 从零到能分析（最小闭环）

```
science_preflight
science_project_open      { title, domain, question, ethics }
science_study_coach       { projectId }
science_lit_query         { q, limit }
science_discipline_profile{ domain }
science_exp_plan          { projectId, designId, hypothesis, primaryOutcome, effect }
  ↓ 采数据到 data/
science_exp_run           { projectId, slug, script, inputs, seed }
science_stats             { projectId, testId, csvPath, columns }
science_figure            { projectId, kind, csvPath, columns, errorType, preset }
science_provenance        { projectId }
```

### 从分析到投稿

```
science_manuscript_new    { projectId, journal }
science_manuscript_lint   { projectId }
science_manuscript_build  { projectId }
science_format_check
science_paper_audit
science_submission_route  { journal }
science_cover_letter      { projectId, journal }
```

### 拿到审稿意见之后

```
science_rebuttal          { projectId, comments }
science_stats             { ... }        ← 补分析（若审稿人要求）
science_figure            { ... }        ← 重画（若要求改图）
science_manuscript_build  { projectId }  ← 重新出件
```

---

## 工具背后的数据文件

| 数据文件 | 谁在用 | 改它会影响 |
| --- | --- | --- |
| `data/journals.json` + `journal-formats.json` | 稿件、期刊情报 | 排版要求、字数限制 |
| `data/citation-styles.json` | 稿件 | 引用格式（6 种） |
| `data/disciplines/*.json` + `_index.json` | 学科画像、方案 | 设计、测量、方法、审稿攻击 |
| `data/statistics.json` | `science_stats`、方案 | 检验、效应量、决策树、功效 |
| `data/tools/registry.json` | 学科画像 | 工具清单与替代方案 |
| `data/lab-protocols.json` | 方案、复现 | 13 条实验协议 |
| `data/repro-checklists.json` | 复现 | L1–L4 分级与阻塞规则 |
| `data/workflow.json` | 教练 | S0–S11 的 55 个门 |
| `data/examples/*` | 教程、验证 | 三个可复现示例 |

改任何一份都要重跑对应的 verify 脚本，见 `docs/discipline-methods.md` 最后一节。
