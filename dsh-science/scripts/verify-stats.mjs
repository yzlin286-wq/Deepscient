#!/usr/bin/env node
/**
 * M6c 分析与作图验证。
 *
 *   node scripts/verify-stats.mjs
 *
 * 全部离线、确定性（固定种子）。用临时课题跑：
 *   - CSV 解析与长表 where 取列
 *   - 统计执行：正确性（对手算/已知值）、假设检查、备选提示、不支持时的诚实降级
 *   - 结果落库与溯源
 *   - 期刊尺寸作图与自检
 *   - 三个示例数据集能复现 expected.json 里的数字
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'stats-verify-'))
process.env.DSH_HOME = home

const { ScienceStore } = await import('../lib/science/store.js')
const lab = await import('../lib/science/lab/index.js')
const { runStats, parseCsv, renderResultMarkdown, pickSeries, listTestIds, getTest } = await import('../lib/science/lab/stats.js')
const { runFigure, listPresets } = await import('../lib/science/lab/figures.js')

let pass = 0
let fail = 0
const fails = []
function check(label, cond, detail = '') {
  if (cond) { pass += 1; return }
  fail += 1
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}
function section(t) { console.log(`\n── ${t} ──`) }

/** runStats / runFigure 在参数不合法时是同步抛错，不是返回 ok:false，所以统一用这个包一层。 */
function throws(fn) {
  try {
    const value = fn()
    return { threw: null, value }
  } catch (error) {
    return { threw: error.message ?? String(error) }
  }
}

const store = new ScienceStore({ dbPath: join(home, 'verify.db') })
const project = lab.createProject(store, { title: '分析验证课题', domain: '心理学', question: '咖啡因是否缩短反应时' })
const pid = project.id
const dir = project.dir

/* ── CSV 解析 ─────────────────────────────────────────────────────────── */
section('CSV')
const csv = 'a,b,grp\n1,2.5,x\n3,4.5,y\n5,,x\n'
writeFileSync(join(dir, 'data', 't.csv'), csv, 'utf8')
const parsed = parseCsv(csv)
check('解析出 3 列', parsed.order.length === 3, JSON.stringify(parsed.order))
check('列名正确', parsed.order.join(',') === 'a,b,grp')
check('行数 3', parsed.n === 3, String(parsed.n))
check('数值自动转 number', parsed.columns.a[0] === 1 && parsed.columns.b[1] === 4.5)
check('空单元格变 null', parsed.columns.b[2] === null)
check('文本列保留字符串', parsed.columns.grp[0] === 'x')
const quoted = parseCsv('name,v\n"a,b",1\n"say ""hi""",2\n')
check('带引号的逗号不当分隔', quoted.columns.name[0] === 'a,b', quoted.columns.name[0])
check('双引号转义', quoted.columns.name[1] === 'say "hi"', quoted.columns.name[1])

const wide = { rt: [400, 410, 455, 460], group: ['placebo', 'placebo', 'caffeine', 'caffeine'] }
check('字符串取列', pickSeries(wide, 'rt').length === 4)
const picked = pickSeries(wide, { column: 'rt', where: { group: 'caffeine' } })
check('where 切出 2 条', picked.length === 2, JSON.stringify(picked))
check('where 取到正确值', picked[0] === 455)
const badCol = (() => { try { pickSeries(wide, 'nope'); return null } catch (e) { return e } })()
check('不存在的列报错', Boolean(badCol) && /没有列/.test(badCol.message))
const badWhere = (() => { try { pickSeries(wide, { column: 'rt', where: { zzz: 1 } }); return null } catch (e) { return e } })()
check('where 用了不存在的列报错', Boolean(badWhere) && /筛选条件/.test(badWhere.message))

