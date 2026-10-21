# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循语义化版本。
`dsh-science/` 是独立版本线（当前 0.2.0），随产品迭代但不跟着改号，原因见 [docs/spec.md](docs/spec.md)。

## [0.6.3] — 2026-10-21

数据层双语打通：英文模式下阶段名、门名、下一步动作都是英文，判定结果不变。

### 新增

- **`dsh-science/data/workflow.en.json`**：12 个阶段的 `label` / `goal` / `artifacts`，55 个门的 `label` / `fix`，外加 5 条 `globalRules` 的英文版。按 `stageId` 与 `stageId.gateId` 索引。
- **`?locale=en`**：`/projects/:id/stages`、`/next`、`/overview` 接受语言参数。`label` / `goal` / `artifacts` / `fix` 取覆盖表，`complete` / `blocking` / `status` 一律仍由 `stageStatus()` 判定——翻译不碰结论。
- **`fallbacks[]`**：没翻到的阶段或门，key 会列进响应的 `fallbacks` 数组，不回退得无声无息。
- 前端 `withLocale(path)`：请求自动带 `locale=<当前语言>`，中文时不加参数（与现网一致）。

### 修复

- **覆盖文件读错目录**：`scienceRoot()` 返回的是 `$DSH_HOME/science`（实例的研究库），而 `workflow.json` 在**包目录**里。改成按候选顺序找真正装着 `workflow.json` 的那份（环境变量 → 仓库同级 `dsh-science` → 各 profile 的 `node_modules`）。此前读到不存在的路径后静默回退，表现为「`?locale=en` 没反应」。

### 实测

```
[zh] S1 = 文献与现状                     | 至少检索过一次            [status=fail] | fallbacks=0
[en] S1 = Literature and state of the art | At least one search performed [status=fail] | fallbacks=0
```

### 未完成

- `tools.en.json`（36 个工具的描述）与 `sources.en.json`（8 个源）未建，工具页与接入页的数据仍是中文。
- 引导（47 条）与设置（43 条）界面文案仍是中文硬编码。

## [0.6.2] — 2026-10-21

流程 / 工具 / 计费 / 接入 / 说明五页文案迁进字典，字典到 125 key，中英逐 key 对齐。

### 变更

- 五页正文全部改走 `tf(...)`：表头、空态、说明句、占位符、按钮（刷新 / 保存 / 测试）都不再有中文字面量。
- `RANGE_LABEL` / `WIRED_LABEL` 两个中文常量表改成 `rangeLabel()` / `wiredLabel()`。
- 字典新增 `stages` / `tools` / `docs` / `billing` / `sources` 五组，共 97 条新 key；插值键 `{blocking}` `{shown}/{total}` `{currency}` `{files}` 按调用点逐个对上。

### 校验

`verify-deepscient` 从 288 项增至 293 项：

- zh/en 字典 **key 集合双向差集为空**（漏一条就会在界面上露出 key 本身）
- 字典规模 ≥ 120 条
- 英文值里不含中日韩字符（防漏翻）
- 总览页六个 key 齐全
- 总览与页面壳范围内无成句中文字面量（注释除外）

### 未完成

- 引导（47 条）与设置（43 条）仍是中文硬编码。
- `workflow.en.json` / `tools.en.json` / `sources.en.json` 未建，英文模式下阶段名与门名仍中文。

## [0.6.1] — 2026-10-21

双语地基 + 控制台总览落地。六个页面里的「工作台」已经整页重写，文案全部由字典驱动。

### 新增

- **`tf(key, vars)` 插值**：字典值就是纯字符串（`LocaleDict = Record<string, string>`），没有占位符能力，所以 `{n}` / `{id}` / `{percent}` 的替换自己做。
- **`useLocaleRevision()`**：订阅 `locale.subscribe`，切换语言时已挂载的组件立刻重渲。不订阅的组件会留在旧文案上，所以显示文字的地方都要调它一次。
- **浏览器标签跟着语言走**：`document.title` 从 `tf('app.title')` 取值，切英文就是 `DeepScient Research Workbench`；`MutationObserver` 仍盯着 head 防止被外壳写回。
- **控制台总览重做**（工作台页）：改成吃 `/projects/:id/overview` 的四块——① 课题身份（下拉切换 + 领域 + 目标刊 + 库内计数）② 进度条 `9/12 · 75%` + 当前阶段 + 四个真实计数 chip ③ 产出清单（22 项按 已产出/待产出 两态，点一行跳「流程」对应阶段）④ 下一步（每条带等级 chip 与 `fix`，可跳转）。

