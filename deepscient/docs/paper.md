# 从数据到投稿级 PDF

这篇文档只讲一件事：**怎么让一篇论文从原始数据一路走到能交出去的 PDF/DOCX/JATS/HTML**，以及这条路上已知会断的地方。

判断类的东西（这个结论站不站得住、贡献够不够新）在 `science_paper_audit` 那一层，不在本文范围。本文只负责机械环节：数字对不对、要件齐不齐、版式合不合。

## 五个环节

| 环节 | 工具 | 产物 | 落在哪 |
|---|---|---|---|
| 数据 | `science_project_open` → `science_exp_run` | 受控目录、输入指纹 | `<DSH_HOME>/science/projects/<id>/` |
| 统计 | `science_stats` | 结构化结果（statistic/df/p/效应量/区间）+ 一句可直接抄的报数 | 库里 `analysis` 表 + `analysis.json` |
| 图 | `science_figure` | PDF + PNG，600 dpi，按栏宽 | 课题目录 `figures/` |
| 装配 | `science_manuscript_assemble` | 汇总表 + 图引用 + 报数句 | 稿件 `paper.md` 的标记块 |
| 出件 | `science_manuscript_build` | PDF / DOCX / JATS / HTML | 稿件 `build/` |

引文另有一条独立的路：`science_reference_add` 把条目写进 `references.yml`，正文用 `[@key]` 引用，build 时按目标刊的引文风格重排。手改 `references.yml` 也行，只要不动 `key`。

## 装配是怎么工作的

`science_manuscript_assemble` 只写 `paper.md` 里这一块：

```markdown
<!-- assemble:results:start -->
…表、图、报数句…
<!-- assemble:results:end -->
```

块外的散文一个字都不动，所以「让模型写论证、让工具填数字」可以并行，互不覆盖。连跑两次结果字节相同（`e2e-paper-run.mjs` 里有这条断言），因此可以放心把它放进脚本。

它从库里读两样东西：

- `analysis` 表里 `kind = 'stats'` 且 `ok = true` 的记录 —— 生成汇总表和报数句
- `figure_spec` 表 —— 生成图引用，并把图**复制**进稿件的 `figures/`

第二步容易被忽略：图原本落在课题目录，稿件目录是另一个地方。不复制的话，换台机器 or 换个目录出件就会报「图文件找不到」。装配工具现在会自动复制，并优先选 PNG（PDF 只有 LaTeX 能读，HTML 预览会缺图）。

## 表格与交叉引用的语法

Markdown 子集里，表注写在表**下方**、以 `: ` 开头，标签放句末：

```markdown
| 检验 | 样本 | 统计量 | p | 效应量 |
| --- | --- | --- | --- | --- |
| Welch 双样本 t 检验 | a=30, b=30 | t(56.21) = -5.08 | < .001 | Cohen's d = -1.31 |

: 表 1：主要分析结果汇总 {#tab:results}
```

正文里引用写 `\ref{tab:results}`、`\ref{fig:<figure id>}`。**不要写 `@tab:results`** —— `@` 是文献引用的前缀，写错会被判成「引用了一条不存在的参考文献」，这是最容易踩的一脚。

## 中文怎么出

front matter 不用加任何开关：正文里出现中文节标题，build 就用 `xeCJK` + `SimSun`（粗体落 `SimHei`），`ctex`/`fontspec` 在 MiKTeX 里默认就有。中文字体会嵌进 PDF，字体表里能看到 `SimSun` 且带 ToUnicode。

一个坑值得记下来：Windows 上 `pdftotext` 默认按 CP936 输出，抽中文会得到 `涓庣畝鍗曞弽搴旀椂浠诲姟` 这种串。那不是 PDF 错了，是抽取端编码错了 —— 把这串按 GBK 编回字节再按 UTF-8 解码，得到的是正确的「与简单反应时任务」。

## 期刊族与自动补类

换刊只改 front matter 的 `journal`。LaTeX 类缺了会自动跑 `mpm --install` 补，补不上就退回 `article` 并在 `warnings` 里点名缺哪个包，不静默降级。`science_format_check { deep: true }` 会真编译一个最小文档，把引擎、宏包、python-docx 的实际状态一次性摊开。

## 一次真实产出的数字

用随包示例数据（`data/examples/sleep-wm`，22 对配对观测）跑完整条链，落在一份 PLOS ONE 稿件上：

| 项 | 值 |
|---|---|
| 正文 | 1841 词（Introduction / Results / Discussion / Methods / Data availability） |
| 统计 | 2 条成功分析（Welch t 与 Mann-Whitney U，作为敏感性分析并排报告） |
| 图 | 1 张，600 dpi，PNG 复制进稿件 `figures/` |
| 表 | 1 张汇总表，`{#tab:results}`，正文 `\ref{tab:results}` 引用 |
| 文献 | 10 条，全部在正文被引，`cite-undefined` 与 `cite-uncited` 均为 0 |
| 要件检查 | `blocking = 0`，只剩一条 `words-unbounded` 提示（该刊未收录，无法比对字数上限） |
| 产物 | PDF 142 KB / 14 页（Letter、双倍行距、连续行号）· DOCX 82 KB · JATS 22 KB · HTML 19 KB |
| 已知残留 | 6 处 `Overfull \hbox`（长表格列宽），交稿前调列宽 |

## 自检

```powershell
node deepscient/scripts/e2e-paper-run.mjs      # 20 项断言，含幂等与图复制
node deepscient/scripts/e2e-paper-run.mjs --keep   # 保留临时稿件，出问题看现场
```

这条脚本不调模型：它建稿、装配、加文献、跑 lint、出四件、用 `pdfinfo` 和 `pdftotext` 验证页数与文字。绿了只说明机械环节没断，不说明论文写得好——这正好是它该负责的边界。

## 已知断点

| 现象 | 原因 | 处理 |
|---|---|---|
| `figure-file-missing` | 图只在课题目录 | 跑 `science_manuscript_assemble`，它会复制 |
| `cite-undefined: tab:xxx` | 正文写了 `@tab:xxx` | 改成 `\ref{tab:xxx}` |
| `xref-dangling: tab` | 表注写成了标题行、或标签不在 `: ` 行末 | 按上面的表格语法写 |
| `cite-undefined: <key>` | 骨架的 front matter 没指 `referencesFile` | 0.5.0 起建稿会自动写 `referencesFile: references.yml`；老稿件手动补一行 |
| `abstract-long` | 摘要有硬上限 | 按提示删词，别删结构 |
| `Overfull \hbox` | 表格比栏宽 | 少一列、或把长数字列换成量级写法 |
