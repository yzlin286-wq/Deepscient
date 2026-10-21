# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循语义化版本。
`dsh-science/` 是独立版本线（当前 0.2.0），随产品迭代但不跟着改号，原因见 [docs/spec.md](docs/spec.md)。

## [0.10.0] — 2026-10-21

DeepScient 有了自己的账号体系，DeepSeek 那套账号入口整体退役。

### 为什么要做

DSH 原本的浏览器 cookie 是**设备级**的：本机任何浏览器拿着启动时的 `?token=` 就进去了，系统里没有"这是谁"的概念。DeepSeek 的账号插件解决的是另一件事——用平台账号换额度、联网与模型——但它换来的是**外部账号**，不是本机身份。

DeepScient 要的是人级身份：同一个实例上可以有几个使用者，各自的课题与需求书不该混着看。

### 移除：DeepSeek 账号四件套

`deepscient/cordis.patch.yml` 里关掉四行：

| 行 id | 包 | 原本干什么 |
|---|---|---|
| `deepseek-account` | `dsh-deepseek-account-platform` | 平台侧 OAuth 与令牌 |
| `llm-deepseek-account` | `dsh-llm-deepseek-account` | 账号派生的模型通道 |
| `account-controller` | `dsh-api-account-controller` | 账号 API |
| `ui-settings-account` | `dsh-client-ui-settings-account` | 设置里的「账号」页 |

**模型不受影响**：供应商由 `deepscient-sync-models.mjs` 写进 `local.patch.yml`，走 API key，不经过账号通道。关掉后重启 `broken=[]`，38+1 个工具照旧。

### 新增：应用内账号（`deepscient/host/auth.js`）

六个端点，挂在 `/deepscient/auth/`：`state`（可用性与当前用户）、`register`、`login`、`logout`、`password`、`users`。

安全上的四件事：

1. **密码只存 scrypt 派生值**。16 字节随机 salt，64 字节密钥，比较走 `timingSafeEqual`。不存明文、不存可逆加密、不自己发明 KDF。
2. **磁盘上只放 token 的 sha256**。`sessions.json` 被拷走也换不回可用的 cookie。
3. **登录失败与用户不存在给同一句话**。不告诉外面"这个用户名存在"。连续 8 次失败锁 15 分钟，返回 429 与剩余秒数。
4. **注册只对第一个账号开放**。第一个是 `owner`，随后 `registration-closed`（403）。单人科研工具不需要开放注册，假装支持比拒绝更糟。

改密码会把该用户的全部会话清掉，再用当前这枚换新——别的设备随即失效。

`displayName` 之类的中文经 UTF-8 往返正常（浏览器请求体默认 UTF-8；验收早期用 PowerShell 5.1 发包时出现过 `?????`，那是客户端编码问题，不是服务端）。

### 新增：门开在哪

判定标准是「这条数据是不是某个人的」：

- **公开**（不需要登录）：`health` / `tools` / `workflow` / `stages` / `presets` / `sources` / `docs`。这些是这台机器的能力清单，源那页的 key 本来就是掩码。
- **要登录**：`briefs` / `projects/*` / `overview` / `next` / `settings`，以及其他所有"某个人的"数据。

门放在 `handleApi` 里、`allowedMethods` 之后：405 与 401 各自表达各自的问题，不互相遮掩。

### 新增：界面

- **登录门**（`shell.overlay`，order 5，盖在首屏引导之上）：没有会话就整页拦住。没有账号时显示「创建第一个账号」，有账号时显示「登录」。`position: fixed; inset: 0`，登录前看不到任何应用内容。
- **设置里的「账号」一节**（`settings.section`，order 45）：显示当前是谁、登出、改密码。登出走整页重载——内存里的会话态和课题缓存都不该留着。
- 文案进 `auth.*` 组，中英各 24 键，双向对齐。字典顶层组 15 → 16。

### 验收

