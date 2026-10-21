# 发布说明 · DeepScient 0.4.0

## 本次增量：中转站合作方对接

在不改上游代码的前提下，把「中转站（un.ccagent.cn）」接成一条完整链路：

- **签名客户端与 8 个接口**：`host/relay.js` 实现 canonical query / 原始字节摘要 / 四个签名头，封装 `ping`、`users/sync`、`users/{uid}`、`plans`、`buy-url`、`account-url`、`orders/{trade_no}` 与 Webhook 验签；只对 `429`/`5xx`/网络错误退避（1s/2s/4s），每次重试重新签 nonce。
- **绑定 / 订单加密存储**：`<DSH_HOME>/science/partner.json`（0600，绑定/订单/事件去重）与 `partner-key`（AES-256-GCM 主密钥，0600）；用户 Key 只以密文落盘，接口与界面只给掩码。
- **Webhook 与回跳**：公开端点 `POST /deepscient/partner/webhook`（原始字节验签、300 秒时间窗、`event_id` 幂等、头体事件号核对）与 `GET /deepscient/partner/return`（`return:<trade_no>:status` HMAC，回跳只作 UX，最终状态以订单查询为准）。
- **计费页区块**：计费页新增「中转站」（账号 / 套餐 / 订单）：连通自检、同步账号、我的额度、套餐购买、订单查询；未配置 secret 时退化成「怎么配」提示，不给按钮。
- **登录后静默同步**：官网授权登录成功后异步调 `users/sync`，失败不阻塞登录也不上抛，只留一条不含 Key 的 warn。
- **文档与探针**：`docs/relay.md`（配置、本机端点、签名、Webhook 部署、错误码映射、16 条联调用例）与零依赖的 `scripts/partner-probe.mjs`（`--ping/--plans/--sync/--buy/--account/--order`，与 `host/relay.js` 共用同一份签名实现）。

## 这次发什么

0.3.0 解决的是「界面点下去真的能用」。0.4.0 换了个方向：**把 GitHub 上成熟的科研技能装进来，并让它可复现、可卸载、不拖累发布包**。

范围说清楚：GitHub 上科研类 agent skill 存量 1200+ 条，这一版装的是**精选的 81 条**（8 个仓库，全部 MIT 或逐技能 MIT）。
另外声明了两个 MCP 工具服务器（多源论文检索、PubMed 全文），**默认不加载**。

三条设计决定，值得先讲：

1. **不全量进**。技能目录是每轮注入模型的 system-reminder，1200 条会吃掉 80k+ tokens，挤掉真正的工作上下文。精选 81 条 + 随包 17 条 = 98 条，约 8.5k tokens，并把 `catalogDescriptionMaxLength` 从 500 调到 260（完整描述仍在磁盘上）。三个巨型包（bioSkills 562 / AlterLab 243 / SciAgent 208）留了「路由技能 + 嵌套引用」的做法，下一轮要用再折叠进来。
2. **发布包里没有一条第三方正文**。清单 + 安装器进包，正文由 `install-skills.mjs` 在目标机器上按 `ref`（commit SHA）+ `sha256` 拉下来，装到 `<DSH_HOME>/science/skills-vendor`。「换台干净机器也能跑」这条底线不能因为装技能就破。
3. **MCP 是开关，不是默认件**。它们靠 `npx -y` 拉包，第一次要联网；断网机器上起不来。所以只有 `DSH_ENABLE_MCP=1` 时启动器才叠加 `mcp.patch.yml`，且两行都 `failOnStartupError: false` —— 连不上只丢工具、不退进程。**开启后本机实测注册 34 个工具**（papers 23 + pubmed 11），热启动约 5 秒。

## 产物

```
dist/local-deepscient-0.4.0.tgz     118968 字节
sha256  ffed6cdefc6961be6c677dbb30ec7fb867aafda8f3ca9d233666afb410062b98
```

30 个文件（0.3.0 是 25 个）：新增 `mcp.patch.yml`、`scripts/install-skills.mjs`、`scripts/probe-mcp.mjs`、`docs/skills.md`、`docs/mcp.md`（清单本体在 `dsh-science/skills-vendor/`，不进 deepscient 的包）。

重新构建：

```
cd deepscient
npm pack --pack-destination ..\dist
```

