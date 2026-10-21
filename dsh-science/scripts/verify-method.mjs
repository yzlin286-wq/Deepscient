/**
 * 发表层（M2）验收：期刊匹配 / 投稿门禁 / 加速路径 / 新颖性 / 起草。
 *
 *   node scripts/verify-method.mjs            # 全量（含一次真实 scoop check）
 *   node scripts/verify-method.mjs --offline  # 不联网
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadJournals, profileQuery, rankJournals, scoreJournal } from '../lib/science/method/journals.js'
import { runAudit, listProfiles } from '../lib/science/method/rules.js'
import { planRoute } from '../lib/science/method/route.js'
import { detectGap, overlap, titleTokens } from '../lib/science/method/novelty.js'
import { buildCoverLetter, parseRebuttal } from '../lib/science/method/draft.js'
import { ScienceStore } from '../lib/science/store.js'
import { apply } from '../lib/method-tools.js'

const offline = process.argv.includes('--offline')
const results = []
const add = (ok, msg) => results.push([ok === 'section' ? 'SECTION' : (ok ? 'PASS' : 'FAIL'), msg])
const check = (label, cond, detail = '') => add(Boolean(cond), `${label}${detail ? ` — ${detail}` : ''}`)
const section = (t) => add('section', t)

/* ── 1. 期刊画像 ────────────────────────────────────────────────────────── */
section('期刊画像')
const { journals, meta } = loadJournals()
check('期刊数 ≥ 50', journals.length >= 50, `${journals.length} 本`)
check('画像核验日期存在', Boolean(meta.verifiedAt), meta.verifiedAt)
check('id 无重复', new Set(journals.map((j) => j.id)).size === journals.length)
check('每本都有 band', journals.every((j) => Number.isInteger(j.band) && j.band >= 1 && j.band <= 5))
check('estimate 字段被标注', journals.some((j) => j.firstDecisionDays?.estimate === true))

/* ── 2. 三档推荐 ────────────────────────────────────────────────────────── */
section('三档推荐')
const cases = [
  { n: '蛋白折叠', q: { title: 'A diffusion model for protein folding kinetics', abstract: 'molecular dynamics with a generative diffusion model predicts folding rates', keywords: ['protein folding', 'diffusion model'], design: 'computational', band: 4, words: 4800, figures: 6 } },
  { n: 'RCT', q: { title: 'Semaglutide versus placebo for cardiovascular outcomes: a randomised trial', abstract: 'Multicentre randomised double-blind trial of 3200 patients.', keywords: ['clinical trial', 'randomised', 'cardiovascular'], design: 'clinical-trial', band: 5, words: 2700, figures: 4, refs: 38 } },
  { n: '化学', q: { title: 'Total synthesis of a diterpenoid via catalytic C-H activation', abstract: 'A convergent synthesis using palladium catalysis.', keywords: ['synthesis', 'catalysis'], design: 'experimental', band: 4 } },
  { n: 'ML', q: { title: 'Scaling laws for sparse mixture-of-experts language models', abstract: 'We train 40 models and derive scaling laws.', keywords: ['machine learning', 'scaling law'], design: 'computational', band: 4 } },
  { n: '预注册复制', q: { title: 'A registered replication of the ego-depletion effect', abstract: 'Preregistered multi-site replication with 2000 participants.', keywords: ['replication', 'psychology'], design: 'experimental', band: 3, needsRegisteredReport: true } },
  { n: '材料', q: { title: 'Perovskite solar cells with 27% efficiency via interface passivation', abstract: 'Device fabrication and stability testing.', keywords: ['perovskite', 'solar cell', 'materials'], design: 'experimental', band: 4, figures: 9 } },
]
const ranked = {}
for (const c of cases) {
  const r = rankJournals(journals, profileQuery(c.q), { perTier: 5 })
  ranked[c.n] = r
  check(`${c.n} 有主投档`, r.target.length > 0, r.target.map((s) => s.id).join(','))
}
check('RCT 主投含 NEJM 或 JAMA', ranked.RCT.target.some((s) => ['nejm', 'jama', 'lancet'].includes(s.id)),
  ranked.RCT.target.map((s) => s.id).join(','))