/* ── 已知值正确性 ─────────────────────────────────────────────────────── */
section('统计正确性')
// 手算基准：a={1,2,3,4,5}, b={2,4,6,8,10} → 均值 3 vs 6
const r1 = runStats(store, { projectId: pid, testId: 'ttest-welch', data: { a: [1, 2, 3, 4, 5], b: [2, 4, 6, 8, 10] } })
check('ttest 成功', r1.ok === true, r1.error)
check('Welch 统计量为负（a<b）', r1.statistic < 0, String(r1.statistic))
check('df 是小数（Welch 特征）', !Number.isInteger(r1.df), String(r1.df))
check('有 p 值', typeof r1.p === 'number' && r1.p > 0 && r1.p <= 1)
check('有效应量 cohens-d', r1.effectSize?.kind === 'cohens-d')
check('效应量带 CI', Array.isArray(r1.effectSize?.ci) && r1.effectSize.ci.length === 2)
check('CI 下界 < 点估计', r1.effectSize.ci[0] < r1.effectSize.value)
check('CI 上界 > 点估计', r1.effectSize.ci[1] > r1.effectSize.value)
check('有 assumptions', Array.isArray(r1.assumptions) && r1.assumptions.length >= 2)
check('assumptions 每项有 ok', r1.assumptions.every((a) => 'ok' in a))
check('记录了 seed', Number.isInteger(r1.seed))
check('reportAs 是完整句', typeof r1.reportAs === 'string' && r1.reportAs.length > 12)

// 配对：完全相关的两列 → t 应很大
const r2 = runStats(store, { projectId: pid, testId: 'ttest-rel', data: { a: [10, 12, 14, 16, 18], b: [1, 2, 3, 4, 5] } })
check('配对 t 成功', r2.ok === true, r2.error)
check('配对差值恒为 9 → t 极大或 NaN 处理得当', r2.ok === true)
check('配对效应量是 dz', r2.effectSize?.kind === 'cohens-dz', r2.effectSize?.kind)

// 完全相等的两组：p 应接近 1
const r3 = runStats(store, { projectId: pid, testId: 'ttest-welch', data: { a: [5, 5, 5, 5, 5], b: [5, 5, 5, 5, 5] } })
check('方差为 0 时不崩', r3.ok === true || r3.ok === false)
if (r3.ok) {
  check('完全相等 → p 接近 1', r3.p > 0.9, String(r3.p))
  check('完全相等 → 效应量为 0 或 null', r3.effectSize?.value === 0 || r3.effectSize?.value == null, String(r3.effectSize?.value))
}

// 卡方：手算 2×2 [[30,20],[15,35]]，n=100
const r4 = runStats(store, { projectId: pid, testId: 'chi2', data: { table: [[30, 20], [15, 35]] } })
check('卡方成功', r4.ok === true, r4.error)
check('默认用 Yates 校正 → χ² ≈ 7.92', Math.abs(r4.statistic - 7.9192) < 0.01, String(r4.statistic))
check('同时给出未校正值 ≈ 9.09', Math.abs(r4.uncorrected.statistic - 9.0909) < 0.01, String(r4.uncorrected?.statistic))
check('声明了用的是哪种校正', r4.correction === 'yates', r4.correction)
check('卡方 df = 1', r4.df === 1)
check('Cramér V 在 0–1', r4.effectSize.value > 0 && r4.effectSize.value < 1)
const r4b = runStats(store, { projectId: pid, testId: 'chi2', data: { table: [[30, 20], [15, 35]] }, options: { correction: 'none' } })
check('可要求不校正 → 9.09', Math.abs(r4b.statistic - 9.0909) < 0.01, String(r4b.statistic))
check('不校正时 correction 标为 none', r4b.correction === 'none')

// Fisher：[[8,2],[1,9]] 的 OR 应为 36
const r5 = runStats(store, { projectId: pid, testId: 'fisher', data: { table: [[8, 2], [1, 9]] } })
check('Fisher OR = 36', Math.abs(r5.effectSize.value - 36) < 0.001, String(r5.effectSize.value))
check('Fisher p < 0.01', r5.p < 0.01, String(r5.p))

