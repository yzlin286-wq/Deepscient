# 快速上手

这个实例叫 DeepScient，是一个独立的 DeepSeek Harness：它有自己的数据根、自己的 profile、自己的端口，和另一个 dsh 互不影响。

## 起停

```
deepscient\bin\deepscient.cmd            # 起，默认 3081，端口被占就顺延
deepscient\bin\deepscient.cmd -NoOpen    # 起，不自动开浏览器
deepscient\bin\deepscient.cmd -Port 3090 # 指定端口
```

关掉那个窗口就是关掉服务。数据在 `%USERPROFILE%\.deepscient`，删掉这个目录等于恢复出厂。

## 十步走到投稿

1. **体检**：`science_preflight` 看环境（Python、LaTeX、统计库）缺什么。
2. **建课题**：`science_project_open`，带 `domain`（学科包 id）、`question`、`ethics`（伦理批号）与 `dataLicense`。
3. **看学科**：`science_discipline_profile` 告诉你这个学科常见的设计、必报项、审稿人常打的点。
4. **检索定位缺口**：`science_lit_query` → `science_gap_matrix`。检索式、时间窗、数据库要留档。
5. **出方案与样本量**：`science_exp_plan`。给效应量算 n，或给 n 算 MDE。聚类设计要算设计效应。
6. **预注册**：把方案提交到 OSF / PROSPERO，把编号填回课题（`prereg_ref`）。这一步门是硬的。
7. **跑数据**：原始数据进 `data/`，脚本进 `code/`，执行一律走 `science_exp_run`（它会记命令、环境、seed、输入输出哈希）。
8. **统计**：`science_stats`。先看 `assumptions`，不满足就按 `warnings[].fallback` 换检验重跑——不是换到显著为止。
9. **作图**：`science_figure`，按目标刊的毫米尺寸出。
10. **写作到出件**：`science_manuscript_new` → 改 `paper.md` → `science_manuscript_lint` → `science_manuscript_build`（PDF / DOCX / JATS / HTML）。

## 侧栏那几个图标是什么

侧栏有 6 个图标，一个图标就是一个页面，点下去直接进，中间没有二级页签：

- **工作台**：课题卡片、S0–S11 阶段条、当前卡在哪、下一步做什么。
- **流程**：55 个门逐条列出，含等级（阻塞／警告／自查）与「怎么过」。
- **工具**：33 个工具分别属于哪一步、这一步产出什么文件。
- **计费**：token 消耗是真值，金额是按你配的价目表估算。
- **接入**：文献源与检索 API 的凭据，只写 `.credentials.yaml` 一个文件。
- **说明**：就是这一页。

设置里还有一页「科研」：默认学科、默认目标刊、α、多重比较校正、出图单位。改完立刻生效。

## 面板上的三种颜色

- 绿 = 机器能查的都过了；
- 红 = 有阻塞项，停下修；
- 灰／虚线 = 「还没留下记录」或「必须你自己看」（伦理、作者贡献、cover letter）。

**灰不等于过。** 面板不会因为别处都做完了就把灰的算绿。
