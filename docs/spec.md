# DeepScient 技术规格

> 本文的路径一律**以仓库根为基准**书写（例如 `deepscient/README.md`），与源码位置保持一致。
> 面向使用者的说明见 [../README.md](../README.md)，面向接手者的规格就是本篇。

这份文档写给要接手、要发布、或者要判断「它到底做到了没有」的人。用户视角看 `deepscient/README.md` 与界面里的「说明」页签。

## 1. 目标与边界

**目标**：在同一个 dsh 运行时上多开一个实例，改名为 DeepScient，把科研流程做成看得见的界面，并把这条链完整跑通到可发布。

**明确不做**：重打包 Electron 安装器；改 `dsh-web-frontend/dist`；多用户/远程鉴权/TLS；改 `dsh-science` 的代码、数据与断言。

## 2. 实例形态

| 项 | 值 | 判定依据 |
|---|---|---|
| 数据根 | `%USERPROFILE%\.deepscient` | `$DSH_HOME` 显式覆盖，优先级实测高于 `~/.dsh` |
| profile | `deepscient` | `dsh --profile deepscient --from-default-profile web` 建出的干净 profile |
| 端口 | 3081，占用则顺延 3082–3099 | 启动器用 `TcpListener` 试探后绑定 |
| 组合 | `dsh-base` + `dsh-web-app` + `@local/deepscient` + `@local/dsh-science` | profile 的 `package.json > dsh.profile.bundles` |
| 供应商 | `tree` + `ccagent`，默认 `ccagent/deepseek-v4.1-flash` | `local.patch.yml`，只含 `apiKeyEnv` 名 |

`~/.dsh` 的 mtime 在整个搭建过程中保持 `2026-10-21 09:29:19` 不变，3080 实例全程未重启。

## 3. 品牌改名

三条路，选第三条：

1. 改 `dist/index.html` —— 安装目录，dsh 一升级就被覆盖；
2. 整份替换前端产物 —— 5.1 MB，且要把 `<title>`、`manifest.webmanifest`、favicon 全部对齐；
3. **服务端 `webServer.tapIndex(html => html)`** —— 每次渲染 index 时跑一次纯函数。

选 3。理由：升级不影响，不改别人的文件，改动可读。代价是静态文件要单独接管，所以额外注册了 `GET /manifest.webmanifest`（`exact` 路由，整份自己写，不去猜 dist 路径）。

`<title>`、`application-name`、`apple-mobile-web-app-title`、`theme-color`、`data-deepscient="brand"` 标记都由 tap 写入；tap 幂等（带标记就原样返回），重复渲染不会插两遍。

侧栏品牌槽 `sidebar.brand.mark` / `sidebar.brand.name` 是 `single`，官方占用者 `@deepseek-ai/dsh-client-ui-brand-official` 由 patch 里 `disabled: true` 让开。实测：该包已从启动图中消失，我们的客户端模块出现在 preload 里。

## 4. 插件包结构

```jsonc
{
  "name": "@local/deepscient",
  "type": "module",
  "exports": { ".": "./host/index.js", "./client": "./client/index.js",
               "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true,
                "inject": ["@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-sidebar"] }
  }
}
```

`cordis.patch.yml` 只有两段：

```yaml
- id: ui-brand-official
  name: '@deepseek-ai/dsh-client-ui-brand-official'
  disabled: true
- insert:
    - id: deepscient
      name: '@local/deepscient'
```

**为什么 patch 里不写科研工具行**：工具、人设、技能归 `@local/dsh-science` 自己的 patch。两边各管一段，dsh-science 升级时不会与品牌层互相覆盖。

安装到 profile 用的是 `dsh plugin --profile deepscient add <dir>`，pnpm 建链接的同时把它们写进 `dsh.profile.bundles`——组合来源是 profile 状态，不是启动参数，所以启动器不必再传 `--patch`。

## 5. 宿主接口