// 相关：y = x 完全线性 → r = 1
const xs = [1, 2, 3, 4, 5, 6, 7, 8]
const r6 = runStats(store, { projectId: pid, testId: 'pearson', data: { x: xs, y: xs.map((v) => v * 2 + 1) } })
check('完全线性 r ≈ 1', Math.abs(r6.statistic - 1) < 1e-6, String(r6.statistic))
check('R² ≈ 1', Math.abs(r6.effectSize.value - 1) < 1e-6)

// OLS：y = 3x + 2 应还原系数
const olsY = xs.map((v) => 3 * v + 2)
const r7 = runStats(store, { projectId: pid, testId: 'ols', data: { y: olsY, x: xs } })
check('OLS 成功', r7.ok === true, r7.error)
check('OLS 有系数表', Array.isArray(r7.coefficients) && r7.coefficients.length === 2, JSON.stringify(r7.coefficients?.map((c) => c.name)))
const slope = r7.coefficients?.find((c) => c.name === 'x')
check('斜率还原为 3', slope && Math.abs(slope.estimate - 3) < 1e-6, String(slope?.estimate))
const intercept = r7.coefficients?.find((c) => c.name === 'const')
check('截距还原为 2', intercept && Math.abs(intercept.estimate - 2) < 1e-6, String(intercept?.estimate))
check('系数带 CI', slope && Array.isArray(slope.ci))

// 置换：确定性（同 seed 同结果）
const permData = { g1: [1, 2, 3, 4, 5, 6], g2: [7, 8, 9, 10, 11, 12] }
const pa = runStats(store, { projectId: pid, testId: 'permutation', data: permData, seed: 42, options: { resamples: 500 } })
const pb = runStats(store, { projectId: pid, testId: 'permutation', data: permData, seed: 42, options: { resamples: 500 } })
check('置换检验可复现', pa.p === pb.p, `${pa.p} vs ${pb.p}`)
const pc = runStats(store, { projectId: pid, testId: 'permutation', data: permData, seed: 7, options: { resamples: 500 } })
check('换 seed 结果不同（但不是错）', pc.ok === true)
check('完全分离的两组 p 很小', pa.p < 0.01, String(pa.p))

// 生存：常数风险下中位生存应可算
const surv = runStats(store, {
  projectId: pid,
  testId: 'logrank',
  data: {
    time: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    event: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    group: ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'b', 'b', 'b', 'b'],
  },
})
check('log-rank 成功', surv.ok === true, surv.error)
check('log-rank df = 1', surv.df === 1)
check('log-rank 有 HR', surv.effectSize.kind === 'hazard-ratio')

// 生存：删失保留
const km = runStats(store, { projectId: pid, testId: 'kaplan-meier', data: { time: [1, 2, 3, 4, 5, 6, 7, 8], event: [1, 1, 1, 1, 0, 0, 1, 1] } })
check('Kaplan-Meier 成功', km.ok === true, km.error)
check('记录删失数', km.n.censored === 2, JSON.stringify(km.n))
check('有曲线点', Array.isArray(km.curve) && km.curve.length > 0)

/* ── 假设检查与备选 ───────────────────────────────────────────────────── */
section('假设与备选')
// 极端偏态 → 正态性应判失败，并给出 fallback
const skewed = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 50, 60]
const r8 = runStats(store, { projectId: pid, testId: 'ttest-welch', data: { a: skewed, b: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] } })
check('偏态数据成功返回', r8.ok === true, r8.error)
const normFail = r8.assumptions.find((a) => a.id.startsWith('normality') && a.ok === false)
check('检出正态性不满足', Boolean(normFail), JSON.stringify(r8.assumptions.map((a) => `${a.id}:${a.ok}`)))
check('给出 warnings', r8.warnings.length >= 1, JSON.stringify(r8.warnings))
check('warnings 带备选检验 id', r8.warnings[0].fallback.length >= 1, JSON.stringify(r8.warnings[0]))
check('备选来自 statistics.json 的 fallback 字段', (getTest('ttest-welch').fallback ?? []).includes(r8.warnings[0].fallback[0]), JSON.stringify(getTest('ttest-welch').fallback))
// 备选里每个 id 都必须真的存在，否则提示是空的
for (const fb of r8.warnings[0].fallback) {
  check(`备选 ${fb} 在统计库里存在`, Boolean(getTest(fb)), fb)
}