### 变更

- `PAGES` 表不再存中文标题，侧栏 label 与页面副标题都走 `panel.*` / `page.*`。
- `REASON_LABEL`（中文字面量映射）改成 `REASON_KEY` + `reasonLabel()`。
- `Loading` / `ErrorBox` / `Page` 壳 / chip 文案 / 六页副标题全部走字典；字典扩到 `app` / `common` / `reason` / `overview` / `page` / `workbench` / `sources` 七组。
- 删掉旧的 `StageLadder` 与 `Workbench`（104 行），总览不再靠界面自己数门。

### 验证

`verify-deepscient` 288 项全绿；断言从「`PRODUCT_TITLE` 常量存在」改为「`document.title` 取 `tf('app.title')`」，并把「六页副标题各不相同」改为「六页各用不同的副标题 key」。

### 未完成（下一步）

- 存量文案：流程 / 工具 / 计费 / 接入 / 说明 五页正文约 90 条、引导约 47 条、设置约 43 条，仍是中文硬编码。
- 数据层英文：`workflow.en.json`（12 阶段 + 55 门）、`tools.en.json`（36 工具）、`sources.en.json`（8 源）尚未建立，所以英文模式下阶段名与门名仍是中文。

## [0.6.0] — 2026-10-21

控制台总览的数据面：一次拿全「走到哪、卡在哪、下一步、产出什么」，并修掉一处把关键信息写死的 bug。

### 新增

- **`GET /deepscient/api/projects/:id/overview`**：一次返回项目身份、进度（done/total/percent）、当前阶段四个真实计数、库内产物计数（文献/分析/图/实验/记录）、按阶段的产出清单（`present` 用「该阶段门全过」判定）、下一步动作（带 `fix`）与阶段汇总。界面首屏从此只打一个接口，不用再拼四个。

### 修复

- **`/next` 的当前阶段计数是假的**：`stage.blocking` / `warnings` / `skipped` / `manual` 在 `routeNext` 里被硬编码成 `0`，界面上「当前阶段阻塞几个门」永远显示 0，等于把最该看的信息丢了。现在回 `stageStatus()` 取真实值。实测某课题：当前 S1，阻塞 1 · 警告 3（此前一律 0）。

### 实测（3081 真实库）

```
progress : 9/12 (75%)
current  : S1 文献与现状 | 阻塞 1 警告 3 未留记录 0
counts   : papers=0 analyses=2 figures=1
artifacts: 22 项，已产出 15 项
next[0]  : 至少检索过一次 → science_lit_query 或 science_search；检索范围要写进记录
```

## [0.5.1] — 2026-10-21

侧栏从「一个图标进去再点页签」改成「一页一个图标」，并把品牌露出的最后一处补齐。

### 变更

- **科研控制台的 6 个页面拍平成侧栏一级菜单**：工作台 / 流程 / 工具 / 计费 / 接入 / 说明各占一个侧栏图标，点哪个进哪个，界面里不再有二级 tab 条。`sidebar.panellist` 的 id 与 `main` 的 key 由同一张 `PAGES` 表产出，结构上不可能对不上（漏一个就是点出白屏，所以用同一张表驱动两处注册）。
- **每个页面独立挂载**：只有当前页在取数，切走即卸载；「选中哪个课题」提到模块级共享，跨页不丢。
- **跨页跳转改用 layout 服务**：底部胶囊的「计费」、引导里的「接入」、设置里的「去填 API」都改成 `ctx.layout.selectPanel(...)`，原来那套「记一个待办页签、挂载后消费」的 `panelNav` 机制整个删掉。
- **每个页面一个图标**：仪表盘 / 阶梯 / 扳手 / 币 / 节点 / 文档，同一套笔画（`currentColor`，未选中 0.75 透明度），全部内联，不引外部资源。

### 修复

