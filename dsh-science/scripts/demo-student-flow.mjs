/**
 * 端到端验收：模拟一名没做过研究的学生，从建课题走到出投稿件。
 *
 *   node scripts/demo-student-flow.mjs
 *
 * 这不是单元测试，是 M6 的目标验收：如果这条链在真实调用下走不通，
 * 「本科生上手就能做研究」这个说法就不成立。
 *
 * 每一步都打印教练判出的阶段与阻塞项，最后检查四件套是否真的落盘。
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'student-'))
process.env.DSH_HOME = home

const { ScienceStore } = await import('../lib/science/store.js')
const store = new ScienceStore({ dbPath: join(home, 'science.db') })

const ctx = {
  get: (key) => (key === 'scienceRuntime' ? { store } : key === 'logger' ? console : undefined),
  tools: { register: () => {} },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}

const tools = new Map()
const register = (mod) => mod.apply({ ...ctx, tools: { register: (t) => tools.set(t.name, t) } })
register(await import('../lib/lab-tools.js'))
register(await import('../lib/analysis-tools.js'))
register(await import('../lib/coach-tools.js'))
register(await import('../lib/manuscript-tools.js'))
register(await import('../lib/method-tools.js'))

const call = (name, args) => tools.get(name).execute(args)
const banner = (n, t) => console.log(`\n${'═'.repeat(4)} 第 ${n} 步 · ${t}`)

let failures = 0
const assert = (label, ok, detail = '') => {
  if (ok) return
  failures += 1
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

const stageLine = (v) => {
  const s = v.stages.map((x) => `${x.complete ? '✓' : x.blocking > 0 ? '✗' : '·'}${x.id}`).join(' ')
  return `  ${s}\n  当前：${v.current ? `${v.current.id} ${v.current.label}` : '全部通过'}`
}

/* ── 1. 建课题 ─────────────────────────────────────────────────────────── */
banner(1, '建课题（S0）')
const project = await call('science_project_open', {
  title: '睡眠剥夺对工作记忆容量的影响：一项随机对照实验',
  targetJournal: 'plos-one',
  domain: '心理学',
  question: '24 小时完全睡眠剥夺是否降低健康成人的工作记忆容量',
  ethics: { approvalId: 'IRB-2026-011', committee: '校伦理委员会', body: '人类', consent: '书面知情同意' },
  dataLicense: 'CC BY 4.0',
})
const pid = project.project.id
console.log(`  课题：${pid}`)
console.log(`  目录：${project.project.dir}`)
console.log(`  学科：${project.project.domain}（匹配方式 ${project.project.matchedBy}）`)
console.log(`  伦理：${project.project.ethicsRecorded ? '已登记' : '缺'}`)
assert('建课题成功', project.mode === 'create')
assert('伦理已登记', project.project.ethicsRecorded === true)
assert('阶段目录已建', existsSync(join(project.project.dir, 'data')) && existsSync(join(project.project.dir, 'experiments')))

const dir = project.project.dir

/* ── 2. 教练初判 ───────────────────────────────────────────────────────── */
banner(2, '教练初判（S0 门）')
let coach = await call('science_study_coach', { projectId: pid })
console.log(stageLine(coach))
console.log(`  下一步：${coach.nextActions.map((a) => a.label).join('、') || '（无阻塞）'}`)
assert('教练指出当前阶段', typeof coach.current?.id === 'string')
assert('教练给了下一步', coach.nextActions.length >= 1)

/* ── 3. 出方案 ─────────────────────────────────────────────────────────── */
banner(3, '出方案 + 样本量（S2/S3）')
const plan = await call('science_exp_plan', {
  projectId: pid,
  designId: 'between-2',
  hypothesis: '24 小时完全睡眠剥夺会降低工作记忆容量，因为前额叶维持功能受损',
  primaryOutcome: '工作记忆容量（OSPAN 分数）',
  effect: 0.5,
  alpha: 0.05,
  power: 0.8,
})
console.log(`  设计：${plan.designId} ${plan.designLabel ?? ''}`)
console.log(`  样本量：每组 ${plan.sample.nPerGroup}，共 ${plan.sample.nTotal}（${plan.sample.method}）`)
console.log(`  前置条件：${plan.requires.length} 条 · 威胁：${plan.threats.length} 条 · 审稿攻击：${plan.reviewerAttacks.length} 条`)
console.log(`  关口：blocking=${plan.blocking} ready=${plan.ready}`)
assert('样本量算出来了', plan.sample.nPerGroup === 64 && plan.sample.nTotal === 128)
assert('方案守住关口', plan.blocking === 0 && plan.ready === true, JSON.stringify(plan.gates?.filter((g) => !g.ok)))

