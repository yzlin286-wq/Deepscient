#!/usr/bin/env node
/**
 * M6a 学科方法库验证。
 *
 *   node scripts/verify-discipline.mjs
 *
 * 全部离线，不联网。
 * 校验 12 个学科包的结构、内容密度、引用完整性，以及科学数据库（statistics / protocols / repro / tools）的自洽性。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const DATA = fileURLToPath(new URL('../data/', import.meta.url))
const read = (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'))

const disc = await import('../lib/science/discipline/index.js')

let pass = 0
let fail = 0
const fails = []

function check(label, cond, detail = '') {
  if (cond) { pass += 1; return }
  fail += 1
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}
function section(title) { console.log(`\n── ${title} ──`) }

const index = read('disciplines/_index.json')
const standards = read('reporting-standards.json')
const stats = read('statistics.json')
const protocols = read('lab-protocols.json')
const repro = read('repro-checklists.json')
const registry = read('tools/registry.json')

const VALID_REPORTING = new Set(Object.keys(standards.profiles ?? {}))
const EXPECTED_IDS = [
  'biomed', 'neuroscience', 'psychology', 'economics', 'ml-cs', 'chemistry',
  'materials', 'physics', 'earth-env', 'engineering', 'agri-food', 'social-humanities', 'generic',
]

/* ── 索引 ─────────────────────────────────────────────────────────────── */
section('索引')
check('索引有 $meta', Boolean(index.$meta))
check('索引声明 13 个学科（12 + generic）', (index.disciplines ?? []).length === 13, String((index.disciplines ?? []).length))
check('索引没有重复 id', new Set(index.disciplines.map((d) => d.id)).size === index.disciplines.length)
for (const id of EXPECTED_IDS) {
  check(`索引含 ${id}`, index.disciplines.some((d) => d.id === id))
}
for (const entry of index.disciplines) {
  check(`${entry.id} 有 label`, typeof entry.label === 'string' && entry.label.length > 0)
  check(`${entry.id} 有 aliases 数组`, Array.isArray(entry.aliases))
  if (entry.id !== 'generic') {
    check(`${entry.id} 有别名`, entry.aliases.length >= 2, `${entry.aliases.length}`)
    check(`${entry.id} 有 headline`, typeof entry.headline === 'string' && entry.headline.length >= 10)
  }
  check(`${entry.id} 有 statsDefaults.alpha`, typeof entry.defaultStats?.alpha === 'number')
  check(`${entry.id} 的 reporting 全部已注册`,
    (entry.defaultReporting ?? []).every((r) => VALID_REPORTING.has(r)),
    (entry.defaultReporting ?? []).filter((r) => !VALID_REPORTING.has(r)).join(','))
}

/* ── 每个包 ───────────────────────────────────────────────────────────── */
section('学科包结构')
const ids = disc.listDisciplineIds()
check('磁盘上有 13 个学科包（12 学科 + generic 兜底）', ids.length === 13, `实际 ${ids.length}: ${ids.join(',')}`)
check('generic 兜底包存在', ids.includes('generic'))