`verify-deepscient` **302 项全绿**。新增断言：账号状态端点可用且不泄露 `hash`/`salt`、未登录读课题接口是 401 且错误码为 `auth-required`、未登录不能改设置、三张能力清单仍然 200。

**验收脚本自己解决了"没凭据"的问题**：没有 `DEEPSCIENT_VERIFY_USER` 时，如果这台机器还没有账号，它临时建一个 `verify-temp`，跑完在 `process.on('exit')` 里把整个 `auth` 目录删掉，环境回到「还没有账号」——本机第一个账号仍然由人在浏览器里注册。已经有账号又没给凭据时，它不碰任何东西，让断言自己报错。

### 已知边界

- **WebSocket 通道没有单独加门**。DSH 的设备级 cookie 仍然守着 `/api` 与 Mux；应用账号守的是 DeepScient 自己的路由。单机单人场景下够用，多用户场景下要补。
- **没有找回密码**。本机没有邮件通道，遗忘密码只能清掉 `$DSH_HOME/science/auth/` 重来。UI 上写明了这一点。
- **登出入口只在设置里**，没有做左侧栏常驻头像。
- **多用户是"能区分人"，不是"隔离数据"**：课题库仍是一份，两个账号看到的是同一批课题。真正的多租户要改科研库的存储布局，那是另一件事。

## [0.9.0] — 2026-10-21

新建对话从空白输入框变成一次需求梳理。0.8.0 交付的两层底座（缺口怎么算、面板怎么读）现在接上了界面。

### 新增：科研需求向导

挂在 `conversation.input.activity` —— composer 工具栏里模型选择器之后的位置。选它有两个理由，都来自实测而不是猜：`Slots.listSubTree` 报这个 single 槽 `occupants: []`（空着），且它是唯一同时提供 `inputActions` 与 `onActiveChange` 的位置。

- **`inputActions`** 是从 `dsh-client-ui-conversation` 的 `ComposerActions` 暴露的完整动作面：`captureInsertion` / `insertText` / `setDraft` / `persistDraft` / `addAttachments` / `removeAttachment` / `pruneAttachments` / `submit`。向导用 `setDraft` 而不是 `insertText`：产出是整段任务书，覆盖草稿语义更对，也不用处理 `draftRev` 竞态。
- **`onActiveChange`** 是 ownerProps：展开时占满工具栏宽度，卸载时必须释放。向导的 `useEffect` 在收起与卸载时都调 `false`，不释放会把别的附件控件挤没。

十组字段：研究问题、领域、已有数据、可招到的样本、设备与平台、截止时间、人力、目标产出、伦理备案、数据许可。研究问题带一句改写提示（在什么对象里、什么相比什么、影响什么、观察多久）。只有「研究问题」是必填——没它按钮就禁用。

两个出口：**写进输入框**（`setDraft`，用户自己改完再发）、**直接开始**（`setDraft` + `submit`）。

三处刻意的取舍：

1. **向导不算缺口。** 缺口判定在 `science_requirement_brief` 工具里，服务端算 why 与 unlocks；前端再算一遍必然与服务端漂移，那是两份真源。
2. **向导不写数据。** 它只组装一段文字进草稿箱。真正的写发生在模型调 `science_requirement_brief` 时。按 user-actions 的规矩，纯视图交互不需要工具，也不需要 Host 服务方法。
3. **不做「是否科研模式」的开关。** 本实例默认预设就是科研模式，多一个开关就多一处会漂的状态。

任务书显式点名下一步：先用 `draft` 结构化、把缺口摆出来，补齐后再 `commit` 建课题。主 agent 接得住，用户也知道会发生什么。

### 文案

`wizard.*` 组进 `deepscient/locale/zh.json` 与 `en.json`，键路径分三组（`wizard.field.*` / `wizard.hint.*` / `wizard.ph.*`）避免与标签同名撞嵌套。`verify` 断言中英 key 数相等且逐一对应、英文值无中日韩字符。字典顶层组从 14 增到 15。

