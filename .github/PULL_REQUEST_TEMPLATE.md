## 改了什么

<!-- 一两句话。若是修复，说清原来错在哪、为什么错 -->

## 为什么

<!-- 场景或缺陷的根因。评审看这段决定要不要合 -->

## 怎么验的

<!-- 贴命令与关键输出，不是「我测了」 -->

```powershell
node tools\verify-packaging.mjs
# → 打包面校验：20 项全部通过
```

## 影响面

- [ ] `dsh-science/lib/` 工具或流程逻辑
- [ ] `dsh-science/data/` 学科数据（每条新增都要有出处）
- [ ] `dsh-science/skills-vendor/manifest.json`（ref 已 `--lock-refs`，sha256 已 `--lock`）
- [ ] `deepscient/host/` 或 `deepscient/client/`（界面）
- [ ] 组合层 / preset / 启动器
- [ ] 只改文档

## 自查

- [ ] 没引入新的 npm 依赖
- [ ] 没提交凭据、第三方技能正文、本机绝对路径、`dist/`
- [ ] 动了运行时面：跑过 `verify-portability.mjs`
- [ ] 动了宿主或界面：跑过 `verify-deepscient.mjs --token`（贴出通过项数）
- [ ] 新增的能力有对应的验证，或明确说明为什么验不了
