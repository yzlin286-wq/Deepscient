# MCP 工具层（可选）

DeepScient 默认**不**加载任何 MCP 服务器。这不是没做完，是刻意的：

- 这些服务器要靠 `npx -y` 现场拉包，第一次需要联网；
- 「换台干净机器、断网也能把实例起起来」是这套东西的底线，MCP 会破这条线；
- 不挂的时候，进程不起、启动不变慢、工具列表不变。

## 怎么开

```powershell
$env:DSH_ENABLE_MCP = '1'
deepscient\bin\deepscient.cmd -NoOpen -Port 3081
```

启动日志会多两行：

```
[DeepScient] MCP npmrc: <DSH_HOME>\science\mcp-npmrc（已生成）
[DeepScient] MCP 层  : …\deepscient\mcp.patch.yml
```

关掉：不设这个变量（或设成别的值）重启即可。

## 本机实测（2026-10-21，Windows + Node 24）

| 项 | 结果 |
|---|---|
| 冷启动（第一次 `npx -y` 要下载包） | `papers` 34 s，`pubmed` 74 s |
| 热启动（npm 缓存已有） | `papers` ~3 s，`pubmed` ~2.3 s |
| 注册到的工具 | **34 个**：`papers` 23 个（`mcp__papers__search_papers` 等）+ `pubmed` 11 个（`mcp__pubmed__pubmed_search_articles` 等） |
| `/health.mcp.tools` | `{"count":34,"servers":["papers","pubmed"],"names":[…]}` |

自检命令（绕开 dsh，直接跟服务器握手，出错时把 npx 的 stderr 打出来）：

```powershell
node deepscient/scripts/probe-mcp.mjs papers
node deepscient/scripts/probe-mcp.mjs pubmed
```

## 两个真机踩过的坑（都在代码里绕过了）

**1. `~/.npmrc` 里指向没在监听的代理 → npx 2 毫秒退出，工具全缺席。**
本机 `~/.npmrc` 留着 `proxy=http://127.0.0.1:7890`，而 7890 没在听。`npx -y` 因此 `ECONNREFUSED` 直接失败，
dsh 侧只表现为「MCP 开着但 0 个工具」。修法不是去改你的全局 npm 配置，而是给 MCP 子进程单独一份：

启动器会在 `<DSH_HOME>/science/mcp-npmrc` 生成（**已存在就不覆盖**）：

```
registry=https://registry.npmjs.org/
proxy=
https-proxy=
fund=false
audit=false
loglevel=error
```

`mcp.patch.yml` 的两行都带 `env.npm_config_userconfig: !!js dshHomePath('science/mcp-npmrc')`。
你的网络**确实**要走代理时，改那个文件就行；不改则一律直连。

**2. `env` 只收字符串，`!!js process.env.X` 在变量不存在时是 `undefined` → 整行配置校验失败。**
最初 `pubmed` 那行写了 `NCBI_API_KEY: !!js process.env.NCBI_API_KEY`，本机没设这个变量，于是：

```
dsh: warning: 1 entry did not activate
mcp-pubmed (…dsh-mcp-client): ValidationError: invalid config: …
```

结果这一行**悄悄装不上**（另一行 `papers` 照常工作，很容易漏看）。现在改成注释里的示例 `# NCBI_API_KEY: 'your-ncbi-api-key'`，
要提额度就自己填真 key。

## 冷启动与 60 秒握手上限

MCP 客户端的 `initialize` 走 SDK 默认请求超时（60 s）。第一次 `npx -y` 下载包超过这个时间（本机 `pubmed` 74 s）
就会握手超时、这一行缺席——**再启动一次就好了**（包已进 npm 缓存，2 s 起来）。
所以第一次开 MCP 层如果看到工具少一个：重启一次再确认，不要先怀疑配置。

## 声明了什么

`deepscient/mcp.patch.yml`（host 平面，`DSH_ENABLE_MCP=1` 才叠加）：

| 行 id | serverName | 工具数 | 包 |
|---|---|---|---|
| `mcp-papers` | `papers` | 23 | `paper-search-mcp-nodejs`（arXiv / PubMed / Semantic Scholar / Crossref / OpenAlex / bioRxiv / IACR / Web of Science，含 PDF 下载） |
| `mcp-pubmed` | `pubmed` | 11 | `@cyanheads/pubmed-mcp-server`（PubMed + Europe PMC 全文、MeSH、引文格式化、ID 互转） |

两行都是 `failOnStartupError: false`：没网、没 `npx`、包拉不下来 → 日志报一条错、这几个工具缺席，
**harness 照常启动**。要不要连上，用 `/deepscient/api/health` 的 `mcp` 块看：

```json
"mcp": {
  "enabled": true,
  "patch": "…/deepscient/mcp.patch.yml",
  "declared": [{ "serverName": "papers", "transport": "stdio" },
                { "serverName": "pubmed", "transport": "stdio" }],
  "tools": { "count": 34, "servers": ["papers", "pubmed"], "names": ["mcp__papers__…", "mcp__pubmed__…"] },
  "note": "已按 DSH_ENABLE_MCP=1 叠加 MCP 层"
}
```

`declared` 只认**非注释行** —— 文件注释里还写着 Python 版示例，那些不算已声明。
`tools` 是运行时真相：`count > 0` 才算真连上；`tools.error` 有值说明读工具表时抛了（不会把 `/health` 拖成 500）。

## Python 版（本机有 `uv` 再用）

能力更强，但多一层 Python 运行时依赖，所以只以注释形式放在 `mcp.patch.yml` 里：

```yaml
- id: mcp-arxiv
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: arxiv
    transport: stdio
    command: uvx
    args: ['arxiv-mcp-server']        # 3227★，原始 LaTeX 分节读取、BibTeX、主题订阅
    toolCallTimeoutMs: 120000
    failOnStartupError: false

- id: mcp-zotero
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: zotero
    transport: stdio
    command: uvx
    args: ['zotero-mcp']
    env:
      ZOTERO_LOCAL: 'true'
    failOnStartupError: false
```

## 字段速查

| 字段 | 默认 | 含义 |
|---|---|---|
| `transport` | 必填 | `stdio` 或 `streamable-http` |
| `serverName` | 必填 | 工具名前缀，`[A-Za-z0-9_-]{1,32}`，同 profile 内唯一 |
| `command` / `args` / `env` / `cwd` | — | stdio：可执行文件、参数、附加环境变量（**值必须是字符串**）、工作目录 |
| `url` / `headers` | — | streamable-http：端点与附加头 |
| `toolCallTimeoutMs` | 60000 | 单次 `tools/call` 超时（论文类调到 90000） |
| `failOnStartupError` | false | 首连失败是否让插件激活失败（保持 false：连不上只丢工具） |
| `reconnect.*` | 开 | 断线重连退避；`maxAttempts: 3`，避免无网时无限重试刷日志 |

工具名规则：`mcp__<serverName>__<工具原名>`，和 Claude Code / Codex 一致，重名也能共存
（`mcp__papers__search_papers` 与 `mcp__pubmed__pubmed_search_articles` 互不干扰）。

## 什么时候该开

- 需要 PubMed / Europe PMC 的**全文**、MeSH、引文图谱 —— 自带的 `science_*` 检索工具覆盖不到；
- 需要跨源（arXiv/Crossref/OpenAlex/Semantic Scholar）批量落 PDF；
- 本地 Zotero 里去重、补引文。

只是「搜一下文献」的话，随包工具（Crossref / OpenAlex / arXiv / PubMed 元数据）已经够用，不必开 MCP。
