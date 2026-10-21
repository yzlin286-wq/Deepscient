/**
 * 缺口矩阵：把一条 claim 放进文献里，看「谁做了什么、还缺什么」。
 *
 * ## 与 science_novelty 的分工
 *
 * - `science_novelty` 回答「我的稿子会不会被抢发」——拿标题去撞，看重叠度。
 * - 这里是**选题期**用的：拿一条 claim 去查，看这个方向在五个维度上被填了多少。
 *
 * ## 为什么是这五个维度
 *
 * 一条 claim 要变成可发表的贡献，缺的通常是这五类之一。每类都有专门的检索式与
 * 「算不算被覆盖」的判定模式，所以结论可复核：说「缺理论」，就列出查到了什么、为什么不算。
 *
 * ## 最小心
 *
 * 检索不到 ≠ 缺口。可能只是检索式太窄。所以 `covered === 0` 时 verdict 是 `gap`
 * 但**必须**带 `caveat`，绝不说「这是全新的」。
 */
import { extractLimitations } from './distill.js'

/** 五个缺口方向。`needWhen` 为 false 时该方向不成立（claim 自己已经补上了）。 */
export const GAP_PROBES = {
  theory: {
    label: '理论保证',
    what: '在明确假设下的收敛率或下界',
    build: (kw) => `${kw} convergence rate analysis bound`,
    cover: [/convergence/i, /regret/i, /\bbound(s|ed)?\b/i, /theorem/i, /\bproof\b/i, /converge/i, /收敛/],
    needWhen: (claim) => claim.evidenceKind !== 'theorem',
    why: 'claim 自身没有定理式证据时，理论是缺口',
  },
  scale: {
    label: '规模验证',
    what: '跨量级（至少三个数量级）的一致验证',
    build: (kw) => `${kw} large scale scaling law`,
    cover: [/large[- ]scale/i, /scaling/i, /billion/i, /trillion/i, /massive/i, /at scale/i, /大规模/],
    needWhen: () => true,
    why: '单点实验说服不了顶刊，规模一致性是最常见的退稿理由',
  },
  transfer: {
    label: '跨域迁移',
    what: '跨域迁移与失效边界',
    build: (kw) => `${kw} transfer cross-domain generalization`,
    cover: [/transfer/i, /cross[- ]domain/i, /generaliz/i, /out[- ]of[- ]distribution/i, /迁移/],
    needWhen: () => true,
    why: '顶刊要普适机制，只在单一设置成立的结论会被判「limited advance」',
  },
  reproduction: {
    label: '独立复现',
    what: '独立复现与分歧解释',
    build: (kw) => `${kw} reproducibility replication`,
    cover: [/reproduc/i, /replicat/i, /independent (verification|replication)/i, /复现/],
    needWhen: () => true,
    why: '代码仓的结果没有第三方复现时，可信度是审稿人的第一个问题',
  },
  benchmark: {
    label: '统一评测',
    what: '可比协议下的统一评测',
    build: (kw) => `${kw} benchmark evaluation suite`,
    cover: [/benchmark/i, /\bsuite\b/i, /leaderboard/i, /evaluation framework/i, /评测/],
    needWhen: () => true,
    why: '各仓自报数字、协议不同，是这类方向最典型的空白',
  },
}

/** 只查这几个源：arXiv 是优化方向主力，crossref/doaj/europepmc 免费且无日额度。 */
export const GAP_SOURCES = ['arxiv', 'crossref', 'doaj', 'europepmc']

const STOPWORDS = new Set([
  /* 功能词 */
  'the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'with', 'by', 'from', 'as', 'at',
  'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those', 'it', 'its',
  'we', 'our', 'us', 'they', 'their', 'than', 'instead', 'which', 'when', 'where', 'while', 'such',
  'can', 'may', 'will', 'would', 'should', 'more', 'most', 'less', 'very', 'also', 'not',
  'has', 'have', 'had', 'do', 'does', 'did', 'but', 'so', 'if', 'then', 'about', 'into',
  'over', 'under', 'between', 'both', 'each', 'across', 'within', 'without', 'only', 'even',
  /* 动词：第三人称 / 过去式 / 原形——这类词进检索式只会稀释命中 */
  'use', 'used', 'uses', 'using', 'propose', 'proposes', 'proposed', 'introduce', 'introduces', 'introduced',
  'present', 'presents', 'presented', 'achieve', 'achieves', 'achieved', 'outperform', 'outperforms', 'outperformed',
  'report', 'reports', 'reported', 'show', 'shows', 'showed', 'shown', 'improve', 'improves', 'improved',
  'reduce', 'reduces', 'reduced', 'enable', 'enables', 'enabled', 'allow', 'allows', 'allowed',
  'require', 'requires', 'required', 'work', 'works', 'worked', 'give', 'gives', 'given',
  'provide', 'provides', 'provided', 'obtain', 'obtains', 'obtained', 'demonstrate', 'demonstrates', 'demonstrated',
  'compare', 'compares', 'compared', 'reach', 'reaches', 'reached', 'beat', 'beats', 'based',
  'keep', 'keeps', 'keeping', 'kept', 'make', 'makes', 'making', 'made', 'take', 'takes', 'taking', 'took',
  'call', 'calls', 'called', 'consider', 'considered', 'assume', 'assumes', 'assumed',
  'lower', 'lowered', 'lowers', 'raise', 'raised', 'raises', 'increase', 'increased', 'decrease', 'decreased',
  'attain', 'attained', 'attaining', 'improved', 'reducing', 'reached', 'record', 'records',
  /* 通用名词：出现在每篇标题里，不构成检索特征 */
  'update', 'updates', 'method', 'methods', 'approach', 'approaches', 'technique', 'techniques',
  'version', 'case', 'step', 'steps', 'way', 'thing', 'part', 'number', 'value', 'values',
  'these', 'those', 'various', 'several', 'different', 'same', 'new', 'novel',
  /* 中文功能词 */
  '通过', '以及', '可以', '我们', '本文', '这个', '一个', '并且', '因此', '但是',
])

