# @local/dsh-science — 科研版 harness

在 dsh 上做的一个科研向 harness 应用：**证据链**与**可复现**是一等公民，其余（检索、统计、图表、写作、审稿）围绕这两条展开。

形态与 dsh 官方的 preset 机制同构，走官方推荐路线：

| | 本包 | 装进 `node_modules` 的第三方 preset |
|---|---|---|
| preset 落地 | bundle patch 里 `insert` 一行（或 `override` 一行）声明，registry 自己激活 | 直接改 shipped 的 `presets/*.patch.yml`，dsh 升级即被覆盖 |
| 数据 | `$DSH_HOME/science`（SQLite + 技能 + 产物） | 视包而定，通常也在 `$DSH_HOME` 下 |
| 源文件位置 | 仓库在 workspace，可 diff / 可备份 | 装进 `node_modules`，被自身更新覆盖 |

## 安装（已完成）

```powershell
# 通过 dsh 的 plugin_manager 安装（等价：在 Web 的 Plugins 页装本目录）
# target 指向本目录的绝对路径
plugin_manager install_bundle <仓库根>\dsh-science
```

安装后：

```powershell
dsh --profile web --dump-config | Select-String science   # 组合里能看到 science-kit / preset-science
node scripts/verify-tools.mjs                             # 工具契约自检（14 项）
```

**在 Web UI 验收**：新建会话 → 模式下拉选「科研模式」→ 输入“做一次科研环境体检” → 应看到 `science_preflight` 的调用与结果。

## 目录约定（数据根 `$DSH_HOME/science`）

| 目录 | 用途 |
|---|---|
| `projects/` | 每个课题一个子目录（project.json + 笔记） |
| `library/` | 文献 PDF 与抽出的文本/分块 |
| `experiments/` | 实验计划、运行记录、产物 |
| `manuscripts/` | 稿件骨架与导出件 |
| `roles/` | 五个子角色稿（survey / analyst / experimenter / writer / critic） |
| `skills/` | 随包科研技能（启动时同步，可被用户覆盖） |
| `logs/` | 检索过程、运行日志 |
| `config.json` | 工具路径 + 检索环境变量名（**不存密钥明文**） |
| `schema_meta.json` | 布局版本；M1 起与 `science.db` 的 `schema_meta` 表对齐 |

## 本仓库结构

