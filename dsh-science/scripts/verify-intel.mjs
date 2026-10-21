#!/usr/bin/env node
/**
 * M3 期刊情报层验证。
 *
 *   node scripts/verify-intel.mjs            # 离线（种子 + 夹具）
 *   node scripts/verify-intel.mjs --live     # 额外打真实源（OpenAlex/SciRev/LetPub 各一刊）
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const live = process.argv.includes('--live')
const root = mkdtempSync(join(tmpdir(), 'intel-verify-'))

const { ScienceStore } = await import('../lib/science/store.js')
const { HttpCache } = await import('../lib/science/http/cache.js')
const { createClient } = await import('../lib/science/http/client.js')
const { RateLimiter, Budget, CircuitBreaker } = await import('../lib/science/http/limits.js')
const openalex = await import('../lib/science/intel/openalex-profile.js')
const scirev = await import('../lib/science/intel/scirev.js')
const letpub = await import('../lib/science/intel/letpub.js')
const intel = await import('../lib/science/intel/index.js')
const { loadJournals, profileQuery, scoreJournal, scoreEmpirical, rankJournals } = await import('../lib/science/method/journals.js')

let pass = 0
let fail = 0
const fails = []

function check(label, cond, detail = '') {
  if (cond) { pass += 1; return }
  fail += 1
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const store = new ScienceStore({ dbPath: join(root, 'verify.db') })
const client = createClient({
  cache: new HttpCache({ db: store.db, dir: join(root, 'cache') }),
  limiter: new RateLimiter(), budget: new Budget(), breaker: new CircuitBreaker(),
})

/* ── 1. schema ──────────────────────────────────────────────────────── */
console.log('\n── schema ──')
check('schema ≥ v4', store.version() >= 4, `v${store.version()}`)
for (const t of ['journal_intel', 'journal_topic', 'review_corpus']) {
  const row = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t)
  check(`表 ${t} 存在`, !!row)
}

/* ── 2. 种子 ────────────────────────────────────────────────────────── */
console.log('\n── 种子 ──')
const seed = JSON.parse(readFileSync(new URL('../data/journal-intel-cache.json', import.meta.url), 'utf8'))
const seeded = intel.loadSeed(store, seed)
check('种子导入 ≥30 条源记录', seeded.loaded >= 30, `${seeded.loaded}`)
check('种子可重复导入（幂等）', intel.loadSeed(store, seed).skipped >= 0)

const { journals } = loadJournals()
const nature = journals.find((j) => j.id === 'nature')
const noIssn = journals.find((j) => !j.issn)
check('存在无 ISSN 的会议刊（intelPolicy 已标注）', !!noIssn, noIssn?.id)
check('无 ISSN 刊被判为不支持', noIssn ? openalex.supports(noIssn) === false : false, noIssn?.id)

/* ── 3. 画像读取 ────────────────────────────────────────────────────── */
console.log('\n── 画像读取 ──')
const oa = store.getJournalIntel('nature').openalex
check('nature 有 openalex 画像', !!oa?.payload)
const dist = oa?.payload?.bySubfield || []
check('子领域分布 ≥5 组', dist.length >= 5, `${dist.length}`)
check('分布降序', dist.every((s, i) => i === 0 || dist[i - 1].share >= s.share))
check('覆盖率 >0.9', (oa?.payload?.coverage || 0) > 0.9, `${oa?.payload?.coverage}`)
check('载文量 >1000', (oa?.payload?.totalWorks || 0) > 1000, `${oa?.payload?.totalWorks}`)
check('confidence 为 high', oa?.confidence === 'high', oa?.confidence)

/* ── 4. 子领域命中（id 归一化） ─────────────────────────────────────── */
console.log('\n── 子领域命中 ──')
const top = dist[0]
check('top 子领域有 name 和 share', !!top?.name && typeof top.share === 'number')
const mapPlain = { subfields: [{ id: top.id, name: top.name }] }
const mapUrl = { subfields: [{ id: `https://openalex.org/subfields/${top.id}`, name: top.name }] }
const h1 = openalex.hitShare(oa.payload, mapPlain)
const h2 = openalex.hitShare(oa.payload, mapUrl)
check('纯 id 命中', h1.share > 0, `${h1.share}`)
check('URL 形态 id 同样命中（归一化生效）', Math.abs(h2.share - h1.share) < 1e-9, `${h2.share}`)
check('命中 = top 子领域 share', Math.abs(h1.share - top.share) < 1e-9, `${h1.share} vs ${top.share}`)
check('未命中子领域返回 0', openalex.hitShare(oa.payload, { subfields: [{ id: '999999', name: 'x' }] }).share === 0)

const emp = scoreEmpirical({ profile: oa.payload, manuscriptMap: mapPlain })
check('scoreEmpirical 返回 0-1', emp && emp.value >= 0 && emp.value <= 1, `${emp?.value}`)
check('scoreEmpirical 带 confidence', !!emp?.confidence, emp?.confidence)
check('无画像时 scoreEmpirical 返回 null', scoreEmpirical(null) === null)

