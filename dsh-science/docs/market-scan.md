# 期刊论著写作系统：市面调研与借鉴清单

> M5 任务 2 的产出。目的有两个：一是确认我们要做的事别人做到哪一步了（避免重复造轮子），
> 二是把**能合法拿来用的东西**和**只能看不能抄的东西**分清楚——这一步不能凭感觉，得看许可。
>
> 数据取自 GitHub REST API（`/repos/{owner}/{repo}`），抓取时间见各表 `pushed` 列；商业产品
> 部分来自公开产品文档与定价页。星数为抓取时的实际值，不是估的。

---

## 0. 一句话结论

这个赛道分成两半：**排版引擎**（Overleaf / Quarto / Typst / LaTeX 类文件）已经非常成熟且大多开源，
**"从研究内容到期刊格式"这一段的自动化**才是空档——现有的工具都是"给你一个空壳模板，内容自己写"，
没有一个把「证据链 → 论证结构 → 目标刊要件 → 四格式出件」串成一条流水线。

所以我们的定位不是再做一个编辑器，是补上 `dsh-science` 里缺的那一段：**M5 只做"内容已经有了之后"的机械化部分**，
编辑器那一层（Overleaf/Fidus Writer 的形态）不重做，靠 `paper.md` 这种纯文本源去和它们共存。

---

## 1. 开源项目全景

### 1.1 在线协作 LaTeX / 结构化编辑器

| 项目 | 星 | 许可 | 最近推送 | 语言 | 是什么 |
|---|---:|---|---|---|---|
| `overleaf/overleaf` | 18,255 | AGPL-3.0 | 2026-09-17 | JavaScript | 浏览器里的协作 LaTeX 编辑器，事实标准 |
| `fiduswriter/fiduswriter` | 568 | AGPL-3.0 | 2026-10-20 | JavaScript | 面向人文社科的协作写作 + 引文 + 导出 |
| `pkp/texture` | 30 | GPL-3.0 | 2026-07-10 | JavaScript | 给 OJS 用的 JATS XML 所见即所得编辑器 |
| `pubpub/pubpub` | 546 | GPL-2.0 | 2026-10-20 | TypeScript | 社区出版平台，稿件即网页 |
| `peerj/paper-now` | 620 | MIT | 2022-12-09 | HTML | GitHub 仓库 → 期刊排版页面（已停更） |

**能借鉴的**

- **Overleaf**：单一源文件 + 实时编译 + 编译日志面板。它的 `clsi`（编译服务）设计值得抄思路：
  每次编译在隔离容器里跑，把 stdout/stderr 解析成结构化的 `errors/warnings/typesetting` 三类回传前端。
  我们 M5 的 `readLatexLog()` 就是同一个思路的精简版——不返回 exit code，返回 `{message, context.line, context.text}`。
  它的 `docstore` 用"行级 diff + 定期 snapshot"存历史，这个我们用 git 替代，不自己做。
- **Texture**：JATS 的节点模型（`element → attributes → text`）+ 一个 schema 驱动的属性编辑器。
  我们的 `jats.js` 借鉴了它的最小节点集：`front / body / back` 三段 +
  `element-citation publication-type` 映射表，而不是硬编码某一家出版社的 DTD。
- **Fidus Writer**：它做对了一件事——**把引文和正文分开存**，正文里只存 citation key，
  导出时才按目标样式渲染。这正是我们 `paper.md` + `references.yml` + `cite.js` 的结构。
- **paper-now**：证明了"稿件可以就是仓库里的一堆纯文本"，但它死在"排版质量上不去"。
  反过来说明：纯文本源可以，但**必须有一个真排版引擎兜底**（我们用 xelatex）。

**不能碰的**：Overleaf 和 Fidus Writer 都是 AGPL-3.0。抄一行代码进来，整个 `dsh-science` 就得跟着 AGPL。
以上只借架构判断，代码全部重写。

### 1.2 LaTeX 期刊模板库

| 项目 | 星 | 许可 | 最近推送 | 是什么 |
|---|---:|---|---|---|
| `rstudio/rticles` | 1,539 | GPL-3（DESCRIPTION 声明，GitHub 未识别 SPDX） | 2026-10-01 | R Markdown 的 40+ 期刊模板集合 |
| `quarto-journals/*` | 16–24 | MIT | 2023–2026 | Quarto 的期刊模板（jasa、plos、acs 等） |
| `typst/templates` | 429 | MIT-0 | 2026-03-20 | Typst 官方维护的模板 |

