# 发表方法论：哪些进了系统，哪些只能靠判断

**核验日期**：2026-10-20。每条都标了证据强度与落地形式。

证据强度：
- **T1 机制**：制度性设计，改变录用概率本身（最硬）
- **T2 编辑决策**：决定 desk reject 与否的判据
- **T3 写作结构**：可复制，影响送审率
- **T4 报告规范**：审稿人核对表，缺项必返修
- **T5 对抗策略**：审稿回应的博弈

---

## T1：制度性机制（唯一能提高录用概率的一类）

### 1. Registered Reports —— 结果前过审

**事实**（cos.io 实测抓取，2026-10）：300+ 期刊采用；stage 1 通过即 **in-principle acceptance**，不因结果撤销，仅在质量不达标、偏离注册方案、报告不清时撤销。

**为什么最硬**：把"结果不好看"这个最大拒稿风险提前消除。同时消除发表偏倚、低统计功效、选择性报告。

**落地**：`science_submission_route` 的 `registeredReport.viable` + 日历化的 stage 1/stage 2 时间线；`data/acceleration.json` 存门槛与 caveats。

**不适用**：探索性/描述性研究、纯计算方法。

### 2. Portable review —— 一次评审多刊承认

**事实**（reviewcommons.org 实测抓取，2026-10）：Review Commons 由 ASAPbio + EMBO 运营，affiliate 含 eLife、EMBO J、EMBO Reports、LSA、JCB、MBoC、PLOS Biology、PLOS Genetics、Genetics、G3、Genome Biology、Genes & Dev、Open Biology、J Gen Physiol；2024 起新增 Development 与 J Cell Sci（试点）。

**收益**：省 2–3 轮重复外审，每轮 2–4 个月。

**落地**：`science_submission_route` 的 `portableReview`；`journals.json` 每刊的 `portableReview[]` 字段；`science_journal_fit` 的 `needsPortableReview` 参数会让支持该机制的刊加分。

### 3. Transfer / cascade —— 带审稿意见转投

**落地**：`journals.json` 的 `transferChain`（每刊）+ `data/acceleration.json` 的 `transferChains`（出版商级）；`science_submission_route` 给链与 caveats。

**关键 caveat**：转投前判断原审稿意见对新刊是否仍适用。把针对 Nature 的 importance 批评带到子刊通常不再成立。

### 4. 预印本先行

**落地**：`journals.json` 每刊 `preprint` 字段（allowed / allowed-restricted / discouraged）；route 输出动作与时机。

---

## T2：编辑决策（desk reject 的真实原因）

### 5. 编辑三问

这个期刊的读者会在意吗 / 为什么是现在 / 为什么是我们。编辑初筛以分钟计。

**落地**：`science_cover_letter` 的第 1、2 段就是这三问的前两问，且给出"必须填的事实"与"要避免的套话"——工具不写成品句子，因为套话正是编辑一眼看穿的东西。

### 6. Scope 匹配优先于影响力量级

desk reject 第一杀手是投错刊，不是不够好。

**落地**：`science_journal_fit` 的 scope 子分占 45% 权重，输出 `matchedTopics` / `missingTopics`；命中 0 个时明确建议换刊而不是改稿。

### 7. 格式红线

字数/图数/参考文献超限是最容易被"即时退回"的一类（不需要判断学术价值）。

**落地**：`journals.json` 的 `limits`；`science_journal_fit` 的 `format` 子分与 `超限` 风险项；`science_paper_audit` 的 GEN-14。

### 8. 标题是断言，不是话题

**落地**：`science_paper_audit` GEN-01（"Study of / Investigation into" 前缀）+ GEN-02（novel/first 之类未兑现承诺）。

---

## T3：写作结构

### 9. C-C-C 递归

每个尺度（全文→节→段→句）都是 context → content → conclusion。

**落地**：`science-top-journal-writing` 技能（含四尺度对照表）。**不可自动检查**——这是组织原则，不是文本特征。

### 10. 摘要 5 句模板

背景 / 空白 / 做法 / 关键结果（带数字）/ 意义。

**落地**：GEN-03（长度）、GEN-04（数字个数）自动查；GEN-21 把"第 2 句是否写出空白"列为**待人工确认**，因为语义判断不可靠。

### 11. Figure-first

先定 Figure 1 的一句话信息，再组织正文。

**落地**：GEN-13 查"声明的图数是否都被正文引用"（可计算）；GEN-22 把"Figure 1 能否独立传达核心信息"列为人工项。

