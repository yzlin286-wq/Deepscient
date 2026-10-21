# 工具在哪一步用

工具定义 36 个：23 个挂在具体阶段，13 个跨阶段（查历史、溯源、教练、期刊情报、前沿扫描）。工具只在「科研模式」这个 preset 的会话里可调——它们是预设的一部分，不是全局函数。

先说清一件事：`dsh-science/docs/tool-registry.md` 里那张核心表是 33 个，比代码里少三个（`science_reproducibility`、`science_statistics_choice`、`science_top_journal_writing` 是后加的知识转化层）。面板「工具」页签直接扫包里的工具定义，所以它显示 36。以面板为准，文档会滞后。

| 阶段 | 工具 | 它在回答什么 |
|---|---|---|
| S0 选题 | `science_project_open` | 这个课题叫什么、属于哪个学科、伦理与数据许可填了没 |
| S0 | `science_discipline_profile` | 这个学科通常怎么做、必报哪些项 |
| S0 | `science_discipline_list` | 有哪些学科包可选 |
| S0 | `science_preflight` | 本机环境够不够跑（Python / LaTeX / 统计库） |
| S1 文献 | `science_lit_query` | 按检索式取库、去重、落库 |
| S1 | `science_search` | 全库检索（标题 / 摘要 / 全文片段） |
| S1 | `science_gap_matrix` | 已有工作 × 缺口的矩阵 |
| S1 | `science_review_corpus` | 综述语料与主题聚类 |
| S2 设计 | `science_exp_plan` | 出方案：前置条件、威胁与对策、审稿人会打的点 |
| S2 | `science_journal_fit` | 这篇东西适合投哪本（档位、周期、命中率口径） |
| S3 样本量 | `science_exp_plan`（`effect` 或 `n`） | 算 n，或算 MDE |
| S3 | `science_power` | 各类检验的功效函数 |
| S4 测量 | `science_discipline_profile` | 测量定义与单位惯例 |
| S5 采集 | `science_exp_run` | 执行脚本，留命令、环境、seed、哈希 |
| S6 管理 | `science_exp_run` | 清洗脚本也走它，便于事后复现 |
| S7 分析 | `science_stats` | 假设检验 + 效应量 + 假设诊断 + 稳健性回退 |
| S7 | `science_prereg_check` | 现在的分析与预注册是否一致 |
| S8 图 | `science_figure` | 期刊尺寸出图（9 种图型） |
| S9 写作 | `science_manuscript_new` | 建稿（挂到课题上） |
| S9 | `science_manuscript_lint` | 查要件与格式 |
| S9 | `science_manuscript_build` | 出 PDF / DOCX / JATS / HTML |
| S9 | `science_format_check` | 目标刊的字数、图数、摘要、参考文献上限 |
| S10 内审 | `science_paper_audit` | 按审稿维度逐条打分 + 证据链核查 |
| S10 | `science_manuscript_audit` | 结构与论证链自查 |
| S10 | `science_stats_report` | 统计报告要件（效应量、CI、检验前提） |
| S11 投稿 | `science_submission_route` | 投哪条路径最快、被拒后怎么转投 |
| S11 | `science_cover_letter` | 覆盖信论据骨架 |
| 全程 | `science_study_coach` | 现在第几步、卡在哪、下一步做什么 |
| 全程 | `science_workflow_stages` | 讲清某一步要什么、为什么 |
| 全程 | `science_exp_query` | 查历史运行与分析记录 |
| 全程 | `science_provenance` | 溯源链校验（改过什么、哈希对不对） |
| 全程 | `science_frontier_scan` | 前沿扫描：新预印本、新方法 |
| 全程 | `science_intel` | 期刊情报（周期、口径、政策） |

## 怎么读这张表

- 表里出现两次的阶段不是重复：同一个工具在不同阶段回答不同的问题（`science_exp_plan` 一次出方案、一次算 n）。
- 面板「工具」页签列的是同一份数据，来源是 `workflow.json` 每个阶段的 `tools` 数组——不另存一份目录，所以不会对不上。
- 工具名不会变，但阶段划分可能调整；以 `science_workflow_stages` 的输出为准。
