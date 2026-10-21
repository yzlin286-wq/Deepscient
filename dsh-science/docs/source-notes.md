# 免费检索渠道实测笔记（2026-10-20 本机实测）

记录的是**真实响应**，不是文档抄写。每条都标了状态码、体积、以及"下次会怎么坏"。
接入状态列：✅ 已接入 `@local/dsh-science` ／ 🔶 可用但需额外条件 ／ ❌ 本机不可用。

---

## 一、元数据检索：无需 key（全部已接入）

| 源 | 实测 | 限额口径 | 坑 |
|---|---|---|---|
| **OpenAlex** ✅ | 200 / 44KB | 无 key 时**本 IP 每天 $0.10**（约 100 次检索）；带 key $1/天 | 2026 起按美元计费。响应头可读预算：`x-ratelimit-remaining-usd`、`-limit-usd`、`-cost-usd`(0.001/次)、`-reset`(秒)。超预算回 402/429 |
| **Crossref** ✅ | 200 / 7.6KB | 无硬额度，`mailto=` 进 polite pool | `select` 参数**不接受 `language`**，带上整条 400 `select-not-available`（这个 bug 花了 1 轮才定位） |
| **Europe PMC** ✅ | 200 / 1.8KB（lite）/ 4.4KB（core 单篇） | 无硬额度 | `resultType=core` 才带 `fullTextUrlList`；`{PMCID}/fullTextXML` 对不存在的 PMCID 回 **500 而不是 404**，别把它当故障 |
| **PubMed E-utilities** ✅ | 200 / 1KB | 无 key 3 req/s | 检索是两步：`esearch` 只给 id 列表，必须再 `esummary`。一步实现会拿到空标题 |
| **arXiv API** ✅ | 200 / 4.5KB Atom | 官方要求 3s/次 | `all:"multi word"` 是短语匹配，召回塌；要拆成 `all:a AND all:b` |
| **DOAJ** ✅ | 200 / 7KB | 无硬额度 | 只覆盖 OA 期刊；`bibjson` 是嵌套结构，`identifier[]` 里才有 DOI |
| **DataCite** ✅ | 200 / 7KB | 无硬额度 | 数据集/软件为主，字段在 `attributes` 下；摘要要按 `descriptionType=Abstract` 挑 |
| **Zenodo** ✅ | 200 / 22KB | 无硬额度但**突发就 403** | 实测同一 URL 单发 200、连发 403。限速压到 0.5 rps / burst 1，403 要退避重试一次 |
| **OpenAIRE** ✅ | 200 / 92KB | 无硬额度 | JSON 是 XML→JSON 转换产物，字段全是 `{$: "值"}`，要递归取 `$`；单次响应很大 |
| **bioRxiv/medRxiv API** 🔶 | 200 / 70KB | 无硬额度 | 只能按日期区间翻页，**不支持关键词检索**；正文 PDF：bioRxiv 206 可拿，medRxiv 403 |

### 免费 key 申领（一步，值得做）

OpenAlex 在响应体的 `meta.notice` 里明示了自助通道：

```http
POST https://api.openalex.org/api-keys
Content-Type: application/json

{"email": "<你的邮箱>"}
```

点邮件里的链接即生效，额度从 $0.10/天 变成 $1/天。key 写进 `$DSH_HOME/science/config.json` 的 `retrieval.openalexKey`。
Semantic Scholar 的 key 走网页申请；CORE 需注册；Unpaywall **必须真实邮箱**（占位邮箱回 422 `Please use your own email address`）。

---

## 二、全文获取：九级回退链的真实结果

实测发现"200 不等于拿到 PDF"——大量站点回 200 + `text/html` 的 Cookie 门或登录页。所以每一级都必须验 content-type 与 `%PDF-` magic。

| 级别 | 路径 | 实测 | 备注 |
|---|---|---|---|
| 1 | OpenAlex `best_oa_location.pdf_url` | 常为**空** | 实测 PLOS 那篇 `best_oa` 的 pdf_url 是空的，但 `locations[]` 有 8 条 |
| 2 | OpenAlex `locations[].pdf_url` | 有时命中 | 必须遍历，不能只信 best |
| 3 | Unpaywall `/v2/{doi}?email=` | 422 占位邮箱被拒 | 配真实邮箱后可用 |
| 4 | **Europe PMC `fullTextUrlList`** | ✅ 稳 | `documentStyle=pdf` + `availability=Open access` → 直接给 `europepmc.org/articles/{PMCID}?pdf=render` |
| 5 | **Europe PMC `{PMCID}/fullTextXML`** | ✅ 200 / 76KB JATS | 结构化最好，优先于 PDF（有章节标签） |
| 6 | **PMC `efetch db=pmc`** | ✅ 200 / 70KB JATS | 无需 key |
| 7 | 直链模板 | **arXiv ✅ 206**（支持 Range）／**PLOS ✅ 200 PDF**／**Frontiers ✅ 206**／**bioRxiv ✅ 206** | 这四个是真·无门直链 |
| 8 | 出版商 Cookie 两步 | Springer / Nature 回 200 但 **content-type=text/html**，`finalUrl` 带 `error=cookies_not_supported` | 先 GET 落地页收 cookie，再带 Referer+Cookie 取 `content/pdf/*.pdf` |
| 9 | CF 站点 | **Wiley / SAGE / T&F / MDPI / medRxiv 全 403** | 需要 TLS 指纹伪装（`curl_cffi --impersonate`）或 FlareSolverr；本机 `curl_cffi` 未装 |
| 10 | Sci-Hub | `.se` 超时；**`.st` / `.ru` 200 但返 ALTCHA PoW 挑战页** | 不是图形验证码，是可自动解的 SHA-256 前缀匹配；默认关闭 |