前缀路由 `/deepscient`，全部只读，除 `PUT /settings`。非回环来源一律 403（这里没有鉴权，就不该被外部访问）。

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/deepscient/api/health` | 产品名、版本、数据根、settings 路径、科研库可用性与来源 |
| GET | `/deepscient/api/workflow` | 12 个阶段（id/label/goal/toolCount/gateCount）+ 严重度顺序 + 全局规则 |
| GET | `/deepscient/api/tools` | 36 个工具（name/stageId/stageLabel/artifacts），`?stage=S7` 过滤 |
| GET | `/deepscient/api/skills` | 随包技能目录 |
| GET | `/deepscient/api/docs` | 四篇说明的 id/title/bytes |
| GET | `/deepscient/api/docs/:id` | 单篇 markdown |
| GET | `/deepscient/api/projects` | 课题列表 + 每个课题的阶段进度 |
| GET | `/deepscient/api/projects/:id` | 课题 + 方案 + 计数（run/analysis/figure/provenance）+ 溯源链校验 |
| GET | `/deepscient/api/projects/:id/stages` | 12 阶段 + 55 门 + 汇总计数 |
| GET | `/deepscient/api/projects/:id/next` | 当前阶段 + 下一步动作 + 失败模式 + done |
| GET/PUT | `/deepscient/api/settings` | 偏好读写（白名单 + 原子写） |

数据不自己算：`stageStatus()` / `advise()` 来自 `dsh-science`，`verifyChain()` 也来自它。工具清单 = workflow 挂阶段的 ∪ 扫包里 `name: 'science_*'` 得到的（标「全程」）。

`@local/dsh-science` 定位顺序：`DEEPSCIENT_SCIENCE_DIR` → 仓库同级 → 各 profile 的 `node_modules/@local/dsh-science`。找不到就返回 `available:false` + 探测过的路径。

## 6. 客户端

单文件 `client/index.js`，`window.__ModuleLoader__.load({id, factory})`，`require('react')` 是唯一外部依赖（基线表里就这一项，不声明 `dsh.client.external`）。

五个注册：

| 槽 | 注册 | 说明 |
|---|---|---|
| `sidebar.brand.mark` | 组件 | 双轨道 + 中心点的 SVG 标记 |
| `sidebar.brand.name` | 组件 | `DeepScient` + 「科研」 |
| `sidebar.panellist` | `{id:'science', order:20, label:()=>t('panel')}` | 侧栏图标；id 即主区域 key |
| `main` | `{key:'science'}` | 工作台四页签 |
| `settings.section` | `{id:'science', order:40, label:()=>t('settings')}` | 设置页 |

`panellist.id === main.key` 是必须的：侧栏点图标就是把主区域切到同名 key。这条规则从 `dsh-client-ui-schedule` 的注册里读出来的（它同时注册了这两个槽），不靠猜。

样式全部内联 + 半透明灰，`color` 继承宿主 `currentColor`，深浅主题都可读。不引第三方 UI 库（基线里没有）。Markdown 渲染器自己写（标题/列表/代码块/表格/粗体/行内代码/链接），够说明文档用。

## 7. 验证

`deepscient/scripts/verify-deepscient.mjs`，127 项（不给 token 时 118 项）：

- 包：导出、`dsh.bundle.patch`、client 平台、`node --check`、patch 内容、locale、icon；
- 宿主：tap 改标题、幂等、无 `<head>` 兜底、注入项声明、设置白名单四种拒绝、文档四篇、取文档防路径穿越、默认数据根；
- 客户端：ModuleLoader 协议、只 require react、桩加载后五个槽各注册一次、id/key 对齐、order 是数字、label 能取到中文、组件可调用且渲染出 `DeepScient`/svg/标题；
- 承载：CLI `--dump-config` 的合成配置里 9 个科研插件齐全、官方品牌行被本包 patch 关掉、本包行未被禁用；`/skills` 的 17 个技能与磁盘目录逐一比对；
- 隔离：`~/.deepscient` 存在且不是 `~/.dsh`、profile 选了两个 bundle、供应商层不含密钥明文；
- HTTP：无 token 首页 401；health/tools/heartbeat/workflow/projects/stages/next/detail/docs/skills/settings/manifest 全绿；55 门字段合法；S0 完成、S1 未完成（演示数据的设计）；404 两种；405 一种；PUT 写入 → 读回 → 复原；
- 鉴权后：首页 200、标题 `DeepScient · 科研工作台`、无旧标题、启动图含我们的模块、combo 端点真的把模块吐出来。

**验不到的**：版面观感、深色模式对比、窄侧栏换行、浏览器里真点开。脚本只证明「被服务、被加载、注册了对的槽、组件能返回节点」。

## 8. 回归

`dsh-science` 的 11 个脚本全部重跑，2199 项全绿，数字与 M6 一致：

```
verify-tools 14 · verify-method 71 · verify-intel 50 · verify-frontier 174 ·
verify-format 261 · verify-discipline 1050 · verify-lab 189 · verify-stats 152 ·
smoke-manuscript-tools 68 · smoke-discipline-tools 53 · smoke-lab 117
```

`verify-search`（57/60）没算进这 2199：它依赖 arXiv/Zenodo 实时网络，失败是环境性的，如实记录，不掩盖、也不拿它当通过。

## 9. 演示数据的两个坑

1. `demo-student-flow.mjs` 自己 `mkdtemp` 并把 `DSH_HOME` 指向那里，从不写真实数据根——所以不能指望它顺手把数据装进实例。
2. 演示结束时 WAL 里还有约 680 KB 没落盘。直接复制 `science.db`（4096 字节）会得到一个空壳，打开报 `disk I/O error`。`seed-demo.mjs` 用 `VACUUM INTO` 让 SQLite 自己吐干净单文件，再搬文件树。

`seed-demo.mjs` 拒绝写入 `~/.dsh`：开发 shell 里的 `$DSH_HOME` 常指着另一个实例，照着它写等于在别人的活库上动刀。

## 10. 发布前清单

- [x] 独立数据根、独立 profile、独立端口，`~/.dsh` 未变
- [x] 品牌：标题、manifest、侧栏标记与名称
- [x] 面板：工作台 / 流程 / 工具 / 说明
- [x] 设置页：9 项偏好，白名单 + 原子写
- [x] 宿主接口 12 条，只读为主，回环限定
- [x] 127 项验收断言（含 9 插件 / 36 工具 / 17 技能）
- [x] 2199 项回归全绿
- [ ] 浏览器实机走查（观感、深色、窄屏）—— 需人工
- [ ] 发布包：`deepscient-0.1.0.tgz`（`npm pack` 产物），清单见 `deepscient/RELEASE.md`