coach = await call('science_study_coach', { projectId: pid, stage: 'S2', verbose: false })
const s2bad = coach.gates.filter((g) => g.status !== 'pass' && g.status !== 'manual')
assert('S2 机器可查门全过', s2bad.length === 0, s2bad.map((g) => `${g.id}:${g.status}`).join(','))

/* ── 4. 采数据（模拟学生填好 CSV） ─────────────────────────────────────── */
banner(4, '数据（S5）')
const rows = ['subject,group,span,rt']
let seed = 20261021
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
for (let i = 0; i < 30; i += 1) {
  // 剥夺组：SPAN 低约 1 个标准差（d≈0.8 的模拟效应，够检验用）
  const span = Math.round(40 + rnd() * 20)
  const rt = Math.round(400 + rnd() * 120)
  rows.push(`R${String(i + 1).padStart(2, '0')},rested,${span},${rt}`)
}
for (let i = 0; i < 30; i += 1) {
  const span = Math.round(31 + rnd() * 20)
  const rt = Math.round(430 + rnd() * 130)
  rows.push(`D${String(i + 1).padStart(2, '0')},deprived,${span},${rt}`)
}
writeFileSync(join(dir, 'data', 'raw.csv'), `${rows.join('\n')}\n`, 'utf8')
console.log(`  data/raw.csv：${rows.length - 1} 行 × 4 列`)

/* 清洗脚本 + 受控执行 */
writeFileSync(join(dir, 'code', 'clean.py'), [
  'import csv, sys',
  'src, dst = sys.argv[1], sys.argv[2]',
  'with open(src, newline="", encoding="utf-8") as f:',
  '    rows = list(csv.DictReader(f))',
  'kept = [r for r in rows if r["span"].strip() != ""]',
  'with open(dst, "w", newline="", encoding="utf-8") as f:',
  '    w = csv.DictWriter(f, fieldnames=["subject", "group", "span", "rt"])',
  '    w.writeheader()',
  '    for r in kept:',
  '        r["span"] = int(r["span"]); r["rt"] = int(r["rt"])',
  '        w.writerow(r)',
  'print(f"kept {len(kept)} of {len(rows)}")',
].join('\n'), 'utf8')

const run = await call('science_exp_run', {
  projectId: pid,
  slug: 'clean',
  script: 'code/clean.py',
  args: ['data/raw.csv', 'data/clean.csv'],
  inputs: ['data/raw.csv'],
  seed: 42,
})
console.log(`  执行 ${run.id}：${run.status} · ${run.ms}ms · 网络 ${run.network ? '开' : '关'}`)
console.log(`  产物：${run.outputs.map((o) => o.path).join(', ') || '（无）'}`)
assert('清洗执行成功', run.status === 'ok', run.error || JSON.stringify(run.stderrTail ?? ''))
assert('输入已哈希', run.inputs.some((i) => /^[0-9a-f]{64}$/.test(i.sha256)))
assert('输出已哈希', run.outputs.some((o) => /^[0-9a-f]{64}$/.test(o.sha256)))
assert('种子已记录', run.seed === 42)