**不可达**：LibGen `libgen.is`、Anna's Archive、`openaccessbutton` API —— 本机连不上（连接超时，非 403）。

---

## 三、中文库

| 源 | 实测 | 结论 |
|---|---|---|
| CNKI 国内 `kns.cnki.net` | **SSL 握手被 RST**（curl 000 / python `SSLError`） | 网络层阻断，不是 UA 问题 |
| **CNKI 海外 `chn.oversea.cnki.net`** | ✅ 200 / **55KB SSR 结果页** | 绕过阻断的主入口：`/kns/defaultresult/index?kw=<UTF-8>`，结果在 `table.result-table-list` |
| 万方 `s.wanfangdata.com.cn` | 200 / 168KB SSR，但**列表异步加载** | `__NUXT__` / `__INITIAL_STATE__` 都没有，需逆向 XHR；`SearchService.Search` 端点带 `application/json` 回 415，说明还要 CSRF/额外头 |
| 维普 `www.cqvip.com` | ✅ 200 / **621KB SSR（Nuxt）** | `data-n-head` 属性可判定 Nuxt，数据在 `window.__NUXT__` / `#__NUXT_DATA__` |
| 百度学术 `xueshu.baidu.com` | 200 但是**「安全验证」页**（1.4KB） | 需 Cookie 池 + 住宅代理 |
| NSTL | 206 | 需会话，可作补充 |

---

## 四、受限源与反爬现状

| 源 | 实测 | 应对 |
|---|---|---|
| **Semantic Scholar** | 第 1 次 200，**第 2 次立刻 429** | 无 key 实际 ≈1 次即触顶。要么 30/60/120s 退避，要么申请 key |
| **Google Scholar** | 直连 302 → `google.com/sorry/index`，最终 **429**，页面含 `unusual traffic` | 本机 IP 已被标记。需要住宅代理 + 持久 Cookie（`NID`）。默认关闭 |
| scholar.archive.org | 200 / 4.4KB | Scholar 的可编程替代（fatcat 后端），比直连温和 |
| BASE | **403 `Access denied for IP`** | 需注册机构 IP，本机不可用 |
| CORE | 429 | 需免费 key |
| Dimensions / Lens | 404 `{}` / 需 key | DSL 端点要 token，不可匿名 |
| DeepDyve / ResearchGate / Academia.edu | 未测（对自动化明确敌意） | 不建议 |

---

## 五、每源的克制规则（写死在 `lib/science/http/limits.js`）

```js
openalex      1 rps burst 3   + 预算熔断（剩 $0.005 停）
crossref      2 rps burst 5
europepmc     3 rps burst 6
pubmed        3 rps burst 3
arxiv         0.33 rps burst 1
zenodo        0.5 rps burst 1  + 403 退避重试
s2            0.2 rps burst 1  + backoff [30s,60s,120s]
scholar       0.05 rps burst 1 + 需代理
cnki(oversea) 0.5 rps burst 2  + 3s 抖动
wanfang/cqvip 0.5 rps burst 2  + 2s 抖动
```

熔断：连续 3 次失败 → 冷却 300s，期间该源被跳过但**不报错**（扇出照常返回其他源结果）。

---

## 六、这几条实测直接改掉的设计

1. **"单块多词不加引号"**：`"protein folding diffusion model"` 带引号时十个源只有 4 个有命中；去掉引号后 8 个源 36 条。短语匹配是召回杀手。
2. **Crossref 的 `select` 要试**：`language` 一个字段就能让整条请求 400。
3. **403 不等于权限问题**：Zenodo 突发就 403，必须"退避一次再判死刑"，否则整源被误熔断。
4. **缓存必须命中**：二次同查询 6967ms → 16ms，缓存把扇出成本摊平；同时它也是预算保护。
5. **探针要串行**：9 个源并发探一次，Zenodo 直接 403；串行 + 250ms 间隔全绿。