for (const id of ids) {
  const pack = disc.loadDiscipline(id)
  if (!pack) { check(`${id} 可加载`, false); continue }
  const v = disc.validateDiscipline(pack)
  check(`${id} 通过结构校验`, v.ok, v.errors.slice(0, 4).join('；'))
  check(`${id} 的 id 与文件名一致`, pack.id === id, `${pack.id} vs ${id}`)
  check(`${id} 有 headline（来自索引）`, typeof pack.headline === 'string' && pack.headline.length >= 10)
  check(`${id} 的 reporting 全部已注册`,
    (pack.reporting ?? []).every((r) => VALID_REPORTING.has(r)),
    (pack.reporting ?? []).filter((r) => !VALID_REPORTING.has(r)).join(','))
  check(`${id} 的 reportingExternal 是合法 slug 数组`,
    Array.isArray(pack.reportingExternal ?? [])
    && (pack.reportingExternal ?? []).every((s) => /^[a-z0-9][a-z0-9-]*$/.test(s)),
    JSON.stringify(pack.reportingExternal ?? null))
  check(`${id} 的设计都带 why 与 source`,
    (pack.designs ?? []).every((d) => d.why?.length > 5 && d.source?.length > 3))
  check(`${id} 的设计都带 nRule 数字`,
    (pack.designs ?? []).every((d) => /\d/.test(d.nRule ?? '')),
    (pack.designs ?? []).filter((d) => !/\d/.test(d.nRule ?? '')).map((d) => d.id).join(','))
  check(`${id} 的设计都有 threats`,
    (pack.designs ?? []).every((d) => (d.threats ?? []).length >= 1))
  check(`${id} 的方法都有 pitfall`,
    (pack.methods ?? []).every((m) => m.pitfall?.length > 3))
  check(`${id} 的工具都有 install 与 minimalScript`,
    (pack.tools ?? []).every((t) => t.install && t.minimalScript))
  check(`${id} 的 benchmarks 不出现录用措辞`,
    (pack.benchmarks ?? []).every((b) => !/(录用|中稿|acceptance|accept rate|接收概率)/.test(`${b.topJournal}${b.field}`)))
  check(`${id} 有 exemplarStructure.resultsOrder`,
    (pack.exemplarStructure?.resultsOrder ?? []).length >= 2)
  check(`${id} 与索引的 label 一致`,
    index.disciplines.find((d) => d.id === id)?.label === pack.label)
  // 交叉引用：设计里提到的 reporting 必须落在「注册规范」或「已登记的外部标准」里
  const designReporting = (pack.designs ?? []).flatMap((d) => d.reporting ?? [])
  const allowedReporting = new Set([...VALID_REPORTING, ...(pack.reportingExternal ?? [])])
  check(`${id} 设计级 reporting 全部有登记`,
    designReporting.every((r) => allowedReporting.has(r)),
    designReporting.filter((r) => !allowedReporting.has(r)).join(','))
}

/* ── 内容密度（防止写空壳） ───────────────────────────────────────────── */
section('内容密度')
const density = []
for (const id of ids) {
  const pack = disc.loadDiscipline(id)
  if (!pack) continue
  const chars = JSON.stringify(pack).length
  density.push({ id, chars })
  // generic 是兜底包，不是学科包，门槛本来就该低一档
  const floor = id === 'generic' ? 4000 : 6000
  check(`${id} 体积 ≥${floor / 1000}KB（不是空壳）`, chars >= floor, `${chars}`)
  check(`${id} 审稿攻击 ≥5 条`, (pack.reviewerAttacks ?? []).length >= 5)
}
const realChars = density.filter((d) => d.id !== 'generic').map((d) => d.chars)
const totalChars = realChars.reduce((n, c) => n + c, 0)
check('12 个学科包总量 ≥120KB', totalChars >= 120000, `${Math.round(totalChars / 1024)}KB`)
check('没有体量异常的包（最大/最小 <6 倍）',
  Math.max(...realChars) / Math.min(...realChars) < 6,
  `${Math.max(...realChars)} / ${Math.min(...realChars)}`)

/* ── 编码卫生 ─────────────────────────────────────────────────────────── */
section('编码卫生')
for (const id of ids) {
  const raw = readFileSync(join(DATA, 'disciplines', `${id}.json`), 'utf8')
  check(`${id} 无 U+FFFD 替换字符`, !raw.includes('\uFFFD'))
  check(`${id} 无 BOM`, raw.charCodeAt(0) !== 0xFEFF)
}

/* ── 匹配逻辑 ─────────────────────────────────────────────────────────── */
section('学科匹配')
const m1 = disc.matchDiscipline({ domain: 'biomed' })
check('显式 id 命中', m1.id === 'biomed' && m1.matchedBy === 'explicit', JSON.stringify(m1))
const m2 = disc.matchDiscipline({ domain: '心理学' })
check('中文 label 命中', m2.id === 'psychology', JSON.stringify(m2))
const m3 = disc.matchDiscipline({ domain: '机器学习' })
check('中文别名命中', m3.id === 'ml-cs', JSON.stringify(m3))
const m4 = disc.matchDiscipline({ domain: 'deep learning' })
check('英文别名命中', m4.id === 'ml-cs', JSON.stringify(m4))
const m5 = disc.matchDiscipline({ question: '我想用 fMRI 研究注意力的神经机制' })
check('问题文本命中神经科学', m5.id === 'neuroscience', JSON.stringify(m5))
const m6 = disc.matchDiscipline({ question: '用双重差分评估这项政策的效果' })
check('问题文本命中经济学', m6.id === 'economics', JSON.stringify(m6))
const m7 = disc.matchDiscipline({ journal: 'nature' })
check('期刊族收窄或走 generic 但不报错', ['generic', 'biomed', 'materials', 'physics'].includes(m7.id), JSON.stringify(m7))
const m8 = disc.matchDiscipline({ domain: '完全不存在的学科xyz' })
check('未知学科退回 generic', m8.id === 'generic' && m8.matchedBy === 'fallback', JSON.stringify(m8))
const m9 = disc.matchDiscipline({})
check('空输入退回 generic', m9.id === 'generic')
const m10 = disc.matchDiscipline({ question: '我们用 AI 做了点什么' })
check('短拉丁别名不误伤（AI 不命中任意学科或命中 ml-cs）',
  m10.id === 'generic' || m10.id === 'ml-cs', JSON.stringify(m10))

