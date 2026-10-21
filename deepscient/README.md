# DeepScient

科研版 DeepSeek Harness。独立实例、独立数据根、独立品牌，把 `@local/dsh-science` 那条「选题 → 投稿」的有门流程配上一套能看的界面，再把用量与文献 API 这两件日常事收进面板。

```
deepscient\bin\deepscient.cmd          # 起服务，默认 3081
deepscient\bin\deepscient.cmd -NoOpen  # 不自动开浏览器
```

启动器会打印一行带 token 的地址，**只能用它进**：不带 token 访问首页是 401（dsh 的默认行为，不是我们加的）。

## 它和另一个 dsh 是什么关系

| | 另一个实例 | DeepScient |
|---|---|---|
| 数据根 | `~/.dsh` | `~/.deepscient` |
| profile | `web` | `deepscient` |
| 端口 | 3080 | 3081（被占就顺延到 3099） |
| 界面标题 | DeepSeek Harness | DeepScient · 科研工作台 |
| 预设 | standard / ptc / minimal / cordis | 只有一个「科研模式」 |

三者都不共享。`~/.dsh` 的 mtime 在整套搭建过程中没有被改过一次——这是隔离的硬证据，不是口头承诺。

## 模式：只留「科研模式」

随包发的 standard 预设被**并进**科研设定，并改名为「科研模式」：

- `dsh-science/presets/science.patch.yml` 里那条声明的 `config.id` 就是 `standard`，所以 `agent-preset-registry` 的默认值（`standard`）直接指向它，新会话默认即科研模式，历史会话记下的 `agentPreset: standard` 照旧解析；
- `deepscient/cordis.patch.yml` 把随包的四条原版声明（`preset-standard` / `preset-ptc` / `preset-minimal` / `preset-cordis`）逐条 `disabled: true`。

为什么关而不是 override：override 会整段替换 `config`，要复制 ~170 行插件清单，必然漂移；改声明的 id 是零复制的。
要换回原版四种花色：把 `id: standard` 改回 `science`，并删掉那四条 disable。

## 装了什么

```
deepscient/
├─ package.json        两个 entry：宿主半边（.）与客户端半边（./client）
├─ cordis.patch.yml    让开官方品牌槽、关掉四条原版预设、挂上自己
├─ local.patch.yml     供应商层（只有 apiKeyEnv 名字，没有密钥）
├─ mcp.patch.yml       MCP 工具层（默认不加载，DSH_ENABLE_MCP=1 才叠加）
├─ host/
│  ├─ index.js         品牌 tap（标题/manifest/composer 胶囊样式）+ 挂 /deepscient/api
│  ├─ api.js           健康、设置、流程、工具、技能（含 vendor 溯源）、文档、课题、用量、预设、接入源
│  ├─ science.js       定位 @local/dsh-science，不复制它的逻辑
│  ├─ settings.js      偏好落在数据根的 ui-settings.json（含计费与引导状态）
│  ├─ content.js       说明文档按 Markdown 读
│  ├─ usage.js         token 用量：扫会话日志 → 索引 → 区间汇总 → 按价目估算
│  ├─ sources.js       八个文献/检索数据源的凭据台账（掩码、连通性探测）
│  └─ relay.js         中转站合作方客户端：签名、绑定/订单加密落盘、Webhook 与回跳
├─ client/index.js     品牌、侧栏面板、主区域工作台、设置分区、底部胶囊、使用引导
├─ locale/{zh,en}.json 插件市场里显示的标题与描述
├─ docs/*.md           工作台「说明」页的内容来源（11 篇，含 skills.md / mcp.md / paper.md）
└─ scripts/
   ├─ verify-deepscient.mjs   355 项断言（带 token；不带时 346 项）
   ├─ partner-probe.mjs       中转站联调探针：ping / 套餐 / 同步 / 购买 / 额度 / 订单
   ├─ seed-demo.mjs           把演示数据装进本实例
   ├─ e2e-science-run.mjs     真跑一次科研版：真 key、真模型、真落库、技能与 MCP 配置举证
   ├─ install-skills.mjs      按清单把 81 条第三方科研技能装进本实例（可 dry-run / 校验 / 卸载）
   ├─ probe-mcp.mjs           绕开 dsh 直接跟 MCP 服务器握手：连不上时把 npx 的报错打出来
   └─ sync-model-key.mjs      把生产实例那本账里的 key 复制到科研实例
```

