# 中转站对接（un.ccagent.cn）

DeepScient 与中转站（`https://un.ccagent.cn`）之间的合作方接口：用户在本实例登录后**静默建号**，在「计费 → 中转站」里买套餐、看额度，支付结果由 Webhook 回填、订单接口兜底。本文只讲「怎么配、怎么签、怎么验」，签名与落盘的实现都在 `host/relay.js`。

## 1. 能力总览

| 能力 | 方向 | 上游接口 | 在本项目里 |
| --- | --- | --- | --- |
| 账号同步 | 我们 → 中转站 | `POST /partner/v1/users/sync` | 官网授权登录成功后静默调用（失败不影响登录）；也可在「计费 → 中转站 → 同步账号」手动补 |
| 套餐查询 | 我们 → 中转站 | `GET /partner/v1/plans` | 计费页「在售套餐」表，缓存 60 秒，前端不硬编码价格 |
| 购买跳转 | 我们 → 中转站 | `POST /partner/v1/buy-url` | 每行套餐一个「购买」按钮，服务端换一次性 URL 后由浏览器打开 |
| 额度页 | 我们 → 中转站 | `POST /partner/v1/account-url` | 「我的额度」按钮，一次性免登录页 |
| 支付回填 | 中转站 → 我们 | `POST <webhook_url>` | `/deepscient/partner/webhook`，验签 + `event_id` 幂等 |
| 订单对账 | 我们 → 中转站 | `GET /partner/v1/orders/{trade_no}` | 「最近订单」里的「查询」，也是死信后的兜底 |
| 绑定查询 | 我们 → 中转站 | `GET /partner/v1/users/{external_uid}` | `GET /deepscient/api/partner/binding`，只回「有没有同步、user_id 是多少」 |
| 连通自检 | 我们 → 中转站 | `GET /partner/v1/ping` | 「测试连通」（带服务端量到的耗时）与 `partner-probe.mjs --ping` |

一句话：**我们换 `external_uid` 的账号与 API Key，中转站收钱并开额度，Webhook 告诉我们「钱到了」。**

## 2. 配置

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CCAGENT_PARTNER_APP_ID` | `app_ccagent_prod` | 可公开，会显示在计费页与 `--ping` 输出里 |
| `CCAGENT_PARTNER_APP_SECRET` | 无 | **只在服务端**。没配就整块功能退化成「未配置」提示 |
| `CCAGENT_PARTNER_BASE` | `https://un.ccagent.cn` | 上游基址；误填成带 `/partner/v1` 的完整地址会被自动剥掉，避免拼出 `/partner/v1/partner/v1` |
| `CCAGENT_PARTNER_PUBLIC_BASE` | 无 | 本实例的公网基址，用来拼 `return_url` 与默认 Webhook 地址 |
| `CCAGENT_PARTNER_WEBHOOK_URL` | `PUBLIC_BASE + /deepscient/partner/webhook` | 只想覆盖 Webhook 地址时用；最终要拿去中转站报备 |

`app_secret` 有两个来源，**环境变量优先，其次本地文件**：

1. 环境变量 `CCAGENT_PARTNER_APP_SECRET`；
2. `<DSH_HOME>/science/partner-app-secret`（`DSH_HOME` 默认 `~/.deepscient`），内容是一行 secret，权限 0600。

```powershell
# 临时（只对当前进程树生效）
$env:CCAGENT_PARTNER_APP_SECRET = '<app_secret>'

# 或者写文件：一行、末尾换行可有可无
New-Item -ItemType Directory -Force "$env:USERPROFILE\.deepscient\science" | Out-Null
Set-Content -NoNewline "$env:USERPROFILE\.deepscient\science\partner-app-secret" '<app_secret>'
icacls "$env:USERPROFILE\.deepscient\science\partner-app-secret" /inheritance:r /grant:r "$env:USERNAME:(R)"
```

三条红线（代码里是按这个写的，评审时按这个查）：

