# 第三方技能：来源、许可与署名

`dsh-science/skills-vendor/manifest.json` 里的 81 条技能全部来自公开仓库，**正文不进本仓库**，
仓库里只有清单（`manifest.json`）与说明（`README.md`）。装的时候由
`deepscient/scripts/install-skills.mjs` 按清单从 GitHub 拉指定 commit 的指定路径，校验 sha256 后
落到本机 `~/.deepscient/science/skills-vendor/`。

这样做的好处：本仓库的许可干净、体积小、不会被第三方后续改动作废；代价是装的时候要联网一次。

## 来源仓库

| 仓库 | 条数 | 许可 | 分组 | 主要提供什么 |
|---|---|---|---|---|
| [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | 42 | MIT | workflow | 科研全流程：选题、检索、实验、统计、作图、写作、投稿、审稿回应 |
| [Aperivue/medsci-skills](https://github.com/Aperivue/medsci-skills) | 20 | MIT | workflow | 医学与临床研究：方案、伦理、统计报告、期刊规范 |
| [ai4s-research/ai4s-skills](https://github.com/ai4s-research/ai4s-skills) | 7 | MIT | workflow | AI for Science 工作流与实验编排 |
| [jxtse/scientific-research-skills](https://github.com/jxtse/scientific-research-skills) | 7 | MIT | workflow | 文献综述、论文结构、研究方法 |
| [anthropics/skills](https://github.com/anthropics/skills) | 2 | per-skill MIT（各技能目录内 `LICENSE.txt`） | generic | 技能创作与工具编写范式 |
| [wp-a/nature-academic-search](https://github.com/wp-a/nature-academic-search) | 1 | MIT | search | Nature 系检索路径 |
| [MrLee2R/Intelligrapher](https://github.com/MrLee2R/Intelligrapher) | 1 | MIT | figure | 数据到成图的链路 |
| [YuanZHAO321/Scientific-Writing-zh](https://github.com/YuanZHAO321/Scientific-Writing-zh) | 1 | MIT | writing | 中文学术写作规范 |

合计 **8 个仓库、81 条技能**。

## 我们改了什么、没改什么

- **没改正文**。安装脚本按 `path` 取单个技能文件，原样落盘，只做三件事：截断过长的 description（≤480 字符）、
  补 frontmatter 必需的 `name`/`description`、把 `ref` 与 `sha256` 记进清单用于校验。
- **没用到的仓库不收**。GitHub 上成熟的科研 agent skill 有 1200+ 条，我们只收精选 81 条：
  562 条、243 条、208 条的巨型包会让模型的路由在几十个近义技能之间崩掉，也会把每次请求的上下文撑到 8 万 token。
  取舍理由写在 [deepscient/docs/skills.md](../deepscient/docs/skills.md)。
- **pin 到 commit**。每条都锁 40 位 commit SHA，不跟分支漂移；升级要显式跑 `--lock-refs` 再 `--lock`。

## 许可与义务

全部 8 个来源仓库都是宽松许可（MIT 系），本仓库的 MIT 许可不覆盖、也不改变它们。
再分发这些技能正文时，请保留各仓库的版权声明；`manifest.json` 里的 `repo` / `path` / `ref` 就是署名依据。

如果你是要在一个不接受第三方内容的场合使用，可以只用随包 17 条（`dsh-science/skills/`），
不跑 `install-skills --apply` 即可 —— 第三方技能是可选装。