**rticles 的模板清单**（这是整个生态里最全的一份）：acm, acs, aea, agu, ajs, amq, ams, arxiv, asa,
bioinformatics, biometrics, copernicus, ctex, elsevier, frontiers, glossa, ieee, ims, informs, iop,
isba, jasa, jedm, joss, jss, lipics, lncs, mdpi, mnras, oup_v0, oup_v1, peerj, pihph, plos, pnas, rsos,
rss, sage, sim, springer, tf, trb, wellcomeor。

**能借鉴的**：这份清单直接告诉我们**该覆盖哪些族**。我们的 `journal-formats.json` 里有 13 个族，
对着它核了一遍覆盖度：

| rticles 有、我们靠哪个族兜 | 说明 |
|---|---|
| acm, ieee, informs, lipics, lncs | `ieee` 族（IEEEtran 同源）或 `generic` + article |
| acs, aea, ams, asa, jasa, isba, rss | `acs` / `mlr` / `generic` |
| elsevier, iop, copernicus, springer, tf, oup, sage, mdpi, frontiers, bmc, pnas, rsos, plos, peerj, joss, wellcomeor | `elsevier` / `springer-nature` / `wiley` / `bmc` / `plos` / `science` |
| ctex, glossa, pihph, mnras, trb, sim, jedm, ajs, amq, agu, bioinformatics, biometrics, arxiv | `generic`（A4 + 双倍行距 + 行号，投稿稿通用形态） |

**注意**：rticles 是 GPL-3，**模板文件不能复制**。但各出版社自己的 `.cls`/`.bst` 是 LPPL
（LaTeX Project Public License），本身就允许直接 `\documentclass{}` 引用——所以我们走的是
"调出版社的类"这条路，不是"抄别人的模板"。这两件事在法律上完全不同。

### 1.3 排版与格式转换引擎

| 项目 | 星 | 许可 | 最近推送 | 语言 | 是什么 |
|---|---:|---|---|---|---|
| `typst/typst` | 56,725 | Apache-2.0 | 2026-10-20 | Rust | 现代标记语言排版系统 |
| `quarto-dev/quarto-cli` | 6,104 | NOASSERTION（MIT + 第三方） | 2026-10-20 | JavaScript | 基于 Pandoc 的科技出版系统 |
| `stencila/stencila` | 909 | Apache-2.0 | 2026-10-20 | Rust | 可执行文档（含代码结果） |
| `manubot/manubot` | 476 | NOASSERTION | 2026-08-02 | Python | 用 git + CI 自动出稿的稿件系统 |

**能借鉴的**

- **Quarto**：`_quarto.yml` 里一个 `format:` 字段决定全部输出形态，同一份 `.qmd` 出 PDF/DOCX/HTML/EPUB。
  我们的 `paper.md` 里一个 `journal:` 字段切四个渲染器，是同一个设计。
  Quarto 的教训也记下了：它靠 Pandoc 做转换，而 Pandoc 的 LaTeX 输出对期刊类支持很弱
  （`--reference-doc` 只能改样式，改不了 `\documentclass`）。我们没有 pandoc，反而被迫做对了——
  直接从 AST 生成 `.tex`，类和选项自己控制。
- **Manubot**：`usefulness` 判断——它证明"纯文本 + CI 出稿"这条路能跑通（JOSS 上有真实论文这么发过）。
  它的问题是没有格式合规检查：写完就出 PDF，字数超了、引文漏了没人拦。这正是我们 `lint.js` 补的洞。
- **Typst**：如果将来要摆脱 LaTeX 依赖，Typst 的模板系统（`typst/templates`，MIT-0）是最好的替代品。
  现在不切，因为出版社只认 `.cls`。

### 1.4 引文与参考文献

| 项目 | 星 | 许可 | 最近推送 | 是什么 |
|---|---:|---|---|---|
| `citation-style-language/styles` | 3,918 | CC BY-SA 3.0 | 2026-10-19 | 官方 CSL 样式库，10,000+ 种期刊样式 |
| `Juris-M/citeproc-js` | 366 | CPAL / AGPL 双许可 | 2026-07-05 | CSL 的 JavaScript 实现 |

**这是整个赛道里最关键的一块，也是我们做取舍的地方。**

- 完整方案：接 `citeproc-js` + 下载对应 CSL XML。能拿到 10,000+ 期刊的精确格式。
- 我们的方案：自己写一个**微型 CSL 子集**（`data/citation-styles.json`，6 种风格），
  覆盖 GB/T 7714、APA 7、Vancouver、Nature、IEEE、Cell。

为什么不接 citeproc-js：
1. 依赖：`citeproc-js` 是 CPAL/AGPL 双许可，塞进 MIT 的包里不合适；
2. 运行环境：CSL 需要 locale XML + 样式 XML + 正则处理器，在 dsh 的插件沙箱里是三个额外的 IO 依赖；
3. **投稿阶段的真实需求不需要 10,000 种**——作者只投一个刊，只需要那一个刊的格式。