## 0.4.0 改了什么

**1. 第三方技能：清单 + 安装器**

- `dsh-science/skills-vendor/manifest.json`：81 条，每条 `{id, name, repo, ref, path, license, group, sha256}`。`ref` 全是 40 位 commit（禁分支名），`sha256` 是 `SKILL.md` 的内容哈希 —— 上游推了 `main` 不影响行为，偷偷改内容会被 `--diff` 抓到。
- `deepscient/scripts/install-skills.mjs`（零新依赖）：`--list / --plan / --apply / --check / --diff / --lock / --lock-refs / --remove / --self-test`。自己实现 ustar 解析（含 pax 长名），取包走 `codeload.github.com`、取 commit 走 `commits.atom` —— 都不吃 GitHub API 的 60 次/小时额度（本机 git 被配了不通的代理时会自动走 atom）。
- 归一化只碰语法：`userInvocable/modelInvocable/disableModelInvocation` 映射成 dsh 认的键（后者会直接抛错），超长 `description` 压成单行截到 480 字，BOM 剥掉；`references/`、`templates/`、`LICENSE.txt` 一并落盘（单文件 ≤256 KB、单技能 ≤2 MB）。撞上非 vendor 技能加 `vendor-` 前缀，**绝不覆盖**。

**2. 预设多一个技能根**

`dsh-science/presets/science.patch.yml` 的 `customSkillDirs` 从两个变三个：`skills` → `science/skills` → `science/skills-vendor`（用户 > 随包 > vendor，同名前面的赢）。`tool-skill` 加 `catalogDescriptionMaxLength: 260`。

**3. 新接口 + 界面**

- `GET /deepscient/api/skills`：三个根、每条的来源与 vendor 溯源（repo/ref/license）、`counts{sessionExpect}`、目录 token 估算。其中 `preset.roots` 是**唯一可信的「会话里扫哪些目录」**——读预设注册表 `readDocument` 的声明，再把 `!!js dshHomePath('…')` 求值；`hostCatalog` 只是 host 平面的参考值（本机是 1 条），别混着看。
- `POST /deepscient/api/skills/check`：与 `--check` 同一套规则，返回 `{ok, checked, passed, manifest:{rows,pinned}, failed, problems}`。
- `/health` 增 `skills`（各项计数 + 目录 token）与 `mcp`（`enabled`、`patch`、`declared`；只认非注释行）。
- 设置 → 科研 → 「技能目录」卡：「看装了哪些技能」（按来源分组 + vendor 溯源表）与「检查已装技能」。

**4. MCP（默认关）**

- `mcp.patch.yml`：`mcp-papers`（`npx -y paper-search-mcp-nodejs`，多源检索/下载，23 个工具）、`mcp-pubmed`（`npx -y @cyanheads/pubmed-mcp-server`，PubMed/Europe PMC 全文与 MeSH，11 个工具），`toolCallTimeoutMs: 90000`、`reconnect.maxAttempts: 3`、`failOnStartupError: false`。Python 版（`uvx arxiv-mcp-server`、`uvx zotero-mcp`）以注释形式写在同一文件。
- **两个真机坑**（都在代码里绕过了，值得记下来）：
  1. 本机 `~/.npmrc` 留着 `proxy=http://127.0.0.1:7890`，而 7890 没在监听 → `npx -y` 2 毫秒内 `ECONNREFUSED` 退出，MCP 工具一个都注册不上，dsh 侧只表现为「开着但 0 个工具」。修法不是改用户全局 npm 配置，而是启动器给 MCP 子进程生成 `<DSH_HOME>/science/mcp-npmrc`（已存在不覆盖，要代理就改它），两行 patch 都带 `env.npm_config_userconfig`。
  2. `env` 是 `z.dict(String)`，`NCBI_API_KEY: !!js process.env.NCBI_API_KEY` 在变量不存在时得到 `undefined` → 整行 `ValidationError: invalid config`，这一行**悄悄装不上**（另一行照常工作，很容易漏看）。已改成注释里的示例。
  3. 握手上限 60 s：冷启动 `pubmed` 要 74 s（第一次下包），会超时缺席；包进缓存后 2.3 s 起来 —— 第一次开 MCP 少一行，重启一次即可。