### 12. Introduction 漏斗

**落地**：技能内，不自动检查。

### 13. Discussion 给边界

**落地**：GEN-17 查 discussion 里有没有 limitation 表述；具体写什么由作者决定。

---

## T4：报告规范

### 14. 六套规范

CONSORT / PRISMA / STROBE / ARRIVE / TRIPOD / COREQ。

**落地**：`data/reporting-standards.json` 共 54 条规则，分 7 个 profile（general 22 + consort 8 + prisma 6 + strobe 5 + arrive 5 + tripod 4 + open-science 4）。每条带 `source` 与 `fix`。`science_paper_audit` 按 profile 组合执行。

### 15. TOP Guidelines 8 项

**落地**：`open-science` profile 4 条（数据引用、预注册声明、分析计划偏离、可复现信息）+ general 的 GEN-08/09。

### 16. 统计报告

效应量 + CI + 精确 n + 多重比较校正 + 缺失数据。

**落地**：GEN-05（n）、GEN-06（CI/SD）、GEN-07（只给 p 值）、GEN-16（显著当证明）。

---

## T5：审稿对抗

### 17–19. 逐条回应 / 分歧用数据辩 / 补实验分流

**落地**：`science_rebuttal` 切条 + 七类分类 + 每类动作 + 回应骨架；`science-rebuttal-playbook` 技能写三个反直觉规则（顺从引来更多要求、补实验要分流、统计质疑不能用文字回应）。

**分类是关键词启发式**，输出里明确写"可能误判，每条要人工确认"。

### 20. 被拒后的决策树

按拒稿理由（scope / format / novelty / method / significance / unknown）分流。

**落地**：`data/acceleration.json` 的 `decisionTree`；`science_submission_route` 支持 `rejectReason` 只返回相关分支。

---

## T6：期刊画像的可信度分级（M3）

### 21. 声明层 vs 实证层：为什么后者优先

一本刊的 `aims & scope` 是**营销文案**，写的是它希望收到什么。编辑桌上真实的稿子分布是另一回事。
两者冲突时，**以真实产出为准**——这是 M3 的核心方法论。

| 层 | 数据 | 权重 | 什么时候用 |
|---|---|---|---|
| 声明层 | `journals.json` 的 `scopeKeywords` / `designs` | scope .45 / design .20 / band .15 / format .10 / 加速 .10 | 无 OpenAlex 画像，或画像覆盖率 <80% |
| 实证层 | 近两年该刊论文按子领域分布 | scope .28 / **footprint .32** / design .18 / band .12 / format .06 / 加速 .04 | 覆盖率 ≥80% 且有稿件子领域映射 |

**为什么必须整批切换而不是逐刊混合**：同一批候选里混用两套权重，分数就不可比了——
一本刊用 0.45 权重的 scope 拿到 0.6，另一本用 0.28 权重拿到 0.6，这两个 0.6 不是一回事。
所以阈值判定是**批量级**的，覆盖率不足就整批退回，并在 `intelNote` 里说明原因。

### 22. footprint 的双路归一化

`hitShare`（你的子领域占该刊产出的比例）不能单看绝对值：

- 综合刊的最大子领域也只有 9%（Nature 的 Molecular Biology 9.1%）
- 专刊可以有 68%（Molecular Cell）

直接比大小会得出"综合刊不如专刊匹配"的错误结论。所以取两路平均：

```
absScore = min(1, hitShare / 0.10)        # 绝对占比，10% 即满分
relScore = min(1, hitShare / maxShare)    # 相对该刊自己的最大子领域
value    = 0.5 * absScore + 0.5 * relScore
```

再按 confidence 向 0.5 收缩（载文量 <500 或覆盖率 <0.9 时收缩一半），
避免小样本画像主导排序。

### 23. 三源各自的证据地位

| 源 | 地位 | 能推翻什么 | 不能推翻什么 |
|---|---|---|---|
| OpenAlex 产出分布 | **强证据**，参与排序（权重 .32） | 期刊自述的 scope | 单篇稿件的质量与新颖性 |
| SciRev 众包 | **中证据**，只做时间规划与难度预期 | "这本刊很快"这类传闻 | 排序（不进打分） |
| LetPub 自由文本 | **弱证据**，只做弱信号呈现 | 无 | 任何阻断逻辑（永不参与） |