```
dsh-science/
├─ package.json              # dsh.bundle.patch = [cordis.patch.yml, presets/science.patch.yml]
├─ cordis.patch.yml          # Host 平面：science-kit（数据根 + 技能同步 + ctx.scienceKit）
├─ presets/science.patch.yml # Agent 平面：preset-science 声明行（人设 + 工具行）
├─ lib/index.js              # 数据根 + config + schema_meta + 技能同步 + 检索运行时
├─ lib/tools.js              # science_preflight
├─ lib/science-tools.js      # science_search / lit_query / source_status / retrieval_doctor
├─ lib/method-tools.js       # 期刊匹配 / 审计 / 加速路径 / 新颖性 / cover letter / 审稿（M2 六工具）
├─ lib/frontier-tools.js     # 前沿扫描 / claim 提炼 / 缺口矩阵 / 贡献设计 / 论文骨架（M4 五工具）
├─ lib/manuscript-tools.js   # 建稿 / 要件检查 / 四格式出件 / 环境自检（M5 四工具）
├─ lib/discipline-tools.js   # 学科画像 / 学科清单（M6a 两工具）
├─ lib/lab-tools.js          # 课题 / 方案 / 受控执行 / 查询 / 溯源（M6b 五工具）
├─ lib/analysis-tools.js     # 统计检验 / 期刊尺寸作图（M6c 两工具）
├─ lib/coach-tools.js        # 流程教练 / 流程本体（M6d 两工具）
├─ lib/science/
│  ├─ http/                  # client（Cookie/代理/curl 双传输）/ limits（限速+预算+熔断）/ cache（SQLite 响应缓存）
│  ├─ sources/free.js        # 10 个无 key 源适配器
│  ├─ registry.js            # 单源执行 + 并发扇出 + 403/429 分级处理
│  ├─ query.js               # 检索式 DSL 与各源语法翻译
│  ├─ record.js              # 归一化 / 三路去重 / 相关性打分 / GB-T 引用
│  ├─ store.js               # SQLite v7（检索 / 方法论 / 情报 / 转化 / 实验 / 分析 / 溯源 七层表）
│  ├─ pipeline.js            # 编排：扇出 → 去重 → 排序 → 落库 → 报告
│  ├─ method/                # M2：journals / audit / route / novelty / drafting
│  ├─ intel/                 # M3：openalex-profile / scirev / letpub / card
│  ├─ frontier/              # M4：github / index / distill / gap / contribution / plan
│  ├─ discipline/            # M6a：index（学科匹配）；M6d：coach（S0–S11 门判定）
│  ├─ lab/                   # M6b：project / power / runner / plan / query / provenance；M6c：stats / figures
│  └─ format/                # M5：yaml / markdown / source / cite / formats / latex / docx / jats / html / lint / build
├─ data/
│  ├─ journals.json          # 53 本期刊画像
│  ├─ journal-formats.json   # 13 个版式族 + 46 个出版社别名（LaTeX 类 / DOCX 规格 / 引文风格）
│  ├─ citation-styles.json   # 微缩 CSL：6 种引文风格（自写的规则描述，非 CSL XML 改写）
│  ├─ journal-intel-cache.json # 140 条三源快照（fresh 安装不联网就有实证层）
│  ├─ contribution-types.json  # 7 类贡献 × 3 档证据清单
│  ├─ frontier/optimization.json # 8 个实测锚点（带 observedAt 与 why）
│  ├─ statistics.json        # 44 个检验 / 28 个效应量 / 5 种校正 / 10 个功效函数 / 7 个决策节点
│  ├─ disciplines/*.json     # 12 个学科包 + generic（设计 / 测量 / 方法 / 工具 / 报告规范 / 审稿攻击）
│  ├─ tools/registry.json    # 60+ 个科研工具（装法 / 最小脚本 / 替代 / 离线可用性 / 许可）
│  ├─ lab-protocols.json     # 13 条实验协议
│  ├─ repro-checklists.json  # 可复现清单 L1–L4 + 阻塞规则
│  ├─ workflow.json          # S0–S11 阶段与 55 个门
│  └─ examples/              # 三个可复现示例（data.csv + README + expected.json）
├─ scripts/py/               # power_run.py / stats_run.py / figure_run.py / docx_build.py / make_examples.py
├─ scripts/verify-tools.mjs    # 工具契约自检（14 项）
├─ scripts/verify-search.mjs   # 检索层验收（60 项，含在线探针）
├─ scripts/verify-method.mjs   # 发表方法论验收（71 项）
├─ scripts/verify-intel.mjs    # 期刊情报验收（50 项）
├─ scripts/verify-frontier.mjs # 知识转化验收（174 项离线）
├─ scripts/verify-format.mjs   # 排版导出验收（261 项离线 / 272 项含真编译）
├─ scripts/verify-discipline.mjs # 学科方法库验收（1050 项）
├─ scripts/verify-lab.mjs      # 实验层验收（189 项）
├─ scripts/verify-stats.mjs    # 分析与作图验收（152 项）
├─ scripts/smoke-frontier.mjs  # 真实链路冒烟（消耗 GitHub 与十源配额）
├─ scripts/smoke-manuscript-tools.mjs # 工具层冒烟（67 项）
├─ scripts/smoke-discipline-tools.mjs # 学科工具冒烟（53 项）
├─ scripts/smoke-lab.mjs       # 工具层冒烟：lab + analysis + coach 九工具（117 项）
├─ scripts/demo-student-flow.mjs # 端到端演示：建课题 → 出投稿件，九步全链
├─ docs/source-notes.md       # 渠道实测笔记（状态码/限额/坑）
├─ docs/market-scan.md        # M5 竞品调研与借鉴清单（含许可边界）
├─ docs/discipline-methods.md # 学科包与统计库的导读（数据权威，文档导读）
├─ docs/tool-registry.md      # 33 个工具按阶段索引
├─ docs/onboarding-tutorial.md # 从零到投稿的十步教程
└─ skills/science/*/SKILL.md  # 随包技能（17 个）
```

## 已实现

### M0 骨架

- `science-kit`：建齐 7 个子目录、写 `config.json`（幂等，只补缺失键）、写 `schema_meta.json`、同步随包技能、发布 `ctx.scienceKit`；
- `preset-science`：PI 人设 + 四条硬约束（证据链 / 可复现 / 先查库 / 不越权）+ standard 级工具面 + 科研工具行 + 图像 offload；
- `science_preflight` 工具：数据根、schema 版本、技能清单、工具链探测（python / git / pandoc / xelatex），缺项一次列清；
- 两个技能：`science-literature-search`、`science-reproducibility`。

### M1.0 检索层（已完成，实测 60/60）

**十个无 key 源并发扇出**：OpenAlex、Crossref、Europe PMC、PubMed、arXiv、DOAJ、DataCite、Zenodo、OpenAIRE（+ bioRxiv/medRxiv API 按日期扫描）。

