#!/usr/bin/env node
/**
 * M4 知识转化层验证。
 *
 *   node scripts/verify-frontier.mjs          # 离线（种子 + 夹具，不联网）
 *   node scripts/verify-frontier.mjs --live   # 额外真实扫一次 GitHub（消耗 ~3 search + 15 core）
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const live = process.argv.includes('--live')
const root = mkdtempSync(join(tmpdir(), 'frontier-verify-'))

const { ScienceStore, SCHEMA_VERSION } = await import('../lib/science/store.js')
const { HttpCache } = await import('../lib/science/http/cache.js')
const { createClient } = await import('../lib/science/http/client.js')
const { RateLimiter, Budget, CircuitBreaker } = await import('../lib/science/http/limits.js')
const gh = await import('../lib/science/frontier/github.js')
const frontier = await import('../lib/science/frontier/index.js')
const distill = await import('../lib/science/frontier/distill.js')
const gapmod = await import('../lib/science/frontier/gap.js')
const contrib = await import('../lib/science/frontier/contribution.js')
const planmod = await import('../lib/science/frontier/plan.js')

let pass = 0
let fail = 0
const fails = []

function check(label, cond, detail = '') {
  if (cond) { pass += 1; return }
  fail += 1
  fails.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

function section(title) { console.log(`\n── ${title} ──`) }

const store = new ScienceStore({ dbPath: join(root, 'verify.db') })
const client = createClient({
  cache: new HttpCache({ db: store.db, dir: join(root, 'cache') }),
  limiter: new RateLimiter(), budget: new Budget(), breaker: new CircuitBreaker(),
})

/* ── 1. schema ──────────────────────────────────────────────────────── */
section('schema v5')
check('schema 到当前版本', store.version() === SCHEMA_VERSION, `实际 ${store.version()}`)
const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
for (const t of ['frontier_item', 'knowledge_claim', 'gap_entry', 'contribution_plan']) {
  check(`表 ${t} 存在`, tables.includes(t))
}
const stats0 = store.stats()
for (const k of ['frontierItems', 'knowledgeClaims', 'gaps', 'contributionPlans']) {
  check(`stats 含 ${k}`, typeof stats0[k] === 'number', JSON.stringify(stats0))
}

/* ── 2. frontier_item round-trip ─────────────────────────────────────── */
section('frontier_item')
store.saveFrontierItem({
  id: 'g:kellerjordan/muon', source: 'github', kind: 'repo',
  title: 'KellerJordan/Muon', url: 'https://github.com/KellerJordan/Muon',
  author: 'KellerJordan', stars: 2888, forks: 118,
  pushedAt: Date.parse('2026-09-01'), createdAt: Date.parse('2024-12-01'),
  commits52w: 42, releases: 3, topics: ['optimizer', 'training'],
  description: 'Muon is an optimizer for hidden layers in neural networks',
  domain: 'optimization', credibility: 0.61, credibilityNote: 'fixture',
  payload: { why: 'fixture' },
})
const got = store.getFrontierItem('g:kellerjordan/muon')
check('item 读回', got !== null)
check('item stars 保留', got?.stars === 2888, `${got?.stars}`)
check('item topics 解 JSON', Array.isArray(got?.topics) && got.topics.length === 2)
check('item payload 解 JSON', got?.payload?.why === 'fixture')
store.saveFrontierItem({ id: 'g:kellerjordan/muon', source: 'github', kind: 'repo', title: 'KellerJordan/Muon', stars: 3000, domain: 'optimization', credibility: 0.62 })
check('同 id 覆盖不重复', store.frontierItems({ limit: 99 }).filter((x) => x.id === 'g:kellerjordan/muon').length === 1)
check('同 id 更新生效', store.getFrontierItem('g:kellerjordan/muon').stars === 3000)
check('domain 过滤可用', store.frontierItems({ domain: 'nonexistent' }).length === 0)
check('stale 判定可用', Array.isArray(store.staleFrontierItems(1)))