样本 <10 条的众包数据降 `low` 并从排序调整中剔除；数据超 90 天标 `stale` 并降 confidence；
每个源独立失败，在 `degraded[]` 里点名缺哪一源，其余照常给结论——**不因为一个源挂了就整体沉默**。

### 24. 明确不做

- **不预测录用概率**。footprint 是"这类工作在该刊出现过几次"的统计，不是"你能中"的概率。
- **不做期刊排名**。不同学科的子领域口径不同，跨学科比 footprint 无意义。
- **不替代读刊**。`hitShare = 0` 只说明近两年零篇，可能是新方向，也可能是永不会发的方向——需人工判断。

---

## T7：知识转化（M4）——把实现变成主张

前六层都在处理「已有的论文」。这一层处理「还没有论文的东西」：一个 GitHub 仓库报了个数，
怎么判断它是不是可发表贡献的起点。

### 25. 观察不是主张

`Muon achieves a 1.35x speedup` 是**观察**。可发表的是「通过什么机制、在什么范围内、导致什么」。
两者之间缺的是机制陈述，而机制缺失无法用更多实验补——只能靠一个**直接测中间量**的实验
（测谱范数、测条件数、测梯度噪声），而不是再刷一个 benchmark。

这是代码仓转论文的第一死因：作者有十条记录，零条机制。

### 26. 缺口有五种，不是一种

「没人做过」是外行话。可操作的问法是：**这五类里缺哪类**。

| 方向 | 什么算已被覆盖 | 缺了意味着什么 |
|---|---|---|
| 理论保证 | convergence / regret / bound / theorem / proof | 只有实验，审稿人第一问就是「为什么」 |
| 规模验证 | large-scale / scaling / billion / at scale | 单点结果说服不了顶刊 |
| 跨域迁移 | transfer / cross-domain / generalization / OOD | 只在单一设置成立 → limited advance |
| 独立复现 | reproduc / replicat / independent verification | 自报数字没有第三方验证 |
| 统一评测 | benchmark / suite / leaderboard / evaluation framework | 各仓协议不同，数字不可比 |

判定必须**看摘要而不只看标题**——`Toward scalable optimizers` 这种标题里没有 scaling 相关词，
但它确实覆盖了规模方向。

### 27. 目标档位改变证据清单，不改变工作量排序

同一份工作，band 3 和 band 5 要的东西**不是同一件事**：

- `new-theory` band 3：标准假设下的收敛率 + 与 2-3 个基线对比 + 可复现实现。
- `new-theory` band 5：上下界匹配（或首个紧界）+ 假设弱于已有最好结果 + 理论常数项在真实模型
  上量级相符 + 跨 3 个数量级 2 个模态一致 + 能抽出可复用的设计原则。

差别不是「多写点」，是**多一个维度**。band 3 的清单再完美也填不满 band 5 的门槛，
因为它们量的不是同一件事。

由此推论：给工期时只能算目标档的未拥有项。把 4/5 档的清单也算进来，会让「目标是 band 3」
看起来比「目标是 band 5」更久——那是算术，不是现实。上行空间单独报。

### 28. 缺口类型与贡献类型必须配对

| 缺口 | 只能由这类贡献填 |
|---|---|
| 理论保证 | `new-theory` |
| 规模验证 | `empirical-law` 或 `new-algorithm` |
| 跨域迁移 | `unification` |
| 独立复现 | `negative-result` |
| 统一评测 | `benchmark` |

配错的典型：发现「缺理论」，然后设计了一个新算法去做更多实验。这是最常见的失败设计——
**用实验去填理论缺口，做完了洞还在。**

### 29. 标题是断言，不是话题

五个可操作的句式：

| 结构 | 适合 | 判据 |
|---|---|---|
| `{X} sets {Y}` | 机制主张 | X 决定 Y 的取值 |
| `{X} bounds {Y}` | 有定理 | 找到反例即倒 |
| `{X} governs {Y} across {Z}` | 跨规模普适 | 必须真的跨了规模 |
| `{X} does not {Y} when {Z}` | 反例 | 必须先排除自身失误 |
| `{X} is equivalent to {Y} under {Z}` | 统一 | 要能互相推出 |

三条自检：主语在前 5 词内吗、动词是方向词吗（不是「研究/探讨」）、能被一个实验或反例推翻吗。

判据来自第 8 条（标题是断言）。M4 只是把它变成可生成的结构槽——**不生成成品措辞**，
因为机械拼出来的句子会让作者改语法而不改主张。

### 30. Figure 1 与摘要第 2 槽