- **空白会话欢迎页的品牌位没人接**：`conversation.hero.brand.mark` 此前是外壳自己渲染，第一屏大字标还是旧品牌。现在注入 `BrandMark`。
- **浏览器标签仍是 `DeepSeek Harness`**：外壳静态 `index.html` 里写死的 `<title>`，改成运行时覆盖为 `DeepScient 科研工作台`，并用 `MutationObserver` 盯着 `head`（路由切换时外壳会写回去；只在值不同时写，不会自触发）。

### 校验

`verify-deepscient.mjs` 从 282 项增至 288 项：面板 id 与 `main` key 的集合一致性、六项排序号互不相同、六项 label 各自取到中文、六页共用同一个品牌外壳且副标题互不相同、locale 的 `panel` 六个键齐全、界面里不再有 `S.tabs`/`S.tab(`、`PRODUCT_TITLE` 存在。不带 token 全绿。

## [0.5.0] — 2026-10-21

这一版的主题是把「能出件」补成「能产出完整论文」：出件层原本就齐，缺的是把数据、统计、图、正文、引文串成一条可重跑的链。

### 新增

- **`science_manuscript_assemble`**：从库里的 `analysis` 与 `figure_spec` 生成结果汇总表、图引用和可直接抄进正文的报数句，只写 `paper.md` 里 `<!-- assemble:results:* -->` 标记块内的内容。连跑两次字节相同；图会自动从课题目录复制进稿件 `figures/`，优先选 PNG（PDF 只有 LaTeX 能读）。
- **`science_reference_add`**：按 DOI（无 DOI 时按标题+年份）去重写 `references.yml`，自动生成 `authorYEARword` 形式的 cite key，冲突加后缀。把「模型手抄书目」这个高错动作从流程里去掉。
- **`deepscient/scripts/e2e-paper-run.mjs`**：论文链路端到端 20 项断言（装配幂等、图复制、引文去重、lint 无阻断、四件出稿、`pdfinfo` 页数、`pdftotext` 抽到表注/图注/参考文献）。不调模型，可进 CI。
- **`deepscient/docs/paper.md`**：五个环节、表格与交叉引用语法、中文出件、六类已知断点的处理办法。

### 修复（都会直接影响论文里的数字或要件）

- **Welch t 的报数句把统计量与自由度写串了**：原本输出 `Welch t(-5.08) = 0.000`，现在按 Satterthwaite 自由度输出 `Welch t(56.21) = -5.08，p < .001，Cohen's d = -1.31`。
- **配对 t 检验把均值差的区间挂在 `dz` 上**：`effectSize.cohens-dz.ci` 现在按 dz 自身的标准误算，均值差的区间单独放 `meanDiff`。
- **`mannwhitney` / `wilcoxon` 报了 p 却没有效应量**：补上秩二列相关 `r`，并在报数句里带上。
- **`anova-oneway` 的 F 缺自由度、`friedman` 写成 `χ²F` 且漏 Kendall's W**：补齐为 `F(df1, df2)` 与 `Friedman χ²(df)`。
- **建稿生成的 front matter 没指 `referencesFile`**：骨架里写了 `references.yml` 却不去读，正文引用一律被判 `cite-undefined`。现在 `scaffoldSource` 默认写 `referencesFile: references.yml`。
- **装配出的表格标签不被识别**：表注必须写在表下方并以 `: ` 开头、标签放行末，否则 `{#tab:xxx}` 不会被 markdown 层采集，正文 `\ref{}` 判 `xref-dangling`。

### 加固

- `.gitignore` 补 `**/.credentials*`、`**/*.pem`、`**/*.key`、`**/id_rsa*`、`**/local.patch.yml`。
- `tools/verify-packaging.mjs` 增加两项：`.gitignore` 必须挡住凭据与机器本地文件；稿件与统计脚本里不得出现密钥形态字面量。打包面校验从 17 项增至 19 项。

### 实测

用随包示例数据跑完整条链，落在一份 PLOS ONE 稿件上：正文 1841 词、2 条成功分析、1 张 600 dpi 图、1 张汇总表、10 条文献全被引、`blocking = 0`；产物 PDF 142 KB / 14 页（Letter、双倍行距、连续行号）· DOCX 82 KB · JATS 22 KB · HTML 19 KB。中文摘要在同一份 PDF 里正确渲染（`xeCJK` + 嵌入 SimSun，带 ToUnicode）。残留 6 处 `Overfull \hbox`，属列宽问题。

