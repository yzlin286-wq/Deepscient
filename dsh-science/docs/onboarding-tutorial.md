# 上手教程：从零到一个能投稿的课题

这份教程假设**你没有做过研究**，或者只在课上做过作业级实验。
它不讲方法论的道理（那些在 `docs/discipline-methods.md` 和技能里），
只讲你在这个应用里按什么顺序点、每一步该看到什么。

---

## 第 0 步：体检（1 分钟）

```
science_preflight
```

它会告诉你：数据根在哪、SQLite 能不能写、Python 是什么版本、哪些检索源可用。

看到 `ok: true` 就往下走。有红项就先看 `error` 字段里那句具体的话——通常是路径或网络问题，
不是"系统坏了"。

---

## 第 1 步：建课题（2 分钟）

```
science_project_open {
  title: "睡眠剥夺对工作记忆容量的影响",
  domain: "心理学",
  question: "24 小时完全睡眠剥夺是否降低健康成人的工作记忆容量",
  ethics: { approvalId: "IRB-2026-011", committee: "校伦理委员会", body: "人类", consent: "书面知情同意" },
  dataLicense: "CC BY 4.0"
}
```

三个字段值得解释：

- **`question`**：写成「对象 + 自变量 + 因变量 + 时点」。一句能读完的话。
  "睡眠和工作记忆的关系"不是研究问题，是话题。
- **`domain`**：可以写中文，也可以写 `psychology`。匹配器会给出 `matchedBy` 与 `confidence`。
- **`ethics`**：涉及人就填，不涉及也写 `body: "不涉及"`。
  这不是形式主义——半年后写方法段时，你会需要这个批号，而那时你已经不记得了。

返回里 `missing` 会列出还缺什么。现在应该是"方案"和"预注册"。

它同时建好了目录：

```
<数据根>/science/projects/睡眠剥夺对工作记忆容量的影响-20261021-a1b2/
  data/         原始数据只放这里，只读
  code/         分析脚本
  figures/      图
  protocols/    测量协议、问卷、刺激材料
  env/          环境快照
  experiments/  每次执行的目录
```

---

## 第 2 步：看流程在哪一步（10 秒）

```
science_study_coach { projectId: "<上一步的 id>" }
```

它会给你：

```
当前阶段：S1 文献与现状
这一阶段要解决的问题：知道这个问题被做到哪一步，并留下可核验的检索记录。

全流程：
· S0 选题与范围 — 警告 1
✗ S1 文献与现状 — 阻塞 1，警告 2
✗ S2 假设与设计 — 阻塞 3
...
```

**`✗` 是有阻塞，`·` 是有警告或还没判定。** 没有 `✓` 之前不要往后跳——
尤其不要在 S2 没做完时开始写引言。

---

## 第 3 步：文献（20 分钟到几小时）

```
science_lit_query { q: "sleep deprivation working memory capacity", limit: 30 }
science_gap_matrix { projectId: "<id>", topic: "sleep deprivation working memory" }
```

`science_lit_query` 会去 OpenAlex / Crossref / arXiv 等源检索，把结果落库并给 DOI。
`science_gap_matrix` 把这些结论排成矩阵，让你看到**哪一格是空的**——那就是你的位置。

这一步的产出不是"我读了几篇"，而是：

- 库里有 ≥10 条记录（门会检查）。
- 每条有 DOI 或明确的来源。
- 你能用一句话说出"别人做到哪、没做到哪"。

不要在汇报里写"我读了大量文献"。写"检索了 X 数据库，时间窗 Y，得到 Z 条，其中 N 条直接相关"。

---

## 第 4 步：设计与方案（30 分钟，但要多想）

先看这个学科怎么做研究：

```
science_discipline_profile { domain: "psychology" }
```

返回里有 `designs`（可用设计）、`measurements`（怎么测）、`methods`（怎么分析）、
`reviewerAttacks`（审稿人会打哪）、`benchmarks`（方法学门槛）。

选区组间设计，然后出方案：

```
science_exp_plan {
  projectId: "<id>",
  designId: "between-2",
  hypothesis: "24 小时睡眠剥夺会降低工作记忆容量，因为前额叶维持功能受损",
  primaryOutcome: "工作记忆容量（OSPAN 分数）",
  effect: 0.5
}
```

**`effect: 0.5` 是最关键的参数。** 它决定样本量。0.5 是 Cohen's d 的中等效应。
如果你不知道真实效应有多大，两种做法：