/**
 * 从 claim 文本里抽检索关键词。
 *
 * 按**首次出现顺序**取，不按长度：句子前半段通常是被主张的机制名词
 * （"orthogonalizing the momentum update"），后半段才是修饰语
 * （"instead of Adam-style per-parameter scaling"）。按长度排会取到修饰语，检索变空。
 *
 * 中文不做分词。中文 claim 的 `keywords` 由调用方显式提供——用空格切中文会切出
 * 「通过对动量做正交化」这种整段词，拿去检索只会更糟。这里宁可返回空并让人补。
 */
export function extractKeywords(text = '', { max = 3 } = {}) {
  const source = String(text)
  const cjk = (source.match(/[\u4e00-\u9fa5]/g) || []).length
  if (cjk > 0 && cjk / Math.max(1, source.replace(/\s/g, '').length) > 0.4) return []
  const tokens = source
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\-\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
  const seen = new Set()
  const out = []
  for (const w of tokens) {
    if (seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= max) break
  }
  return out
}

/**
 * 判断一篇命中是否「真的覆盖了该方向」——标题 + 摘要 + venue 都要看。
 * 只看标题会把 "Toward scalable optimizers" 这种漏掉。
 */
export function covers(probe, record) {
  const text = `${record.title || ''} ${record.abstract || ''} ${record.venue || ''}`
  return probe.cover.some((re) => re.test(text))
}

/**
 * 从仓库对象推「锚点关键词」——这条 claim 属于谁。
 *
 * 这一步很关键：README 里的 claim 往往只写结果（"improved the training speed record"），
 * 方法名只在仓库名和描述里。不带锚点去检索，查回来的全是泛泛的 "training speed" 文献，
 * 缺口判定就成了噪音。
 *
 * 只取仓库名末段（camelCase 会拆开）和描述里的前 2 个技术词，不做猜测性扩展。
 */