- **Figure 1 必须是核心发现**，不是示意图、不是流程图。把 Figure 1 和标题一起给别人看，
  他能否说出你在主张什么；不能就重画。理论工作最多在最后加一张假设与结论关系图。
- **摘要第 2 槽（空白）最容易漏**，也是编辑判断「为什么现在」的唯一依据。缺了它，
  整篇读起来是「我们又做了一个」，而不是「这里有个洞」。
- 第 4 槽必须有数字和样本量。只有「显著提升」等于没有结果。

### 31. 明确不做

- **不判断 claim 真伪**。工具只做结构化，每条 claim 的 `needsHumanReview` 恒为 `true`。
- **不宣称「全新」**。`verdict: gap` 的完整含义是「用这组关键词没查到」，不是「没人做过」。
  十源覆盖的是已发表与预印本，代码仓里的私有结果查不到。
- **不预测录用**。`credibility` 是「这个仓库值不值得读」，与能否发表无关。
- **不自动分中文词**。中文 claim 返回空关键词并明确要求人工提供——用整段中文检索只会更空。

---

## 存储：让"更快"变成可测指标

schema v3 新增五张表：

| 表 | 作用 |
|---|---|
| `manuscript` | 状态机 `draft→audited→submitted→under_review→rejected/transferred→accepted→published`；转投不改 id |
| `submission_event` | 时间线：preprint / submit / desk_reject / review_invited / review_returned / decision / transfer / accept |
| `audit_run` | 每次自检的阻断/警告/通过数与完整报告 |
| `claim` | 每条结论，状态由证据自动重算（unsupported / supported / partial / contradicted） |
| `evidence` | 证据：文献 quote + 页码 + 图号 + file_hash，或自有实验 |

schema v4 加 M3 三表：`journal_intel`（三源快照）/ `journal_topic`（产出分布）/ `review_corpus`（评审语料）。

schema v5 加 M4 四表：

| 表 | 作用 |
|---|---|
| `frontier_item` | GitHub 候选：stars/forks/52 周 commit/release/数学密度/关联论文 → 信誉分与分类 |
| `knowledge_claim` | 从 README 提炼的 claim：机制（原文）/ 预测 / 证伪条件 / 证据类型 / 置信 |
| `gap_entry` | 五方向缺口判定：已有几篇、缺什么、是否可发表 |
| `contribution_plan` | 贡献方案：类型 / 目标档 / 证据清单 / 门槛差距 / 候选刊 / 状态机 `draft→designing→ready` |

由此可算：**desk 决定天数、总周期、transfer 次数、审计修复轮次**，以及 M4 的
**从扫描到定稿的工序步数**。这些是"更快"的唯一可验证口径。

---

## 明确不做的事

1. **不预测录用概率**。`acceptRate` / `deskRejectRate` 在数据里标 `estimate: true`，只用于排序与展示，不参与任何阻断判定。拿它算"投 5 次中 1 次"没有依据。
2. **不做语义判断**。标题是否真 claim、摘要空白是否成立、Figure 1 是否承载核心信息——这些列为 manual 项，由 agent 读技能后判断。工具替人判会给出假阳性且无法追责。
3. **不写成品套话**。cover letter 输出论据槽位与"必须填的事实"，不输出句子。
4. **不承诺数据时效**。`journals.json` 超 12 个月未核验时，`science_journal_fit` 自动降 confidence 并提示自查官网。

## 数据来源与可信度

| 文件 | 来源 | 可信度 |
|---|---|---|
| `data/journals.json` | 官方 scope / author guidelines（字数图数、预印本政策）+ 上表两个清单 | 结构与政策项可靠；acceptRate/deskRejectRate/天数标 estimate |
| `data/reporting-standards.json` | CONSORT 2010 / PRISMA 2020 / STROBE / ARRIVE 2.0 / TRIPOD / TOP | 条目忠于原规范；摘取的是高频项，非全套 |
| `data/acceleration.json` | cos.io（实测抓取）/ reviewcommons.org（实测抓取）/ 出版商公开说明 | 名单与机制可靠；天数标 estimate |
| `data/contribution-types.json` | 审稿习惯总结（七类贡献 × 三档证据清单） | **启发式**，`$meta.nature: "heuristic"`；不是任何期刊的官方标准 |
| `data/frontier/optimization.json` | 8 个实测锚点，每个带 `observedAt` 与 `why` | 数值是抓取当时的真实值；`why` 是人工判断，会过期 |