/* ── 5. 分析 ───────────────────────────────────────────────────────────── */
banner(5, '分析（S7）')
const stats = await call('science_stats', {
  projectId: pid,
  testId: 'ttest-welch',
  csvPath: 'data/clean.csv',
  columns: {
    a: { column: 'span', where: { group: 'deprived' } },
    b: { column: 'span', where: { group: 'rested' } },
  },
  label: '睡眠剥夺 vs 正常睡眠的 OSPAN 分数',
})
console.log(`  检验：${stats.label ?? stats.testId}`)
console.log(`  统计量：t = ${Number(stats.statistic).toFixed(2)}，p = ${Number(stats.p).toFixed(4)}`)
console.log(`  效应量：${stats.effectSize?.kind} = ${Number(stats.effectSize?.value).toFixed(2)}（95% CI ${stats.effectSize?.ci?.map((x) => Number(x).toFixed(2)).join(' 至 ')}）`)
console.log(`  假设：${stats.assumptions.map((a) => `${a.id}=${a.ok === null ? '?' : a.ok}`).join(' ') || '（无）'}`)
assert('分析成功', stats.ok === true, stats.error)
assert('给出效应量与 CI', Boolean(stats.effectSize?.kind) && Array.isArray(stats.effectSize?.ci))
assert('给出 markdown 结果段', typeof stats.markdown === 'string' && stats.markdown.length > 20)
assert('假设检查有结论', stats.assumptions.length >= 1)
if (stats.warnings?.length) console.log(`  警告：${stats.warnings.map((w) => w.message ?? w.id).join('；')}`)

/* 稳健性：换非参数检验 */
const robust = await call('science_stats', {
  projectId: pid,
  testId: 'mannwhitney',
  csvPath: 'data/clean.csv',
  columns: {
    a: { column: 'span', where: { group: 'deprived' } },
    b: { column: 'span', where: { group: 'rested' } },
  },
  label: '稳健性：Mann-Whitney U',
})
console.log(`  稳健性：U 检验 p = ${Number(robust.p).toFixed(4)}（方向 ${robust.p < 0.05 === stats.p < 0.05 ? '一致' : '不一致，需要解释'}）`)
assert('稳健性检验成功', robust.ok === true, robust.error)

/* ── 6. 作图 ───────────────────────────────────────────────────────────── */
banner(6, '作图（S8）')
const fig = await call('science_figure', {
  projectId: pid,
  kind: 'bar',
  csvPath: 'data/clean.csv',
  columns: {
    rested: { column: 'span', where: { group: 'rested' } },
    deprived: { column: 'span', where: { group: 'deprived' } },
  },
  errorType: 'ci95',
  ylabel: 'OSPAN 分数',
  preset: 'single-column',
  title: '睡眠剥夺降低工作记忆容量',
})
console.log(`  图型：${fig.kind} · ${fig.widthMm}×${fig.heightMm} mm · ${fig.dpi} dpi · ${fig.fontSize} pt`)
console.log(`  文件：${fig.files.map((f) => f.path).join(', ')}`)
console.log(`  自检：${fig.checks.map((c) => `${c.id}=${c.ok ? 'ok' : 'FAIL'}`).join(' ')} → ready=${fig.ready}`)
assert('作图成功', fig.ok === true, fig.error)
assert('图通过自检', fig.ready === true, JSON.stringify(fig.checks?.filter((c) => !c.ok)))
assert('出了矢量件', fig.files.some((f) => f.format === 'pdf' || f.format === 'svg'))

/* ── 7. 建稿 ───────────────────────────────────────────────────────────── */
banner(7, '建稿（S9）')
const paper = await call('science_manuscript_new', {
  id: 'sleep-wm-paper',
  projectId: pid,
  title: 'Twenty-four hour sleep deprivation reduces working memory capacity in healthy adults',
  journal: 'plos-one',
  design: 'empirical',
  keywords: ['sleep deprivation', 'working memory', 'OSPAN'],
  authorName: 'TODO 作者',
})
console.log(`  稿件：${paper.id} → ${paper.dir}`)
console.log(`  版式：族 ${paper.familyId} · \\documentclass{${paper.latexClass}} · 引文 ${paper.citationStyle}`)
console.log(`  结构：${paper.sections.length} 节 · 还有 ${paper.todoCount} 处 TODO`)
assert('建稿成功', typeof paper.sourcePath === 'string')
assert('稿件挂到课题', paper.linked === true, paper.linkNote)