export function anchorKeywordsFromItem(item = {}) {
  const out = []
  const name = String(item.title || item.fullName || '').split('/').pop()
  if (name) {
    const parts = name
      .replace(/[._-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    out.push(...parts.slice(0, 2))
  }
  if (item.description) out.push(...extractKeywords(item.description, { max: 2 }))
  return dedupe(out).slice(0, 3)
}

function dedupe(list) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const key = String(item).toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/**
 * 主函数。
 *
 * @param claim - `{id, mechanism, prediction, evidenceKind}`
 * @param deps - `{pipeline, limit, keywords, anchorKeywords}`
 *   `anchorKeywords` 是这条 claim 所属对象的名字（如 repo 名里的 "muon"）。
 *   **必须给**：claim 句子常常只描述结果（"improved the training speed record"），
 *   不带方法名；不把方法名拼进检索式，查出来的全是泛化文献。
 * @returns `{claim, keywords, directions[], overall, caveat, degraded[]}`
 */
export async function buildGapMatrix(claim, { pipeline, limit = 8, keywords = null, anchorKeywords = null } = {}) {
  if (!pipeline) throw new Error('buildGapMatrix 需要 pipeline')
  const own = keywords && keywords.length > 0 ? keywords : extractKeywords(claim.mechanism, { max: 3 })
  const anchors = (anchorKeywords || []).filter(Boolean).map((w) => String(w).toLowerCase())
  const kws = dedupe([...anchors, ...own]).slice(0, 4)
  if (kws.length === 0) {
    return {
      claim,
      keywords: [],
      directions: [],
      overall: 'needs-keywords',
      summary: '没有可用于检索的关键词。',
      limitations: [],
      degraded: [],
      needsKeywords: true,
      caveat: '这条 claim 是中文或关键词不足，无法自动构造检索式。请显式传 keywords（英文技术词，2-4 个），'
        + '例如 ["orthogonalized momentum", "spectral norm"]。中文不做自动分词——用整段中文去检索只会更空。',
    }
  }
  const kwsAll = kws

  const directions = []
  const degraded = []

  for (const [gapType, probe] of Object.entries(GAP_PROBES)) {
    const needed = probe.needWhen(claim)
    const query = probe.build(kws.join(' '))
    const row = {
      gapType,
      label: probe.label,
      needed,
      why: probe.why,
      query,
      searchedTotal: 0,
      coveredCount: 0,
      covered: [],
      verdict: 'unknown',
      statement: '',
      whatMissing: needed ? probe.what : null,
    }

    if (!needed) {
      row.verdict = 'not-needed'
      row.statement = `claim 本身已带${probe.label === '理论保证' ? '定理式证据' : probe.label}，这个方向不缺。`
      directions.push(row)
      continue
    }

    let report = null
    try {
      report = await pipeline.search({ query, blocks: kwsAll.length > 0 ? [kwsAll] : undefined }, {
        limit, persist: false, returnLimit: Math.max(limit, 12), sources: GAP_SOURCES,
      })
    } catch (error) {
      degraded.push(`${gapType}:${String(error.message || error).slice(0, 50)}`)
      row.verdict = 'unknown'
      row.statement = `检索失败，无法判定「${probe.label}」是否有缺口。`
      directions.push(row)
      continue
    }

    const records = report?.records || []
    row.searchedTotal = report?.total ?? records.length
    const hit = records.filter((r) => covers(probe, r))
    row.coveredCount = hit.length
    row.covered = hit.slice(0, 4).map((r) => ({
      title: (r.title || '').slice(0, 120),
      year: r.year || null,
      doi: r.doi || null,
      venue: r.venue || null,
      sources: r.sources || [],
    }))

    if (row.coveredCount === 0) {
      row.verdict = 'gap'
      row.statement = report?.total > 0
        ? `检索「${query}」命中 ${report.total} 篇，其中 0 篇涉及${probe.label}。缺${probe.what}。`
        : `检索「${query}」没有任何命中。可能是真缺口，也可能是检索式太窄——先换关键词再确认。`
    } else if (row.coveredCount <= 2) {
      row.verdict = 'thin'
      row.statement = `只有 ${row.coveredCount} 篇涉及${probe.label}（${hit.slice(0, 2).map((r) => (r.title || '').slice(0, 50)).join(' / ')}），仍有空间但需要与它们明确区分。`
    } else {
      row.verdict = 'crowded'
      row.statement = `已有 ${row.coveredCount} 篇涉及${probe.label}，这不是缺口；要么换方向，要么在这些工作之上再往前一步。`
    }
    directions.push(row)
  }

  const gaps = directions.filter((d) => d.verdict === 'gap')
  const thin = directions.filter((d) => d.verdict === 'thin')
  const crowded = directions.filter((d) => d.verdict === 'crowded')

  const overall = gaps.length > 0 ? 'gap' : thin.length > 0 ? 'thin' : crowded.length > 0 ? 'crowded' : 'unknown'
  const caveat = '检索不到不等于全新。十源覆盖的是已发表与预印本，代码仓里的私有结果查不到；'
    + 'verdict=gap 只说明「用这组关键词没查到」，投稿前还要用 science_novelty 撞一次标题。'

  return {
    claim,
    keywords: kws,
    directions,
    overall,
    summary: buildSummary({ gaps, thin, crowded, directions }),
    limitations: claim.excerpt ? extractLimitations(claim.excerpt) : [],
    degraded,
    caveat,
  }
}

function buildSummary({ gaps, thin, crowded, directions }) {
  const parts = []
  if (gaps.length > 0) parts.push(`${gaps.length} 个方向是空白（${gaps.map((g) => g.label).join('、')}）`)
  if (thin.length > 0) parts.push(`${thin.length} 个方向薄弱（${thin.map((g) => g.label).join('、')}）`)
  if (crowded.length > 0) parts.push(`${crowded.length} 个方向已拥挤（${crowded.map((g) => g.label).join('、')}）`)
  const notNeeded = directions.filter((d) => d.verdict === 'not-needed').length
  if (notNeeded > 0) parts.push(`${notNeeded} 个方向本身不缺`)
  return parts.join('；') || '没有可判定的方向。'
}

/** 把矩阵压成一句可执行的话：先补哪个方向。 */
export function pickPrimaryGap(matrix) {
  const order = ['theory', 'scale', 'transfer', 'benchmark', 'reproduction']
  const candidates = matrix.directions.filter((d) => d.verdict === 'gap' || d.verdict === 'thin')
  if (candidates.length === 0) return null
  candidates.sort((a, b) => {
    const av = a.verdict === 'gap' ? 0 : 1
    const bv = b.verdict === 'gap' ? 0 : 1
    if (av !== bv) return av - bv
    return order.indexOf(a.gapType) - order.indexOf(b.gapType)
  })
  return candidates[0]
}

export default { buildGapMatrix, pickPrimaryGap, extractKeywords, covers, GAP_PROBES, GAP_SOURCES }