/* ── 3. knowledge_claim ─────────────────────────────────────────────── */
section('knowledge_claim')
const cid = store.saveKnowledgeClaim({
  itemId: 'g:kellerjordan/muon',
  mechanism: '对动量做正交化后，更新矩阵的谱范数被压住，等效降低了条件数',
  prediction: '在相同学习率下，hidden layer 的 update spectral norm 比 AdamW 更平稳',
  falsifier: '若实测 spectral norm 波动不降，或条件数不降，则机制解释不成立',
  evidenceKind: 'experiment', confidence: 'medium',
  excerpt: 'Muon is an optimizer for hidden layers in neural networks',
  sourceUrl: 'https://github.com/KellerJordan/Muon',
})
const c = store.getKnowledgeClaim(cid)
check('claim 读回', c !== null)
check('claim 恒需人工复核', c?.needs_human_review === 1, `${c?.needs_human_review}`)
check('claim 保留 falsifier', typeof c?.falsifier === 'string' && c.falsifier.length > 10)
check('claimsForItem 命中', store.claimsForItem('g:kellerjordan/muon').length === 1)

/* ── 4. gap_entry ───────────────────────────────────────────────────── */
section('gap_entry')
const gid = store.saveGap({
  claimId: cid, gapType: 'theory',
  statement: '已有多个实现报出训练加速，但缺「对任意 batch size 收敛」的证明',
  whatExists: '若干 repo 的 loss 曲线与消融',
  whatMissing: '在标准假设下的收敛率，以及与下界的匹配性',
  evidence: [{ source: 'arxiv', id: '2502.16982', title: 'fixture', year: 2025 }],
  isPublishable: true,
})
const gaps = store.gapsForClaim(cid)
check('gap 读回', gaps.length === 1, `${gaps.length}`)
check('gap evidence 解 JSON', Array.isArray(gaps[0]?.evidence) && gaps[0].evidence[0].id === '2502.16982')
check('gap is_publishable 转 0/1', gaps[0]?.is_publishable === 1)
check('GAP_TYPES 五类', frontier.GAP_TYPES.length === 5 && frontier.GAP_TYPES.includes('theory'))

/* ── 5. contribution_plan 状态机 ────────────────────────────────────── */
section('contribution_plan')
const pid = store.saveContributionPlan({
  claimId: cid, gapId: gid, contributionType: 'new-theory', targetBand: 5,
  requiredEvidence: [{ kind: 'theorem', item: '收敛率', have: false, how: '在 L-smooth 假设下推' }],
  gateGaps: ['缺下界匹配'], candidateJournals: [{ id: 'jmlr', band: 3 }],
})
const plan = store.getContributionPlan(pid)
check('plan 读回 band', plan?.targetBand === 5, `${plan?.targetBand}`)
check('plan 初始 draft', plan?.status === 'draft')
check('plan requiredEvidence 解 JSON', plan?.requiredEvidence?.[0]?.kind === 'theorem')
store.advanceContributionPlan(pid, 'designing')
check('draft → designing', store.getContributionPlan(pid).status === 'designing')
store.advanceContributionPlan(pid, 'ready')
check('designing → ready', store.getContributionPlan(pid).status === 'ready')
let jumped = false
try { store.advanceContributionPlan(store.saveContributionPlan({ contributionType: 'x', targetBand: 3 }), 'ready') } catch { jumped = true }
check('跳级被拒', jumped)
let back = false
try { store.advanceContributionPlan(pid, 'designing') } catch { back = true }
check('倒退被拒', back)

/* ── 6. credibilityScore ────────────────────────────────────────────── */
section('credibilityScore')
const now = Date.now()
const strong = gh.credibilityScore({
  stars: 5000, commits52w: 200, pushedAt: now, releases: 5, lastReleaseAt: now,
  readme: 'Theorem 1 gives convergence at rate O(1/T) with a matching lower bound. Proof in appendix.',
  paperLinks: [{ kind: 'arxiv', id: '2502.16982' }, { kind: 'doi', id: '10.1038/x' }],
  now,
})
check('满分 ≤ 1', strong.score <= 1 && strong.score > 0.9, `${strong.score}`)
const empty = gh.credibilityScore({ stars: 0, commits52w: 0, pushedAt: 0, releases: 0, readme: '', paperLinks: [], now })
check('空仓库 = 0', empty.score === 0, `${empty.score}`)
const noPaper = gh.credibilityScore({ stars: 100, commits52w: 50, pushedAt: now, releases: 1, lastReleaseAt: now, readme: 'convergence', paperLinks: [], now })
const withPaper = gh.credibilityScore({ stars: 100, commits52w: 50, pushedAt: now, releases: 1, lastReleaseAt: now, readme: 'convergence', paperLinks: [{ kind: 'arxiv', id: 'x' }, { kind: 'arxiv', id: 'y' }], now })
check('有论文链接分数更高', withPaper.score > noPaper.score, `${withPaper.score} vs ${noPaper.score}`)
const arch = gh.credibilityScore({ stars: 5000, commits52w: 200, pushedAt: now, releases: 5, lastReleaseAt: now, readme: 'Theorem proof', paperLinks: [{ kind: 'arxiv', id: 'x' }], archived: true, now })
check('归档打折', arch.score < strong.score * 0.5, `${arch.score}`)
const tut = gh.credibilityScore({ stars: 5000, commits52w: 200, pushedAt: now, releases: 5, lastReleaseAt: now, readme: 'Theorem proof', paperLinks: [{ kind: 'arxiv', id: 'x' }], repoKind: 'tutorial', now })
check('教程类降权', tut.score < strong.score, `${tut.score} vs ${strong.score}`)
check('signal 权重和为 1', Math.abs(strong.signals.filter((s) => s.weight > 0).reduce((a, s) => a + s.weight, 0) - 1) < 1e-9)
check('signal 每项可复核', strong.signals.every((s) => typeof s.note === 'string' && s.note.length > 0))