真实成绩：一次 `protein folding diffusion model` 查询 → 8 个源有命中、36 条去重记录、1.5–7s；二次同查询走缓存 **16ms**。

| 能力 | 实现 |
|---|---|
| 限速 | 每 host 令牌桶 + 抖动（参数来自实测，见 `docs/source-notes.md`） |
| 预算 | 读 OpenAlex `x-ratelimit-remaining-usd`，剩 $0.005 自动停用该源并降级到无预算源 |
| 熔断 | 连续 3 次失败冷却 300s；**403 先退避重试一次再判**（Zenodo 突发就 403） |
| 缓存 | SQLite + 文件体，2xx 才存，TTL 分级（元数据 7 天 / PDF 30 天 / HTML 1 天） |
| 去重 | DOI → arXiv id → 标题指纹+首作者+年，三路；多源命中合并 sources 并补齐空字段 |
| 检索式 | DSL（块间 AND、块内 OR）翻成各源原生语法；**单块多词不加引号**（加引号召回从 8 源掉到 4 源） |
| 存储 | SQLite v2 + FTS5（`paper` / `paper_fts` / `query_log` / `source_state`），幂等迁移 |
| 观测 | 每源命中/耗时/状态、跳过原因、预算消耗全部进 `query_log` 与 `source_state` |

四个工具：

- `science_search` —— 多源扇出 + 去重排序 + 落库
- `science_lit_query` —— 先查本地库（FTS5），别重复烧配额
- `science_source_status` —— 渠道矩阵：谁冷却、谁故障、预算剩多少、缓存命中率
- `science_retrieval_doctor` —— 串行探针，真发请求，区分"源坏了"和"检索式太窄"

渠道细节、每个源的限额与坑、全文九级回退的真实结果：见 [docs/source-notes.md](docs/source-notes.md)。

### M2 发表方法论层（已完成，实测 71/71）

把"如何更快更好发顶刊"里**可验证、可执行**的部分做成门禁与决策支持，不是散文建议。

| 能力 | 实现 | 依据 |
|---|---|---|
| 期刊匹配 | 53 本期刊画像（scope/设计/档位/限额/预印本/RR/portable review/转投链），五项可拆分解读打分，输出 reach/target/safe 三档 | 官方 scope 与 author guidelines |
| 投稿前门禁 | 54 条规则 / 7 个 profile（general·CONSORT·PRISMA·STROBE·ARRIVE·TRIPOD·TOP），每条带 source 与具体改法 | 六套报告规范 |
| 证据链门禁 | 孤儿断言（结论无证据）、被自己的证据反驳的断言 | schema v3 的 claim/evidence |
| 加速路径 | Registered Reports 可行性、portable review、预印本时机、转投链、**带累计天数的日历**、按拒稿理由的决策分支 | cos.io（300+ 刊）、reviewcommons.org（16 家 affiliate）、出版商 transfer service |
| 新颖性检查 | 十源 scoop check，标题重叠排序，近期高重叠预警，摘要空白陈述检测 | M1 十源扇出 |
| 起草支持 | cover letter 五槽论据骨架（给"必须填的事实"与"要避免的套话"）、审稿意见七类分类 + 回应骨架 | 编辑决策三问、审稿博弈实践 |

六个工具：`science_journal_fit`、`science_paper_audit`、`science_submission_route`、`science_novelty`、`science_cover_letter`、`science_rebuttal`。

schema v3 新增 `manuscript` / `submission_event` / `audit_run` / `claim` / `evidence` 五张表——于是"更快"变成可测指标：desk 决定天数、总周期、转投次数、审计修复轮次。

方法论出处与"哪些只能靠判断"的边界：[docs/methods.md](docs/methods.md)。

### M3 期刊情报层（已完成，实测 117/120 + 140/157 源记录）

M2 的期刊匹配靠**期刊自述的 scope 关键词**——那是营销文案。M3 把它换成**它实际发过什么**，并把作者侧的真实体验接进来。

| 能力 | 实现 | 实测数据 |
|---|---|---|
| 产出足迹 | OpenAlex 近两年每刊论文按子领域 `group_by` 汇总，算「你的子领域占该刊产出比例」 | 49/53 刊，Nature 8998 篇/99.6% 覆盖，eLife 9159 篇/100% |
| 评审现实 | SciRev 众包：首轮月数、总量月数、即时拒天数、审稿轮数、每轮报告数、意见难度、样本量 | 45/53 刊，Nature 2.0/4.0/13d/1.6/2.8/3.4/90 条 |
| 中国作者视角 | LetPub：审稿速度档、录用比例措辞（含 `invited-only` 警示）、中科院分区、IF | 46/53 刊 |
| 实证打分 | fit 从「声明层」切到「实证层」：scope .28 / **footprint .32** / design .18 / band .12 / format .06 / 加速 .04 | 覆盖率 ≥80% 才切，否则整批退回并说明原因 |
| 跨刊对比 | 给定稿件子领域，反查哪几本刊最常发这类工作 | 1312 Molecular Biology：Molecular Cell 68%、Genome Biology 55%、EMBO Rep 34% |