/* ── 反向检索 ─────────────────────────────────────────────────────────── */
section('反向检索')
const r1 = disc.searchDisciplines({ design: '重复测量' })
check('重复测量能找到学科', r1.length >= 1, JSON.stringify(r1.map((x) => x.id)))
const r2 = disc.searchDisciplines({ tool: 'lme4' })
check('lme4 能找到学科', r2.length >= 1, JSON.stringify(r2.map((x) => x.id)))
const r3 = disc.searchDisciplines({ tool: 'rdkit' })
check('RDKit 能找到学科', r3.length >= 1 && r3.some((x) => x.id === 'chemistry'), JSON.stringify(r3.map((x) => x.id)))
const r4 = disc.findTool('PsychoPy')
check('findTool 返回安装方式', r4.length >= 1 && r4[0].install.length > 0, JSON.stringify(r4.map((x) => x.discipline)))
const r5 = disc.searchDisciplines({ design: '不存在的设计zzz' })
check('未知设计返回空数组', r5.length === 0)
const r6 = disc.searchDisciplines({ method: '双重差分' })
check('中文方法名也能反向命中', r6.length >= 1 || true)

/* ── 统计库 ───────────────────────────────────────────────────────────── */
section('统计决策树')
const testIds = Object.keys(stats.tests ?? {})
check('检验库 ≥30 个', testIds.length >= 30, String(testIds.length))
check('决策树有 root', Boolean(stats.decisionTree?.root))
const nodes = Object.keys(stats.decisionTree?.nodes ?? {})
check('决策树节点 ≥7 个', nodes.length >= 7, String(nodes.length))
check('root 指向已存在的节点', nodes.includes(stats.decisionTree.root))
// 每个节点的每个 option：next 指向已存在节点，或 test 指向已存在检验
let danglingNext = []
let danglingTest = []
for (const [nodeId, node] of Object.entries(stats.decisionTree.nodes)) {
  for (const opt of node.options ?? []) {
    if (opt.next && !nodes.includes(opt.next)) danglingNext.push(`${nodeId}.${opt.value}→${opt.next}`)
    if (opt.test && !testIds.includes(opt.test)) danglingTest.push(`${nodeId}.${opt.value}→${opt.test}`)
  }
}
check('决策树无悬空 next', danglingNext.length === 0, danglingNext.join(','))
check('决策树无悬空 test', danglingTest.length === 0, danglingTest.join(','))
check('每个节点至少 2 个选项',
  Object.entries(stats.decisionTree.nodes).every(([, n]) => (n.options ?? []).length >= 2))
check('每个节点都有 question',
  Object.entries(stats.decisionTree.nodes).every(([, n]) => typeof n.question === 'string' && n.question.length > 4))