- secret **不进仓库、不进前端、不进日志**。`/deepscient/api/partner` 只回 `secretPresent` 与 `secretSource`（`env` / `file`），不回值。
- 浏览器侧永远拿不到 secret，签名全部在服务端完成。
- 用户 `api_key` 用 AES-256-GCM 加密后写 `<DSH_HOME>/science/partner.json`，密钥在 `<DSH_HOME>/science/partner-key`（0600）；界面与接口只给掩码。

上游基址与凭据配置错了的典型表现是 `40101`（签名失败），不是网络错误——先对 secret，再对时钟。

## 3. 本机端点

全部挂在 `/deepscient/api` 下，**都要求本机会话**（不在 `PUBLIC_API` 里），身份取自 `req.deepscientUser.id`，不接受客户端传来的 uid。

| 路径 | 方法 | 请求体 | 返回要点 | 登录 |
| --- | --- | --- | --- | --- |
| `/deepscient/api/partner` | GET | — | `configured`、`appId`、`base`、`secretPresent`、`secretSource`、`webhookUrl`、`publicBase`、`binding`、`orders`（当前用户最近 10 条）、`plans`、`plansError` | 是 |
| `/deepscient/api/partner/ping` | POST | `{}` | `appId`、`ts`、`latencyMs`（服务端计时，含网络往返） | 是 |
| `/deepscient/api/partner/sync` | POST | `{ "displayName": "可选" }` | `binding` 投影：`externalUid`/`userId`/`username`/`apiBaseUrl`/`apiKeyMasked`/`hasKey`/`syncedAt` | 是 |
| `/deepscient/api/partner/buy-url` | POST | `{ "planId": 1 }`（可省） | `url`、`ticket`、`expiresIn`；`planId` 只认正整数，否则 400 `bad-plan-id` | 是 |
| `/deepscient/api/partner/account-url` | POST | `{}` | `url`、`ticket`、`expiresIn` | 是 |
| `/deepscient/api/partner/binding` | GET | — | 本地绑定投影 + 上游 `remote`（没同步过时是 `{found:false}`，仍然是 200） | 是 |
| `/deepscient/api/partner/orders/{trade_no}` | GET | — | `order`（本地库合并上游结果）、`webhook`（`event_id`/`status`/`attempts`）；订单不属于当前用户时 404 | 是 |

两个公开端点**不要求会话**，但都要求签名，且仍然只接受回环来源：

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/deepscient/partner/webhook` | POST | 支付回填。验签失败 400，落库失败 500，非 `subscription.paid` 直接 200 `ignored` |
| `/deepscient/partner/return` | GET | 浏览器回跳页。校验 `trade_no`/`status`/`sign`，再查一次订单决定显示「开通成功」还是「待确认」 |

> 「只接受回环」是 `host/index.js` 里 `isLoopback(req)` 判的，**对 Webhook 同样生效**。所以反向代理或隧道必须把请求发到 `127.0.0.1:3081`（Nginx/Caddy 默认从本机发起，frp/ngrok 客户端也在本机），否则中转站会收到 403。

## 4. 签名

### 4.1 公式

```
payload_digest =
    POST/PUT/PATCH : hex(sha256(实际发送的原始请求体字节))
    GET/DELETE     : canonical_query（无参数时为空字符串 ""）