### 校验

`verify-deepscient` 298 项全绿。新增断言：向导已注册到 composer 工具栏槽、组件与 `setDraft` 路径存在、任务书开场句存在、向导文案中英双向对齐且不少于 30 个键。槽注册数从 18 增到 19。

### 验证边界

**向导的实际视觉与交互没有自动化验证**。浏览器控制不可用，且本次会话的 GUI 指向 3080（另一个 profile，不加载 deepscient），`Slots.listSubTree` 的 client 查询只对已连接的页面生效——它连不到 3081 这一页。当前能确认的是：客户端文件语法通过、注册调用与同文件里 18 处既有注册同形、host 侧启动无 broken、298 项断言全绿。

需要人确认三件事：向导按钮在输入框上方是否出现在预期位置、面板展开会不会被 composer 容器裁掉（用的是绝对定位 + `maxHeight: 70vh` + 滚动）、点「直接开始」后任务书是否如期进入输入框并发出。

## [0.8.0] — 2026-10-21

科研模式从「一个万能 agent」变成「一支有分工的军团」，新建会话从空白输入框变成需求梳理。

### 新增：七个可派发的智能体角色

`dsh-science/presets/science-roles.patch.yml`（新文件，637 行）。每个角色是一整套独立组装：自己的 persona、自己的技能指引、自己的工具边界。主预设通过 `tool-subagent` 的 `allowedAgentPresets` 把它们列给模型，模型派活时用 `agent_preset` 点名。

| preset id | 角色 | 工具边界要点 |
|---|---|---|
| `science-survey` | 文献侦察兵 | 检索/预印本/缺口/新颖性；不给跑实验、不给排版 |
| `science-strategist` | 选题与选刊参谋 | 学科画像/贡献设计/期刊匹配与情报；不做设计细节 |
| `science-experimenter` | 实验执行者 | 方案/受控执行/指纹/溯源；不给写稿与选刊 |
| `science-analyst` | 统计与图 | 假设检查/效应量/期刊规格作图；不解释理论含义 |
| `science-writer` | 写作与排版 | paper.md 一份真源/要件检查/四件套出件；不重算统计 |
| `science-critic` | 审稿人 | 投稿前门禁/查重/顶刊达标/证据链；**不改稿** |
| `science-rebuttal` | 返修答辩 | 意见拆条/response letter/返修人力估算 |

技术前提（实测确认，不是推测）：`dsh-subagent-spawn-in-process` 的 `agentPreset: true`，`dsh-tool-subagent` 支持 `agent_preset` 枚举 + `allowedAgentPresets` 白名单，子 agent 走 `applyChildComposition` 独立组装。fork provider 的 `agentPreset` 是 `false`，所以军团只能派 spawn 子代理。`persona` 字段在 tool-subagent 上已废弃，角色身份只能靠 preset 的 persona 插件给。

**风险与守门**：`allowedAgentPresets` 里写一个激活失败的 id，整个科研模式会变 broken——不是降级，是完全不可用。`verify` 加了一条断言专门守这个：名册里每个 id 都必须在 presets 列表里真实存在。

### 新增：需求梳理层

- **`science_requirement_brief`**（`dsh-science/lib/brief-tools.js`）—— 四个 action：`draft`（把一句话描述结构化成需求书并算出缺口）、`refine`（补一轮）、`commit`（校验后建课题）、`read`/`list`。
  缺口是**算出来的**，每条带 `why`（为什么缺）与 `unlocks`（补上它能解锁哪一步），有的还带 `fix`（给用户的改写句式）。判定是纯规则：空泛词（「感兴趣」「想研究」）缺少比较结构会判 blocking，涉及人的研究缺 ethics 直接 blocking。
  **不编造**：缺 ethics 就是缺，不填占位符。
  需求书落 `$DSH_HOME/science/briefs/*.json`，人可读可改可版本对比。