check('化学稿保底不含生物学专业刊', !ranked.化学.safe.some((s) => ['genome-biology', 'jcb', 'cell-reports', 'embo-reports'].includes(s.id)),
  ranked.化学.safe.map((s) => s.id).join(',') || '空')
check('ML 稿不把综合刊当冲刺', !ranked.ML.reach.some((s) => s.genericScope === true),
  ranked.ML.reach.map((s) => s.id).join(',') || '空')
check('预注册稿的 RR 刊进候选', [...ranked.预注册复制.reach, ...ranked.预注册复制.target].some((s) => s.acceleration.registeredReports),
  [...ranked.预注册复制.reach, ...ranked.预注册复制.target].map((s) => `${s.id}:${s.acceleration.registeredReports}`).join(','))
check('材料稿图数超限被记风险', ranked.材料.target.some((s) => s.risks.some((r) => r.includes('超限'))) || ranked.材料.target.every((s) => s.parts.format === 1))

const natureScore = scoreJournal(journals.find((j) => j.id === 'nature'), profileQuery(cases[0].q))
check('分项可拆开', ['scope', 'design', 'band', 'format', 'acceleration'].every((k) => Number.isFinite(natureScore.parts[k])))
check('超限进风险项', natureScore.risks.some((r) => r.includes('超限')), natureScore.risks.join('|').slice(0, 60))

/* ── 3. 投稿门禁 ────────────────────────────────────────────────────────── */
section('投稿门禁')
const profiles = listProfiles()
check('规范 profile ≥ 7', profiles.length >= 7, profiles.map((p) => `${p.id}:${p.rules}`).join(' '))

const BAD = {
  title: 'A Study of a novel mechanism of protein folding',
  abstract: 'We studied protein folding and found interesting results.',
  intro: 'Protein folding is clearly important. It is well known that folding matters.',
  methods: 'We used spectroscopy.',
  results: 'Folding rate increased significantly (p<0.05).',
  discussion: '',
}
const bad = runAudit(BAD, { profiles: ['general'], meta: { figures: 5 } })
const badIssues = bad.results.filter((r) => r.status === 'fail')
check('缺陷稿命中 ≥ 12 项', badIssues.length >= 12, `${badIssues.length} 项（阻断 ${bad.counts.blocking}）`)
check('标题话题化被抓', badIssues.some((r) => r.id === 'GEN-01'))
check('novel 承诺被抓', badIssues.some((r) => r.id === 'GEN-02'))
check('只给 p 值被抓', badIssues.some((r) => r.id === 'GEN-07'))
check('clearly 类断言被抓', badIssues.some((r) => r.id === 'GEN-15'))
check('缺 COI 被抓', badIssues.some((r) => r.id === 'GEN-10'))
check('缺 discussion 记为无法检查而非通过', bad.results.some((r) => r.id === 'GEN-18' && r.status === 'fail'))

const GOOD = {
  title: 'Chaperone concentration sets the folding rate of globular proteins',
  abstract: 'Folding rates vary widely, yet the determinant remains unresolved. Here we show that chaperone concentration sets the folding rate. Using single-molecule spectroscopy on 48 constructs we find k = 0.42 [chaperone]^0.8 (95% CI 0.31-0.55, n = 48), with the effect vanishing below 2 uM. This identifies chaperone availability as the dominant control on folding speed across the proteins we measured.',
  intro: 'Folding has been studied for decades. The determinant is unresolved. We test whether chaperone concentration sets the rate.',
  methods: 'We measured folding rates by FRET in n = 48 proteins across 5 concentrations (SD 0.3 uM). Data availability: traces at zenodo.org/record/0000000. Code availability: github.com/lab/fretfit v1.2. Ethics: recombinant proteins only, no human or animal subjects. Author contributions: A.B. designed the study; C.D. performed experiments. Competing interests: The authors declare no competing interests. Preregistration: analysis plan at OSF (osf.io/abcd1). Environment: Python 3.12 with pinned lockfile and fixed seed.',
  results: 'Rate increased 3.2-fold (95% CI 2.6-3.9, d = 1.4). Figure 1 shows rate versus concentration; Figure 2 shows traces; Figure 3 shows saturation; Figure 4 summarises the model.',
  discussion: 'Our results support a chaperone-limited model. A limitation is that only recombinant globular proteins were tested, so membrane proteins remain untested.',
}
const good = runAudit(GOOD, { profiles: ['general'], meta: { figures: 4 } })
check('合格稿零阻断', good.counts.blocking === 0, `阻断 ${good.counts.blocking} / 警告 ${good.counts.warning}`)
check('合格稿多数通过', good.counts.pass >= 14, `${good.counts.pass} 项通过`)