---

## 七、期刊情报三源（M3，2026-10-20 实测）

### 7.1 接入的三个源

| 源 | 实测 | 拿到什么 | 坑 |
|---|---|---|---|
| **OpenAlex `group_by`** ✅ | 200，49/53 刊成功 | 近两年每刊的子领域产出分布 | 三处致命坑，见下 |
| **SciRev** ✅ | 200，45/53 刊成功 | 首轮/总量月数、即时拒天数、轮数、意见难度、样本数 | 覆盖率有限，404 是常态不是故障 |
| **LetPub** ✅ | 200，46/53 刊成功 | 审稿速度档、录用比例措辞、分区、IF | 刊名搜索被同名子刊淹没，必须用 ISSN |

### 7.2 OpenAlex 的三个坑（都踩过）

1. **`per-page` 在 `group_by` 模式下限制的是「返回组数」不是「论文数」**。
   `per-page=1` 只给你 1 组，`meta.count` 却是全量——看起来 8998 篇，实际只覆盖 0.01%。
   结论：`group_by` 时**绝不能带 `per-page`**。去掉后 200 组，覆盖率 99.6%。
2. **`sources/{id}.topics` 是终身累积，不是近况**。
   Nature 的 top3 是 "History of Science"——那是它一百多年的存量。
   必须走 `works` + `from_publication_date` + `group_by` 才是当下画像。
3. **`group_by=primary_topic.id` 对 works 覆盖极差**（Nature 近两年只 1 组）。
   子领域级（`primary_topic.subfield.id`）才可靠，`field.id` 作粗粒度兜底。

另外一个**id 形态不一致**：`/works` 和 `/topics` 返回完整 URL（`https://openalex.org/subfields/1312`），
`group_by` 的 `key` 只给尾段（`1312`）。不做归一化，两套数据永远对不上，命中率恒为 0。

### 7.3 全量抓取的实测结果

53 刊 × 3 源，606 秒，**140 条源记录成功 / 17 条失败**：

| 失败类型 | 刊 | 原因 |
|---|---|---|
| `HTTP 404`（SciRev） | jama, bmj, angewandte, neurips, icml, nature-communications-eng | SciRev 未收录该刊，属正常覆盖缺口 |
| `HTTP 0`（SciRev） | nature-materials, lancet | 传输层失败，可重试 |
| `no-matching-detail-page`（LetPub） | pnas, nature-biotechnology, lancet, jama, bmj, neurips, icml | `searchissn` 未命中（多为子刊/新刊/会议） |
| `no-works-in-window`（OpenAlex） | bmj, jmlr | 近两年无该源收录的论文 |

会议刊（neurips/icml）无 ISSN，`intelPolicy: 'conference-no-issn'`，三源全跳过——这是设计内行为。

**覆盖结论**：49/53 有实证画像 = 92.5%，超过 fit 的 80% 阈值，实证层默认可用。

### 7.4 明确不接入的源及原因

| 源 | 实测 | 为什么不接 |
|---|---|---|
| **OpenReview** | 403 + JS challenge | 无头浏览器才能过，成本远超收益 |
| **Scimago (SJR)** | 403 Cloudflare | 同图书馆可查，不值得破 |
| **MedSci  MedSci 期刊库** | 纯 JS 渲染 | 无静态 HTML 可解析 |
| **JCR / 影响因子官方** | 需订阅 | 版权问题，且 LetPub 已有二手值 |
| **SciRev 的评论文本** | 页面可读但非结构化 | 只取量化字段，不做文本挖掘 |

### 7.5 限速与预算

```
openalex      1 rps burst 3   + 预算熔断（剩 $0.005 停）  ← 全量抓取的上限瓶颈
scirev        0.5 rps burst 1 + 500ms 抖动
letpub        0.3 rps burst 1 + 1200ms 抖动 + backoff [8s,20s]
```

单刊全抓 ≈ 4–5 次请求；53 刊全量 ≈ 200 次请求 ≈ 10 分钟。
OpenAlex 无 key 每天 $0.10（≈1000 次），一次全量抓取吃掉约 10%。

**429 是速率不是额度**：实测连续抓满 53 刊后，紧接着的 `topics?search=` 回 429。
退避打 3s/8s 两级，仍失败就如实上报 `OpenAlex 不可用（HTTP 429）`，让 fit 退回声明层并说明，
不要假装有数据。

---

---

## 八、知识转化层：GitHub 与十源复用（M4，2026-10-20 实测）

M4 不引入新的文献源，它复用 M1 的十源扇出，只新增一个外部源：GitHub REST API。
下面是这个源的真实边界，以及复用十源时会踩到的坑。

