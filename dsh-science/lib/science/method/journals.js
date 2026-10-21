/**
 * 期刊匹配：把稿件画像投到期刊画像上，给可解释的分数。
 *
 * 设计原则：
 *   - 分数必须能逐项拆开（scope/design/band/format/acceleration），否则用户不知道为何被推荐
 *   - 期刊 scope 里的"体裁词"（multidisciplinary、broad interest…）不与稿件主题匹配，
 *     它们是期刊定位而非稿件属性；混进来会让综合刊一边倒
 *   - 拿不到官方统计的字段只用于排序，绝不升级成阻断
 */
import { readFileSync } from 'node:fs'

const DATA_URL = new URL('../../../data/journals.json', import.meta.url)

/** 体裁/定位词：描述期刊是什么，不描述稿件写了什么。 */
const META = new Set([
  'multidisciplinary', 'broad interest', 'wide readership', 'conceptual advance', 'breakthrough',
  'solid advance', 'broad scope', 'sound science', 'no novelty requirement', 'significance',
  'mechanism', 'open peer review', 'data note', 'applied physics', 'interdisciplinary',
  'practice-changing', 'patient', 'evidence', 'translation', 'quantitative', 'fundamental',
])

const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'with', 'in', 'on', 'to', 'from', 'by', 'as', 'at',
  'is', 'are', 'was', 'were', 'this', 'that', 'these', 'those', 'we', 'our', 'study', 'using',
  'based', 'via', 'here', 'show', 'shows', 'shown', 'new', 'novel', 'can', 'be', 'it',
])

/** 轻量词干：只处理最常见的复数/进行时，够用于匹配，不引入依赖。 */
function stem(word) {
  const w = String(word).toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (w.length <= 3) return w
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.endsWith('ing')) return w.slice(0, -3)
  if (w.endsWith('ed')) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