string_to_sign = app_id + "\n" + timestamp + "\n" + nonce + "\n" + payload_digest
signature      = hex(hmac_sha256(app_secret, string_to_sign))
```

四个请求头，缺一不可：

| Header | 取值 |
| --- | --- |
| `X-Partner-App-Id` | `app_id` |
| `X-Partner-Timestamp` | 10 位 Unix 秒；与服务端偏差超过 300 秒会被拒 |
| `X-Partner-Nonce` | 8–64 位，仅 `A-Z a-z 0-9 _ -`；10 分钟内不可重复（本项目用 16 位 hex） |
| `X-Partner-Signature` | 64 位小写 hex |

### 4.2 canonical query 示例

规则：key 升序；key 相同时按 value 升序；逐项 `encodeURIComponent(k) + "=" + encodeURIComponent(v)`，再用 `&` 连接。

```
?b=2&a=1      →  a=1&b=2
?tag=z&tag=a  →  tag=a&tag=z
（无参数）     →  ""
```

### 4.3 POST 只看字节

摘要必须基于**实际发出去的 Buffer**。本项目在 `relayRequest` 里只 `JSON.stringify` 一次，同一个字符串既用来算签名也用来发送；不要「先算出对象、再让 HTTP 库重新序列化」——键序或空格差一个字符就是 `40101`。

请求体的 key 顺序不要求与文档示例一致，只要签名与发送用的是同一份字节。

## 5. 八个上游接口

封装都在 `host/relay.js`，业务层只调这些函数：

| 函数 | 上游 | 用途与注意 |
| --- | --- | --- |
| `ping()` | `GET /partner/v1/ping` | 联调第一步。返回 `{app_id, ts}`；能通说明 app_id、secret、时钟三者都对 |
| `syncUser(uid, {displayName})` | `POST /partner/v1/users/sync` | 幂等：同一 `external_uid` 永远返回同一个 `user_id` 与同一个 `api_key`。拿到结果立刻 `saveBinding`（Key 加密落盘） |
| `getUser(uid)` | `GET /partner/v1/users/{uid}` | 查「同步过没有」。上游用 `40401` 表示没同步，本函数把它翻译成 `{found:false}`，不当异常抛 |
| `listPlans()` | `GET /partner/v1/plans` | 套餐价/额度/时长/分组。进程内缓存 60 秒，`force:true` 可绕过 |
| `createBuyUrl({externalUid, planId, returnUrl})` | `POST /partner/v1/buy-url` | 换一次性购买页地址（300 秒、只能打开一次）。`planId` 非正整数会被丢弃，不会发 `NaN` |
| `createAccountUrl(uid)` | `POST /partner/v1/account-url` | 换一次性「我的额度」页地址（同样 300 秒、一次性） |
| `getOrder(tradeNo)` | `GET /partner/v1/orders/{trade_no}` | 对账兜底。订单不存在或不属于本 app 都是 `40403`，不区分，避免探测 |
| Webhook（入站） | `POST <webhook_url>` | 由 `verifyWebhookSignature` + `applyPaidEvent` 处理，见第 6 节 |

重试只针对「可能会自己好」的失败：`429`、`5xx`、网络错误，退避 `1s → 2s → 4s`（最多 3 次重试，即 4 次尝试）；每次重试**重新签 nonce**，否则会被判 `40103`。`4xx`（除 429）直接失败，不重试。单次请求超时 10 秒。

## 6. 支付回填

### 6.1 验签公式

```
expected = hex(hmac_sha256(app_secret,
             app_id + "\n" + timestamp + "\n" + event_id + "\n" + hex(sha256(raw_body))))