### 8.1 GitHub REST：三个结论决定了设计

| 探测 | 结果 | 设计后果 |
|---|---|---|
| `GET /rate_limit`（匿名） | `core: 60/h`，`search: 10/min` | 一次 `detail:true` 的 scan = 3 search + 每仓 3 core，**匿名额度跑两三次就到顶** |
| `GET /search/repositories?q=topic:optimization` | 返回 `ray` / `czkawka` / `svgo` | topic 标签是社区随便打的，与「优化理论」无关 → **四个查询模板一律不带 topic 过滤** |
| `GET /search/code`（匿名） | **401 Requires authentication** | 「搜代码里的收敛证明」这条路线不存在，任何方案都不要依赖它 |

带 token 时：`core: 5000/h`，`search: 30/min`，够正常使用。配置位置
`~/.dsh/science/config.json` 的 `retrieval.githubToken`。

### 8.2 同名异物：`muon in:name` 的 20 个结果

实测 `muon in:name stars:>10` 返回 20 个仓库，其中 **13 个和优化无关**：

```
scverse/muon          单细胞多组学分析（Python）
muon-build/muon       构建工具
fhunleth/muontrap     Erlang 进程内消息追踪
wtlnetwork/muon       无线网络管理
... 另有 9 个同名的无关库
```

剩下的 5 个才是真优化器。所以必须有**领域门**（`relevance()` 用领域词典打分），
`filteredTotal` 不为 0 是正常的，为 0 才要怀疑词典太宽。

这条经验是通用的：**任何按名字检索的技术名词，都会撞上同名异物**。领域门不是可选优化。

### 8.3 类型折扣：为什么教程必须打折

第一次实扫时，排名第一的是 `vukrosic/muon-optimizer-guide`——326 次 52 周 commit，
比真实现还活跃。它是**教程**，不是实现。

加入 `classifyRepo` + `REPO_KIND_PENALTY`（tutorial ×0.6、awesome ×0.5、toolkit ×0.85、
benchmark ×0.9、archived ×0.3）后排名变成：

```
KellerJordan/Muon             0.581
zhehangdu/Newton-Muon         0.311
LH-Tech-AI/faster-nanogpt     0.282
vukrosic/muon-optimizer-guide 0.253   ← 从第一落到第四
nil0x9/flash-muon             0.196
```

活跃度和「值得读」是两件事。教程可以很活跃。

### 8.4 `stats/participation` 的两种失败

| 状态 | 含义 | 处理 |
|---|---|---|
| 404 | owner/repo 写错或仓库已删 | 视为无 commit 数据，不重试 |
| **202** | GitHub 尚未缓存该仓的参与度统计 | **视为冷缓存，不视为错误**；标 `detailPartial: true` |

202 很容易被当成失败。它不是——等一会儿再查就有。scan 里把它记成 `detailPartial`，
并在输出里如实标出，不要静默丢弃。

### 8.5 复用十源时的两个坑

**OpenAlex 日额度会先耗尽。** M4 的缺口矩阵只查 `arxiv` / `crossref` / `doaj` / `europepmc`
四源，刻意不查 OpenAlex——它的 `$0.001`/请求、无 key 每天 `$0.10`（≈100 次）在 M1/M3 阶段
就已经吃满。`verify-search.mjs` 把「openalex 429 且预算 ≤ $0.0005」判为 SKIP-pass 而不是 FAIL。

**检索词太泛会让缺口判定全是噪音。** Muon 的 README claim 自动抽出的词是
`["lowered","record","training"]`，查回来的 20 篇全是泛泛的训练加速文献，覆盖判定 0/20。
带上仓库名推出来的锚点（`["muon","optimizer"]`）后才有区分度。
`anchorKeywordsFromItem()` 就是为这件事存在的——**claim 句子常只写结果，方法名只在仓库名里**。

### 8.6 本轮实测快照

```
scan(topic="muon optimizer", limit=5, detail=true)   12.1s
  3 次 search + 15 次 core｜20 候选 → 领域门剔 13 → 5 入库｜5 条 arXiv 预印本
distill(KellerJordan/Muon)                           README 3997 字 → 2 条 claim（均 result-only）
gap_matrix(claim, anchor=["muon","optimizer"])       2.4s｜5×4 次文献检索
  theory thin(1) / scale thin(1) / transfer thin(2) / reproduction gap(0) / benchmark thin(2)
design(band 3/4/5)                                   工期 1 / 3 / 6 周（只算目标档）
paper_plan                                           mechanismPresent: false → 标题槽留空，风险 high
```

第 2 天的复跑被配额卡住（`readme: 无`）。`scripts/smoke-frontier.mjs` 在遇到这种情况时
会明确打印「GitHub core 配额已耗尽」并正常退出，不伪装成成功——这类降级必须可见。