- **`GET /deepscient/api/briefs`** —— 只读端点。写操作留给工具，面板只负责看与引导：一份表单直接写库会绕开缺口判定，那正是要防的事。

### 改动：提示词

- 主 persona 的「工作方式」开头加硬约束：**新建会话第一件事不是开工，是问清楚**。缺的四样（资源/时间人力/目标产出/约束）要一轮问完再 commit，需求书没 commit 不进 S0。写明理由：没有它的课题会在 S1 卡「检索范围没定义」、在 S3 卡「样本量算不出来」。
- 旧的「派活第一行写 `scienceRole: <code>`」删除。那只是一个 prompt 字符串，没有任何代码读取它——五个角色实际上是同一个 agent。换成按 `agent_preset` 点名的对照表，每条给判据。

### 校验

`verify-deepscient` 296 项全绿。新增断言：八个预设（主 + 七角色）、七个角色 id 齐全、主预设名册的每一项都真实存在。`/api/tools` 报 39 个工具（`science_requirement_brief` 已注册）。`/api/briefs` 返回 200。

### 未完成

**新建会话的向导 UI 还没做**。本轮交付的是它的两层底座：需求梳理工具（缺口怎么算）与只读端点（面板怎么读）。面板侧的六步表单与「写进输入框」按钮（`inputActions.insertText`）留到下一轮——那需要在 `conversation.input.activity` 或 `conversation.input.dock` 上挂组件，并补 `wizard.*` 双语字典。

## [0.7.1] — 2026-10-21

把「研究预印本」做成一次检索就能用的一等能力，并更正上一版的一处误判。

### 更正

0.7.0 的说明里写「预印本源只有 arXiv，缺 bioRxiv / medRxiv」——**这句是错的**。当时看的是 `deepscient/host/sources.js`（面板「接入」页的**凭据登记表**），而真正决定能否检索的是 `dsh-science/lib/science/sources/free.js`（**源实现表**），那里本来就有 9 个源：

```
openalex  crossref  europepmc  pubmed  arxiv  doaj  datacite  zenodo  openaire
```

`europepmc` 一个接口就覆盖 bioRxiv / medRxiv / PsyArXiv / Research Square / SSRN，`pubmed` 也在。所以预印本**能搜到**，缺的是两样东西：没法「只搜预印本」，界面上也看不到这两个源。

### 新增

- **`preprintsOnly` 检索开关**（`science_search` / `science_lit_query`）：
  - Europe PMC 追加 `SRC:PPR` —— 实测 `sleep deprivation AND SRC:PPR` 命中 1292 条，头几条就是 `[PPR] bioRxiv`、`[PPR] PsyArXiv`、`[PPR] Research Square`。
  - PubMed 追加 `"preprint"[pt]`。
  - arXiv 天然全是预印本，不加过滤。
  - 用途写在提示词里：判断「这个点有没有人抢先发表」必须走预印本检索，只查已见刊的会漏掉刚挂上去的。

### 修复

- **面板「接入」页看不到预印本源**：凭据表补 `europepmc`（标注含 bioRxiv / medRxiv）与 `pubmed`，两者都是公开 REST、不需要凭据。源数 8 → 10。
- 科研模式 persona 的 S1 段补上 `preprintsOnly` 的用法与理由。

### 校验

`verify-deepscient` 294 项全绿（源数断言 8 → 10，新增「接入页能看到 europepmc」一条）。`/deepscient/api/sources` 报 10 个源，`europepmc` 与 `pubmed` 均为 `wired: runtime`。

## [0.7.0] — 2026-10-21

三步科研流程的能力审计 + 补齐三处缺口。工具从 35 增到 38。

### 审计结论（对照「发现空白 → 实验与独立核查 → 选刊投稿」）