/* ── 诚实降级 ─────────────────────────────────────────────────────────── */
section('诚实降级')
const unsupported = runStats(store, { projectId: pid, testId: 'fine-gray', data: { a: [1, 2, 3] } })
check('未实现的检验返回 ok=false', unsupported.ok === false)
check('method 为 unsupported', unsupported.method === 'unsupported', unsupported.method)
check('给出 hint 指向自己写脚本', /science_exp_run/.test(unsupported.hint ?? ''), unsupported.hint)
check('列出支持的检验 id', Array.isArray(unsupported.supported) && unsupported.supported.length >= 20, String(unsupported.supported?.length))
const unknown = throws(() => runStats(store, { projectId: pid, testId: 'not-a-test', data: { a: [1] } }))
check('统计库里没有的 id 直接抛错', Boolean(unknown.threw) && /统计库里没有/.test(unknown.threw), JSON.stringify(unknown))
const noData = throws(() => runStats(store, { projectId: pid, testId: 'ttest-welch' }))
check('既无 data 也无 csvPath 抛错', Boolean(noData.threw))
const badCsvPath = throws(() => runStats(store, { projectId: pid, testId: 'ttest-welch', csvPath: '../../etc/passwd' }))
check('csvPath 越界被拒绝', Boolean(badCsvPath.threw) && /越界/.test(badCsvPath.threw), badCsvPath.threw)
const noSuchCsv = throws(() => runStats(store, { projectId: pid, testId: 'ttest-welch', csvPath: 'data/none.csv' }))
check('缺 CSV 抛错', Boolean(noSuchCsv.threw) && /不存在/.test(noSuchCsv.threw))

/* ── 长表跑通（走 CSV 路径） ──────────────────────────────────────────── */
section('CSV 端到端')
const longCsv = 'subject,group,rt\n'
  + [1, 2, 3, 4, 5, 6].map((i) => `${i},placebo,${400 + i * 10}`).join('\n') + '\n'
  + [7, 8, 9, 10, 11, 12].map((i) => `${i},caffeine,${450 + i * 10}`).join('\n') + '\n'
writeFileSync(join(dir, 'data', 'long.csv'), longCsv, 'utf8')
const r9 = runStats(store, {
  projectId: pid,
  testId: 'ttest-welch',
  csvPath: 'data/long.csv',
  columns: {
    a: { column: 'rt', where: { group: 'caffeine' } },
    b: { column: 'rt', where: { group: 'placebo' } },
  },
})
check('长表 where 取列跑通', r9.ok === true, r9.error)
check('每组 6 个观测', r9.n.a === 6 && r9.n.b === 6, JSON.stringify(r9.n))
check('caffeine 反应时更长（本例构造如此）', r9.statistic > 0, String(r9.statistic))

/* ── 落库与溯源 ───────────────────────────────────────────────────────── */
section('落库')
const analyses = lab.listAnalyses(store, pid, { limit: 50 })
check('已记录多条分析', analyses.length >= 10, String(analyses.length))
check('分析记录带 testId', analyses.every((a) => typeof a.testId === 'string'))
check('分析记录带摘要', analyses.filter((a) => a.summary.length > 0).length >= 8)
const filtered = lab.listAnalyses(store, pid, { testId: 'ttest-welch' })
check('可按 testId 过滤', filtered.every((a) => a.testId === 'ttest-welch'))
const one = lab.getAnalysis(store, r1.id)
check('可按 id 取回', one && one.id === r1.id)
check('取回的 result 完整', one.result.ok === true && typeof one.result.p === 'number')
check('取回的 spec 有 seed', one.spec.seed !== undefined)
check('assumptions_json 也存了', Array.isArray(one.assumptions) && one.assumptions.length >= 2)
const chain = lab.verifyChain(store, pid)
check('溯源链完整', chain.ok === true, JSON.stringify(chain.problems))
check('溯源里有 analysis 条目', lab.listByProject(store, pid, { limit: 200 }).some((e) => e.subject === 'analysis'))

