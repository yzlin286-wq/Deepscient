/**
 * M4 真实链路冒烟：scan → distill → gap → design → plan，全用真网络与真库。
 *
 * 与 verify-frontier.mjs 的分工：那个是离线断言（无配额消耗），
 * 这个是**打真实 GitHub 检索与十源检索**的冒烟，用来确认契约没被现实打脸。
 *
 * 会消耗配额：一次运行 ≈ 3 次 search + 9 次 core + 5×4 次文献检索。
 * GitHub 匿名额度是 core 60/h、search 10/min，**跑两三次就到顶**；
 * 到顶后 README 全是空的，脚本会在第 ② 步退出并说明原因——那不是代码坏了，
 * 把 token 放进 ~/.dsh/science/config.json 的 retrieval.githubToken 即可。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { ScienceStore } = await import('../lib/science/store.js')
const { HttpCache } = await import('../lib/science/http/cache.js')
const { createClient } = await import('../lib/science/http/client.js')
const { RateLimiter, Budget, CircuitBreaker } = await import('../lib/science/http/limits.js')
const { createRegistry } = await import('../lib/science/registry.js')
const { createPipeline } = await import('../lib/science/pipeline.js')
const frontier = await import('../lib/science/frontier/index.js')
const { distillClaims, extractLimitations } = await import('../lib/science/frontier/distill.js')
const { buildGapMatrix, pickPrimaryGap, anchorKeywordsFromItem } = await import('../lib/science/frontier/gap.js')
const { designContribution } = await import('../lib/science/frontier/contribution.js')
const { buildPaperPlan } = await import('../lib/science/frontier/plan.js')
const { loadJournals } = await import('../lib/science/method/journals.js')

const root = mkdtempSync(join(tmpdir(), 'm4-e2e-'))
const store = new ScienceStore({ dbPath: join(root, 'e2e.db') })
const cache = new HttpCache({ db: store.db, dir: join(root, 'cache') })
const limiter = new RateLimiter()
const budget = new Budget()
const breaker = new CircuitBreaker()
const client = createClient({ cache, limiter, budget, provenance: false })
const registry = createRegistry({ client, limiter, breaker, budget, mailto: 'e2e@example.com' })
const pipeline = createPipeline({ registry, store, budget, breaker, limiter, cache })

const t0 = Date.now()

/* ① 扫描 */
const scanRes = await frontier.scan({ client, registry, topic: 'muon optimizer', limit: 3, minStars: 10, detail: true, includeArxiv: true })
const wrote = frontier.persistScan(store, scanRes)
console.log(`① scan: ${scanRes.items.length} 条（落库 ${wrote.written}）｜剔除 ${scanRes.filteredTotal} 个领域外｜${((Date.now() - t0) / 1000).toFixed(1)}s`)
for (const it of scanRes.items) console.log(`   ${it.credibility.toFixed(3)} ${it.fullName} [${it.repoKind}] papers=${it.paperLinks.length} readme=${it.readmeExcerpt ? it.readmeExcerpt.length + '字' : '无'}`)

/* ② 提炼 */
const target = scanRes.items.find((i) => i.readmeExcerpt)
if (!target) {
  console.log('② 没有任何候选带 README 正文——GitHub core 配额已耗尽（匿名 60/h）。')
  console.log('   这不是代码缺陷：把 token 放进 ~/.dsh/science/config.json 的 retrieval.githubToken 后重跑。')
  store.close()
  rmSync(root, { recursive: true, force: true })
  process.exit(0)
}
const dist = distillClaims(target.readmeExcerpt, { maxClaims: 4, sourceUrl: target.url })
console.log(`\n② distill(${target.fullName}): ${dist.claims.length} 条 claim｜限制句 ${extractLimitations(target.readmeExcerpt).length}`)
const savedClaims = []
for (const c of dist.claims) {
  const id = store.saveKnowledgeClaim({
    itemId: target.itemId, mechanism: c.mechanism, prediction: c.prediction,
    falsifier: c.falsifier, evidenceKind: c.evidenceKind, confidence: c.confidence,
    excerpt: c.excerpt, sourceUrl: c.sourceUrl,
  })
  savedClaims.push({ ...c, id })
  console.log(`   [${c.evidenceKind}/${c.confidence}] ${c.mechanism.slice(0, 70)}`)
}