## 界面

侧栏多 6 个图标，一个图标一个页面，没有二级页签：

- **工作台**：课题卡片 + S0–S11 阶段条 + 当前卡点 + 下一步动作（带「阻塞/警告/未留记录/自查」标签与「怎么过」）+ 这一步最常见的翻车方式。
- **流程**：12 个阶段、55 个门，逐条列等级、状态、详情、怎么过。
- **工具**：36 个工具（23 个挂在阶段上、13 个跨阶段），可按名字或阶段过滤；下面同时列出 17 个随包技能（标题取自各自的 `SKILL.md`）。
- **计费**：今天的 token 消耗、四个区间的汇总、按模型 / 按会话明细、预估金额、扣费主体（掩码）、New API 中转站链接位，以及「中转站」区块（账号 / 套餐 / 订单）。
- **接入**：八个文献/检索数据源一行一个，可填 key 或邮箱、保存、点「测试」发一次最小请求；如实标注哪些字段当前版本的工具真的会读。
- **说明**：`docs/` 下七篇。

设置里多一页「科研」：原有九项偏好，加上计费口径（来源 / 中转站地址 / 账单页 / 币种）、可增删行的价目表（provider、模型、输入/缓存命中/输出每百万单价），以及「重新打开使用引导」。

底部输入区有一颗只报 token 的胶囊：`今日 128.4k tokens`。金额不进底部——位置小、也不必天天看；点胶囊直接跳到「计费」页看金额与明细。出厂那颗同时显示「缓存命中率」的胶囊被首屏样式摘掉——命中率对科研决策没有价值，留着会被当成账单。摘除是 `[data-composer-stat="usage"]{display:none!important}`，只点名那一个节点，旁边的活动指示器不动。

## 第一次打开会发生什么

`onboardingDone` 不为 `true` 时，`shell.overlay` 上浮出六步引导：自检 → 模型与 key → 文献 API → 建课题 → 开会话 → 三条铁律。每步一个能按的按钮，进度写回 `ui-settings.json`，看到「跳过引导」就不再出现；想重来在设置里点「重新打开使用引导」。

第五步不再是「复制这段话去开会话」：三条起手式各有一个「用这条开会话」，点了就直接建好会话并把提示词填进输入框（`uiWorkspace.startSession(workspaceId, {agentPreset, prompt, clearPreviousDraft: true})`），你按回车就发。三件事它会先说清楚：当前挂的是哪个预设（预设坏了会明说「激活失败」并禁用按钮）、今天用的是哪个 provider/模型、key 读没读到。失败不再静默——超时会告诉你缺的是 key 还是预设（后者指向设置 → 科研 → 预设体检），不会再把一句 `new session failed` 丢在控制台里。

引导里能直接建课题（`POST /deepscient/api/projects`）。这个写端点先比一次课题根：dsh-science 的 `projectsRoot()` 在 `$DSH_HOME` 缺失时会退回 `~/.dsh`，与本实例数据根不一致时返回 `409 root-mismatch`，宁可拒绝也不把人的课题写进生产库。

## 计费口径（重要）

token 数是**真值**：逐条读会话日志里 provider 写的 `assistant/message.data.usage`，按 `request/header` 的 `(turn, step)` 归属到 `provider/model`，索引落在 `~/.deepscient/science/usage-index.json`（按 `size+mtimeMs` 复用，60 秒有效）。

金额是**估算**：按设置里的价目 × token 算，命中缓存的输入与未命中的输入分开算（缓存通常便宜一个数量级）。上游折扣、赠送额度、按次计费的能力本机看不到，**账单以中转站为准**——所以界面写「≈」，并指向账单页。

两个 URL 是预留字段：`billingBaseUrl`（中转站地址）、`billingConsoleUrl`（账单/余额页），默认空，界面上显示「链接待填」。填了才变成可点的链接。实际扣费发生在你自己的 key 上，计费页列出的「扣费主体」只有掩码。

## 中转站合作方对接（un.ccagent.cn）

计费页多了一块「中转站」：账号、套餐、订单都从这里走，用户不必去中转站注册。五件事：