const CONSORT = {
  title: 'Drug X and mortality: a randomised trial', 
  abstract: 'A multicentre double-blind randomised placebo-controlled trial of 3200 patients assessed all-cause mortality as the primary outcome.',
  methods: 'Patients were randomly assigned by central web-based block randomisation. Participants and assessors were blinded. Sample size was powered at 90%. Intention-to-treat analysis used multiple imputation. Adverse events were recorded.',
  results: 'Mortality fell from 12.1% to 9.0% (RR 0.74, 95% CI 0.62-0.89, p=0.001, n = 3200).',
  discussion: 'Limitations include a single region.',
}
const con = runAudit(CONSORT, { profiles: ['consort'], meta: {} })
check('CONSORT 抓到缺注册号', con.results.some((r) => r.id === 'CON-01' && r.status === 'fail'))
check('CONSORT 抓到缺流程图', con.results.some((r) => r.id === 'CON-05' && r.status === 'fail'))
check('CONSORT 认可随机化与盲法', con.results.filter((r) => ['CON-02', 'CON-03', 'CON-04'].includes(r.id)).every((r) => r.status === 'pass'))

/* ── 4. 证据链（绑库） ──────────────────────────────────────────────────── */
section('证据链')
const root = mkdtempSync(join(tmpdir(), 'verify-method-'))
let store = null
try {
  store = new ScienceStore({ dbPath: join(root, 'm.db') })
  check('schema 至少 v4', store.version() >= 4, `v${store.version()}`)
  const ms = store.upsertManuscript({ title: BAD.title, abstract: BAD.abstract, status: 'draft', figures: 5 })
  const c1 = store.addClaim({ manuscriptId: ms.id, text: 'Chaperones set the folding rate' })
  const c2 = store.addClaim({ manuscriptId: ms.id, text: 'The effect is conserved across species' })
  store.addEvidence({ claimId: c1.id, paperId: 'p1', quote: '3.2x increase', pageFrom: 4, locator: 'Fig.2c' })
  store.addEvidence({ claimId: c2.id, quote: 'no effect in fish', supports: false })

  const orphan = store.addClaim({ manuscriptId: ms.id, text: 'This mechanism is universal' })
  check('孤儿断言被识别', store.orphanClaims(ms.id).some((r) => r.id === orphan.id))
  check('反驳证据改状态', store.claimsForManuscript(ms.id).find((c) => c.id === c2.id).status === 'contradicted')

  const auditBound = runAudit(BAD, { profiles: ['general'], meta: { figures: 5 }, store, manuscriptId: ms.id })
  check('audit 抓到孤儿断言', auditBound.results.some((r) => r.id === 'GEN-19' && r.status === 'fail'))
  check('audit 抓到被反驳断言', auditBound.results.some((r) => r.id === 'GEN-20' && r.status === 'fail'))

  store.logSubmissionEvent({ manuscriptId: ms.id, kind: 'submit', journalId: 'nature' })
  store.logSubmissionEvent({ manuscriptId: ms.id, kind: 'desk_reject', journalId: 'nature', ts: Date.now() + 7 * 86400000 })
  const tl = store.submissionTimeline(ms.id)
  check('desk 天数被算出', tl.metrics.deskDecisionDays === 7, `${tl.metrics.deskDecisionDays}d`)
  store.saveAuditRun({ manuscriptId: ms.id, blocking: 3, warning: 5, pass: 10, report: {} })
  check('审计快照落库', store.recentAudits(ms.id).length === 1)
} catch (error) {
  check(`存储层抛错：${error.message}`, false)
}