/* ③ 缺口矩阵 */
const claim = savedClaims[0]
const t1 = Date.now()
const anchor = anchorKeywordsFromItem(target)
const matrix = await buildGapMatrix(claim, { pipeline, limit: 5, anchorKeywords: anchor })
console.log(`\n③ gap_matrix(${claim.id}): ${matrix.overall}｜锚点 ${JSON.stringify(anchor)}｜关键词 ${JSON.stringify(matrix.keywords)}｜${((Date.now() - t1) / 1000).toFixed(1)}s`)
for (const d of matrix.directions) console.log(`   [${d.verdict}] ${d.label} 命中${d.searchedTotal} 覆盖${d.coveredCount}`)
const primary = pickPrimaryGap(matrix)
if (primary) console.log(`   先补：${primary.label} → ${primary.whatMissing}`)
for (const d of matrix.directions.filter((x) => x.verdict !== 'not-needed')) {
  store.saveGap({
    claimId: claim.id, gapType: d.gapType, statement: d.statement,
    whatExists: (d.covered || []).map((e) => e.title).join('；') || null,
    whatMissing: d.whatMissing || '—',
    evidence: (d.covered || []).map((e) => ({ title: e.title, year: e.year, doi: e.doi })),
    isPublishable: d.verdict === 'gap',
  })
}

/* ④ 贡献设计 */
const { journals } = loadJournals()
for (const band of [3, 4, 5]) {
  const d = designContribution({ claim, gap: primary, targetBand: band, journals, store })
  console.log(`\n④ design(band${band}): ${d.typeLabel}｜目标档 ${d.evidenceCount.atBand} 项｜工期 ${d.estimatedWeeks}周（上行 ${d.upwardWeeks}周）｜门槛差距 ${d.gateGaps.length}`)
  if (band === 4) {
    const planId = store.saveContributionPlan({
      claimId: claim.id, contributionType: d.typeId, targetBand: d.targetBand,
      requiredEvidence: d.requiredEvidence, gateGaps: d.gateGaps, candidateJournals: d.candidateJournals,
    })
    console.log(`   存为 ${planId}｜候选刊 ${d.candidateJournals.map((j) => j.name).slice(0, 4).join(' / ')}`)
    if (d.gapFit) console.log(`   缺口匹配：${d.gapFit.ok ? '✓' : '⚠'} ${d.gapFit.note.slice(0, 90)}`)

    /* ⑤ 论文骨架 */
    const plan = buildPaperPlan(d, { claim, gap: primary, journalId: 'neurips', title: null, keywords: matrix.keywords })
    console.log(`\n⑤ paper_plan:`)
    for (const t of plan.titleCandidates) console.log(`   标题[${t.id}] ${t.draft}`)
    console.log(`   Figure1: ${plan.figure1Sentence.draft}`)
    console.log(`   摘要槽：${plan.abstractSlots.map((s) => `${s.name}(${s.status})`).join(' ')}`)
    console.log(`   实验 ${plan.experimentList.length} 项｜证明 ${plan.theoryList.length} 项｜图 ${plan.figureOrder.length} 张`)
    console.log(`   时间线：${plan.timeline ? `${plan.timeline.length} 步 / ${plan.totalDays} 天` : '无'}`)
    console.log(`   风险：${plan.risks.map((r) => r.level).join(',')}｜下一步 ${plan.nextActions.length} 条`)
    store.advanceContributionPlan(planId, 'designing')
    console.log(`   状态推进：${store.getContributionPlan(planId).status}`)
  }
}

const st = store.stats()
console.log(`\n库：${JSON.stringify({ frontier: st.frontierItems, claims: st.knowledgeClaims, gaps: st.gaps, plans: st.contributionPlans })}`)
console.log(`总计 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
store.close()
rmSync(root, { recursive: true, force: true })
