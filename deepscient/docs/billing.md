# 计费与口径：token 从哪来，钱为什么是「估算」

## 一句话

token 数是**真值**，从本机会话日志里逐条读出来；金额是**按你填的价目算的估算**，
真实扣费发生在你的那把 key 上，账单在中转站。页面上两者分开写，绝不混成一个数。

## token 数的来源

每次模型回复，provider 会在会话日志里写一条 usage：

```
<sessions>/<日期>/<会话>.jsonl.zstd
  → assistant/message   .data.usage = { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, totalTokens }
  → request/header      .data.header.config = { provider, model }     ← 按 (turn, step) 与上面对齐
```

- `totalTokens = inputTokens + cacheReadTokens + outputTokens`（`cacheWriteTokens` 单独列，不重复计入）。
- 面板把同一份日志按 `(size, mtimeMs)` 缓存成索引：`<数据根>/science/usage-index.json`，
  只对新增或改动的文件重新解析，60 秒内重复打开不重复扫盘。
- 单个日志超过 64 MB 会被跳过并在「统计时跳过的部分」里点名，不静默吞掉。
- 解析不了的行记进 `quality.badLines`，缺 usage 的回复记进 `quality.withoutUsage`；
  它们是「这台机器上确实没数」，不会被摊到别的条目上。

`totalTokens` 以 provider 给的为准。如果某天某个 provider 不写 usage，那一条只会让
`withoutUsage` 加一，其它数字照旧。

## 金额怎么算

价目表在设置里，按**每百万 token** 填，可以有多行：

| 字段 | 含义 |
| --- | --- |
| `provider` | `tree` / `ccagent` / … ；`*` 表示通配 |
| `model` | 模型名；`*` 表示通配 |
| `inputPerM` | 未命中缓存的输入单价 |
| `cacheReadPerM` | 命中缓存的输入单价（通常便宜一个数量级） |
| `outputPerM` | 输出单价 |

匹配顺序是「provider + model 精确」→「provider 精确 + model 通配」→ 全通配。没匹配到的模型，
那一行金额显示 `—`，不会用别的模型的价目替它算。`cacheReadPerM` 缺省时退回 `inputPerM`，
这样至少不会把命中缓存的部分当成免费。

金额 = Σ(各类 token ÷ 1e6 × 对应单价)，按 token 种类分别算再相加 —— 所以缓存命中率高的会话，
金额会明显低于「把所有输入都按未命中价算」。

## 为什么要写明「估算」

1. 价目表是你填的，你改它就变；上游调价不会自动同步。
2. 中转站可能有自己的折扣、赠送额度、阶梯价、按次计费的能力（检索、嵌入），这些本机看不到。
3. 有的 provider 会把「思考 token」并进输出，有的单列；本机只能照它给的数字汇总。

所以底部胶囊与计费页写的是「≈」，并且明确指向中转站账单页。**对账请以中转站为准。**

## 底部胶囊

底部只显示一个数：今天的 token 消耗量（`今日 128.4k tokens`）。金额不放在这里 —— 底部位置小，
一个数就够了；要看金额与明细点胶囊，直接跳到工作台的「计费」页。
出厂那颗胶囊会同时显示「缓存命中率」，已经被首屏样式摘掉 —— 命中率对科研工作没有决策价值，
留着只会让人以为那是账单。

## 中转站链接为什么是空的

`billingBaseUrl`（中转站地址）与 `billingConsoleUrl`（账单/余额页）是两个预留字段，默认空。
没填时计费页显示「链接待填：https://<中转站地址>」，填了才变成可点的链接。

原因很实在：这套实例可以接任何一家 New API 中转站，写死一个地址就是错的。填的时候注意：

- 只填到站点根或面板路径，不要带 key；
- 账单页的路径各家不同（常见是 `/panel/token`、`/console/topup`），按你的部署填；
- 这两个字段只影响「点得开」，不影响任何统计。

## 扣费发生在哪

你的实际用量在这把 key 上扣费：

- 用环境变量注入 key 时，计费页的「扣费主体」会显示来源与掩码（`TREE_API_KEY`、`CCAGENT_API_KEY`、`DEEPSEEK_API_KEY`）；
- 用 DSH 凭据库里的 key 时，显示的是该 provider 的掩码与备注；
- 同一台机器切 key 会改变计费主体，历史会话按写入时的 provider/model 归属，不会因为换 key 而重算。

密钥只在主机侧读取，前端只拿到掩码；日志、索引、tarball 里都不出现明文。