- `bin/launch.ps1`：`DSH_ENABLE_MCP=1` 且文件存在才追加第二个 `--patch`，并在启动日志里明确打「MCP 层：关 / 开」。

**5. 验证**

- `verify-deepscient.mjs` 新增「第三方技能与 MCP」28 项：清单字段完整、ref 是 commit、内容哈希已 lock、许可合规、安装器自测 10/10、`--plan` 不写盘、仓库里只有清单与说明、发布包不含第三方正文、三个技能根与磁盘一致、`sessionExpect = 随包+vendor+用户`、目录 token < 12000、`/skills/check` 全通过、MCP 只声明两行且默认关、启动器认开关、`health` 报技能与 MCP。合计 **285 项（带 token 294 项）**。
- `e2e-science-run.mjs` 增第六段：打活实例验「预设声明的技能根含 vendor 且目录都在」「vendor ≥80 条、sessionExpect ≥90」「`/skills/check` 全通过」「MCP 默认关且只声明 papers/pubmed」。最近一次真跑：`vendor 81 / 随包 17 / 会话里应有 98（约 8477 tokens）`、`81/81 通过`、`MCP 默认关，声明了 papers、pubmed`。
- **MCP 真机验证（本版新增的硬证据）**：`DSH_ENABLE_MCP=1` 起第二个实例，`/health.mcp.tools` 从 `count:0` 变成 `{"count":34,"servers":["papers","pubmed"]}`；`node deepscient/scripts/probe-mcp.mjs pubmed` 输出 `initialize ok（2331ms）… tools/list: 11 个`。断言新增 5 项：运行时工具数默认必须为 0、两行都带独立 npmrc、`env` 里不许出现 `!!js process.env.X`、启动器会生成 npmrc 且不覆盖、探针脚本在位。

## 已知边界（这一版新增的）

- **会话内那 98 条技能的可见性**：headless 一次性 runner **按设计不组合 agent preset**，所以它看不到预设平面的技能目录（实测 host 平面只看到 1 条 `diagnose-windows-sandbox-acl`）。本版用两件硬事实代替：预设声明的三个根（含 vendor，且目录真实存在）+ 81 个 `SKILL.md` 全部通过 dsh 自己的 frontmatter 规则校验。真点开一个会话、让模型调 `skill` 工具这一步，要在浏览器里做（设置 → 科研 → 技能目录 → 看装了哪些技能）。
- **MCP 只验证到「工具注册」，没验证「模型真的调用成功」**：34 个工具的 schema 已进工具表，服务器也在握手时回了 `tools/list`；但没有跑一次「让模型用 `mcp__pubmed__pubmed_search_articles` 查一篇」的完整往返。
- **技能正文没被逐条读过**：只校验了 frontmatter 与体积，没有逐条评估 81 条内容质量；选型依据是仓库成熟度（star、更新活跃度、许可）与流程覆盖度。

---

# 0.3.0 发布说明（历史）

## 这次发什么

0.2.0 把界面搭起来了，0.3.0 修的是「界面点下去真的能用」：**新建会话失败的真因**、**引导不再要人复制粘贴**、**真的用现有 key 跑通一次**、**科研包对第三方环境零依赖**（删掉所有本地植入的痕迹）。

三处真机上复现出来的故障，都在这一版修掉：

1. **「新建会话失败」**——科研预设整个是 `broken`：① 预设里又声明了一次 `image-offload`，而 `image/offload` 的消息投影已由 host 平面注册，撞成 `already registered`；② `plan-mode` 行没给必填的 `config.section`。registry 因此把预设判为激活失败，`uiWorkspace.startSession()` 拿着它必然失败，而失败被 `.catch(r => console.warn(...))` 吞进控制台——所以界面上只看到一句「失败」，看不到原因。
2. **引导第五步要人复制粘贴**——现在每条起手式一个「用这条开会话」，点了就建会话 + 把提示词填进输入框，按回车即发。
3. **科研实例其实调不动模型**——key 只在 `~/.dsh` 那本账里，`~/.deepscient` 没有，`/health` 现在会把这件事明说出来（`keyPresent: false`），并配了 `scripts/sync-model-key.mjs` 一条命令搬过来。

产物：