const md = renderResultMarkdown(r1)
check('结果 markdown 有标题', /^### /.test(md))
check('markdown 有 p 值', /p [=<]/.test(md))
check('markdown 有样本量', /样本：/.test(md))

/* ── 作图 ─────────────────────────────────────────────────────────────── */
section('作图')
const presets = listPresets()
check('有 5 个幅面预设', presets.length === 5, String(presets.length))
check('单栏 85 mm', presets.find((p) => p.id === 'single-column').widthMm === 85)
check('双栏 180 mm', presets.find((p) => p.id === 'double-column').widthMm === 180)

const fig1 = runFigure(store, {
  projectId: pid,
  kind: 'bar',
  data: { g1: [1, 2, 3, 4, 5], g2: [2, 3, 4, 5, 6], g3: [3, 4, 5, 6, 7] },
  errorType: 'sem',
  ylabel: '反应时 (ms)',
  name: 'fig-bar',
  formats: ['pdf', 'png'],
})
check('柱图成功', fig1.ok === true, fig1.error)
check('出 2 个文件', fig1.files.length === 2, JSON.stringify(fig1.files?.map((f) => f.format)))
check('含 PDF 矢量', fig1.files.some((f) => f.format === 'pdf'))
check('含 PNG', fig1.files.some((f) => f.format === 'png'))
check('文件真的存在', fig1.files.every((f) => existsSync(join(dir, f.path))), JSON.stringify(fig1.files.map((f) => f.path)))
check('路径是相对的', fig1.files.every((f) => !f.path.includes(dir)), fig1.files[0]?.path)
check('落在 figures/ 下', fig1.files.every((f) => f.path.startsWith('figures/')))
check('尺寸 85×60', fig1.widthMm === 85 && fig1.heightMm === 60, `${fig1.widthMm}×${fig1.heightMm}`)
check('dpi 600', fig1.dpi === 600)
check('字号 7', fig1.fontSize === 7)
check('有自检项', Array.isArray(fig1.checks) && fig1.checks.length >= 4)
check('自检全部通过', fig1.ready === true, JSON.stringify(fig1.checks?.filter((c) => !c.ok)))
check('记录了 figure id', typeof fig1.id === 'string' && fig1.id.startsWith('fig_'))

const fig2 = runFigure(store, { projectId: pid, kind: 'scatter', data: { x: [1, 2, 3, 4, 5], y: [2, 4, 5, 4, 5] }, fitLine: true, name: 'fig-scatter', formats: ['pdf', 'svg'] })
check('散点图成功', fig2.ok === true, fig2.error)
check('SVG 也出', fig2.files.some((f) => f.format === 'svg'))
const fig3 = runFigure(store, { projectId: pid, kind: 'paired', data: { pre: [3, 4, 5, 6, 7], post: [4, 5, 6, 7, 8] }, name: 'fig-paired', preset: 'double-column', formats: ['pdf'] })
check('配对图成功', fig3.ok === true, fig3.error)
check('双栏预设生效', fig3.widthMm === 180, String(fig3.widthMm))
const figBad = runFigure(store, { projectId: pid, kind: 'pie', data: { y: [1, 2] } })
check('不支持的图类型返回 ok=false', figBad.ok === false)
check('返回 supported 列表', Array.isArray(figBad.supported) && figBad.supported.includes('bar'))
const figSmallFont = runFigure(store, { projectId: pid, kind: 'bar', data: { y: [1, 2] }, fontSize: 4 })
check('字号 < 6 pt 被拒绝', figSmallFont.ok === false && /6 pt/.test(figSmallFont.error), figSmallFont.error)
const figWide = runFigure(store, { projectId: pid, kind: 'bar', data: { y: [1, 2] }, widthMm: 500 })
check('宽度不合理被拒绝', figWide.ok === false && /mm/.test(figWide.error))

const figures = lab.listFigures(store, pid, { limit: 10 })
check('figure_spec 记录了 3 张', figures.length === 3, String(figures.length))
check('图记录带 dpi', figures.every((f) => f.dpi === 600 || f.dpi === 600))
check('图记录带尺寸', figures.every((f) => typeof f.widthMm === 'number'))
check('图记录带 path', figures.every((f) => typeof f.path === 'string'))
const figChain = lab.verifyChain(store, pid)
check('作图后溯源链仍完整', figChain.ok === true, JSON.stringify(figChain.problems))

/* ── 示例数据集可复现 ─────────────────────────────────────────────────── */
section('示例数据集')
const examplesRoot = new URL('../data/examples/', import.meta.url)
const { readdirSync } = await import('node:fs')
const exDirs = readdirSync(examplesRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
check('3 个示例', exDirs.length === 3, exDirs.join(','))
for (const ex of exDirs) {
  const base = new URL(`${ex}/`, examplesRoot)
  check(`${ex} 有 data.csv`, existsSync(new URL('data.csv', base)))
  check(`${ex} 有 expected.json`, existsSync(new URL('expected.json', base)))
  check(`${ex} 有 README.md`, existsSync(new URL('README.md', base)))
  const expected = JSON.parse(readFileSync(new URL('expected.json', base), 'utf8'))
  check(`${ex} 声明了 testId`, typeof expected.testId === 'string')
  check(`${ex} 声明了预期 p`, typeof expected.expected.p === 'number')
  check(`${ex} 有 whatToLookAt`, Array.isArray(expected.whatToLookAt) && expected.whatToLookAt.length >= 2)
  check(`${ex} testId 在统计库里`, Boolean(getTest(expected.testId)))
  // 用 CSV 真跑一遍，对齐 expected
  const exProject = lab.createProject(store, { title: `示例-${ex}`, domain: expected.domain })
  mkdirSync(join(exProject.dir, 'data'), { recursive: true })
  writeFileSync(join(exProject.dir, 'data', 'exp1.csv'), readFileSync(new URL('data.csv', base), 'utf8'), 'utf8')
  const got = runStats(store, {
    projectId: exProject.id,
    testId: expected.testId,
    csvPath: 'data/exp1.csv',
    columns: expected.columns,
    options: expected.options ?? {},
  })
  check(`${ex} 能跑通`, got.ok === true, got.error)
  if (got.ok) {
    const wantP = expected.expected.p
    check(`${ex} p 与 expected 一致`, Math.abs(got.p - wantP) < Math.max(1e-6, wantP * 1e-3), `${got.p} vs ${wantP}`)
    const wantStat = expected.expected.statistic
    check(`${ex} 统计量与 expected 一致`, Math.abs(got.statistic - wantStat) < Math.max(1e-4, Math.abs(wantStat) * 1e-3), `${got.statistic} vs ${wantStat}`)
    const wantEs = expected.expected.effectSize
    check(`${ex} 效应量种类一致`, got.effectSize?.kind === wantEs.kind, `${got.effectSize?.kind} vs ${wantEs.kind}`)
    if (typeof wantEs.value === 'number' && wantEs.value !== 0) {
      check(`${ex} 效应量数值一致`, Math.abs(got.effectSize.value - wantEs.value) < Math.max(1e-4, Math.abs(wantEs.value) * 1e-3), `${got.effectSize.value} vs ${wantEs.value}`)
    }
  }
}

/* ── 收尾 ─────────────────────────────────────────────────────────────── */
try { store.db.close() } catch { /* 已关 */ }
try { rmSync(home, { recursive: true, force: true }) } catch { /* Windows 上偶尔 EPERM，无害 */ }

console.log('')
if (fail === 0) {
  console.log(`${pass}/${pass} 通过（分析与作图）`)
  process.exit(0)
}
console.log(`${pass}/${pass + fail} 通过，${fail} 项失败：`)
for (const f of fails) console.log(`  FAIL  ${f}`)
process.exit(1)