/* ── 5. 加速路径 ────────────────────────────────────────────────────────── */
section('加速路径')
const rr = planRoute({ journalId: 'elife', design: 'experimental', band: 4, title: 'A preregistered replication', keywords: ['replication'] })
check('RR 在支持刊 + 实验设计下可行', rr.registeredReport.viable === true, rr.registeredReport.reasons[0] || '')
check('RR 路径含 stage1/stage2', rr.timeline.some((t) => t.step === 'rr-stage1') && rr.timeline.some((t) => t.step === 'rr-stage2'))

const noRR = planRoute({ journalId: 'nature', design: 'computational', band: 4 })
check('RR 在计算方法下不可行', noRR.registeredReport.viable === false)
check('RR 不可行时给替代刊', noRR.registeredReport.reasons.some((r) => r.includes('可考虑')), noRR.registeredReport.reasons.join('|').slice(0, 80))

const pr = planRoute({ journalId: 'embo-j', design: 'experimental', band: 4, field: 'cell biology', hasPreprint: false })
check('portable review 在 affiliate 刊可行', pr.portableReview.viable === true)
check('未发预印本时提示补预印本', pr.portableReview.reasons.some((r) => r.includes('预印本')), pr.portableReview.reasons.join('|').slice(0, 80))

const cum = noRR.timeline.map((t) => t.cumulativeDays)
check('时间线累计单调递增', cum.every((v, i) => i === 0 || v >= cum[i - 1]), cum.join('→'))
check('totalDays 等于末项', noRR.totalDays === cum[cum.length - 1], `${noRR.totalDays}`)
check('transfer 链被给出', noRR.transfer.viable && noRR.transfer.chain.length > 0, noRR.transfer.chain.join('→'))

const filtered = planRoute({ journalId: 'nature', rejectReason: 'scope' })
check('rejectReason 过滤分支', filtered.decision.length === 1 && filtered.decision[0].reason === 'scope', `${filtered.decision.length} 条`)
const scopeBranch = filtered.decision[0]
check('scope 分支建议换刊不改稿', /换刊/.test(scopeBranch.action), scopeBranch.action)

/* ── 6. 新颖性（离线部分） ──────────────────────────────────────────────── */
section('新颖性')
const gap1 = detectGap('The molecular determinant remains unknown.')
check('识别英文空白陈述', gap1.stated && /unknown/.test(gap1.evidence || ''), gap1.evidence || '')
const gap2 = detectGap('该机制目前仍不清楚。')
check('识别中文空白陈述', gap2.stated === true, gap2.evidence || '')
const gap3 = detectGap('We measured folding rates across 48 proteins.')
check('无空白陈述时不误报', gap3.stated === false)
const t1 = titleTokens('Chaperone concentration sets the folding rate of globular proteins')
const t2 = titleTokens('Chaperones set folding rates in globular proteins')
const t3 = titleTokens('Quantum error correction in superconducting qubits')
check('高重叠被算出', overlap(t1, t2) >= 0.6, String(overlap(t1, t2)))
check('低重叠被算出', overlap(t1, t3) <= 0.2, String(overlap(t1, t3)))

/* ── 7. 起草 ────────────────────────────────────────────────────────────── */
section('起草')
const letter = buildCoverLetter({ title: 'X', journalId: 'nature-communications', keyFinding: 'chaperone concentration sets the folding rate' })
check('cover letter 五个槽位', letter.slots.length === 5, String(letter.slots.length))
check('缺事实时列 missing', letter.missing.some((m) => m.includes('whyNow')), letter.missing.join('|').slice(0, 60))
check('开头句去掉自称', !/^We report that we (report|show)/i.test(letter.opening || ''), letter.opening || '')
check('每槽都有必须填的事实', letter.slots.every((s) => s.mustFill.length > 0))