```

- **必须用原始请求体字节**（`req` 流拼出来的 Buffer）。先 `JSON.parse` 再 `JSON.stringify` 会因键序/空白改变摘要，验签必失败。
- 时间窗 300 秒，超出即拒（挡重放）。
- 比较用定长 `timingSafeEqual`。
- 除了验签，还要核对头部 `X-Partner-Event-Id` 与正文 `event_id` 一致——否则「合法签名 + 换正文」有缝可钻。

### 6.2 状态码语义

| 场景 | 本机返回 | 中转站行为 |
| --- | --- | --- |
| 验签通过、事件已处理过 | 200 `{ok:true, duplicate:true}` | 视为成功，停止重试 |
| 验签通过、首次处理 | 200 `{ok:true, duplicate:false}` | 视为成功 |
| 签名错 / 时间戳过期 / event_id 头体不一致 | 400 | 会重试，但改配置前重试也不会好——先去查 secret 与时钟 |
| 事件类型不是 `subscription.paid` 或 `data.status != success` | 200 `{ok:true, ignored:true}` | 视为成功（我们主动放弃处理，不该让对方一直重推） |
| 落库失败（磁盘不可写等） | 500 | 按下面的节奏重试 |
| 服务端没有 secret | 503 | 会重试；先配置 secret |
| 请求体超过 512 KB | 413 | 不重试 |

### 6.3 幂等与重试节奏

- 幂等键是 `event_id`：同一订单只产生一个 `event_id`，重推内容完全一致。`applyPaidEvent` 把「查事件 → 写事件 → 写订单 → 更新绑定」放在同一次读-改-写里，并发两次推送不会都认为自己是第一次。
- 中转站重试节奏：`10s → 60s → 300s → 900s → 3600s`，**共 6 次投递**，单次超时 5 秒，成功判定是 2xx；6 次仍失败记死信，保留 7 天。
- 死信之后靠 `orders/{trade_no}` 主动对账：计费页「最近订单 → 查询」就是这条兜底，会把上游结果合并回本地订单库（保留首次收到时间与 `event_id`，`pending → success` 不会变成新记录）。

## 7. 回跳

购买时如果带了已报备的 `return_url`，支付完成后「返回应用」会跳到：

```
https://<公网域名>/deepscient/partner/return?trade_no=<trade_no>&status=success&sign=<sign>
```

签名原文固定、**不掺 app_id**：

```
sign = hex(hmac_sha256(app_secret, "return:" + trade_no + ":" + status))
```

三条纪律：

1. **回跳只作 UX**。参数可被伪造，页面不会因为 `status=success` 就宣布开通——会再查一次 `orders/{trade_no}`，只有上游 `status=success` 才显示「开通成功」，否则显示「待确认」。
2. 最终状态**以 Webhook / 订单查询为准**。
3. `return_url` 的 host 必须在合作方报备的 `allowed_return_hosts` 里。本机跑的时候 origin 是 `http://127.0.0.1:3081`，中转站访问不到、也没报备，所以 `partnerReturnUrl()` 只在两种情况下下发：显式配置了 `CCAGENT_PARTNER_PUBLIC_BASE`；或请求的 `Origin` 与 `Host` 一致且不是回环地址。两边都不成立就不带 `return_url`——少一个返回按钮，好过让整次购买失败。

## 8. Webhook 部署

数据口只听回环（`host/index.js` 对 `/deepscient` 前缀做 `isLoopback` 检查），所以 Webhook 不能直接对外。做法：**反向代理或隧道把公网 HTTPS 转到本机回环**，再把这个公网地址拿去中转站报备。

```
https://<公网域名>/deepscient/partner/webhook
        │  （Nginx / Caddy / frp / ngrok 任一）
        ▼
http://127.0.0.1:3081/deepscient/partner/webhook
```

要求：

- 公网必须是 **HTTPS**，上游不接受 HTTP；
- 代理到 `127.0.0.1`，不要让请求以非回环源地址进来（否则 403）；
- 5 秒内返回 2xx；
- 不要改写请求体（不要压缩、不要重新序列化），验签看的是原始字节；
- 端口默认 3081，被占用时启动器会顺延到 3099，代理配置要跟着改。

Nginx 片段（只是示例，不要求照抄）：

```nginx
location = /deepscient/partner/webhook {
    proxy_pass         http://127.0.0.1:3081/deepscient/partner/webhook;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Partner-Event-Id $http_x_partner_event_id;
    proxy_set_header   X-Partner-Timestamp $http_x_partner_timestamp;
    proxy_set_header   X-Partner-Signature $http_x_partner_signature;
    proxy_request_buffering off;
    proxy_read_timeout 10s;
}
```

（Nginx 默认就透传自定义请求头；上面三行显式写出来是为了防有人加过 `proxy_set_header` 白名单式配置。）

内网联调建议用 ngrok / frp 临时映射，上线前换成正式域名。地址在计费页「支付回填地址」里可见，直接拿去报备即可。

## 9. 错误码与本项目映射