1. 找同领域同测量的元分析效应量（最好）。
2. 先做 pilot，用 pilot 的效应量，并在正文说明它的不确定性。

它会返回：

- **`sample`**：每组 64，总计 128（statsmodels 算的，不是拍的）。
- **`requires`**：这个设计成立的前置条件清单，逐条打勾。
- **`threats`**：威胁与对策。
- **`reviewerAttacks`**：审稿人会先打哪。
- **`gates`**：关口检查。`blocking: 0` 才能往下走。

如果 `blocking > 0`，按 `fix` 字段修。它给的是可以直接复制的下一步。

### 样本量不够怎么办

反过来算：给定你能招到的人，能检测到多大的效应。

```
science_exp_plan { projectId: "<id>", designId: "between-2", n: 30 }
```

如果 MDE 是 d = 0.74，而你领域的真实效应大概是 0.4——那这个研究**做不出结论**。
这不是失败，这是提前知道了一件重要的事。换设计、换测量、或者换问题。

---

## 第 5 步：预注册（30 分钟，但能救你）

方案里的 `prereg` 段是一份 OSF/PROSPERO 表格草稿。把它填完（"待写"的地方必须填掉），
提交，拿到 DOI，填回课题：

```
science_project_open 的返回会一直提示缺预注册，直到你填了 prereg_ref。
```

预注册的意义：**在看数据之前**把主结局、样本量、分析计划写死并公开。
事后改计划不是不行，但要在稿件里声明为探索性。

---

## 第 6 步：采数据（最花时间的一步）

原始数据放 `data/`。格式随便，CSV 就好，但要满足：

- 一行一个观测（长表）或一行一个被试（宽表），**不要合并单元格**。
- 缺失写 `NA` 或留空，**不要写 0**。0 和缺失是两回事。
- 分组信息必须在某一列里，不能只存在你脑子里。

数据字典写进 `protocols/`：每列什么意思、单位、取值域、缺失编码。

---

## 第 7 步：分析（关键的一步）

### 7.1 先用 code/ 跑通

```python
# code/clean.py
import pandas as pd
df = pd.read_csv('data/raw.csv')
df.to_csv('data/clean.csv', index=False)
```

```
science_exp_run {
  projectId: "<id>",
  slug: "clean",
  script: "code/clean.py",
  inputs: ["data/raw.csv"],
  seed: 42
}
```

它会记下：脚本、输入 sha256、输出 sha256、Python 与库版本、seed、是否联网。
`status: "ok"` 才算跑通。失败也会留痕——**这是特性，不是 bug**。

两件容易踩的事：

- **脚本的工作目录是项目根**，不是 run 目录。所以 `open('data/raw.csv')` 就是你心里那个路径。
  要往 run 目录里写东西，用环境变量 `DSH_RUN_DIR`（另外还有 `DSH_PROJECT_DIR`、`DSH_SEED`、`DSH_RUN`）。
- **Python 层默认断网**（`DSH_LAB_NO_NETWORK=1` 会拦 `socket.connect`）。分析阶段不该联网；
  确实需要就传 `network: true`，记录里会写明。注意它管不住 `curl` 这类子进程。

### 7.2 再算统计

```
science_stats {
  projectId: "<id>",
  testId: "ttest-welch",
  csvPath: "data/clean.csv",
  columns: {
    a: { column: "span", where: { group: "deprived" } },
    b: { column: "span", where: { group: "rested" } }
  }
}
```

`where` 是长表的解法：不用先去 Excel 里把表拆成两列。

返回里最重要的是**顺序**：

1. **`assumptions`** —— 先看这个。正态性、方差齐性过不过。
2. **`warnings`** —— 不过的话，`fallback` 给了该换什么检验。
3. **`p`** —— 第三步才看。
4. **`effectSize`** —— 带 CI。**CI 跨 0 时不能只凭 p 说有效。**
5. **`markdown`** —— 可以直接改进正文的结果段草稿。

### 7.3 稳健性检查

至少做一项，并报一致性：

- 非参数对照（`mannwhitney` / `wilcoxon`）
- 去离群点重跑
- 换协变量重跑

方向一致是稳健性证据；方向变了要解释，不能挑一个报。

### 不知道用哪个检验

```
science_statistics_choice 的决策树：
outcome（连续/二分类/计数/生存/序数）→ design（几组/配对否/重复测量）→ 具体检验
```

或者直接看 `data/statistics.json` 的 `decisionTree`。

---

## 第 8 步：图（20 分钟）