- **静默建号**：官网授权登录成功后异步调 `users/sync`，中转站按 `external_uid` 建号并回一个 API Key；Key 用 AES-256-GCM 加密落在 `~/.deepscient/science/partner.json`，界面只显示掩码。同步失败不阻塞登录，进计费页点「同步账号」可补。
- **套餐购买**：套餐表由上游 `plans` 实时拉取（缓存 60 秒，前端不硬编码价格），点「购买」时服务端换一次性 `buy-url` 交给浏览器打开。
- **我的额度**：`account-url` 换一次性只读页，看余额、生效套餐、到期时间与脱敏 Key。
- **支付回填**：`POST /deepscient/partner/webhook` 按原始字节验签、`event_id` 幂等；落库失败回 500 让中转站重推，回跳页只作提示。
- **订单对账**：Webhook 走成死信时，「最近订单 → 查询」会调订单接口把真实状态合并回本地。

配置只有两条：`app_id` 可公开（默认 `app_ccagent_prod`）；`app_secret` 只在服务端——环境变量 `CCAGENT_PARTNER_APP_SECRET`，或 `<DSH_HOME>/science/partner-app-secret`（权限 0600）。secret 不进仓库、不进前端、不进日志。本机数据口只听回环，所以 Webhook 必须经反向代理或隧道映射成 HTTPS 公网地址再去中转站报备。

完整说明（配置、本机端点、签名公式、Webhook 部署与 Nginx 片段、错误码映射、16 条联调用例）见 [docs/relay.md](docs/relay.md)。联调探针与 `host/relay.js` 共用同一份签名实现：

```powershell
node deepscient\scripts\partner-probe.mjs --ping
node deepscient\scripts\partner-probe.mjs --plans
node deepscient\scripts\partner-probe.mjs --sync u_probe_001 --name 联调用户
node deepscient\scripts\partner-probe.mjs --buy u_probe_001 --plan 1
node deepscient\scripts\partner-probe.mjs --order <trade_no>
```

## 文献 / 检索 API 接入

八个内置源：Semantic Scholar（key）、OpenAlex（邮箱）、CORE（key）、Unpaywall（邮箱）、Crossref（邮箱，与 OpenAlex 共用）、arXiv（免凭据）、Zotero（key）、Exa（key）。凭据只写 `~/.deepscient/science/config.json`，原子 rename，绝不回显明文、不进日志、不进 tarball。

诚实标注：当前 dsh-science 的检索运行时真的消费 `retrieval.mailto`、`retrieval.unpaywallEmail`（以及 `retrieval.openalexKey` / `OPENALEX_KEY`），其余四个字段能存、能测，但这一版工具不会自动使用 —— 界面写「已保存·工具侧尚未读取」，不假装已生效。

## 验证

```
node deepscient\scripts\verify-deepscient.mjs --token <启动器打印的 token>
node deepscient\scripts\seed-demo.mjs                      # 想看点东西时先装演示数据
node deepscient\scripts\sync-model-key.mjs [--apply]       # 把生产实例那本账里的 key 复制过来
node deepscient\scripts\e2e-science-run.mjs [--run]        # 真跑一次：真 key、真模型、真落库
node deepscient\scripts\partner-probe.mjs --ping            # 中转站连通自检（需已配 app_secret）
```

355 项断言覆盖（本版新增「中转站对接」一节与 7 项 HTTP 断言）：包结构与导出、`--check` 语法、patch 是否真的让开了官方品牌、三条 patch（品牌 / 四条预设 disable / 科研预设占用 `standard`）、品牌 tap 两个阶段各自的幂等性、设置白名单（含计费与价目表逐行校验）、引导默认状态、用量解析（合成日志：合计 5800、按模型/按天分桶、坏行与缺 usage 计数）、价目查找四级退化、八个数据源台账与掩码规则、dry 验源四种状态、文档十一篇、客户端模块的桩加载与**七个**槽注册（id/key 对齐、胶囊不说缓存、引导默认不渲染）、数据根隔离、HTTP 全部端点（含 usage / presets / presets/inspect / sources / projects 写入与各自 404/405/400）、中转站签名（canonical query、原始字节摘要、Webhook / 回跳验签）、`api_key` 加密往返与掩码、支付事件幂等、未登录 401 与伪造 Webhook 400、55 个门字段合法性、合成配置里 9 个科研插件 + 四条原版预设被关掉、技能根三个位置（用户 / 随包 / vendor）与磁盘逐一对上、vendor 清单的 commit pin 与内容哈希、安装器自测 10/10、`--plan` 不写盘、发布包不含第三方正文、MCP 默认关且注释行不算声明、设置写入-读回-复原、manifest 接管、首页标题与启动图、**便携性**（不许有 `{{提示词变量}}`、不许出现 `dsh-purge` / `cwd-variable`、不许写死本机绝对路径）、**引导直连会话**（三个「用这条开会话」按钮、`startSession(workspaceId, {prompt, clearPreviousDraft})`、预设坏了要拦、失败要说清是 key 还是预设）、两个新脚本能在位并 dry-run。