两个新工具：`science_journal_intel`（单刊情报卡 + 跨刊足迹排名）、`science_journal_refresh`（预演默认、按额度实抓）。

工具面共八个：`science_journal_fit`、`science_journal_intel`、`science_journal_refresh`、`science_paper_audit`、`science_submission_route`、`science_novelty`、`science_cover_letter`、`science_rebuttal`。

**同一天、同一稿件，两层给出的答案差别**（protein folding，band 3）：

```
声明层  reach: 无   target: 无   safe: scientific-reports / plos-one / f1000research
实证层  reach: pnas 10.3% / nature-communications 16.7% / molecular-cell 68.0%
        target: genome-biology 55.4% / embo-reports 33.9% / cell-reports 26.3%
```

schema v4 新增 `journal_intel`（三源快照）/ `journal_topic`（产出分布）/ `review_corpus`（评审语料）。
140 条源记录随包分发（`data/journal-intel-cache.json`），启动时幂等导入——fresh 安装不联网就有实证层。

**铁律**：`topicFootprint` 是统计事实（该刊近两年产出中落在你子领域的比例），**不是录用概率**；工具从不预测录用。
样本 <10 条降 `low` 且不参与排序；数据超 90 天标 `stale`；每个源失败都在 `degraded[]` 里点名，其余照常。