```
dist/local-deepscient-0.3.0.tgz     90132 字节
sha256  e16d5c6df002dfb31418876c714908bd89a747d0c02898e320620e1b3555aaec
```

25 个文件：`host/` 七个、`client/index.js`、`locale/` 两份、`docs/` 七篇、`scripts/` 四个、`cordis.patch.yml`、`icon.svg`、`README.md`、`package.json`。

重新构建：

```
cd deepscient
npm pack --pack-destination ..\dist
```

## 0.3.0 改了什么

**1. 修好「新建会话失败」（真因在上面）**

- `dsh-science/presets/science.patch.yml`：删掉重复的 `image-offload` 行；给 `plan-mode` 补 `config.section`（只读、只查、只算，方案用 `exit_plan_mode` 交出；用户说「现在就改」视为授权）。`science_project_open` 的注释里也把这条坑写清楚了：预设里再声明 host 平面已有的投影，报错是 `already registered`，不是「你已经配过了」。
- 新增 `GET /deepscient/api/presets/inspect`：返回 `{available, resolved, total, presets:[{id,name,isDefault,broken,rows:[{entryId,moduleName,enabled,condition,fiberState}]}]}`，`fiberState` 是人可读的 `pending/loading/active/failed/disposed/unloading`。设置 → 科研里多一张「预设体检」卡，按一下就把每一行插件的状态列出来——下次预设再坏，看得见是哪一行。

**2. 引导直连会话**

- 第五步重写：先报当前预设（坏了就说「激活失败」并禁用按钮）、今天的 provider/模型、key 读没读到；三条起手式各一个「用这条开会话」+ 一个「复制」兜底。
- 点按钮走 `uiWorkspace.startSession(workspaceId, {agentPreset, prompt, clearPreviousDraft: true})`：**预填提示词，不自动发送**——发不发由人按回车决定。工作区从 `useWorkspaces` 快照里按课题目录找，找不到才 `workspaces.create({path})`。
- 失败不再静默：2.5 秒内没见到新会话，就按 `keyPresent` 报「模型 key 未配置（设置 → 模型）」或「真实原因在 设置 → 科研 → 预设体检」。

**3. `/health` 多报两条事实**

`preset{available,id,name,broken}` 与 `model{provider,model,apiKeyEnv,keyPresent}`。`keyPresent` 只给布尔，永远不带值；`apiKeyEnv` 是从组合配置里按 provider 找出来的名字（`findApiKeyEnv` 只走自有可枚举键，碰到 Cordis Context 的原型 getter 直接跳过，不会把 `/health` 拖成 500）。

**4. 两个新脚本**

- `scripts/sync-model-key.mjs`：把 `~/.dsh/.credentials.yaml` 的 `refs` 段（`CCAGENT_API_KEY` / `TREE_API_KEY` / `TREEAPI_API_KEY`）复制到 `~/.deepscient/.credentials.yaml`。默认 dry-run，`--apply` 才写，写前备份，值永不打印。
- `scripts/e2e-science-run.mjs`：两条腿——模型那一段走 headless（真 key、真模型、退出码即结论、token 记账按会话日志核），建课题与预设体检打 3081 活实例（`POST /deepscient/api/projects` 就是引导里「建课题」按的那条路），建完再去 SQLite 里按题目读回。**脚本里写明了 headless 不组合 agent preset**，所以 `science_*` 在那边不存在是设计如此，不拿假 PASS 糊过去。

**5. 便携性：运行时面没有本地植入**

- 新增 `dsh-science/scripts/verify-portability.mjs`：扫 `lib/ presets/ scripts/ cordis.patch.yml package.json`，禁止 ① 提示词变量 `{{name}}`、② `dsh-purge` / `cwd-variable` 这类本机第三方痕迹、③ 写死的本机绝对路径（Windows 与类 Unix 的用户目录）；persona 只许用官方 key（`prefix|suffix|complete|includeRuntimeContext`）。78 个文件全绿。
- 科研 persona 里那句 `{{cwd}}` 去掉了——`dsh-system-prompt` 对未注册变量直接抛 `unknown prompt variable`，换一台没装 `@local/dsh-cwd-variable` 的机器就是「新建会话失败」。现在改成「工作目录以运行时上下文与 `science_preflight` 报出的为准」。
- 代码注释、README、`docs/survey-2026-10.md` 里指向本机某个内部动作的表述全部改成中性描述，并加了历史文档免责声明。