const REVIEWS = `Reviewer 1
1. The sample size is too small and no power analysis is provided.
2. The authors overclaim that chaperones "determine" folding.
3. Figure 2 is unclear; please clarify the color scale.

Reviewer 2
1. Additional experiments with membrane proteins are needed.
2. The authors should cite Lee et al. on chaperone-limited folding.`
const rb = parseRebuttal(REVIEWS)
check('切出 5 条意见', rb.counts.total === 5, `${rb.counts.total} 条`)
check('统计质疑被分类', rb.findings.some((f) => f.category === 'statistics'))
check('过度声称被分类', rb.findings.some((f) => f.category === 'claim-strength'))
check('补实验被分类', rb.findings.some((f) => f.category === 'new-experiment'))
check('文献被分类', rb.findings.some((f) => f.category === 'prior-work'))
check('阻断项被计数', rb.counts.blocking >= 3, `${rb.counts.blocking} 条`)
check('每条都有回应骨架', rb.findings.every((f) => f.skeleton.length === 3))

/* ── 8. 工具注册 ────────────────────────────────────────────────────────── */
section('工具注册')
const tools = {}
apply({ tools: { register(d) { tools[d.name] = d } }, get: () => null, provide() {}, logger: { info() {}, warn() {} } })
const expected = ['science_journal_fit', 'science_paper_audit', 'science_submission_route', 'science_novelty', 'science_cover_letter', 'science_rebuttal']
check('六个工具全部注册', expected.every((n) => Boolean(tools[n])), Object.keys(tools).join(','))
check('每个工具都有 render', expected.every((n) => typeof tools[n].output.render === 'function'))

/* ── 9. 在线 scoop check ────────────────────────────────────────────────── */
if (!offline) {
  section('在线 scoop check')
  try {
    const { checkNovelty } = await import('../lib/science/method/novelty.js')
    const { loadJournals: _l } = await import('../lib/science/method/journals.js')
    const { ScienceStore: SS } = await import('../lib/science/store.js')
    const { HttpCache } = await import('../lib/science/http/cache.js')
    const { createClient } = await import('../lib/science/http/client.js')
    const { RateLimiter, Budget, CircuitBreaker } = await import('../lib/science/http/limits.js')
    const { createRegistry } = await import('../lib/science/registry.js')
    const { createPipeline } = await import('../lib/science/pipeline.js')

    const s2 = new SS({ dbPath: join(root, 'scoop.db') })
    const cache = new HttpCache({ db: s2.db, dir: join(root, 'cache') })
    const limiter = new RateLimiter()
    const budget = new Budget()
    const breaker = new CircuitBreaker()
    const client = createClient({ cache, limiter, budget, proxies: [] })
    const registry = createRegistry({ client, limiter, breaker, budget, mailto: 'probe@example.com' })
    const pipeline = createPipeline({ registry, store: s2, budget, breaker, limiter, cache })

    const out = await checkNovelty(
      { title: 'Chaperone concentration sets the folding rate of globular proteins', abstract: 'The determinant remains unknown.', limit: 15 },
      { pipeline },
    )
    check('scoop 风险落在四档内', ['low', 'low-medium', 'medium', 'high'].includes(out.scoopRisk), out.scoopRisk)
    check('近邻列表 ≤ 8', out.closest.length <= 8, `${out.closest.length} 条`)
    check('检索到记录', out.searched.total > 0, `${out.searched.total} 条 / ${out.searched.ms}ms`)
    check('重叠度降序', out.closest.every((c, i) => i === 0 || c.overlap <= out.closest[i - 1].overlap))
    s2.close()
  } catch (error) {
    check(`在线 scoop check 抛错：${error.message}`, false)
  }
}

/* ── 汇总 ───────────────────────────────────────────────────────────────── */
for (const [status, msg] of results) {
  if (status === 'SECTION') console.log(`\n── ${msg} ──`)
  else console.log(`${status}  ${msg}`)
}
const failures = results.filter(([s]) => s === 'FAIL')
const total = results.filter(([s]) => s !== 'SECTION').length
console.log(`\n${total - failures.length}/${total} 通过${offline ? '（离线）' : ''}`)

if (store) store.close()
try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
if (failures.length > 0) process.exit(1)