function tokens(text) {
  return String(text || '')
    .split(/[\s,;:.()[\]{}/\\|"'`!?*+=<>–—-]+/)
    .map(stem)
    .filter((w) => w.length > 2 && !STOP.has(w))
}

/** 稿件 -> 词集。标题权重更高，靠重复实现。 */
export function profileQuery(input = {}) {
  const title = String(input.title || '')
  const abstract = String(input.abstract || '')
  const keywords = Array.isArray(input.keywords) ? input.keywords.join(' ') : String(input.keywords || '')
  const bag = new Map()
  const add = (list, weight) => {
    for (const w of list) bag.set(w, (bag.get(w) || 0) + weight)
  }
  add(tokens(title), 3)
  add(tokens(keywords), 2)
  add(tokens(abstract), 1)
  return {
    bag,
    words: new Set(bag.keys()),
    design: input.design || null,
    band: Number.isFinite(input.band) ? input.band : null,
    words_n: Number.isFinite(input.words) ? input.words : null,
    figures: Number.isFinite(input.figures) ? input.figures : null,
    refs: Number.isFinite(input.refs) ? input.refs : null,
    needsRegisteredReport: input.needsRegisteredReport === true,
    needsPortableReview: input.needsPortableReview === true,
  }
}

function topicKeywords(journal) {
  return (journal.scopeKeywords || []).filter((k) => !META.has(String(k).toLowerCase()))
}

/** 单项打分：全部返回 0..1，便于加权与展示。 */
function scoreScope(journal, q) {
  const topics = topicKeywords(journal)
  if (topics.length === 0) {
    /* 综合刊全是体裁词 → 略低于中性：它不排斥任何主题，但也没有主题证据支撑 */
    return { value: 0.45, matched: [], missing: [], generic: true }
  }
  const matched = []
  const missing = []
  for (const topic of topics) {
    const parts = tokens(topic)
    const hit = parts.length > 0 && parts.every((w) => q.words.has(w))
    if (hit) matched.push(topic)
    else missing.push(topic)
  }
  const denom = Math.min(topics.length, 3)
  return { value: Math.min(1, matched.length / denom), matched, missing }
}

function scoreDesign(journal, q) {
  if (!q.design) return { value: 0.6, note: '未指定研究设计' }
  const designs = journal.designs || []
  if (designs.includes(q.design)) return { value: 1 }
  /* 观察性 ↔ 计算/理论之间常有部分兼容，给折中分而不是零 */
  const soft = new Set(['observational', 'computational', 'meta-analysis', 'theory'])
  if (soft.has(q.design) && designs.some((d) => soft.has(d))) return { value: 0.45 }
  return { value: 0.1 }
}

function scoreBand(journal, q) {
  if (!q.band) return { value: 0.6, note: '未指定稿件档位' }
  const gap = journal.band - q.band
  if (gap === 0) return { value: 1 }
  if (gap === 1) return { value: 0.75 }
  if (gap === -1) return { value: 0.85 }
  if (gap === 2) return { value: 0.35 }
  if (gap === -2) return { value: 0.5 }
  return { value: 0.1 }
}

function scoreFormat(journal, q) {
  const limits = journal.limits || {}
  const over = []
  const check = (name, limit, actual) => {
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(actual)) return
    if (actual > limit) over.push({ name, limit, actual, ratio: actual / limit })
  }
  check('words', limits.words, q.words_n)
  check('figures', limits.figures, q.figures)
  check('refs', limits.refs, q.refs)
  if (over.length === 0) return { value: 1, over }
  const worst = Math.max(...over.map((o) => o.ratio))
  /* 超限是真实 desk reject 触发点，但没有官方硬数字，所以只降到 0.05 而不输出阻断 */
  return { value: worst > 1.2 ? 0.05 : 0.3, over }
}

function scoreAcceleration(journal, q) {
  if (!q.needsRegisteredReport && !q.needsPortableReview) return { value: 0.5 }
  const wants = []
  if (q.needsRegisteredReport && journal.registeredReports) wants.push('registered-reports')
  if (q.needsPortableReview && (journal.portableReview || []).length > 0) wants.push('portable-review')
  if (wants.length > 0) return { value: 1, wants }
  return { value: 0, wants: [] }
}

const WEIGHTS = { scope: 0.45, design: 0.20, band: 0.15, format: 0.10, acceleration: 0.10 }

/**
 * 有实证画像时的权重：把"期刊自己说喜欢什么"（scope）让位给"它实际在发什么"（empirical）。
 * 实证层缺失（OpenAlex 失败/无 ISSN）时退回 WEIGHTS，不假装有数据。
 */
const WEIGHTS_WITH_INTEL = { scope: 0.28, empirical: 0.32, design: 0.18, band: 0.12, format: 0.06, acceleration: 0.04 }

const clamp01 = (x) => Math.max(0, Math.min(1, x))

/** 子领域 id 规范形：历史画像存过 `subfields/1312`，稿件侧是 `1312`，比较前必须归一。 */
const normId = (id) => {
  const s = String(id || '')
  const cut = s.lastIndexOf('/')
  return cut === -1 ? s : s.slice(cut + 1)
}

/**
 * 实证命中分：该刊近两年在你这个子领域发了多少比例的论文。
 *
 * 为什么不能只看绝对值：综合刊的最大子领域也只有 9%（Nature 的 Molecular Biology），
 * 而专刊可以有 45%。所以取"绝对值"与"相对该刊最大子领域"两路平均，
 * 再按 confidence 向 0.5 收缩 —— 载文量小或覆盖率低的画像不该主导排序。
 */
export function scoreEmpirical(intel) {
  if (!intel || !intel.profile || !intel.manuscriptMap) return null
  const dist = intel.profile.bySubfield || []
  if (dist.length === 0) return null
  const map = intel.manuscriptMap
  if (!map.subfields || map.subfields.length === 0) return null

  const byId = new Map(dist.map((s) => [normId(s.id), s]))
  const hits = map.subfields.map((sf) => byId.get(normId(sf.id))).filter(Boolean)
  if (hits.length === 0) {
    return { value: 0, hitShare: 0, hits: [], maxShare: dist[0].share, confidence: intel.profile.confidence || 'low', window: intel.profile.window, totalWorks: intel.profile.totalWorks }
  }
  const hitShare = hits.reduce((s, h) => s + h.share, 0)
  const maxShare = dist[0].share || 0
  const absScore = clamp01(hitShare / 0.10)
  const relScore = maxShare > 0 ? clamp01(hitShare / maxShare) : 0
  let value = clamp01(0.5 * absScore + 0.5 * relScore)

  const coverage = intel.profile.coverage
  const confident = (intel.profile.totalWorks || 0) >= 500 && (coverage || 0) >= 0.9
  if (!confident) value = 0.5 + (value - 0.5) * 0.5

  return {
    value,
    hitShare: Math.round(hitShare * 10000) / 10000,
    hits: hits.map((h) => ({ id: h.id, name: h.name, share: h.share })),
    maxShare,
    confidence: intel.profile.confidence || (confident ? 'high' : 'medium'),
    window: intel.profile.window,
    totalWorks: intel.profile.totalWorks,
  }
}

const STALE_MS = 365 * 86400000

/** 单本期刊打分。
 *
 * @param intel {profile, manuscriptMap} | null —— 传入则启用实证层（该刊近两年真实产出命中）
 */
export function scoreJournal(journal, q, { now = Date.now(), intel = null } = {}) {
  const scope = scoreScope(journal, q)
  const design = scoreDesign(journal, q)
  const band = scoreBand(journal, q)
  const format = scoreFormat(journal, q)
  const acceleration = scoreAcceleration(journal, q)
  const empirical = intel ? scoreEmpirical(intel) : null

  const W = empirical ? WEIGHTS_WITH_INTEL : WEIGHTS
  const score = W.scope * scope.value
    + (empirical ? W.empirical * empirical.value : 0)
    + W.design * design.value
    + W.band * band.value
    + W.format * format.value
    + W.acceleration * acceleration.value

  const risks = []
  if (format.over.length > 0) {
    risks.push(`超限：${format.over.map((o) => `${o.name} ${o.actual}>${o.limit}`).join('，')}（常见 desk reject 触发点）`)
  }
  if (Number.isFinite(q.band) && Math.abs(journal.band - q.band) >= 2) {
    const gap = journal.band - q.band
    risks.push(gap > 0
      ? `档位高 ${gap} 级：编辑很可能以 scope/importance 直接退回（不送外审）`
      : `降档 ${-gap} 级：这是保底落点，非时间压力下不建议首选`)
  }
  if (q.design && design.value <= 0.1) {
    risks.push(`研究设计不匹配：该刊常规接受 ${(journal.designs || []).join('/')}`)
  }
  if (q.needsRegisteredReport && !journal.registeredReports) risks.push('该刊不支持 Registered Reports')
  if (q.needsPortableReview && (journal.portableReview || []).length === 0) risks.push('该刊不接 portable review')
  if (journal.type === 'conference') risks.push('会议制：周期由截稿日历决定，不能滚动投稿')
  if (journal.verifiedAt && now - Date.parse(journal.verifiedAt) > STALE_MS) {
    risks.push('期刊画像超过 12 个月未核验，限额与政策需自查')
  }
  /* 实证层只在"该刊确实几乎不发你这类工作"时才升级为风险，避免噪声 */
  if (empirical) {
    if (empirical.hitShare === 0) {
      risks.push(`该刊近两年在 ${empirical.window?.from || ''} 起的 ${empirical.totalWorks || 0} 篇论文中，没有一篇落在你的子领域：scope 不匹配风险高`)
    } else if (empirical.hitShare < 0.01) {
      risks.push(`你的子领域仅占该刊近两年产出的 ${(empirical.hitShare * 100).toFixed(1)}%：送审概率低，cover letter 需正面说明读者相关性`)
    }
    if (empirical.confidence === 'low') risks.push('实证画像样本量/覆盖率偏低，主题命中仅供参考')
  }

  return {
    id: journal.id,
    name: journal.name,
    type: journal.type || 'journal',
    band: journal.band,
    score: Math.round(score * 1000) / 1000,
    weightMode: empirical ? 'empirical' : 'declared',
    parts: {
      scope: Math.round(scope.value * 100) / 100,
      ...(empirical ? { empirical: Math.round(empirical.value * 100) / 100 } : {}),
      design: Math.round(design.value * 100) / 100,
      band: Math.round(band.value * 100) / 100,
      format: Math.round(format.value * 100) / 100,
      acceleration: Math.round(acceleration.value * 100) / 100,
    },
    ...(empirical ? {
      topicFootprint: {
        hitShare: empirical.hitShare,
        hitSubfields: empirical.hits,
        maxSubfieldShare: empirical.maxShare,
        window: empirical.window,
        totalWorks: empirical.totalWorks,
        confidence: empirical.confidence,
      },
    } : {}),
    matchedTopics: scope.matched,
    missingTopics: scope.missing.slice(0, 3),
    genericScope: scope.generic === true,
    risks,
    estimate: {
      deskDays: journal.firstDecisionDays?.desk ?? null,
      reviewDays: journal.firstDecisionDays?.afterReview ?? null,
      deskRejectRate: journal.deskRejectRate?.value ?? null,
      acceptRate: journal.acceptRate?.value ?? null,
      note: '均为量级估计，非承诺',
    },
    acceleration: {
      registeredReports: journal.registeredReports === true,
      portableReview: journal.portableReview || [],
      preprint: journal.preprint || null,
      transferChain: journal.transferChain || [],
    },
  }
}

/**
 * 三档推荐。
 *  reach  = 档位更高，且**有真实主题命中**（没有主题证据的综合刊不算冲刺）
 *  target = 档位匹配、分数够
 *  safe   = 降一档的落点（band 低 1–2），按分数排序 —— 不是"降到地板刊"
 */
export function rankJournals(journals, query, { perTier = 5, intelFor = null } = {}) {
  const q = query && query.bag ? query : profileQuery(query)
  const scored = journals.map((j) => scoreJournal(j, q, { intel: intelFor ? intelFor(j) : null }))
  const byScore = (a, b) => b.score - a.score

  const target = []
  const reach = []
  const safe = []
  for (const s of scored) {
    const gap = Number.isFinite(q.band) ? s.band - q.band : 0
    /* 有实证层时用"该刊实际发不发你这类"作证据，比人工 scope 词可靠 */
    const topicEvidence = s.parts.empirical !== undefined
      ? (s.parts.empirical >= 0.4 || s.parts.scope >= 0.7)
      : s.parts.scope >= 0.5
    const formatOk = s.parts.format >= 1
    if (s.score >= 0.55 && gap >= -1 && gap <= 0) {
      target.push(s)
    } else if (s.score >= 0.42 && gap >= 1 && topicEvidence) {
      reach.push(s)
    } else if (Number.isFinite(q.band) && gap <= -1 && gap >= -3
      && formatOk && s.parts.design >= 0.4 && s.parts.scope >= 0.4) {
      /* 降档落点也必须设计兼容、有主题依据，否则会推出"生物刊接化学稿"这类噪声 */
      safe.push(s)
    } else if (s.score >= 0.68) {
      safe.push(s)
    }
  }
  /* 兜底：档位未知时按绝对分数切成三段 */
  if (target.length + reach.length + safe.length === 0) {
    scored.sort(byScore)
    scored.slice(0, perTier).forEach((s) => target.push(s))
    scored.slice(perTier, perTier * 2).forEach((s) => safe.push(s))
  }
  return {
    reach: reach.sort(byScore).slice(0, perTier),
    target: target.sort(byScore).slice(0, perTier),
    safe: safe.sort(byScore).slice(0, perTier),
    considered: scored.length,
  }
}

/** 读随包的期刊画像（不读用户数据根，保证升级后一致）。 */
export function loadJournals() {
  const raw = JSON.parse(readFileSync(DATA_URL, 'utf8'))
  return {
    meta: raw.$meta || {},
    journals: raw.journals || [],
  }
}

export function getJournal(id) {
  const { journals } = loadJournals()
  return journals.find((j) => j.id === id) || null
}

export default { profileQuery, scoreJournal, rankJournals, loadJournals, getJournal }