## 0.2.0 改了什么

**1. 模式归一**

- `dsh-science/presets/science.patch.yml` 那条声明的 `config.id` 从 `science` 改成 `standard`，`order` 5 → 1，显示名仍是「科研模式」；
- `deepscient/cordis.patch.yml` 把随包的四条原版声明（`preset-standard` / `preset-ptc` / `preset-minimal` / `preset-cordis`）逐条 `disabled: true`。

结果：`agent-preset-registry` 的默认值 `standard` 直接指向科研声明，`/deepscient/api/presets` 只返回一条（`standard` / 科研模式），历史会话的 `agentPreset: standard` 继续解析。不是复制 170 行插件清单去 override，所以不存在两份清单漂移的风险。

**2. token 计费**

- 新增 `host/usage.js`：扫 `$DSH_HOME/sessions/**/*.jsonl.zstd`，读 `assistant/message.data.usage`，按 `request/header` 的 `(turn, step)` 归属 `provider/model`；索引落 `science/usage-index.json`（按 `size+mtimeMs` 复用，60 秒有效，原子写）；区间 `today/7d/30d/all`；
- 新增 `GET /deepscient/api/usage`：返回总量、按模型 / 按会话 / 按天明细、扣费主体（掩码）、计费来源说明与中转站链接位；金额按设置里的价目计算，**是估算**；
- 客户端新增「计费」页签、设置里的价目表编辑器、以及底部 `conversation.composer.dock` 胶囊（只报 `今日 N tokens`，金额与明细留在计费页）；
- 出厂那颗同时显示「缓存命中率」的胶囊被服务端注入的样式摘掉：`[data-composer-stat="usage"]{display:none!important}`，只点名那一个节点。

**3. 文献 / 检索 API 接入**

- 新增 `host/sources.js`：八个内置源（Semantic Scholar / OpenAlex / CORE / Unpaywall / Crossref / arXiv / Zotero / Exa）+ 自定义源数组；凭据只写 `science/config.json`，原子 rename，界面只给掩码；
- 新增 `GET|PUT /deepscient/api/sources`、`POST /deepscient/api/sources/verify`、`DELETE /deepscient/api/sources/:id`；
- 客户端新增「接入」页签：一行一个源，可填、可存、可点「测试」发一次最小请求（8 秒超时，只回状态与耗时）；
- 诚实标注 `wired`：只有 `retrieval.mailto` / `retrieval.unpaywallEmail`（以及 `retrieval.openalexKey` / `OPENALEX_KEY`）当前版本的工具真的会读，其余四个字段标「已保存·工具侧尚未读取」。

**4. 首次打开的使用引导**

- 新增 `shell.overlay` 浮层：六步（自检 → 模型与 key → 文献 API → 建课题 → 开会话 → 三条铁律），进度写回 `ui-settings.json` 的 `onboardingDone` / `onboardingStep`；
- 引导第四步能直接建课题，走新增的 `POST /deepscient/api/projects`；该端点先比课题根，不一致返回 `409 root-mismatch`；
- 浮层默认是 click-through，所以卡片自己写 `pointer-events: auto`，否则按钮点不动。

**5. 开关与文档**

- 设置页新增：计费口径来源、中转站地址、账单页、币种、可增删行的价目表、「重新打开使用引导」；
- `docs/` 新增 `guide.md`、`billing.md`、`sources.md`，说明页从四篇变七篇。

## 装到一台新机器

前提：已装 DeepSeek Harness（dsh 0.2.0-rc.2 上验证），已装 Node ≥ 22（`node:sqlite`、`zlib.zstdDecompressSync`）。

```powershell
# 1. 建独立实例
$env:DSH_HOME = "$env:USERPROFILE\.deepscient"
dsh --profile deepscient --from-default-profile web

# 2. 装两个包（pnpm 会把它们写进 profile 的 dsh.profile.bundles）
dsh plugin --profile deepscient add <本仓库>\deepscient
dsh plugin --profile deepscient add <本仓库>\dsh-science

# 3. 配模型层（复制你现有 profile 里的 llm-* 与 agent-default-model 块）
node scripts\deepscient-sync-models.mjs --from "$env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml" --to .\deepscient\local.patch.yml

# 4. 起
.\deepscient\bin\deepscient.cmd
```

