# 第三方科研技能（vendor skills）

一句话：GitHub 上成熟的科研 agent skill 有 1200+ 条，DeepScient 装的是**精选的 81 条**，
它们和随包的 17 条科研技能并存，会话里一共 98 条可选。

## 为什么不是「全都要」

技能目录会作为一条 system-reminder 进模型上下文（`dsh-tool-skill` 每轮注入 `<available_skills>`）。
条目一多，挤掉的是你真正的工作上下文：

| 装法 | 条目数 | 目录成本（实测/估算） |
|---|---|---|
| 随包 17 条 | 17 | ≈ 1.9k tokens |
| **随包 + 精选 vendor（本版）** | **98** | **≈ 8.5k tokens** |
| 再平铺装 `GPTomics/bioSkills` | 660 | ≈ 45k tokens |
| 全量 1200+ | 1200+ | ≈ 80k+ tokens |

所以三大巨型包（bioSkills 562 / AlterLab 243 / SciAgent 208）这一版**没平铺装**。
真要用，正确姿势是「一个域一条路由技能 + 其余放嵌套 `references/`」——dsh 的 skill provider
只扫 `depth: 1`，`<root>/<名字>/references/**/SKILL.md` 不会进目录，模型需要时再按路径去读。
（`skills-vendor/README.md` 里记了这条留给下一轮。）

另外把 `catalogDescriptionMaxLength` 调到了 **260**（默认 500）：描述在目录里截到 260 字，
完整描述仍在磁盘上。这一刀把 98 条的目录成本从约 13k 压到约 8.5k tokens。

## 装了哪 81 条

| 仓库 | 条数 | 许可 | 覆盖 |
|---|---|---|---|
| `K-Dense-AI/scientific-agent-skills` | 42 | MIT | 检索、实验设计、统计与功效、写作投稿、审稿、作图/海报、平台集成 |
| `Aperivue/medsci-skills` | 20 | MIT | 方案→样本量→清洗→meta→报告规范→引文核验→投稿 |
| `ai4s-research/ai4s-skills` | 7 | MIT | 选题、综述、实验套件、诚信审计、成稿、思维导图 |
| `jxtse/scientific-research-skills` | 7 | MIT | 检索、全文抓取、精读、相关工作、Zotero、论文分诊 |
| `anthropics/skills` | 2 | 逐技能 MIT | `skill-creator`、`mcp-builder` |
| `wp-a/nature-academic-search` | 1 | MIT | 跨源检索去重（明确支持 DeepSeek Harness） |
| `MrLee2R/Intelligrapher` | 1 | MIT | 科研配图 |
| `YuanZHAO321/Scientific-Writing-zh` | 1 | MIT | 中文科研写作 |

完整清单（含每条钉的 commit 与内容哈希）在 `dsh-science/skills-vendor/manifest.json`。

## 装在哪、谁先谁后

```
<DSH_HOME>/skills                  ← 你自己的技能（优先级 1）
<DSH_HOME>/science/skills          ← 随包科研技能 17 条（优先级 2，随包同步）
<DSH_HOME>/science/skills-vendor   ← 第三方 vendor 81 条（优先级 3，本版新增）
```

三个根都写进科学预设的 `customSkillDirs`，`includeDefaultRoots: false`（不把项目级技能包整仓吞进来）。
同名时前面的赢；安装器发现撞名会加 `vendor-` 前缀，**绝不覆盖**你已有的技能。

## 装 / 查 / 更新

```powershell
node deepscient/scripts/install-skills.mjs --list        # 清单 + 装没装
node deepscient/scripts/install-skills.mjs --plan        # 只打印计划（dry-run，不写盘）
node deepscient/scripts/install-skills.mjs --apply       # 真装
node deepscient/scripts/install-skills.mjs --check       # 按 dsh 的规则校验已装
node deepscient/scripts/install-skills.mjs --diff        # 索引与磁盘漂移
node deepscient/scripts/install-skills.mjs --lock        # 回填内容哈希（上游改了才需要）
node deepscient/scripts/install-skills.mjs --lock-refs   # 把 ref 钉到各仓当前 HEAD
node deepscient/scripts/install-skills.mjs --remove --only <id> --apply
```

界面上等价入口：**设置 → 科研 → 技能目录**：

- 「看装了哪些技能」→ 每条的来源、许可、钉的 commit；
- 「检查已装技能」→ 走 `/deepscient/api/skills/check`，与 `--check` 同一套规则。

## 接口

`GET /deepscient/api/skills`

```jsonc
{
  "roots":  { "user": "...", "bundled": "...", "vendor": "..." },
  "preset": { "available": true, "id": "standard", "name": "科研模式",
              "roots": [{ "dir": ".../science/skills-vendor", "exists": true }] },
  "counts": { "user": 0, "bundled": 17, "vendor": 81, "manifest": 81,
              "sessionExpect": 98, "hostCatalog": 1 },
  "catalog": { "session": { "approxTokens": 8477 }, "host": { "rows": 1, "source": "live" } },
  "items": [ { "name": "literature-review", "source": "vendor",
               "vendor": { "repo": "K-Dense-AI/scientific-agent-skills", "ref": "5933…", "license": "MIT" } } ]
}
```

`preset.roots` 是**唯一可信的「会话里扫哪些目录」**：读的是预设注册表 `readDocument` 出来的声明，
再把 `!!js dshHomePath('…')` 按语义求值。别拿 `hostCatalog` 当会话可见性——host 平面只看得见
host 自己挂的那几个技能（本机是 `diagnose-windows-sandbox-acl` 一条）。

`POST /deepscient/api/skills/check` 返回 `{ok, checked, passed, manifest:{rows,pinned}, failed[], problems[]}`。

## 归一化：装的时候改了什么

第三方用 Claude 的 frontmatter 约定，dsh 有两条硬要求（`dsh-skill-filesystem` 会直接抛错）：

| 原字段 | 处理 |
|---|---|
| `userInvocable: false` | → `user-invocable: false` |
| `modelInvocable: false` | → `disable-model-invocation: true`（语义取反保住） |
| `disableModelInvocation` | → `disable-model-invocation` |
| 超长 `description` | 压成单行并截到 480 字，原文进索引 `notes` |
| `license` / `allowed-tools` 等 | 原样保留，dsh 忽略未知字段 |
| BOM、CRLF | 剥掉 / 归一 |

**只改语法，不改正文。** 每个技能带的 `references/`、`templates/`、`LICENSE.txt` 一并落盘
（单文件 ≤ 256 KB、单技能 ≤ 2 MB，超了跳过并告警）。

## 可复现性

- `ref` 是 40 位 commit（禁分支名）：上游推了 `main`，你的行为不会变；
- `sha256` 是内容哈希：上游悄悄改内容，`--diff` 立刻发现；
- 发布包（tarball）里**只有** `skills-vendor/manifest.json` 和 `README.md`，没有一条第三方正文 ——
  「换台干净机器也能跑」这条底线不能因为装技能就破掉。

## 已知边界

- headless 一次性 runner **不组合 agent preset**，所以它看不到预设平面那 98 条技能（这是设计使然）。
  会话内的可见性由「预设声明的三个根 + 81 个 `SKILL.md` 全部通过 dsh 校验」共同保证，
  `e2e-science-run.mjs` 每跑一次都会把这两件事一起验。
- MCP 工具默认不挂（见 [mcp.md](mcp.md)）。
