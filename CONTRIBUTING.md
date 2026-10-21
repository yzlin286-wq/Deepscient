# 参与贡献

先读这一句：这个项目的信誉建立在「声称的每件事都有命令能对上」，所以**提 PR 时请贴上你跑过的验证输出**，
而不是「我改好了」。下面是怎么改、怎么验、什么不能进仓库。

## 环境

- Windows 10/11（当前只在 Windows 验证过，见 [ROADMAP.md](ROADMAP.md)）
- Node ≥ 22.5
- 已装 DeepSeek Harness 桌面版（本仓库的两个包都跑在它的运行时上）

首次准备：

```powershell
node dsh-science\scripts\verify-portability.mjs   # 确认你的环境能跑零依赖脚本
node tools\verify-packaging.mjs                    # 打包面自检
```

## 改哪、遵守什么

| 你想改 | 去哪 | 注意 |
|---|---|---|
| 阶段、门、判定逻辑 | `dsh-science/data/workflow.json` + `dsh-science/lib/` | 门的判定必须对着库里真实状态，不许「让模型觉得可以了」 |
| 工具（新增/改描述） | `dsh-science/lib/*-tools.js` | 工具只在「科研模式」preset 下可见；描述决定模型会不会用错 |
| 学科数据、统计口径 | `dsh-science/data/` | 每条要有出处（期刊、指南、教材），不许编 |
| 界面与页签 | `deepscient/client/`、`deepscient/host/` | 改完要能在 3081 实例上真看到 |
| 组合层 / preset | `deepscient/cordis.patch.yml`、`dsh-science/presets/` | 先读 [docs/spec.md](docs/spec.md) 的「组合」一节 |
| 技能清单 | `dsh-science/skills-vendor/manifest.json` | 见下节流程，别手改 sha256 |

代码风格：ESM、无构建步骤、**不引入新依赖**（两个包都靠 Node 内置能力跑）。注释写「为什么」，
不写「这行在做什么」——后者读代码就知道。

## 提交信息

Conventional Commits，标题一行说完，正文说清「为什么」和「怎么验的」：

```
fix(mcp): 给 MCP 子进程单独的 npmrc，避开本机死代理

~/.npmrc 里 proxy 指向没在监听的 7890，npx -y 会在 2ms 内退出，
dsh 侧只表现为「MCP 开着但 0 个工具」。改为启动器生成
<DSH_HOME>/science/mcp-npmrc，patch 里两行都带 env.npm_config_userconfig。

验证：DSH_ENABLE_MCP=1 起实例，/health.mcp.tools count 从 0 → 34。
```

## 加/升级一条第三方技能

```powershell
# 1) 在 manifest.json 里加一条（repo / path / group / license），ref 先填分支名
# 2) 把分支名解析成 40 位 commit
node deepscient\scripts\install-skills.mjs --lock-refs
# 3) 拉取并计算 sha256 锁进清单
node deepscient\scripts\install-skills.mjs --lock
# 4) 干跑看会装什么，再真装
node deepscient\scripts\install-skills.mjs --plan
node deepscient\scripts\install-skills.mjs --apply --only <skill-id>
# 5) 校验
node deepscient\scripts\install-skills.mjs --check
```

规矩：

- **只收宽松许可**（MIT / Apache-2.0 / BSD / ISC）。GPL 系、无许可、`NOASSERTION` 一律不收。
- **只收精选**。GitHub 上科研 agent skill 有 1200+ 条，巨型包（数百条）会让模型在近义技能之间路由崩塌，
  也会把每次请求的上下文撑到 8 万 token。加之前先算上下文成本，见 [deepscient/docs/skills.md](deepscient/docs/skills.md)。
- **正文不进仓库**。仓库里只有清单；装的人联网按 commit 拉，装完校验 sha256。

## 绝对不能提交

- 任何凭据：API key、token、`.credentials.yaml`、`local.patch.yml`（含本机路径与中转站地址）。
- 第三方技能正文（`skills-vendor/` 下只许有 `manifest.json` 与 `README.md`）。
- 本机绝对路径（`tools/verify-packaging.mjs` 会拦）、提示词变量 `{{...}}`、本机私有插件名。
- `dist/` 与 `*.tgz`（发布走 Release 附件）。
- 无关目录：本机工作区里可能同时躺着别的项目，`.gitignore` 用白名单正是为了这个。

## 提 PR 前必跑

```powershell
node tools\verify-packaging.mjs                       # 必须全过
node dsh-science\scripts\verify-portability.mjs        # 动了运行时面就要跑
node deepscient\scripts\install-skills.mjs --self-test # 动了清单或安装器就要跑
node deepscient\scripts\verify-deepscient.mjs --token <token>   # 动了 host/界面就要跑（需要活实例）
```

PR 模板里有勾选项；把关键命令的输出贴进描述。

## 报告问题

用 Issue 模板，附上：`deepscient/bin/deepscient.cmd -NoOpen` 的启动日志、
`/deepscient/api/health` 的 `version` 与 `skills`、`mcp` 字段、Node 版本、以及你实际看到的现象。
安全相关问题不要开公开 Issue，见 [.github/SECURITY.md](.github/SECURITY.md)。