| 用户步骤 | 已有能力 | 本轮处理 |
|---|---|---|
| 第一步 · 预印本与 idea | `science_search` / `science_lit_query` / `science_frontier_scan` / `science_gap_matrix` / `science_novelty` / `science_contribution_design` / `science_knowledge_distill` / `science_paper_plan` | 预印本源只有 arXiv，缺 bioRxiv / medRxiv —— **未做，列入下一轮** |
| 第二步 · 实验 | `science_exp_plan` / `science_exp_run` / `science_exp_query` / `science_stats` / `science_figure` | 已齐 |
| 第二步 · 独立评审 | `science_paper_audit` + `science-provenance` | 已齐 |
| 第二步 · **独立查重** | 无 | **新增 `science_similarity_check`** |
| 第二步 · **独立校对** | `science_manuscript_lint` 只查要件，不查机械错误 | **新增 `science_proofread`** |
| 第二步 · **顶刊达标评估** | `science_journal_fit` 是匹配、`paper_audit` 是维度打分，没有合成判定 | **新增 `science_journal_readiness`** |
| 第三步 · 选刊分析 | `science_journal_fit` / `science_journal_intel` / `science_journal_refresh` | 已齐 |
| 第三步 · 投稿信 | `science_cover_letter` / `science_submission_route` / `science_rebuttal` | 已齐 |

技能侧 17 本已齐（literature-search / source-matrix / fulltext-hunting / frontier-to-paper / statistics-choice / stats-report / reproducibility / top-journal-writing / journal-selection / journal-intel / manuscript-formatting / reporting-standards / figure-for-journal / rebuttal-playbook / experiment-runbook / discipline-methods / study-coach-flow）。

### 新增（`dsh-science/lib/gate-tools.js`）

三个工具都**只判定、不改稿**，纯本地、确定性、可进 CI：

- **`science_similarity_check`** —— 查重：稿内段落两两 5-gram Jaccard（≥0.6 判重复）、与库内文献的自我重复、同项目多稿的拆篇（salami）风险。边界写在工具描述里：只比本机库，不是查重数据库。
- **`science_proofread`** —— 校对：数字与单位缺空格、连续空格、标点前空格、缩写首现未定义、图表序号跳号、引用编号跳号、括号不配对、中英混排粘连。每条带行号与改法。
- **`science_journal_readiness`** —— 顶刊达标：八个加权维度（证据 / 效应量 / 图 / 稿件 / 审计 / 溯源 / 预注册 / 报告规范），给 `below` / `near` / `ready` 与逐项缺口。读不到的维度标 `skipped`，不算通过。明确写「不预测录用」。

### 修复

- **workflow 把技能名当工具名**：`science_statistics_choice`（S3/S7）、`science_reproducibility`（S6/S10）、`science_top_journal_writing`（S9）本就是技能，却被列进阶段的 `tools` 数组，界面会显示成「这一步要调的工具」。现在拆成 `skills` 字段，`tools` 只留真实工具。
- **工具定义缺 `output` 段**：这个版本的 `defineTool` 要求 `output: { schema, render }`，`render` 缺失会让整套预设 `broken`（报 `Cannot read properties of undefined (reading 'render')`）。三个新工具都补了 `output.schema` 与 `output.render`。

### 提示词

科研模式的 persona 增加「三道独立关卡」段落，点名三个工具各自的职责边界与「报出的 blocking 修完再出件」的纪律。

### 校验

`verify-deepscient` 293 项全绿（插件数断言 9 → 10）；`/deepscient/api/tools` 报 38 个工具，三个新工具分别挂在 S9（proofread）与 S10（similarity / readiness）。

### 未完成

- **预印本源只有 arXiv**：`data/sources` 与检索层需要补 bioRxiv / medRxiv，否则「研究预印本」这一步在生命科学方向上覆盖不足。
- 引导（47 条）与设置（43 条）界面文案仍是中文硬编码；`tools.en.json` / `sources.en.json` 未建。

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
