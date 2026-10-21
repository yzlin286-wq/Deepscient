# The MCP tool layer (optional)

By default DeepScient loads **no** MCP servers. This is not unfinished work, it is deliberate:

- these servers rely on `npx -y` pulling packages on the spot, which needs the network the first time;
- "get the instance up on a clean machine, even offline" is the baseline of this whole thing, and MCP would break that line;
- when nothing is mounted, no process starts, startup does not get slower and the tool list does not change.

## How to turn it on

```powershell
$env:DSH_ENABLE_MCP = '1'
deepscient\bin\deepscient.cmd -NoOpen -Port 3081
```

The startup log gains two lines:

```
[DeepScient] MCP npmrc: <DSH_HOME>\science\mcp-npmrc（已生成）
[DeepScient] MCP 层  : …\deepscient\mcp.patch.yml
```

To turn it off: unset the variable (or set it to something else) and restart.

## Measured on this machine (2026-10-21, Windows + Node 24)

| Item | Result |
|---|---|
| Cold start (the first `npx -y` has to download packages) | `papers` 34 s, `pubmed` 74 s |
| Warm start (npm cache already populated) | `papers` ~3 s, `pubmed` ~2.3 s |
| Registered tools | **34**: 23 from `papers` (`mcp__papers__search_papers` etc.) + 11 from `pubmed` (`mcp__pubmed__pubmed_search_articles` etc.) |
| `/health.mcp.tools` | `{"count":34,"servers":["papers","pubmed"],"names":[…]}` |

Self-check commands (bypassing dsh and handshaking with the server directly; on failure the npx stderr is printed):

```powershell
node deepscient/scripts/probe-mcp.mjs papers
node deepscient/scripts/probe-mcp.mjs pubmed
```

## Two pitfalls hit on real hardware (both worked around in the code)

**1. A proxy in `~/.npmrc` that nothing is listening on → npx exits in 2 milliseconds and every tool is missing.**
This machine's `~/.npmrc` still had `proxy=http://127.0.0.1:7890`, and nothing was listening on 7890. `npx -y` therefore failed outright with `ECONNREFUSED`, and on the dsh side it only showed up as "MCP is on but there are 0 tools". The fix is not to edit your global npm configuration, but to give the MCP child process its own copy:

The launcher generates it at `<DSH_HOME>/science/mcp-npmrc` (**an existing file is not overwritten**):

```
registry=https://registry.npmjs.org/
proxy=
https-proxy=
fund=false
audit=false
loglevel=error
```

Both lines of `mcp.patch.yml` carry `env.npm_config_userconfig: !!js dshHomePath('science/mcp-npmrc')`. If your network **really** has to go through a proxy, edit that file; if you leave it alone, everything connects directly.

**2. `env` accepts strings only, and `!!js process.env.X` is `undefined` when the variable does not exist → the whole config line fails validation.**
Initially the `pubmed` line read `NCBI_API_KEY: !!js process.env.NCBI_API_KEY`, and this machine does not set that variable, so:

```
dsh: warning: 1 entry did not activate
mcp-pubmed (…dsh-mcp-client): ValidationError: invalid config: …
```

As a result this line **silently failed to install** (the other `papers` line kept working, so it is very easy to miss). It is now the commented-out example `# NCBI_API_KEY: 'your-ncbi-api-key'`; fill in a real key yourself if you want a higher quota.

## Cold start and the 60-second handshake limit

The MCP client's `initialize` uses the SDK default request timeout (60 s). If the first `npx -y` package download takes longer than that (on this machine `pubmed` takes 74 s), the handshake times out and that line is absent — **just start once more** (the package is already in the npm cache and comes up in 2 s).
So if you see one tool missing the first time you enable the MCP layer: restart once and check again, do not suspect the configuration first.

## What is declared

`deepscient/mcp.patch.yml` (host plane, only layered in when `DSH_ENABLE_MCP=1`):

| Line id | serverName | Tool count | Package |
|---|---|---|---|
| `mcp-papers` | `papers` | 23 | `paper-search-mcp-nodejs` (arXiv / PubMed / Semantic Scholar / Crossref / OpenAlex / bioRxiv / IACR / Web of Science, including PDF download) |
| `mcp-pubmed` | `pubmed` | 11 | `@cyanheads/pubmed-mcp-server` (PubMed + Europe PMC full text, MeSH, citation formatting, ID conversion) |

Both lines are `failOnStartupError: false`: no network, no `npx`, package cannot be pulled → one error in the log and these tools are absent, but **the harness starts anyway**. Whether they actually connected is visible in the `mcp` block of `/deepscient/api/health`:

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

`declared` counts **non-comment lines only** — the file comments also contain Python examples, and those do not count as declared.
`tools` is the runtime truth: only `count > 0` means really connected; a value in `tools.error` means reading the tool table threw (it will not drag `/health` into a 500).

## The Python variants (use them only if this machine has `uv`)

More capable, but they add a Python runtime dependency, so they are only present as comments in `mcp.patch.yml`:

```yaml
- id: mcp-arxiv
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: arxiv
    transport: stdio
    command: uvx
    args: ['arxiv-mcp-server']        # 3227★, reads original LaTeX section by section, BibTeX, topic subscriptions
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

## Field reference

| Field | Default | Meaning |
|---|---|---|
| `transport` | required | `stdio` or `streamable-http` |
| `serverName` | required | tool name prefix, `[A-Za-z0-9_-]{1,32}`, unique within the same profile |
| `command` / `args` / `env` / `cwd` | — | stdio: executable, arguments, extra environment variables (**values must be strings**), working directory |
| `url` / `headers` | — | streamable-http: endpoint and extra headers |
| `toolCallTimeoutMs` | 60000 | timeout for a single `tools/call` (raise to 90000 for paper tools) |
| `failOnStartupError` | false | whether a failed first connection fails plugin activation (keep false: an unreachable server only loses tools) |
| `reconnect.*` | on | reconnect backoff; `maxAttempts: 3`, so that having no network does not mean endless retries flooding the log |

Tool naming rule: `mcp__<serverName>__<original tool name>`, the same as Claude Code / Codex, so identically named tools can coexist (`mcp__papers__search_papers` and `mcp__pubmed__pubmed_search_articles` do not interfere with each other).

## When to turn it on

- you need **full text**, MeSH and citation graphs from PubMed / Europe PMC — the built-in `science_*` search tools do not cover that;
- you need to bulk-download PDFs across sources (arXiv/Crossref/OpenAlex/Semantic Scholar);
- you need deduplication and citation top-up in a local Zotero.

If all you want is to "search some literature", the bundled tools (Crossref / OpenAlex / arXiv / PubMed metadata) are already enough and you do not need MCP.