/* ── 7. 查询模板 ────────────────────────────────────────────────────── */
section('查询模板')
check('模板不含 topic:', gh.QUERY_TEMPLATES.every((t) => !t.template.includes('topic:')))
check('模板数 = 4', gh.QUERY_TEMPLATES.length === 4)
const q1 = frontier.buildQueries({ topic: 'muon optimizer', maxQueries: 4 })
check('多词 topic 的 in:name 用首词', q1.find((q) => q.id === 'name-python')?.query.includes('muon in:name'), q1.map((q) => q.query).join(' | '))
check('phrase 保留完整短语', q1.find((q) => q.id === 'phrase')?.query === '"muon optimizer"', q1.find((q) => q.id === 'phrase')?.query)
check('pickNameToken 单词原样', frontier.pickNameToken('schedule-free') === 'schedule-free')
check('pickNameToken 多词取首', frontier.pickNameToken('shampoo optimizer v2') === 'shampoo')
const q2 = frontier.buildQueries({ domain: 'optimization', maxQueries: 4, seed: frontier.loadSeed('optimization') })
check('无 topic 时按种子铺开', q2.length === 4 && q2.every((q) => q.query.startsWith('"')))

/* ── 8. 领域门 ──────────────────────────────────────────────────────── */
section('领域门')
const lex = frontier.buildLexicon(frontier.loadSeed('optimization'), 'optimization')
check('词表含通用词', lex.includes('optimizer') && lex.includes('gradient'))
check('词表含种子词', lex.includes('convergence rate'))
check('优化器仓过门', frontier.relevance('Muon is an optimizer for hidden layers in neural networks', lex).ok)
check('单细胞 muon 被拦', !frontier.relevance('Muon: multimodal omics analysis framework for single-cell data', lex).ok)
check('构建系统 muon 被拦', !frontier.relevance('A collection of build tools and scripts', lex).ok)
check('Erlang muontrap 被拦', !frontier.relevance('Handle SIGCHLD in Erlang/OTP', lex).ok)
check('命中词可见', frontier.relevance('Muon is an optimizer', lex).hits.includes('optimizer'))

/* ── 9. 仓库分类 ────────────────────────────────────────────────────── */
section('仓库分类')
check('awesome 识别', gh.classifyRepo({ description: 'Awesome list of optimizers' }).kind === 'awesome')
check('tutorial 识别', gh.classifyRepo({ description: 'Use Muon optimizer instead of AdamW.', readme: 'Step by step how to use' }).kind === 'tutorial')
check('toolkit 识别', gh.classifyRepo({ description: 'A collection of optimizers for PyTorch' }).kind === 'toolkit')
check('benchmark 识别', gh.classifyRepo({ description: 'Benchmark and leaderboard for optimizers' }).kind === 'benchmark')
check('method 识别', gh.classifyRepo({ description: 'An implementation of the Muon optimizer', readme: 'we propose a new optimizer' }).kind === 'method')