| code | HTTP | 含义 | 本项目返回 | 处理建议 |
| --- | --- | --- | --- | --- |
| `0` | 200 | 成功 | 200 | — |
| `40001` | 400 | 请求内容不合法 | 400 `relay-bad-request` | 查 JSON、必填字段、`plan_id`/`return_url` |
| `40101` | 401 | 签名校验失败 | 502 `relay-error` | 对 app_id / secret / 原始字节 |
| `40102` | 401 | 时间戳过期（±300s） | 502 `relay-error` | 校 NTP |
| `40103` | 401 | nonce 重复 | 502 `relay-error` | 每次请求新 nonce，不要缓存签名头 |
| `40401` | 404 | 接口/用户不存在 | 404 `not-found` | 用户没同步过时属于正常结果 |
| `40403` | 404 | 订单不存在或不属于本 app | 404 `not-found` | 不重试 |
| `40901` | 409 | 资源冲突 | 502 `relay-error` | 清洗 `external_uid` 或联系上游 |
| `42901` | 429 | 请求过于频繁 | 429 `relay-rate-limited` | 退避（本项目已内置 1s/2s/4s） |
| `50001` | 500 | 上游内部错误 | 502 `relay-error` | 已重试 3 次，仍失败联系上游 |

另外两种本机状态：

- **409 `partner-not-configured`**：`error.status === 0`，也就是连请求都没发出去（通常是没配 secret）。这是本机配置问题，不该报成「中转站坏了」。
- **502 `relay-error`**：其余所有上游失败与网络错误。

`401xx` 一律按「配置或时钟问题」告警——这类错误重试没有意义。

## 10. 安全清单

- [ ] `app_secret` 只在服务端：环境变量或 `<DSH_HOME>/science/partner-app-secret`（0600）；不进 Git、不进前端包、不进日志。
- [ ] `app_id` 可公开，但要与 secret 配对；换 secret 后旧值立即失效。
- [ ] 用户 `api_key` 加密存储（AES-256-GCM，密钥 `science/partner-key` 0600），对外只给掩码（本项目是前 3 + 后 4，短 Key 全遮）。
- [ ] 日志只写 `event_id`、`trade_no`、业务码；不写 secret、签名头、明文 Key。
- [ ] 服务器开 NTP，签名时间戳误差 < 300 秒（Webhook 验签同样看这个窗）。
- [ ] 每次请求生成新 nonce（本项目 16 位 hex），不缓存签名头、不重放。
- [ ] Webhook 用原始字节验签 + `event_id` 幂等；头与正文的 `event_id` 必须一致。
- [ ] 回跳签名校验通过也不直接发货，以订单查询为准。
- [ ] `return_url` 域名已报备；`webhook_url` 是 HTTPS 公网地址、5 秒内 2xx。
- [ ] 对 `429`/`5xx` 退避，对 `401xx` 告警而不是盲目重试。

## 11. 联调用例

「在本项目怎么验」一列里的「计费 → 中转站」指界面上那一块；`--xxx` 指 `scripts/partner-probe.mjs` 的参数。