**许可边界**：CSL 样式文件是 CC BY-SA 3.0，可以改可以再分发但要同协议。我们的
`citation-styles.json` 是**自己写的格式化规则描述**（"作者超过 5 人降为 et al."这类事实），
不是 CSL XML 的翻译或改写，因此不构成衍生作品。这一点在 `data/citation-styles.json` 的
`$meta` 里也写明了。

### 1.5 投稿与评审平台

| 系统 | 性质 | 关键点 |
|---|---|---|
| Editorial Manager（Aries） | 商业，最主流 | 上传 Word/PDF，自动抽元数据，格式不合规直接拒收 |
| ScholarOne（Clarivate） | 商业 | 同上，强依赖 Word 稿 |
| OJS / Janeway | 开源（OJS 是 GPL-3） | 要 XML（JATS）或 DOCX |
| Scholastica | 商业 SaaS | 轻量，偏小刊 |
| JOSS（`openjournals/joss`，1,927★，MIT） | 开源期刊 | **要 GitHub 仓库 + 一份 `paper.md`** |

**JOSS 这条最值得抄**：它的投稿物就是 `paper.md` + `paper.bib`，评审在 GitHub issue 里跑。
我们的 `paper.md` 结构直接兼容这个形态——意味着同一份源既能出投稿 PDF，也能直接进 JOSS 式流程。
`science_manuscript_new` 建出来的目录（`paper.md` / `references.yml` / `figures/` / `build/`）
就是照着这个约定排的，只把 `paper.bib` 换成 `references.yml`（避免 BibTeX 依赖）。

---

## 2. 商业产品：它们解决了什么、没解决什么

| 产品 | 定位 | 做对了 | 缺什么 |
|---|---|---|---|
| **Overleaf**（含 ShareLaTeX） | 在线 LaTeX | 协作 + 实时编译 + 期刊模板库 | 不懂科研内容，格式合规全靠人肉 |
| **Authorea**（Wiley） | 富文本 + LaTeX 混合 | 一个文档多格式导出 | 被收购后基本停更 |
| **SciSpace / Typeset** | 论文阅读 + 排版 | 一键套期刊格式 | 只管"套壳"，不管内容 |
| **Paperpal / Trinka / Writefull** | AI 语言润色 | 语法、术语、学术语气 | 只碰句子，不碰结构和要件 |
| **Jenni AI** | 生成式写作辅助 | 续写、改写 | 生成的内容本身不可信，且不承诺可核查 |
| **Manuscripts.app** | 写作 IDE | 大纲、素材、协作一体 | 2019 年停止运营（死于"什么都自己做"） |
| **EndNote / Zotero / Paperpile / Mendeley** | 引文管理 | CSL 样式、Word 插件 | 只解决引文，不管排版和合规 |

**共同缺口**（也就是我们该做的）：

1. 没有人做**"目标刊要件"到"源文件"的闭环**——都是写完了才想起来"这个刊多少字上限"。
2. 没有人做**引文完整性**——挂了 3 条参考文献正文没引，Word 插件不会告诉你，编辑会直接拒。
3. 没有人做**四个格式的一致性**——同一篇稿子，PDF 和 Word 里参考文献格式不一样是常态。
   （原因很实在：PDF 走 BibTeX，Word 走插件，两条独立的代码路径。）

Manuscripts.app 的失败还留了个教训：把编辑器和内容系统绑死，做不过 Overleaf。
所以我们只做内容层和出件层，编辑器交给 dsh 自己的 Web UI + 纯文本。

---

## 3. 借鉴清单：具体落到哪个文件

| # | 借鉴点 | 来源 | 我们的实现 |
|---|---|---|---|
| 1 | 编译失败要给结构化诊断，不是 exit code | Overleaf `clsi` | `build.js` `readLatexLog()` → `{errors:[{message, context:{line,text}}], missingFiles, overfull}` |
| 2 | 缺宏包时自动补装，装不上就降级 | Overleaf / TeX Live 生态 | `build.js` `ensureClass()`：`kpsewhich` → `mpm --install` → 回落 `article` |
| 3 | 正文只存 citation key，导出时才渲染 | Fidus Writer | `paper.md` 里 `[@key]`，`cite.js` 在渲染时统一解析成字面量 |
| 4 | 九个字符换一个刊：`format:` 决定全部输出 | Quarto | `meta.journal` → `resolveFormat()` → 四个渲染器 |
| 5 | JATS 用 `publication-type` 映射，不硬编码 DTD | PKP Texture | `jats.js` `JATS_REF_TYPES` 映射表 |
| 6 | 模板清单驱动覆盖度 | rticles | `journal-formats.json` 13 族 + 46 个出版社别名 |
| 7 | 投稿物就是仓库里的纯文本 | JOSS / paper-now / Manubot | `manuscripts/<id>/{paper.md,references.yml,figures/,build/}` |
| 8 | 引文样式做成可插拔数据，不写死在代码里 | CSL 生态 | `data/citation-styles.json`（微型 CSL 子集，自己写的） |
| 9 | 期刊硬要件（字数/图表/文献数）要机器可查 | Editorial Manager 的拒收逻辑 | `data/journals.json` 的 `limits` → `lint.js` |
| 10 | 预览要和最终稿同版式，不能预览好看导出跑版 | Overleaf 的 PDF 预览 | `html.js` 的页面尺寸/字号/行距/行号全部从同一份 `docx` 规格取 |