## [0.4.0] — 2026-10-21

把「GitHub 上成熟的科研技能」和「MCP 工具层」接进产品，并把两者的可用性验到可发布。

### 新增

- **81 条第三方科研技能**：来自 8 个 MIT 仓库，清单在 `dsh-science/skills-vendor/manifest.json`，
  每条 pin 到 40 位 commit 并锁 sha256。安装器 `deepscient/scripts/install-skills.mjs` 零依赖，
  支持 `--list / --scan / --plan / --apply / --check / --diff / --lock / --lock-refs / --remove / --only / --self-test`。
  第三方正文不进包、不进仓库，装的时候按 commit 拉取并校验。
- **MCP 工具层（默认关）**：`DSH_ENABLE_MCP=1` 时启动器叠加 `deepscient/mcp.patch.yml`，
  注册 `papers`（多源论文检索与下载，23 个工具）与 `pubmed`（PubMed/Europe PMC 全文、MeSH，11 个工具）。
- **MCP 独立探针** `deepscient/scripts/probe-mcp.mjs`：绕开 dsh 直接跟 MCP 服务器握手，失败时打印 npx 的 stderr。
- **`/health.mcp.tools`**：运行时报告真实注册到的 MCP 工具数、服务器名与工具名。
- 两份新文档：[`deepscient/docs/skills.md`](deepscient/docs/skills.md)（技能系统与上下文成本）、
  [`deepscient/docs/mcp.md`](deepscient/docs/mcp.md)（MCP 层与两个真机坑）。

### 修复

- **MCP 一个工具都注册不上**：`~/.npmrc` 里指向没在监听的代理时 `npx -y` 会在 2 毫秒内退出，
  dsh 侧只表现为「开着但 0 个工具」。启动器现在给 MCP 子进程生成独立的
  `<DSH_HOME>/science/mcp-npmrc`（已存在不覆盖），两行 patch 都带 `env.npm_config_userconfig`。
- **`pubmed` 那行悄悄装不上**：`env` 只接受字符串，`NCBI_API_KEY: !!js process.env.NCBI_API_KEY`
  在变量不存在时求值为 `undefined`，整行配置校验失败。改成注释里的示例。

### 变更

- 技能目录优先级明确为：项目 `.dsh/skills` → `.agents/skills` → `customSkillDirs` → `$DSH_HOME/skills` → `$AGENTS_HOME/skills`。
- `dsh-science/package.json` 的 `files` 补上 `skills-vendor`（否则清单不随包发布）。
- 活实例断言 288 → **294** 项（新增 5 项 MCP 与 1 项技能计数）；不带 token 时 279 → 285 项。

## [0.3.0] — 2026-10-21

### 修复

- **新建会话报错**：科研 persona 里那句 `{{cwd}}` 是未注册的提示词变量，`dsh-system-prompt` 对未知变量直接抛错，
  换一台没装对应插件的机器就是「新建会话失败」。改为「工作目录以运行时上下文与 `science_preflight` 报出的为准」。
- 六步引导不再要求用户复制粘贴命令，改成可点击的入口。

### 新增

- `dsh-science/scripts/verify-portability.mjs`：扫运行时面 78 个文件，禁止提示词变量、本机私有插件痕迹、写死的本机绝对路径。
- `deepscient/RELEASE.md`：发布说明与产物校验和。

### 变更

- 端到端脚本 `e2e-science-run.mjs` 的第六段改为打 HTTP 接口验技能装配（headless 不组合 agent preset，读不到会话技能表）。

## [0.2.0] — 2026-10-20

### 新增

- Web 界面五个页签：工作台、课题库、接入、计费、说明。
- 12 阶段 / 55 门的可视化与门判定；课题落库与恢复。
- 计费页：token 从会话日志读真值，金额按用户填的价目估算。

## [0.1.0] — 2026-10-19

### 新增

- 实例骨架：独立数据根 `~/.deepscient`、profile `deepscient`、端口 3081 起顺延。
- 启动器 `deepscient/bin/`（PowerShell + cmd 包装），支持 `-Port / -NoOpen / -NoModelLayer`。
- Host API：`/health /skills /presets /projects /sources /billing`。
- 科研后端 `dsh-science`：工具注册、学科数据、流程定义、preset。
