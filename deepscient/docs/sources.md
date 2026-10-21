# 接入文献与检索 API

工作台的「接入」页管八个内置数据源，另外允许自己加。所有凭据只写一个文件：

```
%USERPROFILE%\.deepscient\science\config.json
  ├─ retrieval.mailto            ← OpenAlex 与 Crossref 共用
  ├─ retrieval.unpaywallEmail
  ├─ retrieval.s2Key
  ├─ retrieval.coreKey
  ├─ retrieval.zoteroKey
  ├─ retrieval.exaKey
  └─ retrieval.custom[]          ← { name, baseUrl, keyHeader, key }
```

写入是「读全量 → 改指定字段 → 写临时文件 → rename」，不会把别的键抹掉；
保存空字符串就是清除该字段。加密钥只写本机，界面上只回掩码（key 留头 3 尾 4，邮箱留首字母与域名）。

## 八个内置源

| 数据源 | 凭据 | 写到哪 | 当前工具侧 | 说明 |
| --- | --- | --- | --- | --- |
| Semantic Scholar | key | `retrieval.s2Key` | 已保存·尚未读取 | 免费 key 额度不高，但能显著抬高限速 |
| OpenAlex | 邮箱 | `retrieval.mailto` | 工具侧会读 | 进 polite pool；同一邮箱也喂 Crossref |
| CORE | key | `retrieval.coreKey` | 已保存·尚未读取 | 开放获取全文聚合，key 在 CORE 控制台申请 |
| Unpaywall | 邮箱 | `retrieval.unpaywallEmail` | 工具侧会读 | 查合法开放获取版本 |
| Crossref | 邮箱 | `retrieval.mailto` | 工具侧会读 | 与 OpenAlex 共用同一字段 |
| arXiv | 无 | — | 工具侧会读 | 公开接口，不用填 |
| Zotero | key | `retrieval.zoteroKey` | 已保存·尚未读取 | 文献库同步，只读权限就够 |
| Exa | key | `retrieval.exaKey` | 已保存·尚未读取 | 面向研究者的语义搜索 |

「工具侧会读」的判定标准只有一条：当前 dsh-science 的检索运行时**真的**从 config 里取了它
（读 `retrieval.mailto` / `retrieval.unpaywallEmail`，以及 `retrieval.openalexKey` 或环境变量 `OPENALEX_KEY`）。
其余四个字段能存、能测连通性，但这一版工具不会自动使用 —— 页面上照实写「已保存·工具侧尚未读取」，
不假装已生效。

## 环境变量也行

内置源同名环境变量优先于 config 之外单独生效，界面会显示「来自环境变量 <名字>」：

`SEMANTIC_SCHOLAR_KEY`、`OPENALEX_KEY`、`CORE_API_KEY`、`UNPAYWALL_EMAIL`、
`CROSSREF_MAILTO`、`ZOTERO_API_KEY`、`EXA_API_KEY`。

优先级是 config 里填了就用 config，没填才看环境变量。这条规则让「临时换邮箱」不用改文件，
也让「文件里到底存了什么」始终可查。

## 验证（测试）按钮做什么

点「测试」会真的发一次最小请求，8 秒超时，只回状态与耗时，不回响应正文：

| 结果 | 含义 |
| --- | --- |
| `通 240ms` | 这次请求 2xx，凭据可用 |
| `有凭据` | 只做了「本地有值」检查（该源没有安全的无副作用测试接口） |
| `缺凭据` | 该源需要凭据，但 config 与环境变量都没有 |
| `失败` | 请求非 2xx 或超时；下面的灰字给 HTTP 状态或超时说明 |

测试会消耗一次上游配额（搜索类接口通常按次计），别当健康检查反复点。

## 自定义源

`custom` 是数组，每行 `{ name, baseUrl, keyHeader, key }`：

- `name` 必填，`baseUrl` 必须是 http(s)；
- `keyHeader` 是请求头的名字（例如 `x-api-key`、`Authorization`）；
- 这些行只会被保存和列出，标 `declared`；要让工具真的用它，得在检索运行时里加分支。

## 常见问题

**为什么填了 key 计费页没变化？**
文献 API 的额度通常单独计，不在这套 token 计费里。计费页只统计模型 token。

**填错了会有副作用吗？**
不会。填错只会让该源请求失败。清空保存即恢复。

**能只填一个吗？**
能。八个全空也能跑：arXiv 免凭据，其余走公开限速池，只是慢一些、元数据少一些。