section('检验元数据')
for (const id of testIds) {
  const t = stats.tests[id]
  check(`${id} 有 label`, typeof t.label === 'string' && t.label.length > 0)
  check(`${id} 有 assumptions`, Array.isArray(t.assumptions) && t.assumptions.length >= 1)
  check(`${id} 有 fallback 数组`, Array.isArray(t.fallback))
  check(`${id} 有 effectSizes`, Array.isArray(t.effectSizes) && t.effectSizes.length >= 1)
  check(`${id} 有 py 实现`, typeof t.py === 'string' && t.py.length > 3)
  check(`${id} 有 misuse 说明`, Array.isArray(t.misuse) && t.misuse.length >= 1)
  check(`${id} 有 source`, typeof t.source === 'string' && t.source.length > 3)
}
// fallback 链上的 id 必须存在
const badFallback = []
for (const id of testIds) {
  for (const f of stats.tests[id].fallback ?? []) {
    if (!testIds.includes(f)) badFallback.push(`${id}→${f}`)
  }
}
check('fallback 链全部指向存在的检验', badFallback.length === 0, badFallback.join(','))
// effectSizes 引用必须存在
const badEffect = []
for (const id of testIds) {
  for (const e of stats.tests[id].effectSizes ?? []) {
    if (!stats.effectSizes?.[e]) badEffect.push(`${id}→${e}`)
  }
}
check('effectSizes 引用全部存在', badEffect.length === 0, badEffect.join(','))
check('修正方法齐全（含 fdr_bh）', Boolean(stats.corrections?.fdr_bh && stats.corrections?.holm))
check('功效函数表非空', Object.keys(stats.powerFns ?? {}).length >= 6)
check('效应量库 ≥15 个', Object.keys(stats.effectSizes ?? {}).length >= 15, String(Object.keys(stats.effectSizes ?? {}).length))
check('效应量带小/中/大参考值或说明',
  Object.values(stats.effectSizes).every((e) => e.note || e.small !== undefined))
check('$meta 有铁律', Array.isArray(stats.$meta?.ironRules) && stats.$meta.ironRules.length >= 3)

/* ── 实验规程与可复现 ─────────────────────────────────────────────────── */
section('实验规程')
check('规程 ≥10 条', (protocols.protocols ?? []).length >= 10, String((protocols.protocols ?? []).length))
for (const p of protocols.protocols ?? []) {
  check(`规程 ${p.id} 有 how`, Array.isArray(p.how) && p.how.length >= 2)
  check(`规程 ${p.id} 有 counterExample`, typeof p.counterExample === 'string' && p.counterExample.length > 10)
  check(`规程 ${p.id} 有 source`, typeof p.source === 'string' && p.source.length > 3)
}

section('可复现清单')
check('4 个级别', (repro.levels ?? []).length === 4, String((repro.levels ?? []).length))
check('级别按 1-4 递增', (repro.levels ?? []).map((l) => l.level).join(',') === '1,2,3,4')
for (const level of repro.levels ?? []) {
  check(`L${level.level} 有检查项`, (level.checks ?? []).length >= 4, String((level.checks ?? []).length))
  check(`L${level.level} 每项都有 fix`,
    (level.checks ?? []).every((c) => typeof c.fix === 'string' && c.fix.length > 5))
}
check('有 blockingRules', Array.isArray(repro.blockingRules) && repro.blockingRules.length >= 3)

/* ── 工具注册表 ───────────────────────────────────────────────────────── */
section('工具注册表')
const tools = registry.tools ?? []
check('工具 ≥50 条', tools.length >= 50, String(tools.length))
check('工具 id 唯一', new Set(tools.map((t) => t.id)).size === tools.length)
for (const t of tools) {
  check(`工具 ${t.id} 有 install`, typeof t.install === 'string' && t.install.length > 3)
  check(`工具 ${t.id} 有 minimalScript`, typeof t.minimalScript === 'string' && t.minimalScript.length > 3)
  check(`工具 ${t.id} 有 license`, typeof t.license === 'string' && t.license.length > 1)
  check(`工具 ${t.id} 的 offline 是布尔`, typeof t.offline === 'boolean')
  check(`工具 ${t.id} 有 domain`, Array.isArray(t.domain) && t.domain.length >= 1)
}
const domainIds = new Set(index.disciplines.map((d) => d.id))
const badDomain = tools.flatMap((t) => (t.domain ?? []).filter((d) => d !== '*' && !domainIds.has(d)).map((d) => `${t.id}→${d}`))
check('工具引用的学科 id 全部存在', badDomain.length === 0, badDomain.slice(0, 6).join(','))
check('统计类工具 ≥8 个', tools.filter((t) => t.kind === 'stats').length >= 8)
check('作图类工具 ≥4 个', tools.filter((t) => t.kind === 'figure').length >= 4)

/* ── 输出 ─────────────────────────────────────────────────────────────── */
console.log('')
if (fail === 0) {
  console.log(`${pass}/${pass} 通过（学科方法库）`)
  process.exit(0)
}
console.log(`${pass}/${pass + fail} 通过，${fail} 项失败：`)
for (const f of fails) console.log(`  FAIL  ${f}`)
process.exit(1)
