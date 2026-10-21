# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号遵循语义化版本。
`dsh-science/` 是独立版本线（当前 0.1.0），随产品迭代但不跟着改号，原因见 [docs/spec.md](docs/spec.md)。

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
