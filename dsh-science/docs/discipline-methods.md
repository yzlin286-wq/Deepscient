# 各学科的方法与工具：怎么查、怎么用

这份文档是 `data/disciplines/*.json`、`data/statistics.json`、`data/tools/registry.json`
三份数据的人工说明。数据是权威，文档是导读——两者冲突时以数据为准。

## 一、学科包是什么

`data/disciplines/` 下有 13 个文件：12 个真实学科 + 1 个 `generic` 兜底。

| id | 学科 | 典型设计数 | 是否有人体/动物伦理要求 |
| --- | --- | --- | --- |
| `biomed` | 生物医学与临床 | 7 | 是 |
| `neuroscience` | 神经科学 | 6 | 是 |
| `psychology` | 心理学与行为 | 6 | 是 |
| `economics` | 经济学与计量 | 5 | 视数据来源 |
| `ml-cs` | 机器学习与计算机 | 5 | 否（人类评测除外） |
| `chemistry` | 化学 | 6 | 否（细胞系需说明） |
| `materials` | 材料科学 | 7 | 否 |
| `physics` | 物理与天文 | 5 | 否 |
| `earth-env` | 地球与环境 | 6 | 否（野外观测需许可） |
| `engineering` | 工程 | 5 | 视项目 |
| `agri-food` | 农业与食品 | 6 | 是（动物试验、感官评测） |
| `social-humanities` | 社会科学与人文学 | 5 | 是（访谈、档案） |
| `generic` | 兜底 | 3 | — |

每个包有 13 个键：

| 键 | 内容 | 怎么用 |
| --- | --- | --- |
| `designs` | 该学科认可的研究设计，含 `when` / `requires` / `nRule` / `threats` / `why` / `source` | S2 选设计 |
| `measurements` | 变量怎么测：单位、做法、产出物、校准 | S4 落测量 |
| `methods` | 分析方法与各自的坑（`pitfall`） | S7 选方法 |
| `coreTools` | 该学科真的会用的软件/库，指向工具注册表 | 环境准备 |
| `reporting` | 机器可校验的报告规范 id（`consort` / `prisma` / `arrive` …） | S9 lint |
| `reportingExternal` | 无法机器校验的规范（COBIDAS、ICH、ASTM …），小写 slug | S9 人工对照 |
| `statsDefaults` | 该学科默认的 α、校正方法、效应量类型 | 预填 `science_stats` 参数 |
| `benchmarks` | 领域的**方法学门槛**（不是录用率） | 自查够不够格 |
| `reviewerAttacks` | 审稿人最常打的点与应对 | S10 内审 |
| `exemplarStructure` | 该领域顶刊论文的段落骨架 | S9 写作 |
| `aliases` | 中英文别名，用于匹配 | `matchDiscipline` |
| `headline` / `label` | 一句话定位与显示名 | 由 `_index.json` 拥有，包内不重复声明 |

### 为什么 `label` 只由 `_index.json` 拥有

早期版本里，索引与包各写一份 `label`，两边一旦不一致，工具输出就会在同一句话里
出现两个学科名。现在 `loadDiscipline()` 会用 `_index.json` 的 `label`、`headline`、
`journalFamilies`、`defaultReporting`、`coreTools`、`aliases` 覆盖包内同名字段——
注册信息只有一处真相。

### 学科是怎么匹配上的

`matchHints.order = [explicit, journalFamily, aliasExact, aliasContains, keyword, fallback]`

1. `explicit`：用户直接给了学科 id 或显示名。
2. `journalFamily`：给了目标期刊，按 `journal-formats.json` 的期刊族反查学科。
3. `aliasExact` / `aliasContains`：中英文别名命中。
4. `keyword`：问题文本里的方法词（"双重差分" → `economics`）。
5. `fallback`：`generic`。

返回里带 `matchedBy` 与 `confidence`。`confidence: low` 时要在汇报里说出来，
不要假装匹配可靠。

## 二、统计：44 个检验、28 个效应量、7 个决策节点

`data/statistics.json` 的结构：

```
decisionTree  7 个节点：outcome → design-* → separate-corrected / any-then-correct
tests         44 个检验
  family          compare | associate | predict | survive | resample | dimension
  outcome         该检验接受的结局类型
  design          该检验要求的设计
  requires        组数、最小样本、备注
  assumptions[]   每条带 check 方式与不满足时的 action
  fallback[]      假设不满足时改用的检验 id（必须真实存在）
  effectSizes[]   配套效应量 id（必须真实存在）
  power           { fn, params } 与其他检验共用功效函数
  py / r          最小可运行片段
  reportAs        正文句式模板
  misuse[]        常见误用：wrong / why / right / source
  why / source    为什么用它、出处
effectSizes   28 个效应量，含公式、区间算法、解释阈值
corrections   5 种多重比较校正
powerFns      10 个功效函数（走 statsmodels）
```

### 已实现 vs 未实现