---

## 4. 许可边界：哪些能拿、哪些只能看

| 素材 | 许可 | 我们怎么用 | 结论 |
|---|---|---|---|
| Overleaf / Fidus Writer / Texture / PubPub 代码 | AGPL-3.0 / GPL-2.0 / GPL-3.0 | 只读架构，代码零复制 | ✅ 合法 |
| `rticles` 模板 | GPL-3 | 只读模板**清单**（哪些刊），不复制 `.Rmd`/`.tex` | ✅ 合法 |
| 出版社 `.cls` / `.bst`（elsarticle、IEEEtran、revtex4-2、achemso、sn-jnl…） | LPPL-1.3 | 直接 `\documentclass{}` 调用，随 MiKTeX 分发 | ✅ 合法，且是标准做法 |
| JATS DTD（NISO Z39.96） | 公开标准 | 自己生成最小子集，不嵌 DTD 文件 | ✅ 合法 |
| CSL 样式 XML | CC BY-SA 3.0 | 不复制；`citation-styles.json` 是自己写的规则描述 | ✅ 合法 |
| `citeproc-js` | CPAL / AGPL | 不引入 | ✅ 避开 |
| 期刊名、ISSN | 事实信息 | 作为标识符与元数据（指名使用） | ✅ 合法 |
| GitHub 上的项目描述 | 各自许可 | 本文档里引用均为短句转述，附仓库名 | ✅ 合法 |

**没做的事**（明确记下来，防止以后有人问）：没有反编译任何商业产品（Editorial Manager、ScholarOne、
Paperpal 都是闭源 SaaS，反编译其客户端违反 EULA）；没有绕过任何付费墙；没有复制任何 AGPL/GPL 代码。

---

## 5. 我们和它们的差别（一句话版）

| | Overleaf | Quarto | Manubot | Paperpal | **dsh-science M5** |
|---|---|---|---|---|---|
| 写作环境 | ✅ 强 | 命令行 | 命令行 | ✅ 强 | 纯文本 + dsh Web UI |
| 期刊模板 | ✅ 最多 | ✅ 多 | ❌ | ❌ | 13 族 + 46 出版社别名 |
| 内容到结构 | ❌ | ❌ | ❌ | ❌ | ✅ M4 证据链 + 缺口矩阵 |
| 要件合规检查 | ❌ | ❌ | ❌ | 部分（语言） | ✅ 字数/图表/引文/结构 |
| 四格式一致 | ❌ | ✅ | 部分 | ❌ | ✅ 引文一次解析，四路同源 |
| JATS 输出 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 本机离线 | ❌ | ✅ | ❌ | ❌ | ✅ 零网络依赖 |

---

## 6. 这次调研没解决、但记下来的问题

1. **Word 里的真公式**：DOCX 要 OMML 才是可编辑公式。我们目前用 Unicode 近似（`texToUnicode()`），
   复杂公式会退化成 `_(eff)` 这种写法并在构建警告里列出来。要做对得上 TeX→MathML→OMML 的转换链，
   `latex2mathml` + XSLT（MML2OMML.XSL 是 Office 自带的）能走通，但要多一个依赖和一次 XSLT 变换。
   留作 M5.1。
2. **参考文献去重与合并**：现在 `references.yml` 里两条同 DOI 不同 key 的条目不会合并，会重复出。
   需要一层 DOI 归一。
3. **双栏排版的图片宽度**：`IEEEtran` 双栏最终形态下，`\includegraphics` 跨栏要 `figure*`，
   目前统一用 `figure`。投稿稿是单栏所以不影响，但排版厂版本会跑。
4. **`sn-jnl.cls` 与 `bmcart.cls` 未装**：MiKTeX 的 `mpm` 装不上，Springer 和 BMC 目前落到 `article`。
   版式细节（尤其 Springer 的 `\sponsor`、`\abstract` 分段）会丢。