不带 `--token` 时跳过 9 项需要鉴权的首页检查，通过 346 项（带 token 355 项）。

`e2e-science-run.mjs` 是两条腿：模型那一段走 headless（同一个 `$DSH_HOME`、同一份模型层、退出码即结论），建课题与预设体检打 3081 那个活实例（`POST /deepscient/api/projects` 就是引导里「建课题」按的那条路）。**headless 按设计不组合 agent preset**，所以 `science_*` 那批预设平面的工具在那边必然不存在——脚本把这条边界写在注释和输出里，不用假 PASS 糊过去。

## 第三方科研技能（0.4.0 新增）

GitHub 上成熟的科研 agent skill 有 1200+ 条，DeepScient 装的是**精选的 81 条**：

| 仓库 | 条数 | 许可 |
|---|---|---|
| `K-Dense-AI/scientific-agent-skills` | 42 | MIT |
| `Aperivue/medsci-skills` | 20 | MIT |
| `ai4s-research/ai4s-skills` | 7 | MIT |
| `jxtse/scientific-research-skills` | 7 | MIT |
| `anthropics/skills` | 2 | 逐技能 MIT |
| `wp-a/nature-academic-search` | 1 | MIT |
| `MrLee2R/Intelligrapher` | 1 | MIT |
| `YuanZHAO321/Scientific-Writing-zh` | 1 | MIT |

它们装到 `<DSH_HOME>/science/skills-vendor`，和随包 17 条并存，会话里一共 98 条可选、目录约 8.5k tokens。
每条都钉到具体 commit（`ref` 40 位 SHA）并记内容哈希，发布包里只有清单，没有第三方正文。
细节、上下文成本账、为什么不装那三个巨型包（562/243/208 条）、以及 `--plan/--apply/--check/--remove` 怎么用：
见 [docs/skills.md](docs/skills.md)。

```powershell
node deepscient/scripts/install-skills.mjs --list     # 清单 + 装没装
node deepscient/scripts/install-skills.mjs --plan     # 只打印计划
node deepscient/scripts/install-skills.mjs --apply    # 真装
node deepscient/scripts/install-skills.mjs --check    # 按 dsh 的 frontmatter 规则校验
```

界面上等价入口在 **设置 → 科研 → 技能目录**（「看装了哪些技能」/「检查已装技能」）。

## MCP 工具（默认关）

`mcp.patch.yml` 声明了两个 Node 版服务器（`papers` 多源论文检索、`pubmed` PubMed/Europe PMC），
但**只有** `DSH_ENABLE_MCP=1` 时启动器才叠加它：

```powershell
$env:DSH_ENABLE_MCP = '1'
deepscient\bin\deepscient.cmd -NoOpen -Port 3081
```

刻意默认关：它们要靠 `npx -y` 现场拉包，断网机器上起不来；而「换台干净机器也能跑」是底线。
两行都是 `failOnStartupError: false` —— 连不上只丢工具、不退进程，`/deepscient/api/health` 的 `mcp.tools` 会说清连上了几个。

**本机实测（2026-10-21）**：开启后注册到 **34 个工具**（`papers` 23 + `pubmed` 11），热启动约 5 秒；
冷启动第一次要下包（`papers` 34 s、`pubmed` 74 s），而 MCP 握手上限 60 s —— 所以第一次开如果少一行，**再启动一次**即可。
两个真机坑都绕过了：`~/.npmrc` 里指向死代理会让 `npx` 2 毫秒退出（启动器给子进程生成独立的 `<DSH_HOME>/science/mcp-npmrc`）；
`env` 里写 `!!js process.env.X` 在变量不存在时是 `undefined`，整行配置校验失败、悄悄装不上（已改成注释里的示例）。
Python 版（arxiv / zotero，需 `uv`）以注释形式写在同一个文件里，详见 [docs/mcp.md](docs/mcp.md)。