```
science_figure {
  projectId: "<id>",
  kind: "bar",
  csvPath: "data/clean.csv",
  columns: {
    g1: { column: "span", where: { group: "rested" } },
    g2: { column: "span", where: { group: "deprived" } }
  },
  errorType: "ci95",
  ylabel: "OSPAN 分数",
  preset: "single-column",
  analysisId: "<上一步的 id>"
}
```

三个必给：

- **`preset`**：`single-column` 是 85 × 60 mm。按物理尺寸排版，字号才不会被缩放毁掉。
- **`errorType`**：`sd` / `sem` / `ci95`，**没有默认值**。不说明的误差棒一定会被问。
- **`analysisId`**：把图和产生它的分析关联起来，图与正文数字才对得上。

返回 `ready: true` 表示通过四项自检（字号 ≥6 pt、有矢量、≥300 dpi、宽度合理）。

---

## 第 9 步：写作（几小时到几天）

```
science_manuscript_new { projectId: "<id>", id: "sleep-wm-paper", journal: "plos-one" }
```

生成 `paper.md`（YAML 头 + Markdown 正文）。带 `projectId` 时它还会在库里记一条索引行
（只记 id / 题目 / 目标刊 / 字数，正文仍在文件里），S9 的门才看得到这篇稿。

然后：

```
science_manuscript_lint  { id: "sleep-wm-paper" }     ← 查要件，结论写 lint.json
science_manuscript_build { id: "sleep-wm-paper", targets: ["all"] }  ← 出 PDF/DOCX/JATS/HTML，写 build.json
```

`lint` 的 `block` 级问题（字数超限、摘要超长、图超张数、引了不存在的文献、悬空交叉引用）
必须修完再出件。`cite-uncited`（文献表里有没被引的条目）是 desk reject 的常见理由。

图要在稿件的 `figures/` 里（`science_figure` 出在课题的 `figures/`，投稿时复制过去）。

换刊只改 front matter 的 `journal`，不要复制第二份稿子。

---

## 第 10 步：内审与投稿

```
science_paper_audit { projectId: "<id>" }
science_provenance  { projectId: "<id>" }
science_submission_route { journal: "plos-one" }
science_cover_letter { projectId: "<id>", journal: "plos-one" }
```

`science_provenance` 的 `verified: true` 很重要——它证明这条链上的每一步都是按顺序发生的，
没人改过记录。链断了要先查清，再写方法段。

投稿后收到审稿意见：

```
science_rebuttal { projectId: "<id>", comments: "<审稿意见原文>" }
```

一条意见一条回应。能改的改，不能改的给理由与替代方案。不要和审稿人争对错。

---

## 常见卡点速查

| 症状 | 真实原因 | 怎么办 |
| --- | --- | --- |
| `science_stats` 说 `method: "unsupported"` | 这个检验没实现 | 用返回的 `hint`，把 `py` 片段写进 `code/` 再用 `science_exp_run` 跑 |
| 正态性不满足 | 数据偏态或有离群点 | 用 `warnings[].fallback` 换检验，报方向是否一致 |
| `科学` 匹配结果为 `generic` | 学科名不在别名表里 | 给 `domain` 一个明确 id，或指定 `targetJournal` |
| 图 `ready: false` | 字号太小、没矢量、dpi 低 | 按 `checks` 逐项修；`single-column` + `dpi: 600` + PDF |
| 教练一直停在 S1 | 库内文献 <10 或没检索记录 | 补检索，`science_lit_query` 落库 |
| `science_exp_run` 报网络被拦 | Python 层无网 | 采集阶段做完下载；确实需要就 `network: true` 并说明 |
| 溯源链 `hash-mismatch` | 有人改过库 | 先查清谁在什么时候改的；改不回来就如实说明版本 |
| 样本量算不出 | 没给效应量也没给 n | 给 `effect`（找元分析值）或给 `n`（算 MDE） |

---

## 三条不要做的事

1. **不要在看到结果之后改主结局或换检验。** 那一步一旦迈出去，后面所有数字都要重做，
   而且如果发表后被查出来，代价不是重做能解决的。
2. **不要删原始数据。** 清洗结果另存。`data/` 只读。
3. **不要写"接近显著"。** p 是连续量，没有边缘。要么显著，要么不显著，要么去做等效性检验。

---

## 一句话总结

这个应用不会替你做出发现，也不会告诉你结果会不会被接受。

它保证的是：**你做的每一步都有记录，能被别人重跑，能被你自己半年后看懂。**
顶刊与普通刊的差别，很大一部分就在这里。