第 3 步只搬结构，不搬密钥：`local.patch.yml` 里只有 `apiKeyEnv` 的名字，密钥仍在环境变量里。

**不要**把 `local.patch.yml` 打进发布包——它带着你自己选的供应商端点。`files` 里没有它，这是故意的。
**也不要**把 `~/.deepscient/science/config.json`（文献 API 凭据）或 `usage-index.json` 带走。

## 升级

```
dsh plugin --profile deepscient add <新目录>
```

bundle 组合是 profile 状态，重新 `add` 即换版本。回滚就是再 `add` 回旧目录。数据（`~/.deepscient/science/`）与包无关，升级不动它。

从 0.1.0 升上来时注意：预设 id 从 `science` 变成 `standard`。已经开着的旧会话保留它启动时的插件版本；新会话用新声明。

## 卸载

```
dsh plugin --profile deepscient remove @local/deepscient
```

品牌 tap 与 `/deepscient` 路由随之消失，标题回到 `DeepSeek Harness`，底部胶囊与其样式一起消失，四条原版预设重新出现。要连数据一起清，删 `~/.deepscient`。

## 验收

```
node deepscient\scripts\verify-deepscient.mjs --token <启动器打印的 token>
```

256 项全绿才算发得出去；不给 token 时跑 247 项（跳过 9 项需要鉴权的首页检查）。

端到端另跑一遍（会花 token，约 6 万；真 key、真模型、真落库）：

```
node deepscient\scripts\e2e-science-run.mjs --run --token <token>
```

`dsh-science` 的离线回归必须同时全绿（2199 项：`verify-tools` 14、`verify-method` 71、`verify-stats` 152、`verify-format` 261、`verify-discipline` 1050、`verify-frontier` 174、`verify-intel` 50、`verify-lab` 189、`smoke-discipline-tools` 53、`smoke-lab` 117、`smoke-manuscript-tools` 68），外加便携性检查 `verify-portability.mjs`（78 个文件、两条 PASS）。发布前跑一遍，数字对不上就别发。

`verify-search` 是联网脚本，本次 59/60：失败的 1 项是 `zenodo` 探针 `fetch failed`（本机到 zenodo.org 不可达），与本次改动无关。

## 已知限制（写在发布说明里，不藏）

- 观感没被自动化验证：深色模式对比、窄侧栏换行、价目表在 1280px 下的表现需要人眼看。
- 浏览器里真点开面板没被自动化验证：脚本证明模块被服务、被加载、七个槽注册正确、组件能返回节点；真渲染要 React 运行时。
- 金额是估算：价目由你填，上游折扣 / 赠送额度 / 按次计费的能力本机看不到，账单以 New API 中转站为准。
- 中转站两个链接是预留字段，默认空；没填时界面上显示「链接待填」。
- 四个数据源字段（S2 / CORE / Zotero / Exa）能存能测，但当前 dsh-science 的检索运行时不会自动消费。
- 工具数以代码为准（36），`dsh-science/docs/tool-registry.md` 的核心表（33）滞后于知识转化层新增的三项。

## 发布记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-10-21 | 0.1.0 | 首个可发布包：品牌改名、工作台四页签（含 17 技能清单）、设置页、12 条宿主接口、127 项验收 |
| 2026-10-21 | 0.2.0 | 模式归一为「科研模式」（占用 `standard`）、token 计费（底部胶囊 + 计费页 + 价目表 + 中转站链接位）、八个文献/检索 API 接入台账、六步使用引导、文档四篇 → 七篇、验收 223 项 |
| 2026-10-21 | 0.3.0 | 修「新建会话失败」（预设里重复声明 `image-offload` + `plan-mode` 缺 `section` → 整个预设激活失败）、引导第五步改为「用这条开会话」直连并预填提示词、`/health` 多报 preset/model/keyPresent、新增 `/presets/inspect` 与「预设体检」、新增 `sync-model-key.mjs` 与 `e2e-science-run.mjs`、科研包便携性检查（删掉本地植入痕迹，`{{cwd}}` 变量去掉）、验收 256 项 |