| # | 场景 | 操作 | 预期 | 在本项目怎么验 |
| --- | --- | --- | --- | --- |
| 1 | 签名正确 | `GET /partner/v1/ping` | `code=0`，返回 `app_id` | 「测试连通」按钮，或 `--ping`（会打印 app_id / ts / 耗时） |
| 2 | 签名错误 | 篡改 `X-Partner-Signature` | HTTP 401，`code=40101` | 把 secret 改错一位后 `--ping`；本机端点会映射成 502 |
| 3 | 时间戳过期 | `X-Partner-Timestamp` 取 10 分钟前 | HTTP 401，`code=40102` | 本 CLI 不构造坏请求；需要时用 `signHeaders({ts})` 复算一次（预期 40102 → 本机 502） |
| 4 | nonce 重放 | 同一 nonce 连发 2 次 | 第 2 次 401，`code=40103` | 用 `signHeaders({nonce})` 固定 nonce 连发两次；本机端点 502 |
| 5 | 首次同步 | `users/sync` 新 `external_uid` | 返回 `user_id`、`api_key`、`api_base_url` | 「同步账号」按钮，或 `--sync u_probe_<时间戳> --name 联调用户` |
| 6 | 重复同步 | 同一 `external_uid` 再调一次 | `user_id` 与 `api_key` 与上次一致 | 同一条 `--sync` 再跑一次，比对 `userId` 与 `apiKeyMasked` |
| 7 | 套餐查询 | `GET /partner/v1/plans` | 3 档套餐，价格 `19.90/69.90/299.00` | `--plans` 打表格；或看计费页「在售套餐」 |
| 8 | 生成购买链接 | `buy-url`（`plan_id=1`） | 返回 `url`，`expires_in=300` | `--buy <uid> --plan 1`，或套餐行的「购买」 |
| 9 | 打开购买页 | 浏览器打开 `url` | 展示 3 档套餐，轻享版默认选中 | 复制 `--buy` 打印的 `url` 到浏览器（会消耗 ticket） |
| 10 | ticket 复用 | 同一链接再打开一次 | HTTP 410「链接已失效」 | 再打开一次同一 `url`；界面上「购买」每次都会重新签发 |
| 11 | 支付成功 | 完成微信支付（可用小额测试单） | 回跳页「开通成功」；`webhook_url` 收到 `subscription.paid` | 本版本尚未做真实支付回归；可用「最近订单」的「查询」对账，观察 `webhook.status` |
| 12 | Webhook 验签 | 用 `app_secret` 校验签名 | 通过；`data.status=success` | 真实推送后看服务端日志（只记 `event_id`/`trade_no`）；离线用 `verifyWebhookSignature` |
| 13 | 订单查询 | `GET /partner/v1/orders/{trade_no}` | `status=success`，`start_time/end_time` 非 0 | `--order <trade_no>`，或「最近订单」里的「查询」 |
| 14 | 越权查询 | 用另一 app 查询该订单 | HTTP 404，`code=40403` | 本机按当前用户过滤：别人的单号直接 404，不确认存在 |
| 15 | 额度页 | `account-url` → 打开链接 | 展示余额、套餐、到期时间、脱敏 Key | `--account <uid>`，或「我的额度」按钮 |
| 16 | 限流 | 1 分钟内 >120 次 | HTTP 429，`code=42901` | 循环调 `--ping` 会先在本地被限流（本机 429 `relay-rate-limited`）；上游超限同样映射 429 |

## 12. 联调 CLI

`scripts/partner-probe.mjs` 零依赖，直接复用 `host/relay.js` 的实现——**它跑通的签名就是服务端在用的签名**，不是另抄一份。

```powershell
node deepscient\scripts\partner-probe.mjs --help
node deepscient\scripts\partner-probe.mjs --ping
node deepscient\scripts\partner-probe.mjs --plans
node deepscient\scripts\partner-probe.mjs --sync u_probe_001 --name 联调用户
node deepscient\scripts\partner-probe.mjs --buy u_probe_001 --plan 1
node deepscient\scripts\partner-probe.mjs --account u_probe_001
node deepscient\scripts\partner-probe.mjs --order SUBUSR513NOab12CD1792591714
```

| 参数 | 作用 | 输出 |
| --- | --- | --- |
| `--home <dir>` | 指定 `DSH_HOME`（用于读本地 secret 与 `partner.json`） | — |
| `--ping` | 连通自检 | `app_id`、`ts`、耗时 |
| `--plans` | 拉在售套餐 | 表格：plan_id、标题、实付价、时长、折合额度、分组 |
| `--sync <external_uid>` | 同步账号（可加 `--name <display_name>`） | 绑定投影：externalUid/userId/username/apiBaseUrl/apiKeyMasked |
| `--buy <external_uid>` | 换购买页地址（可加 `--plan <id>`） | `url`、`ticket`、`expires_in` |
| `--account <external_uid>` | 换额度页地址 | `url` |
| `--order <trade_no>` | 查订单 | 状态、金额、套餐、生效/到期时间、`webhook.status` |
| `--help` | 用法 | — |

行为约定：

- 不设 `DSH_HOME` 时脚本会把它指到 `~/.deepscient`，这样能读到和服务端同一份 secret 文件；
- 失败时打印 `[code] message` 并以退出码 1 结束；`code` 为空表示网络层失败；
- **绝不打印明文 `api_key`、`app_secret` 或签名头**——需要核对 Key 就比对掩码；
- `--buy` 打印的 `url` 是 300 秒一次性链接，别贴进聊天窗口长期保存。
