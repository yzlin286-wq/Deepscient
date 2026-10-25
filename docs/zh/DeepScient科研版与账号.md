# DeepScient 科研版：六模块、官网账号与中转站

本文说明 DeepScient v0.2 科研版相对通用工作台新增的四条链路：科研首页六模块、官网账号登录、ccagent 中转站额度与购买、模型 API 回填；以及应用更新源改为 GitHub 后的配置方式。

## 1. 科研首页六模块

新建会话首页会显示六张模块卡。模块内容来自包内 `jiuwenswarm/resources/science/modules.json`，不在前端硬编码。

| 模块 | 绑定专家团 | 覆盖能力 |
| --- | --- | --- |
| 文献与选题 | `sci-literature-team` | 检索式、系统综述、选题与创新性 |
| 实验设计与执行 | `sci-experiment-team` | 实验设计、统计功效、伦理合规 |
| 数据分析与复现 | `sci-analysis-team` | 数据清洗、统计推断、可复现工程 |
| 论文写作与作图 | `sci-writing-team` | 学术写作、图表设计、科研可视化 |
| 投稿与审稿 | `sci-submission-team` | 选刊、投稿材料、审稿回应 |
| 科研知识与资产 | `sci-knowledge-team` | 知识库、数据资产、可复现记录 |

点击模块会：

1. 幂等安装该模块的专家团与专家（内置资源 → 本地，已安装时不会重复复制）；
2. 以该专家团新建 Team 会话，并在会话元数据里绑定 `agent_group_name`；
3. 把模块的快捷提示词预填到输入框。

安装失败时首页保持原样并提示错误，可在「专家 / 专家团广场」里手动重试。内置资源离线可见：不联网也能浏览、预览与安装。

## 2. 内置专家团与专家

随包内置 6 个专家团、22 个专家模板（6 位团队负责人 + 16 位成员），位于：

```
jiuwenswarm/resources/agent/workspace/plugins/agent_templates/<id>/
jiuwenswarm/resources/agent/workspace/plugins/agent_groups/<id>/
jiuwenswarm/resources/agent/workspace/skills/sci-*/
```

成员模板不含 `AGENT.md`，负责人模板含 `AGENT.md`；每个团队带一条共享科研方法技能。专家广场/专家团广场里的来源显示为 `builtin`。

## 3. 官网账号登录

账号由 `deepscient.com` 官网管理，本机不注册、不保存密码。

- OAuth2 授权码 + PKCE（S256），`client_id` 默认 `deepscient-desktop`
- 回调地址：`http://127.0.0.1:<当前端口>/auth/callback`
- 登录态加密落在 `<数据根>/auth/sessions.json`；前端只能拿到用户信息与余额，拿不到 token
- 官网 `userinfo` 返回 401 时，本地登录态会立即清除并回到登录门

配置在 `config.yaml`：

```yaml
auth:
  provider: deepscient
  base_url: https://deepscient.com
  client_id: deepscient-desktop
  discovery_path: /.well-known/deepscient-oauth
  authorize_path: /oauth/authorize
  token_path: /api/oauth/token
  userinfo_path: /api/oauth/userinfo
  revoke_path: /api/oauth/revoke
  callback_path: /auth/callback
  register_url: https://deepscient.com
  account_center_url: https://deepscient.com
  state_ttl_seconds: 300
```

联调时可用 `DEEPSCIENT_OAUTH_BASE`、`DEEPSCIENT_OAUTH_CLIENT_ID` 覆盖。

界面入口：设置 → 模型 → 账号；未登录显示「登录 DeepScient」与「去官网注册」，已登录显示用户名、邮箱、角色、余额与登录有效期。

## 4. ccagent 中转站

中转站（默认 `https://un.ccagent.cn`）负责建号、套餐、购买与支付回填；应用只做服务端签名与展示。

### 4.1 配置