`scripts/py/stats_run.py` 实现 25 个检验族（覆盖多数日常分析）：
`ttest-welch`、`ttest-rel`、`mannwhitney`、`wilcoxon`、`anova-oneway`、`welch-anova`、
`kruskal`、`friedman`、`pearson`、`spearman`、`kendall`、`chi2`、`fisher`、`mcnemar`、
`ols`、`ols-robust`、`logit`、`poisson`、`mixedlm`、`permutation`、`bootstrap-median`、
`tost`、`pca`、`kaplan-meier`、`logrank`。

其余检验调用 `science_stats` 会返回：

```json
{ "ok": false, "method": "unsupported",
  "hint": "把它写成 code/stats.py 交给 science_exp_run 跑；statistics.json 里该条目有可直接复制的 py 片段。",
  "supported": ["anova-oneway", "..."] }
```

这是刻意的：假装支持一个检验，比明确说不支持危险得多。用户拿到 `py` 片段自己写脚本，
再用 `science_exp_run` 跑，整条链仍然是留痕的。

### 假设检查是结果的一部分

每次返回都带 `assumptions[]`，每项有 `ok: true | false | null`：

- `true`：检查通过。
- `false`：不满足。同时 `warnings[]` 给出 `fallback[]`——来自 `statistics.json` 的登记，
  不是临时想的。
- `null`：无法机器检查（比如"两组独立"，那是设计问题）。这类要人自己确认。

### 卡方：Yates 必须显式声明

2×2 表默认用 Yates 连续性校正，并在 `uncorrected` 里同时给出未校正值。
例：`[[30,20],[15,35]]` → 校正后 χ² = 7.92（p = .005），未校正 9.09（p = .003）。
两者都不算错，但正文必须说明用的是哪个。

## 三、工具注册表：60+ 个工具怎么查

`data/tools/registry.json` 每条：

| 字段 | 含义 |
| --- | --- |
| `id` / `label` | 工具标识与显示名 |
| `kind` | `python` / `r` / `gui` / `cli` / `service` |
| `domain[]` | 属于哪些学科 |
| `install` | 装法（conda / pip / 下载页） |
| `minimalScript` | 最小可用示例；图形界面工具写 `（图形界面）` |
| `alt[]` | 装不上时的替代 |
| `offline` | 能否离线用。`false` 的工具在 `env/nonet` 下会失败 |
| `license` | 许可类型（商用/学术免费/需申请） |

### 本机实际装了什么

Python 3.12.10。**已装**：numpy、scipy、pandas、matplotlib、seaborn、statsmodels、
scikit-learn、sympy、networkx、numba、rdkit、ase、cvxpy、jupyter_client、openpyxl、
python-docx、PyMuPDF、nbformat。

**未装**：lifelines、pymc、astropy、biopython、xarray、h5py、dask、shap、pytest、
papermill、pingouin。

未装的影响已经就地处理：

- `fine-gray`、`firth-logit`、`rmst` 在 `statistics.json` 里标注为**自实现**，
  并在 `requires` 里写明不强依赖 lifelines / pymc。
- 生存分析基础能力（Kaplan-Meier、log-rank）由 `stats_run.py` 自己实现，不依赖 lifelines。

### 图形界面工具

`minimalScript: "（图形界面）"` 的工具（如某些质谱软件、EEG 分析套件、CAD）
不能由代理代点。遇到这类工具：

1. 说明要装什么、在哪下。
2. 给出参数该怎么设、产出文件该放哪。
3. 让用户自己操作，然后把产出文件放回 `data/` 或 `figures/`，再用 `science_exp_run` 补录执行记录。

不要假装跑过。

## 四、LaTeX 与排版环境

MiKTeX 25.12。已装文档类：`elsarticle`、`IEEEtran`、`revtex4-2`、`nature`、`achemso`、
`amsart`、`ctexart`、`article`。

缺：`sn-jnl.cls`（Springer Nature）、`bmcart.cls`（BMC）、`setspace.sty`。

`science_format_check` 会报出缺什么。缺的时候两条路：

1. 用 MiKTeX 的自动安装补上（首次编译会弹窗，或 `mpm --install=<pkg>`）。
2. 接受降级到 `article` + 手工排版，**并在交稿说明里写清降级了**。

注意：`nature.cls` v1.0 重定义了 `figure` 环境，会把 `[htbp]` 印成正文。所以 nature 族
走 `article` + Nature 投稿版式的组合，不用 `nature.cls`。

## 五、数据文件的维护约定

- 所有领域知识都在 `data/*.json`，代码里**零**学科事实。
- 每个 JSON 第一项是 `$meta`，含 `updatedAt`。
- 改了数据就要重跑对应的 verify 脚本：

| 改了 | 跑 |
| --- | --- |
| `statistics.json` | `node scripts/verify-discipline.mjs` |
| `disciplines/*.json`、`_index.json` | `node scripts/verify-discipline.mjs` |
| `workflow.json` | `node scripts/verify-lab.mjs` + `smoke-lab.mjs` |
| `tools/registry.json` | `node scripts/verify-discipline.mjs` |
| `examples/*` | `python scripts/py/make_examples.py` 然后 `node scripts/verify-stats.mjs` |