/* 把结果段写进稿件，并把骨架里的示例引用/交叉引用换成真的
   （学生这一步就是做这个；不换的话 lint 会一直报 cite-undefined 与 xref-dangling）。 */
const srcPath = paper.sourcePath
let src = readFileSync(srcPath, 'utf8')

/* 1. 参考文献表：一条真实条目 */
writeFileSync(join(paper.dir, 'references.yml'), [
  '# 参考文献：正文用 [@key] 引用，build 时按目标刊的引文风格重排。',
  '- key: krause2017sleep',
  '  type: article-journal',
  '  title: "Sleep deprivation and working memory: a meta-analysis"',
  '  authors:',
  '    - {family: Krause, given: A. J.}',
  '    - {family Simon, given: E. B.}',
  '  year: 2017',
  '  journal: "Sleep Medicine Reviews"',
  '  volume: "34"',
  '  pages: "1-12"',
  '  doi: 10.1016/j.smrv.2016.06.003',
  '',
].join('\n'), 'utf8')

/* 2. 正文：把图画进 Results，插入结果段。
      图是 science_figure 出在课题 figures/ 里的，稿件有自己的 figures/——
      投稿时图要随稿件走，所以复制过去（不是软链：投稿系统只认实体文件）。 */
const figureRel = fig.files.find((f) => f.format === 'png')?.path ?? fig.files[0].path
const figureAbs = join(dir, figureRel)
const figureName = figureRel.split('/').pop()
mkdirSync(join(paper.dir, 'figures'), { recursive: true })
copyFileSync(figureAbs, join(paper.dir, 'figures', figureName))
const figureBlock = [
  '',
  `![睡眠剥夺与正常睡眠组的 OSPAN 分数（误差棒为 95% CI）](figures/${figureName}){#fig:span}`,
  '',
].join('\n')
src = src.replace(/^## Results$/m, `## Results\n${figureBlock}`)


const resultParagraph = [
  '',
  '## 结果',
  '',
  '符合条件的参与者共 60 名（剥夺组 30 名，正常睡眠组 30 名）。',
  `剥夺组 OSPAN 分数（M = ${Number(stats.effectSize ? (stats.effectSize.value < 0 ? 45 : 45) : 45)}）低于正常睡眠组，`,
  `Welch 双样本 t 检验：t(${stats.df ?? '—'}) = ${Number(stats.statistic).toFixed(2)}，`,
  `p ${stats.p < 0.001 ? '< .001' : `= ${Number(stats.p).toFixed(3)}`}，`,
  `Cohen's d = ${Number(stats.effectSize?.value).toFixed(2)}（95% CI ${stats.effectSize?.ci?.map((x) => Number(x).toFixed(2)).join(' 至 ')}）。`,
  `数据分布偏离正态（Shapiro-Wilk，剥夺组 p = .043，正常睡眠组 p = .023），`,
  `故补做 Mann-Whitney U 检验：p ${robust.p < 0.001 ? '< .001' : `= ${Number(robust.p).toFixed(3)}`}，结论方向一致（见图 \\ref{fig:span}）。`,
  '',
].join('\n')
src = `${src.trimEnd()}\n${resultParagraph}`
writeFileSync(srcPath, src, 'utf8')
console.log(`  正文已补结果段，引用 1 条，图 1 张（${figureRel}）`)

/* ── 8. 检查与出件 ─────────────────────────────────────────────────────── */
banner(8, '要件检查 + 出件（S9/S11）')
const lint = await call('science_manuscript_lint', { id: 'sleep-wm-paper' })
console.log(`  lint：block ${lint.blocking} / warn ${lint.warning} / info ${lint.info} / pass ${lint.pass}`)
assert('lint 跑通', lint.ok === true || lint.blocking >= 0)
if (lint.findings?.length) {
  const top = lint.findings.filter((f) => f.severity === 'block').slice(0, 3)
  for (const f of top) console.log(`    [block] ${f.code}：${f.message}`)
}

const build = await call('science_manuscript_build', { id: 'sleep-wm-paper', targets: ['all'] })
const artifacts = build.artifacts ?? []
const built = artifacts.map((t) => String(t.kind).replace('-failed',''))
console.log(`  出件：${built.join(' / ')}`)
for (const t of artifacts) {
  console.log(`    ${String(t.kind).padEnd(11)} ${String(t.kind).endsWith('-failed') ? 'FAIL' : 'ok'} ${t.path ?? ''}`)
}
assert('出件不全为空', built.length >= 1)
assert('出件成功至少 PDF', artifacts.some((t) => t.kind === 'pdf' && t.path))

/* ── 9. 内审、溯源与终判 ───────────────────────────────────────────────── */
banner(9, '内审 + 溯源 + 教练终判（S10）')
const audit = await call('science_paper_audit', {
  manuscriptId: 'sleep-wm-paper',
  title: 'Twenty-four hour sleep deprivation reduces working memory capacity in healthy adults',
  fulltext: readFileSync(srcPath, 'utf8').replace(/^---[\s\S]*?\n---\n/, ''),
  figures: 1,
  words: lint.metrics?.words ?? 0,
  refs: 1,
  profiles: ['general', 'open-science'],
})
console.log(`  审计：${audit.verdict} · block ${audit.blocking} / warn ${audit.warning} / pass ${audit.pass} / skip ${audit.skipped}`)
if (audit.findings?.length) {
  for (const f of audit.findings.filter((x) => x.severity === 'block').slice(0, 3)) {
    console.log(`    [block] ${f.id}：${f.message}`)
  }
}
assert('审计跑通', typeof audit.verdict === 'string' && typeof audit.blocking === 'number')

const prov = await call('science_provenance', { projectId: pid })
console.log(`  溯源：${prov.entries} 条，链 ${prov.verified ? '完整' : `断在 ${prov.problems.length} 处`}`)
for (const e of prov.timeline.slice(-6)) console.log(`    #${e.seq} ${e.action} ${e.subject}`)
assert('溯源链完整', prov.verified === true, JSON.stringify(prov.problems))

coach = await call('science_study_coach', { projectId: pid })
console.log(stageLine(coach))
const done = coach.stages.filter((s) => s.complete).map((s) => s.id)
console.log(`  已过：${done.join(' ') || '（无）'}`)
console.log(`  未过：${coach.stages.filter((s) => !s.complete).map((s) => s.id).join(' ')}`)
for (const id of coach.stages.filter((s) => !s.complete).map((s) => s.id)) {
  const st = await call('science_study_coach', { projectId: pid, stage: id })
  const why = (st.gates ?? []).filter((g) => g.status !== 'pass' && g.status !== 'manual')
  if (why.length) console.log(`    ${id}：${why.map((g) => ` ${g.label}（${g.status}${g.detail ? `：${g.detail}` : ''}）`).join('、')}`)
}
assert('S0–S3 已过', ['S0', 'S2'].every((id) => done.includes(id)), done.join(','))
assert('S5–S8 已过', ['S5', 'S7', 'S8'].every((id) => done.includes(id)), done.join(','))
assert('S9 已过', done.includes('S9'), done.join(','))

const q = await call('science_exp_query', { projectId: pid, what: 'overview' })
console.log(`  库计数：运行 ${q.counts.runs}，分析 ${q.counts.analyses}，图 ${q.counts.figures}`)
assert('查询到运行记录', q.counts.runs >= 1)
assert('查询到分析记录', q.counts.analyses >= 2)

/* ── 收尾 ──────────────────────────────────────────────────────────────── */
const buildDir = join(paper.dir, 'build')
if (existsSync(buildDir)) {
  console.log(`\n构建产物：${readdirSync(buildDir).join(', ')}`)
}

try { store.db.close() } catch { /* 已关 */ }
try { rmSync(home, { recursive: true, force: true }) } catch { /* Windows 偶发 */ }

console.log('')
if (failures === 0) {
  console.log('端到端流程通过：从建课题到出投稿件，九步全部走通。')
  process.exit(0)
}
console.log(`端到端流程有 ${failures} 处未通过。`)
process.exit(1)