## 不装什么

- 不重新打包 Electron 安装器（改的是 profile 里的组合，不是安装目录）；
- 不动 `dsh-web-frontend/dist`（改名走服务端 tap，dsh 升级不覆盖）；
- 不做多用户、远程鉴权、TLS（数据口只听回环，非回环一律 403）；
- 不碰 `dsh-science` 的选题/实验/统计代码与数据（2199 项断言保持原样）；只改了它那份预设声明：`config.id` / `order` / 描述，以及下面这两处会让预设**整体激活失败**的配置错误。

## 0.4.0 装了什么

| 项 | 事实 |
|---|---|
| 第三方技能 | 81 条 / 8 个仓库，钉 commit + 内容哈希；装到 `science/skills-vendor`，预设按「用户 → 随包 → vendor」扫三个根 |
| 技能目录成本 | 98 条约 8.5k tokens（`catalogDescriptionMaxLength` 调到 260，完整描述仍在磁盘上） |
| 新脚本 | `install-skills.mjs`（list / plan / apply / check / diff / lock / lock-refs / remove / self-test） |
| 新接口 | `GET /deepscient/api/skills`、`POST /deepscient/api/skills/check`；`/health` 增 `skills` 与 `mcp` 两块只读事实 |
| MCP | `mcp.patch.yml` 两行（papers / pubmed），默认不加载；开启后实测注册 34 个工具，启动器认 `DSH_ENABLE_MCP` 并生成独立 npmrc |
| 断言 | 346 项全绿（带 token 355） |

## 0.3.0 修了什么（都是真机上复现出来的）

| 现象 | 原因 | 怎么修的 |
|---|---|---|
| 引导里点「开会话」报新建会话失败 | 科研预设是 `broken` 状态：① 预设里又声明了一次 `image-offload`，而 `image/offload` 的消息投影已由 host 平面注册 → `already registered`；② `plan-mode` 行没给 `config.section`，而它是必填 → 整条预设被 registry 判为激活失败，`startSession` 拿着它必然失败，失败又被 `uiWorkspace.startSession` 的 `.catch` 吞进控制台 | 删掉重复的 `image-offload` 行（host 平面已有），给 `plan-mode` 补上 `section`；新增 `/deepscient/api/presets/inspect` 与设置里的「预设体检」，一行行看每个插件是 `active` 还是 `failed`，不再靠猜 |
| 引导第五步要人复制粘贴提示词 | 那一步只给了「复制」按钮 | 每条起手式一个「用这条开会话」：直接建会话并把提示词填进输入框，你按回车就发（`clearPreviousDraft: true` 不覆盖草稿）；预设坏了按钮禁用并写明原因，超时会告诉你缺的是 key 还是预设 |
| 建了课题但在引导里开不了会话 | `/health` 不报预设与模型，前端无从判断 | `/health` 现在多报 `preset{id,name,broken}` 与 `model{provider,model,apiKeyEnv,keyPresent}`；`keyPresent` 只给布尔，永不带值 |
| 科研实例调不动模型 | 两本凭据账：key 只在 `~/.dsh/.credentials.yaml` | `scripts/sync-model-key.mjs` 把 `refs` 段那三个键复制过来（先备份、值不打印、`--apply` 才写） |

## 已知的验证边界

- **版面好不好看没被验证**：脚本不截图，也不判视觉。深色模式对比、窄侧栏是否挤、价目表在 1280px 下的换行，要人眼看。
- **浏览器里真点开面板没被验证**：脚本证明模块被服务、被加载、七个槽都注册了、组件能被调用返回节点；真渲染要 React 运行时。
- **金额没被第三方对账**：本机算的是估算，中转站账单才是真值。
- `dsh-science/docs/tool-registry.md` 的核心表是 33 个，代码里是 36 个（后加的知识转化层三个）。面板显示 36，以代码为准。