/* ── 5. 权重切换不破坏旧行为 ───────────────────────────────────────── */
console.log('\n── 权重切换 ──')
const q = profileQuery({ title: 'Protein folding kinetics under chaperone confinement', keywords: ['protein folding'], band: 3, design: 'experimental' })
const declared = scoreJournal(nature, q)
check('无 intel 时走 declared', declared.weightMode === 'declared', declared.weightMode)
check('declared 模式无 empirical 分量', declared.parts.empirical === undefined)
const withIntel = scoreJournal(nature, q, { intel: { profile: oa.payload, manuscriptMap: mapPlain } })
check('有 intel 时走 empirical', withIntel.weightMode === 'empirical', withIntel.weightMode)
check('empirical 模式带 footprint', typeof withIntel.topicFootprint?.hitShare === 'number', `${withIntel.topicFootprint?.hitShare}`)
check('两种模式分数不同', declared.score !== withIntel.score, `${declared.score} vs ${withIntel.score}`)
check('分数仍在 0-1', withIntel.score >= 0 && withIntel.score <= 1, `${withIntel.score}`)

const rankedDeclared = rankJournals(journals, q, { perTier: 3 })
const rankedIntel = rankJournals(journals, q, {
  perTier: 3,
  intelFor: (j) => {
    const p = store.getJournalIntel(j.id).openalex?.payload
    return p ? { profile: p, manuscriptMap: mapPlain } : null
  },
})
check('三档都有结构', !!rankedDeclared.reach && !!rankedIntel.target)
check('considered 一致', rankedDeclared.considered === rankedIntel.considered)

/* ── 6. 置信度与陈旧 ───────────────────────────────────────────────── */
console.log('\n── 置信度规则 ──')
check('载文量 10 且覆盖 0.5 → low', openalex.confidenceFor(10, 0.5) === 'low')
check('载文量 200 且覆盖 0.8 → medium', openalex.confidenceFor(200, 0.8) === 'medium')
check('载文量 900 且覆盖 0.95 → high', openalex.confidenceFor(900, 0.95) === 'high')
check('SciRev 3 条样本 → low', scirev.confidenceFor(3) === 'low')
check('SciRev 12 条样本 → medium', scirev.confidenceFor(12) === 'medium')
check('SciRev 40 条样本 → high', scirev.confidenceFor(40) === 'high')

/* 种子是刚刚抓的，所以只有负阈值才应判陈旧（staleIntel 只收 maxAgeDays，返回全局陈旧行） */
check('staleIntel(-1 天) 判为陈旧', store.staleIntel(-1).length >= 2, `${store.staleIntel(-1).length}`)
check('staleIntel(9999 天) 不陈旧', store.staleIntel(9999).length === 0)

/* ── 7. 评审现实与 LetPub 解析夹具 ─────────────────────────────────── */
console.log('\n── 解析夹具 ──')
const sr = store.getJournalIntel('nature').scirev
if (sr) {
  check('SciRev 有 firstReviewMonths', sr.payload?.firstReviewMonths > 0, `${sr.payload?.firstReviewMonths}`)
  check('SciRev 有 reviewCount', sr.payload?.reviewCount >= 10, `${sr.payload?.reviewCount}`)
  check('SciRev confidence 非空', ['low', 'medium', 'high'].includes(sr.confidence), sr.confidence)
}
const lp = store.getJournalIntel('nature').letpub
if (lp) {
  check('LetPub 有 url', typeof lp.payload?.url === 'string')
  check('LetPub 已过滤广告噪声', !JSON.stringify(lp.payload).includes('LetPub助力'))
}
check('LetPub 周数解析（中文／英文）', typeof letpub.parseSpeed === 'function')
check('LetPub 录用比例解析', letpub.parseAcceptRate('较难').kind !== undefined)

/* ── 8. 铁律：不预测录用概率 ───────────────────────────────────────── */
console.log('\n── 铁律 ──')
const blob = JSON.stringify({ declared, withIntel, rankedIntel: rankedIntel.target.slice(0, 1) }).toLowerCase()
for (const banned of ['probability', 'chance', 'likelihood', 'acceptprob']) {
  check(`输出不含 ${banned}`, !blob.includes(banned))
}
check('footprint 是 share 不是概率', withIntel.topicFootprint && !('probability' in withIntel.topicFootprint))

/* ── 9. 可选：真实源 ───────────────────────────────────────────────── */
if (live) {
  console.log('\n── 真实源（live） ──')
  const mailto = 'verify@example.com'
  const r = await intel.fetchJournal(nature, { client, store, mailto })
  check('live openalex ok', r.sources.openalex?.ok === true, r.sources.openalex?.error)
  check('live openalex 有 bySubfield', (r.sources.openalex?.payload?.bySubfield || []).length > 0)
  const srLive = await scirev.fetchOne(nature, { client })
  check('live scirev 返回结构', typeof srLive.ok === 'boolean', srLive.error)
  if (srLive.ok) check('live scirev 有 firstReviewMonths', srLive.payload?.firstReviewMonths > 0, `${srLive.payload?.firstReviewMonths}`)
  const lpLive = await letpub.fetchOne(nature, { client })
  check('live letpub 返回结构', typeof lpLive.ok === 'boolean', lpLive.error)
  if (lpLive.ok) check('live letpub 有 url', typeof lpLive.payload?.url === 'string')
}

/* ── 汇总 ───────────────────────────────────────────────────────────── */
console.log('')
if (fails.length > 0) {
  console.log('失败项：')
  for (const f of fails) console.log(`  ✗ ${f}`)
  console.log('')
}
console.log(`${pass}/${pass + fail} 通过（${live ? '含 live' : '离线'}）`)
store.close()
rmSync(root, { recursive: true, force: true })
if (fail > 0) process.exitCode = 1