| 变量/配置 | 默认 | 说明 |
| --- | --- | --- |
| `partner.app_id` | `app_ccagent_prod` | 可公开 |
| `partner.base_url` | `https://un.ccagent.cn` | 上游基址 |
| `partner.public_base` | 空 | 本实例公网基址，用于 `return_url` 与 Webhook |
| `partner.webhook_url` | 空 | 默认 `public_base + /partner/webhook` |
| `partner.default_model` | `deepseek-chat` | 模型回填的默认模型 |
| `CCAGENT_PARTNER_APP_SECRET` | 无 | 只在服务端读取 |
| `<数据根>/science/partner-app-secret` | 无 | 一行 secret，权限 0600；环境变量优先 |

`<数据根>` 默认 `~/.jiuwenswarm`。app_secret 不进仓库、不进前端、不进日志。

### 4.2 能力与端点

| 能力 | 上游 |
| --- | --- |
| 连通自检 | `GET /partner/v1/ping` |
| 账号同步 | `POST /partner/v1/users/sync` |
| 绑定查询 | `GET /partner/v1/users/{external_uid}` |
| 套餐查询 | `GET /partner/v1/plans` |
| 购买跳转 | `POST /partner/v1/buy-url` |
| 额度页 | `POST /partner/v1/account-url` |
| 订单对账 | `GET /partner/v1/orders/{trade_no}` |
| 支付回填 | `POST <webhook_url>` |

本机端点（需登录会话）：`/api/v1/partner/{status,ping,sync,buy-url,account-url,binding,orders/{trade_no}}`。公开端点：`POST /partner/webhook`、`GET /partner/return`。

登录成功后会在后台静默同步账号；同步失败不阻塞登录，可在「设置 → 计费与额度」手动重试。

### 4.3 支付回填

Webhook 用原始请求体字节验签，`event_id` 幂等；只处理 `subscription.paid` 且 `data.status=success`。重复推送返回 `duplicate=true`，不会重复写入订单。`/partner/return` 只作 UX，最终状态仍以订单查询为准。

本机端口只监听回环；Webhook 需要反向代理或隧道把公网 HTTPS 转到 `127.0.0.1:<端口>/partner/webhook`，并在中转站报备地址。

## 5. 模型 API 回填

账号同步成功后会拿到 `api_key` 与 `api_base_url`，并回填为 `ccagent` 模型供应商条目：

- 条目带 `vendor_key=ccagent`、`plan=custom_api`、`client_provider=OpenAI`、`endpoint_profile=openai_compatible`
- api_key 走现有模型配置的加密保存管线，界面只显示掩码
- 默认模型取 `partner.default_model`；仅当没有任何默认模型时才设为默认
- 同一 `ccagent` 条目绑定到另一个官网用户时不会静默覆盖，需要用户确认
- 「拉取模型」会用回填的 Key 调 `{api_base_url}/models`，返回候选模型名

## 6. 更新源

默认从 GitHub Releases 检查与下载：

- 仓库：`yzlin286-wq/Deepscient`
- API：`https://api.github.com/repos/yzlin286-wq/Deepscient/releases/latest`
- 资产名：
  - `DeepScient-{version}-macos.dmg`
  - `DeepScient-{version}-windows.exe`
  - `DeepScient-{version}.tar.gz`

可选令牌：`GITHUB_TOKEN` 或 `DEEPSCIENT_GITHUB_TOKEN`，只用于提高 API 限额，不会写入日志、状态接口或前端。更新面板的「恢复默认」会回到上述 GitHub 配置。

## 7. 排错

| 现象 | 排查 |
| --- | --- |
| 登录按钮无反应 | 检查 `auth.base_url` 是否可访问；授权地址应由 `/api/v1/auth/authorize` 返回 |
| 回调页打不开 | 确认 `/auth/callback` 已由 Web 服务代理到 Gateway，且端口与授权时一致 |
| 中转站显示未配置 | 设置 `CCAGENT_PARTNER_APP_SECRET` 或写入 `science/partner-app-secret`（0600） |
| 签名失败 `40101` | 核对 app_id / secret，并检查本机时钟偏差是否超过 300 秒 |
| 模型未回填 | 先「同步账号」；冲突时确认是否要覆盖另一个官网用户的 `ccagent` 条目 |
| 更新检查失败 | 确认能访问 `api.github.com`；限流时设置 `GITHUB_TOKEN` |