三源实测坑、失败清单与限速预算：[docs/source-notes.md](docs/source-notes.md#七期刊情报三源m32026-10-20-实测)。
选刊读法：[skills/science/science-journal-intel/SKILL.md](skills/science/science-journal-intel/SKILL.md)。

### M4 知识转化层（已完成，实测 174/174 离线 + 真实链路冒烟）

把一个 GitHub 上的实现变成可发表贡献，中间隔着四道工序。M4 把每道都做成工具，**每一步的产物是下一步的输入**。

```
science_frontier_scan          GitHub 上有什么值得读        → frontier_item
science_knowledge_distill      README 里到底声称了什么      → knowledge_claim
science_gap_matrix             这个方向被填了多少            → gap_entry
science_contribution_design    目标档位要求什么证据          → contribution_plan
science_paper_plan             该动笔的结构长什么样          → 标题 / 图 / 摘要槽
```

| 能力 | 实现 | 实测 |
|---|---|---|
| 前沿扫描 | GitHub 检索 + 仓库详情，六信号信誉分（stars .30 / 52周commit .22 / 新鲜度 .13 / release .08 / 数学密度 .12 / 关联论文 .15）× 类型折扣（tutorial ×0.6、awesome ×0.5、archived ×0.3） | `muon optimizer` → 20 候选，**领域门剔掉 13 个同名异物**，5 条入库，Muon 0.581 居首 |
| claim 提炼 | 切句 → 五类分类（定理/机制/结果/限制/营销）→ 机制句配对最近支撑句 → 反推证伪条件 | Muon README 出 2 条 result-only claim，`note` 直说「缺机制」 |
| 缺口矩阵 | 五个方向（理论/规模/跨域/复现/评测）各一条检索式，按标题+摘要+刊名判「是否真的覆盖」 | 锚点 `["muon","optimizer"]` → theory thin(1) / reproduction gap(0) / benchmark thin(2) |
| 贡献设计 | 七类贡献 × 三档证据清单 + 门槛差距 + `gapFit`（缺口类型与贡献类型是否配对） | band 3 要 3 项，band 5 要 5 项且需紧界；band 3 工期 1 周 vs band 5 工期 6 周 |
| 论文骨架 | 五套断言式标题结构 + 摘要五槽 + 图序（Figure 1 必须是核心发现）+ 结构性风险 + 下一步 | 无机制时拒绝硬拼标题，标 `mechanismPresent: false` 与 high 风险 |

**为什么不自动生成成品标题和摘要**：从英文 claim 机械拼出来的句子必然生硬，交出去只会让作者改语法而不改主张——那恰好是顶刊被拒的第一原因。所以给的是**结构槽 + 自检问题**，草稿一律标 `draftIsRough`。

**为什么 mechanism 永远是原句**：一旦改写，读者就再也分不清「作者说的」和「工具编的」。`prediction`/`falsifier` 是模板派生的，每条带 `derived: true`；`needsHumanReview` 恒为 `true`。

**三个实测坑**（写进代码了）：
- `topic:optimization` 返回 `ray`/`czkawka`/`svgo` —— topic 标签是社区随便打的，四个查询模板一律不用 topic 过滤；
- `muon in:name` 的 20 个结果里 13 个是别的 muon（单细胞、构建工具、Erlang、无线网）—— 必须有领域门，`filteredTotal` 不为 0 是正常的；
- `search/code` 匿名一律 401 —— 任何「搜代码里的收敛证明」的方案都跑不通。

schema v5 新增 `frontier_item` / `knowledge_claim` / `gap_entry` / `contribution_plan` 四张表。
`data/frontier/optimization.json` 随包分发 8 个实测锚点（带 `observedAt` 与 `why`），启动时幂等导入。

**铁律**：`credibility` 是「这个仓库值不值得读」，不是「这条路能中」；`verdict: gap` 的完整含义是「**用这组关键词**没查到」，不是「全新」；工具链里没有任何一处预测录用。

读法：[skills/science/science-frontier-to-paper/SKILL.md](skills/science/science-frontier-to-paper/SKILL.md)。
配额与源细节：[docs/source-notes.md](docs/source-notes.md)。

### M5 排版导出层（已完成，实测 261/261 离线 + 272/272 含真编译 + 工具层 67/67）

M4 结束时手里是一份**内容骨架**。M5 把它变成能直接上传的文件——而且换刊时只改一行。

```
paper.md + references.yml        一份源，正文里不写任何格式
        ↓  parseSource
      文档模型（AST）
        ↓  cite.js 解析一次引文（数字/作者年/上标，按目标刊）
   ┌────┴────┬────────┬─────────┐
  latex.js  docx.js  jats.js  html.js
   PDF       DOCX     XML      预览
```

| 能力 | 实现 | 实测 |
|---|---|---|
| 源格式 | `paper.md`（YAML 头 + Markdown 子集）：`[@key]` 引文、`![cap](path){#fig:x}` 图、`$$...\label{}$$` 公式、表格 + `: caption {#tab:x}` | 自写 YAML 子集解析器（含 flow map、块标量），往返稳定；行内节点 9 类 |
| 版式族 | `journal-formats.json` 13 族 + 46 个出版社别名 → LaTeX 类 / 页尺寸 / 页边距 / 字号 / 行距 / 行号 / 引文风格 | 全部参数进同一份规格，PDF 与 DOCX 与 HTML 预览同源，不跑版 |
| 引文引擎 | 微缩 CSL：6 种风格 × 模板串 + 作者规则；数字按首次引用编号，作者年按字母序；空槽连标点一起清 | GB/T 7714 `JORDAN K, JIN Y, KOLTER JZ. …[J]. arXiv preprint, 2024, 12(3): 45–67.`；APA 带 DOI；Nature 六作者降 `et al`；IEEE `lastSeparatorTwo: and` |
| PDF | 直接生成 `.tex`（不走 BibTeX、不发 `\cite{}`）→ xelatex 两遍 | Nature / Cell / IEEE / PLOS / Elsevier 五族真编译出 3 页 PDF，图嵌入、中文 CJK、公式、三线表全部正常 |
| DOCX | `scripts/py/docx_build.py`（python-docx）：页尺寸、页边距、**连续行号（sectPr/lnNumType）**、东亚字体槽位、双倍行距、标题层级、图注表注、悬挂缩进文献表、三线表边框 | 26 段 / 1 表 / 1 图 / 行号在 / A4 210×297，Word 打开即投稿稿 |
| JATS | `front`+`body`+`back` 最小合法集，`element-citation publication-type` 映射，`xref rid` 对接文献 | 3.7 KB，`<sec>`/`<p>` 标签配平，DOI 带 `pub-id-type` |
| HTML 预览 | 自包含单文件，页面尺寸/字号/行距/行号从同一份 DOCX 规格取；CSS counter 做行号；不引 MathJax | 「格式编辑器」的看的那一半，任何环境离线可开 |
| 要件检查 | 字数（CJK 按字 + 拉丁按词）、摘要区间、图表数、文献数、引文完整性、交叉引用、缺节、关键词、通讯作者、标题长度 | 4 级 × 15 类代码，每条给可执行改法 |
| 环境自检 | `kpsewhich` 查类 → `mpm --install` 补装 → 失败降级 `article`；`readLatexLog` 把编译错误解析成 `{message, 行号, 行内容}` | 两轮重试；`sn-jnl`/`bmcart` 装不上时自动落到 `article` 并记 warning |

**四个工具**：`science_manuscript_new`、`science_manuscript_lint`、`science_manuscript_build`、`science_format_check`。

**为什么不用 BibTeX、不用 pandoc、不接 citeproc-js**：三者都会把「格式一致性」变成三份独立的失败点。
参考文献直接在 JS 里按模板生成字面量，PDF / DOCX / JATS / HTML 四处输出**同一个字符串**——
这是投稿前最容易被忽略、也最容易在最后一步翻车的地方（PDF 里 `[1]`、Word 里 `(Jordan, 2024)`）。

**已知限制**（不藏着）：DOCX 里的复杂公式退化成 Unicode 近似（`\frac`→`/`、`\alpha`→`α`、`x_{ij}`→`xᵢⱼ`），
真 OMML 转换留作 M5.1；转不了的命令原样保留并在 `warnings` 里逐条点名。

竞品调研、可借鉴点、许可边界（哪些 AGPL/GPL 只能读不能抄、哪些 LPPL 可以直调）：
[docs/market-scan.md](docs/market-scan.md)。
读法：[skills/science/science-manuscript-formatting/SKILL.md](skills/science/science-manuscript-formatting/SKILL.md)。

### M6 学科方法与实验层（已完成，实测 1050 + 189 + 152 + 117 项）

M5 结束时，这个应用能"把稿子排成期刊要的样子"。但它还不会**做研究**：
知道怎么排版，不等于知道心理学该用组间还是组内、样本量该算多少、正态性不过该换哪个检验。
M6 补的就是这一段——目标是**一名没做过研究的本科生或研究生，按着它就能从选题走到投稿**。

分四批交付：

| 批次 | 交付 | 实测 |
|---|---|---|
| M6a 学科方法库 | `statistics.json`（44 检验 / 28 效应量 / 5 校正 / 10 功效函数 / 7 决策节点）、12 学科包 + generic、`tools/registry.json`（60+ 工具）、`lab-protocols.json`（13 协议）、`repro-checklists.json`（L1–L4 + 阻塞规则）、`discipline/{index}`、两个工具 | 1050/1050 |
| M6b 实验管理 | SQLite v6→v7（`project`/`experiment`/`experiment_run`/`analysis`/`figure_spec`/`provenance` + `ethics_json`）、`lab/{project,power,runner,plan,query,provenance}`、`power_run.py`、五个工具 | 189/189 |
| M6c 分析与作图 | `stats_run.py`（25 检验族，含自实现的 McNemar 精确检验、Kaplan-Meier、log-rank）、`figure_run.py`（9 种图型，毫米物理尺寸）、`lab/{stats,figures}`、三个可复现示例、两个工具 | 152/152 |
| M6d 流程与教学 | `workflow.json`（S0–S11 / 55 门）、`discipline/coach.js`、两个工具、4 个新技能、3 份文档、`smoke-lab.mjs`、端到端演示 | 117/117 + 整链通过 |

#### 几个硬决定

**样本量不是拍出来的。** `science_exp_plan` 走 statsmodels 的 `TTestIndPower` / `TTestPower` /
`FTestAnovaPower` / `NormalIndPower` 等，返回的 n 都是算出来的：
`d=0.5` → 每组 64（共 128）；配对 `d=0.4` → 52（104）；ANOVA `f=0.25, k=3` → 158（474）；
比例 `0.30 vs 0.45` → 162（324）；相关 `r=0.3` → 167（334）；聚类 `d=0.4, icc=0.1, m=30` → 设计效应 3.90，387（774）。
反向也给：`n=30` → MDE `d=0.7356`。给 `n` 就直接算 MDE，不做"先算 n 再反推"的往返，避免 ceil 漂移。

**未实现的检验明确说不支持，不硬凑近似。** `science_stats` 对未实现的方法返回
`{ok: false, method: "unsupported", hint, supported: [...]}`，并指出 `statistics.json` 里那条自带可直接复制的 `py` 片段——
用户写成 `code/stats.py` 交给 `science_exp_run` 跑，整条链仍然留痕。假装支持一个检验，比明确说不支持危险得多。

**假设检查是结果的一部分，不是附注。** 每次返回带 `assumptions[]`（`true`/`false`/`null`），
不过时 `warnings[]` 给出 `fallback[]`——来自数据文件登记，不是临时想的。卡方默认 Yates 并**同时**给未校正值
（`[[30,20],[15,35]]` → 7.92 校正 / 9.09 未校正），因为正文必须说清用了哪个。

**图按毫米物理尺寸画，不按英寸。** 先定 `widthMm`（单栏 85 / 双栏 180），再定 `fontSize`（默认 7 pt，拒 <6 pt），
最后出件。反过来做（8 英寸图缩到 85 mm）字号会变成 3.3 pt，印刷是一团灰。9 种图型全部实测通过；
误差棒**没有默认值**，必须传 `errorType: sd | sem | ci95`——不说明的误差棒一定会被审稿人问。

**错误棒、图、数字三者要能对上。** `science_figure` 收 `analysisId`，把图和产生它的分析关联；
`science_provenance` 用链式 hash（`sha256([seq, prevHash, projectId, subject, action, actor, detail, createdAt])`）
保证每一步都是按顺序发生、没人改过。**失败的执行也进链**——一份只记成功的历史没有诊断价值。

**门有四种状态，"没查过"不等于"没问题"。** `workflow.json` 的 55 个门逐条对着库里的真实状态判：

| 状态 | 含义 | 处理 |
|---|---|---|
| `pass` | 查得到且达标 | 往下走 |
| `fail` | 查到了但不达标 | 按 `fix` 修 |
| `skip` | **查不到**（没做或没留记录） | 去做或补记录，**不算过关** |
| `manual` | 机器判不了（"对照组选得对不对"） | 人自己核对，一直显示但不阻塞 |

阶段 `complete` 要求 `blocking === 0 && warnings === 0 && skipped === 0`；`manual` 不计入但永远显示。
`science_study_coach` 的 `nextActions` 按 阻塞 → 警告 → 未留记录 → 自查 四级取，
保证"当前阶段没阻塞但也没做完"时不会给出一片空白。

**伦理与数据许可落库，不是写进正文就够。** schema v7 给 `project` 加 `ethics_json`；
`body` 为人类/动物/细胞系/二手数据/不涉及之一，缺失时 coach 在 S0 报 warning。
理由很实际：半年后写方法段时，没人记得批号是多少。

#### 本机实际能跑什么

Python 3.12.10。**已装**：numpy、scipy、pandas、matplotlib、seaborn、statsmodels、scikit-learn、
sympy、networkx、numba、rdkit、ase、cvxpy、python-docx、PyMuPDF。
**未装**：lifelines、pymc、astropy、biopython、xarray、shap、papermill。
所以生存分析基础能力（KM、log-rank）和 McNemar 精确检验是**自实现**的，不依赖 lifelines / scipy 的缺失函数
（`scipy.stats` 至今没有 `mcnemar`）。缺的工具在 `tools/registry.json` 里都有 `alt[]` 替代路径。

GUI-only 工具（`minimalScript: "（图形界面）"`）不能代点，只能给参数怎么设、产出放哪，然后让用户自己操作再补录执行记录。

三份文档：
[docs/discipline-methods.md](docs/discipline-methods.md)（学科包与统计库导读）、
[docs/tool-registry.md](docs/tool-registry.md)（33 个工具按阶段索引）、
[docs/onboarding-tutorial.md](docs/onboarding-tutorial.md)（从零到投稿十步）。
新手入口技能：[skills/science/science-study-coach-flow/SKILL.md](skills/science/science-study-coach-flow/SKILL.md)。

#### 端到端验收：`scripts/demo-student-flow.mjs`

单元断言证明不了"一个没做过研究的人能走通"，所以另写了一条**整链演示**：建课题 → 教练 → 方案（算 n）→
写数据 → 受控清洗 → t 检验 + 非参数稳健性 → 期刊尺寸作图 → 建稿（挂课题）→ 补正文与参考文献 →
lint → 出四件套 → 论文审计 → 溯源校验 → 教练终判。

```
node scripts/demo-student-flow.mjs
```

最终状态（实测）：

```
✓S0 ✗S1 ✓S2 ·S3 ✓S4 ✓S5 ✓S6 ✓S7 ✓S8 ✓S9 ✓S10 ✓S11
已过：S0 S2 S4 S5 S6 S7 S8 S9 S10 S11
未过：S1（没做文献检索）、S3（没做预注册）
```

S1 与 S3 没过是**正确结果**：演示里没有真的检索文献库，也没有真的去 OSF 登记。
教练不会因为"别的地方都做完了"就放过这两项——这正是它存在的意义。

这条演示在开发中抓出六个真问题，都属"链路看着通、走起来断"的类型：

| 问题 | 症状 | 修法 |
|---|---|---|
| `science_exp_run` 的 cwd 是 run 目录 | 学生写 `open('data/raw.csv')` 必然 `FileNotFoundError` | cwd 改为项目根，另给 `DSH_RUN_DIR`/`DSH_PROJECT_DIR`；项目内新增产物也登记哈希 |
| 稿件与本课题无关联 | S9 的"稿子已建"永远 skip，教练把人扣在写作前 | `science_manuscript_new` 收 `projectId`，写索引行 + 溯源条目 |
| 门读不到 lint/build 结论 | S9/S11 永远 skip | lint 落 `lint.json`、build 落 `build.json`，门读文件 |
| 假设不过就永久卡死 | t 检验正态性没过后 S7 再也不可能 complete | 改用"是否跑过登记的 fallback"判定（`statistics.json` 的 `fallback[]`） |
| 骨架注释被当成正文 | 每篇新稿都凭空多出"引用不存在""交叉引用悬空"两条 block | 解析前剥 HTML 注释 |
| 上限为 0 被当成上限 | "正文 355 词，超过上限 0 词的 25%" | `words`/`figures`/`refs` 的 0 一律视为不设上限 |

## 里程碑
- **M1.0 检索层 ✅**：十源扇出、限速/预算/熔断/缓存、DSL 翻译、三路去重、SQLite v2 + FTS5、四个检索工具。
- **M2 发表方法论层 ✅**：53 刊画像、54 条审计规则、加速路径日历、scoop check、cover letter 与审稿分类，六个工具。
- **M3 期刊情报层 ✅**：OpenAlex 产出足迹 + SciRev 评审现实 + LetPub 中国作者视角，实证打分层，两个工具，schema v4。
- **M4 知识转化层 ✅**：GitHub 前沿扫描（领域门 + 六信号信誉 + 类型折扣）、散文→claim 提炼、五方向缺口矩阵、七类贡献×三档证据清单、论文骨架（断言标题 + 摘要槽 + 图序），五个工具，schema v5。
- **M5 排版导出层 ✅**：`paper.md` 单一源 → 文档模型 → 四渲染器（LaTeX/PDF、DOCX、JATS、HTML）；13 版式族 + 46 出版社别名；6 种引文风格一次解析四路同源；要件检查 15 类；编译失败结构化诊断与类自动补装降级，四个工具。
- **M6 学科方法与实验层 ✅**：12 学科包 + generic、44 检验 / 28 效应量的统计库、60+ 工具注册表、13 条实验协议；SQLite v6/v7（实验/分析/图/溯源/伦理六表）；受控执行（断网钩子 + 输入输出哈希 + 环境快照 + seed）；25 检验族与 9 种期刊尺寸图型；S0–S11 流程与 55 个门；九个新工具，schema v7。
- **M1.1 全文与证据链**：`resolve/chain` 九级回退（Europe PMC JATS → PMC efetch → arXiv/PLOS/Frontiers/bioRxiv 直链 → 出版商 Cookie 两步 → CF 源）、`science_fulltext`（`evidence` 表已就位，只等全文链往里写 `file_hash`/页码/quote）。
- **M1.2 中文库**：CNKI 海外入口（`chn.oversea.cnki.net`，实测 200 SSR）、万方 XHR 逆向、维普 `__NUXT__` 解析、`science_cn_search`。
- **M1.3 受限源**：S2 退避与 key、Scholar 住宅代理、Sci-Hub ALTCHA 求解、`science_snowball` 引文网络。
- **M2 稿件闭环（剩余部分）**：`science_review`（五维审稿打分）、科研台只读版（右侧栏）、五个子角色稿。
  （`science_manuscript_scaffold/export` 与 `science_provenance` 已在 M5 / M6b 落地。）
- **M4 生态接入**：MCP（`paper-search-mcp` / `arxiv-mcp-server` / `zotero-mcp`）、上游技能包选择性导入（K-Dense `scientific-agent-skills`、GDM `science-skills` 等，保留 attribution）。

## 注意

- 本包**不覆盖** `system-prompt` 行：那是全局单例，override 会与部署侧注册打架。文案只走 preset 自己的 `persona` 行。
- preset 的行**自己写全**、不 `include` shipped 文件：shipped 的 `presets/*.patch.yml` 属于 dsh 安装目录，dsh 升级会被覆盖；自己写全才能在任意一台机器上行为一致。
- persona 里**不写提示词变量**（`{{…}}`）：这类变量必须由某个插件先注册，缺一个就让整段系统提示词渲染抛 `unknown prompt variable`，表现是「新建会话失败」。路径与数据根一律由 `science_preflight` 与运行时上下文给出。
- 别把 `required: false` 写进 `defineTool` 的 parameters：官方 schema 编译器只接受 `required: true` 或省略（`scripts/verify-tools.mjs` 会替你抓到）。