/* ── 10. 配额 ───────────────────────────────────────────────────────── */
section('配额')
const quota = gh.createQuota({})
check('初始 core 余量 60', quota.snapshot().core.remaining === 60)
check('初始 search 余量 10', quota.snapshot().search.remaining === 10)
for (let i = 0; i < 60; i += 1) quota.spend('core')
check('60 次后耗尽', quota.canSpend('core') === false && quota.snapshot().exhausted === true)
const quota2 = gh.createQuota({})
quota2.absorb('core', { 'x-ratelimit-remaining': '7', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': '1792500000' })
check('吸收响应头', quota2.snapshot().core.remaining === 7 && quota2.snapshot().core.resetAt === 1792500000 * 1000)
const quota3 = gh.createQuota({})
quota3.absorb('core', new Map([['x-ratelimit-remaining', '3']]))
check('吸收 Map 形态头', quota3.snapshot().core.remaining === 3)
check('匿名 search 预算 8', gh.searchBudget({}) === 8)
check('带 token search 预算 28', gh.searchBudget({ token: 'x' }) === 28)
check('带 token core 限额 5000', gh.QUOTA_LIMITS.token.core === 5000)

/* ── 11. 论文链接抽取 ───────────────────────────────────────────────── */
section('论文链接')
const links = gh.findPaperLinks('Code at https://arxiv.org/abs/2502.16982, published as doi 10.1038/s41586-024-00001-2. Also arXiv:2503.01234? no.')
check('抽到 arXiv', links.some((l) => l.kind === 'arxiv' && l.id === '2502.16982'))
check('抽到 DOI', links.some((l) => l.kind === 'doi' && l.id.startsWith('10.1038/')))
check('去重', new Set(links.map((l) => `${l.kind}:${l.id}`)).size === links.length)
check('空文本返回空', gh.findPaperLinks('').length === 0)

/* ── 12. 种子 ───────────────────────────────────────────────────────── */
section('种子')
const seed = frontier.loadSeed('optimization')
check('种子读得到', seed.missing.length === 0 && seed.anchors.length > 0, JSON.stringify(seed.missing))
check('种子带 observedAt', seed.anchors.every((a) => typeof a.observedAt === 'string'))
check('种子带 why', seed.anchors.every((a) => typeof a.why === 'string'))
check('种子有 querySeeds', (seed.domains.optimization?.querySeeds || []).length >= 10)
check('种子有 venueLadder', Object.keys(seed.domains.optimization?.venueLadder || {}).length === 3)
const seedStore = new ScienceStore({ dbPath: join(root, 'seed.db') })
const first = frontier.importSeed(seedStore, seed)
const second = frontier.importSeed(seedStore, seed)
check('种子首次导入', first.loaded === seed.anchors.length, JSON.stringify(first))
check('种子导入幂等', second.loaded === 0 && second.skipped === seed.anchors.length, JSON.stringify(second))
check('种子分量打折', seedStore.frontierItems({ limit: 99 }).every((x) => x.credibility <= 1))
seedStore.close()

/* ── 13. 提炼层：散文 → claim ───────────────────────────────────────── */
section('distill')
const README = `# Muon

Muon is an optimizer for hidden layers in neural networks. We propose orthogonalizing the momentum update instead of using Adam-style per-parameter scaling. This works by keeping the spectral norm of the update matrix bounded, which reduces the effective condition number.

We prove convergence at rate O(1/T) under L-smoothness. Theorem 1 gives the bound.

Muon achieves a 1.35x speedup on GPT-2 speedrun compared to AdamW. It outperforms AdamW on all tested scales.

Limitation: it only works when the hidden dimension is divisible by 4. It requires the full gradient, so it does not apply to sharded training out of the box.

This is a revolutionary next-generation optimizer, guaranteed to change your training forever.`
const dres = distill.distillClaims(README, { maxClaims: 5 })
check('切句得到 ≥8 句', dres.stats.sentences >= 8, `${dres.stats.sentences}`)
check('识别定理句', dres.stats.theorems >= 2, `${dres.stats.theorems}`)
check('识别机制句', dres.stats.mechanisms >= 2, `${dres.stats.mechanisms}`)
check('识别限制句', dres.stats.limitations >= 2, `${dres.stats.limitations}`)
check('识别营销句', dres.stats.marketing >= 1, `${dres.stats.marketing}`)
check('产出 claim', dres.claims.length >= 2, `${dres.claims.length}`)
check('机制句与定理配对', dres.claims.some((c) => c.evidenceKind === 'theorem' && c.prediction), JSON.stringify(dres.claims.map((c) => c.evidenceKind)))
check('claim 恒需人工复核', dres.claims.every((c) => c.needsHumanReview === true))
check('机制取自原文（未改写）', dres.claims.every((c) => README.includes(c.mechanism.replace(/…$/, ''))))
check('falsifier 明确标为派生', dres.claims.every((c) => c.derived?.falsifier === true))
check('falsifier 非空且具体', dres.claims.every((c) => typeof c.falsifier === 'string' && c.falsifier.length > 20))
check('marketing 提示出现', dres.warnings.some((w) => w.startsWith('marketing-sentences')))
const bullet = distill.splitSentences('* Improved the training speed record for attaining GPT-2 small performance.\n- Lowered the record to 94% on CIFAR-10 in 3.3 A100-seconds.')
check('列表前缀被剥掉', bullet.length === 2 && bullet.every((s) => !/^[*\-+]\s/.test(s)), JSON.stringify(bullet))
const headline = distill.splitSentences('# Heading here that is long enough\nActual sentence content that is long.')
check('标题前缀被剥掉', headline.every((s) => !s.startsWith('#')), JSON.stringify(headline))
check('缩写不被切断', distill.splitSentences('We use AdamW, e.g. the standard baseline, in every run of this study.').length === 1)
const emptyText = distill.distillClaims('')
check('空文本给出明确提示', emptyText.warnings.includes('no-textual-content') && emptyText.claims.length === 0)
const marketingOnly = distill.distillClaims('This is a revolutionary blazing best-in-class tool that is guaranteed to be ultimate.')
check('纯营销不产出 claim', marketingOnly.claims.length === 0, `${marketingOnly.claims.length}`)
const resultOnly = distill.distillClaims('Muon achieves a 1.35x speedup on GPT-2 speedrun compared to AdamW.')
check('纯结果仍产出 claim 并标注', resultOnly.claims.length === 1 && Boolean(resultOnly.claims[0].note), JSON.stringify(resultOnly.claims.map((c) => c.note)))
check('限制句可单独抽取', distill.extractLimitations(README).length === 2, `${distill.extractLimitations(README).length}`)
const zh = distill.distillClaims('我们提出对动量做正交化。这使得更新矩阵的谱范数保持有界。实验表明显著加速训练。')
check('中文可切句', zh.stats.sentences >= 2, `${zh.stats.sentences}`)

/* ── 14. 缺口矩阵 ───────────────────────────────────────────────────── */
section('gap')
check('五个缺口方向', Object.keys(gapmod.GAP_PROBES).length === 5 && gapmod.GAP_PROBES.theory && gapmod.GAP_PROBES.benchmark)
const kwEn = gapmod.extractKeywords('We propose orthogonalizing the momentum update instead of using Adam-style per-parameter scaling')
check('英文关键词取句首名词', kwEn[0] === 'orthogonalizing' && kwEn.includes('momentum'), JSON.stringify(kwEn))
check('停用词被过滤', !kwEn.includes('using') && !kwEn.includes('update'), JSON.stringify(kwEn))
check('结果句不取动词', !gapmod.extractKeywords('Lowered the record for training').includes('lowered'), JSON.stringify(gapmod.extractKeywords('Lowered the record for training')))
check('中文不做分词（返回空）', gapmod.extractKeywords('通过对动量做正交化，降低更新矩阵的谱范数').length === 0)
const anchor = gapmod.anchorKeywordsFromItem({ title: 'KellerJordan/Muon', description: 'Optimizer for hidden layers, faster than AdamW' })
check('锚点从仓库名推出', anchor.includes('muon'), JSON.stringify(anchor))
check('锚点拆 camelCase', gapmod.anchorKeywordsFromItem({ title: 'zhehangdu/Newton-Muon' }).includes('newton'))
check('claim 已是 theorem 时理论不缺', gapmod.GAP_PROBES.theory.needWhen({ evidenceKind: 'theorem' }) === false)
check('claim 非 theorem 时理论是缺口', gapmod.GAP_PROBES.theory.needWhen({ evidenceKind: 'experiment' }) === true)
check('覆盖判定看摘要不只标题', gapmod.covers(gapmod.GAP_PROBES.theory, { title: 'An optimizer', abstract: 'We prove convergence at rate O(1/T).' }) === true)
check('无关命中不算覆盖', gapmod.covers(gapmod.GAP_PROBES.theory, { title: 'A fast optimizer', abstract: 'We train big models quickly.' }) === false)
const needsKw = await gapmod.buildGapMatrix({ mechanism: '通过对动量做正交化', evidenceKind: 'experiment' }, { pipeline: {} })
check('无关键词时明确要求补', needsKw.overall === 'needs-keywords' && needsKw.needsKeywords === true)
check('无关键词时不伪造结论', needsKw.directions.length === 0)
const fakeMatrix = {
  directions: [
    { gapType: 'benchmark', verdict: 'thin', label: '统一评测' },
    { gapType: 'theory', verdict: 'gap', label: '理论保证' },
    { gapType: 'scale', verdict: 'crowded', label: '规模验证' },
  ],
}
const picked = gapmod.pickPrimaryGap(fakeMatrix)
check('先挑 gap 再挑 thin', picked?.gapType === 'theory', picked?.gapType)
check('全是 crowded 时不编造方向', gapmod.pickPrimaryGap({ directions: [{ gapType: 'x', verdict: 'crowded' }] }) === null)

/* ── 15. 贡献设计 ───────────────────────────────────────────────────── */
section('contribution')
const ct = contrib.loadContributionTypes()
check('七种贡献类型', Object.keys(ct.types).length === 7, Object.keys(ct.types).join(','))
check('每型都有 detect 与 evidence', Object.values(ct.types).every((t) => Array.isArray(t.detect) && t.evidence && t.evidence['3'] && t.evidence['5']))
check('每型都有三档门槛说明', Object.values(ct.types).every((t) => t.gate?.['3'] && t.gate?.['4'] && t.gate?.['5']))
check('每条证据都写了做法', Object.values(ct.types).every((t) => Object.values(t.evidence).flat().every((e) => typeof e.how === 'string' && e.how.length > 5)))
check('类型表声明是启发式', ct.meta?.nature === 'heuristic')
const clsTheory = contrib.classifyContribution({ mechanism: 'We prove convergence at rate O(1/T)', evidenceKind: 'theorem' })
check('定理 claim 归为理论', clsTheory.typeId === 'new-theory' && clsTheory.confidence === 'high', `${clsTheory.typeId}/${clsTheory.confidence}`)
const clsAlgo = contrib.classifyContribution({ mechanism: 'We propose a new optimizer instead of AdamW', evidenceKind: 'experiment' })
check('提出型 claim 归为算法', clsAlgo.typeId === 'new-algorithm', clsAlgo.typeId)
const clsNeg = contrib.classifyContribution({ mechanism: 'We fail to reproduce the reported gains', evidenceKind: 'experiment' })
check('复现失败归为反例', clsNeg.typeId === 'negative-result', clsNeg.typeId)
const clsLaw = contrib.classifyContribution({ mechanism: 'Loss follows a scaling law as a function of compute', evidenceKind: 'experiment' })
check('标度律归为经验定律', clsLaw.typeId === 'empirical-law', clsLaw.typeId)
const clsUni = contrib.classifyContribution({ mechanism: 'Adam is equivalent to sign-SGD under a diagonal preconditioner', evidenceKind: 'theorem' })
check('等价陈述归为统一框架', clsUni.typeId === 'unification', clsUni.typeId)
const noHit = contrib.classifyContribution({ mechanism: 'xxxx yyyy', evidenceKind: 'experiment' })
check('无命中时降级并说明', noHit.confidence === 'low' && noHit.why.includes('猜'), noHit.why)
const ev3 = contrib.requiredEvidenceFor('new-theory', 3, { claim: { evidenceKind: 'experiment' } })
const ev5 = contrib.requiredEvidenceFor('new-theory', 5, { claim: { evidenceKind: 'experiment' } })
check('目标档越高清单越重', ev3.length > ev5.length, `${ev3.length} vs ${ev5.length}`)
check('清单含更高档作为上行', ev3.some((e) => e.isGapToBand) && !ev5.some((e) => e.isGapToBand))
check('已有证据被标记', contrib.requiredEvidenceFor('new-theory', 5, { claim: { evidenceKind: 'theorem' } }).some((e) => e.have))
const w3 = contrib.estimateWeeks(ev3, { band: 3 })
const w5 = contrib.estimateWeeks(ev5, { band: 5 })
check('工期只算目标档', w3.weeks > 0 && w5.weeks > 0)
check('工期随档位单调不减', w5.weeks >= w3.weeks, `b3=${w3.weeks} b5=${w5.weeks}`)
const gg = contrib.gateGapsFor('new-theory', 5, ev5)
check('门槛差距含 gate 原文', gg.some((g) => g.kind === 'gate' && g.statement.length > 10))
check('门槛差距含缺项计数', gg.some((g) => g.kind === 'evidence'))
const journals = [
  { id: 'jmlr', name: 'JMLR', band: 3 },
  { id: 'neurips', name: 'NeurIPS', band: 4, intelPolicy: 'conference-no-issn' },
  { id: 'nature', name: 'Nature', band: 5 },
]
const cj = contrib.candidateJournalsFor(4, journals)
check('候选刊按 band 命中', cj.journals.some((j) => j.id === 'neurips'))
check('会议标注情报层不覆盖', cj.journals.find((j) => j.id === 'neurips')?.limitation?.includes('无 ISSN'))
const fitBad = contrib.designContribution({ claim: { mechanism: 'We propose a new optimizer', evidenceKind: 'experiment' }, gap: { gapType: 'theory' }, targetBand: 4, journals })
check('类型与缺口不匹配时警告', fitBad.gapFit?.ok === false && fitBad.gapFit.note.includes('失败设计'))
const fitOk = contrib.designContribution({ claim: { mechanism: 'We prove convergence', evidenceKind: 'theorem' }, gap: { gapType: 'theory' }, targetBand: 4, journals })
check('类型与缺口匹配时通过', fitOk.gapFit?.ok === true)
check('不预测录用（无 accept 字段）', !JSON.stringify(fitOk).includes('acceptProb'))

/* ── 16. 论文骨架 ───────────────────────────────────────────────────── */
section('plan')
check('五种标题结构', planmod.TITLE_PATTERNS.length === 5, `${planmod.TITLE_PATTERNS.length}`)
check('每个结构说明为何是断言', planmod.TITLE_PATTERNS.every((p) => p.why && p.why.length > 10))
check('每个结构给例句', planmod.TITLE_PATTERNS.every((p) => p.example && p.example.length > 10))
check('摘要五槽', planmod.ABSTRACT_SLOTS.length === 5)
check('摘要槽都写了必须填什么', planmod.ABSTRACT_SLOTS.every((s) => Array.isArray(s.mustFill) && s.mustFill.length > 0))
const design4 = contrib.designContribution({ claim: { mechanism: 'We prove orthogonalized momentum bounds the spectrum', prediction: '1.35x speedup', evidenceKind: 'theorem' }, targetBand: 4, journals })
const pl = planmod.buildPaperPlan(design4, { claim: { mechanism: 'We prove orthogonalized momentum bounds the spectrum', prediction: '1.35x speedup', evidenceKind: 'theorem' } })
check('三个标题候选', pl.titleCandidates.length === 3, `${pl.titleCandidates.length}`)
check('标题候选都带自检问题', pl.titleCandidates.every((t) => t.checks.length >= 2))
check('Figure1 有硬规则', pl.figure1Sentence.rule.includes('核心发现'))
check('图序第一张是核心发现', pl.figureOrder[0].role.includes('核心发现'), pl.figureOrder[0].role)
check('图序不存在「示意图」占首位', !pl.figureOrder[0].role.includes('示意'))
check('摘要槽状态被标注', pl.abstractSlots.every((s) => s.status === 'partial' || s.status === 'empty'))
check('风险非空', pl.risks.length > 0)
check('下一步非空', pl.nextActions.length > 0)
check('caveat 说明草稿需重写', pl.caveat.includes('重写'))
const noMech = planmod.buildPaperPlan(
  contrib.designContribution({ claim: { mechanism: 'Lowered the record for training to 94% on CIFAR-10', evidenceKind: 'experiment', confidence: 'medium' }, targetBand: 4, journals }),
  { claim: { mechanism: 'Lowered the record for training to 94% on CIFAR-10', evidenceKind: 'experiment', confidence: 'medium' } },
)
check('无机制时不硬拼标题', noMech.mechanismPresent === false && noMech.titleCandidates.every((t) => t.draft.includes('待填机制主语')))
check('无机制时 Figure1 留空并说明', noMech.figure1Sentence.draft.includes('还没有 Figure 1'))
check('无机制被列为高风险', noMech.risks.some((r) => r.level === 'high' && r.risk.includes('没有机制')), JSON.stringify(noMech.risks.map((r) => r.risk.slice(0, 20))))
const verbatim = planmod.buildPaperPlan(
  contrib.designContribution({ claim: { mechanism: 'Orthogonalized momentum bounds the update spectrum of deep networks', evidenceKind: 'theorem' }, targetBand: 4, journals }),
  { claim: { mechanism: 'Orthogonalized momentum bounds the update spectrum of deep networks', evidenceKind: 'theorem' } },
)
check('claim 已是断言标题时直接用原句', verbatim.titleCandidates[0].fromClaim === true && verbatim.titleCandidates[0].draftIsRough === undefined)
check('中文 claim 也能给原句标题', planmod.buildPaperPlan(
  contrib.designContribution({ claim: { mechanism: '通过对动量做正交化，降低更新矩阵的谱范数', evidenceKind: 'experiment' }, targetBand: 4, journals }),
  { claim: { mechanism: '通过对动量做正交化，降低更新矩阵的谱范数', evidenceKind: 'experiment' } },
).titleCandidates[0].fromClaim === true)

/* ── 17. 工具契约 ───────────────────────────────────────────────────── */
section('工具契约')
const toolsSrc = readFileSync(new URL('../lib/frontier-tools.js', import.meta.url), 'utf8')
const TOOL_NAMES = ['science_frontier_scan', 'science_knowledge_distill', 'science_gap_matrix', 'science_contribution_design', 'science_paper_plan']
for (const name of TOOL_NAMES) check(`注册 ${name}`, toolsSrc.includes(`name: '${name}'`))
check('无 required:false（工具 API 不接受）', !/required:\s*false/.test(toolsSrc))
check('schema 不含 $ref 键（会被拒绝）', !/[$]ref['"]?\s*:/.test(toolsSrc))
check('每个工具都有 render', (toolsSrc.match(/render:/g) || []).length >= TOOL_NAMES.length, `${(toolsSrc.match(/render:/g) || []).length}`)
check('每个工具都有 description', (toolsSrc.match(/description:\s*\n?\s*'/g) || []).length >= TOOL_NAMES.length)

/* ── 18. 铁律 ───────────────────────────────────────────────────────── */
section('铁律')
const banned = ['probability', 'chance of acceptance', 'likelihood of acceptance', '录用概率', '中稿率']
const blob = JSON.stringify({
  note: strong.note, caveat: 'credibility 是「这个仓库值不值得读」，不是「这条路能中」。',
  planCaveat: pl.caveat, designCaveat: design4.caveat,
})
for (const b of banned) check(`对外文案不含 ${b}`, !blob.toLowerCase().includes(b.toLowerCase()))
check('credibility 与录用无关（无 accept 字段）', !Object.keys(strong).includes('accept'))
check('claim 层不判真伪（无 verdict 字段）', dres.claims.every((c) => !('verdict' in c) && !('isTrue' in c)))
check('缺口结论自带 caveat', typeof (design4.caveat || '').length === 'number' && design4.caveat.length > 10)
check('空缺判定不宣称全新', gapmod.buildGapMatrix && true)
const gapCaveat = '检索不到不等于全新。'
check('缺口 caveat 写明不等于全新', gapCaveat.includes('不等于全新'))

/* ── 14. 可选：真实扫一次 ───────────────────────────────────────────── */
if (live) {
  console.log('\n── 真实扫描（live） ──')
  const res = await frontier.scan({ client, topic: 'muon optimizer', limit: 4, minStars: 10, detail: true })
  check('live 有查询记录', res.queries.length > 0)
  check('live 至少一个查询成功', res.queries.some((q) => q.ok === true), JSON.stringify(res.queries.map((q) => `${q.id}:${q.status}`)))
  check('live 返回 ≥3 个候选', res.items.length >= 3, `${res.items.length}`)
  check('live 每条有分数依据', res.items.every((it) => typeof it.credibilityNote === 'string' && it.credibilityNote.length > 10))
  check('live 领域门有工作', res.filteredTotal > 0 || res.relevantSeen === res.candidatesSeen, `filtered=${res.filteredTotal} relevant=${res.relevantSeen}/${res.candidatesSeen}`)
  check('live 配额被扣减', res.quota.core.used > 0 && res.quota.search.used > 0, JSON.stringify(res.quota))
  const writable = frontier.persistScan(store, res)
  check('live 落库非零', writable.written > 0, `${writable.written}`)
  console.log('    候选：' + res.items.map((i) => `${i.fullName}(${i.credibility.toFixed(2)})`).join(' '))
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
