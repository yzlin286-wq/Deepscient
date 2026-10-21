/**
 * 新颖性检查（scoop check）：投稿前确认真没人做过同一件事。
 *
 * 只做可计算的部分：近邻文献的重叠度、是否近期高重叠、摘要里有没有写明空白。
 * "你的工作到底新在哪"必须由 agent 读完 science-top-journal-writing 后判断。
 */

const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'with', 'in', 'on', 'to', 'from', 'by', 'as', 'at',
  'is', 'are', 'was', 'were', 'this', 'that', 'these', 'those', 'we', 'our', 'using', 'based',
  'via', 'here', 'new', 'novel', 'study', 'analysis', 'effect', 'effects', 'role', 'via',
])

function stem(w) {
  const s = String(w).toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (s.length <= 3) return s
  if (s.endsWith('ies')) return `${s.slice(0, -3)}y`
  if (s.endsWith('ing')) return s.slice(0, -3)
  if (s.endsWith('ed')) return s.slice(0, -2)
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1)
  return s
}

export function titleTokens(text) {
  return String(text || '')
    .split(/[\s,;:.()[\]{}/\\|"'`!?*+=<>–—-]+/)
    .map(stem)
    .filter((w) => w.length > 2 && !STOP.has(w))
}

/** 标题重叠：Jaccard，但只用较短一方做分母，避免长标题被系统性压低。 */
export function overlap(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter += 1
  return inter / Math.min(A.size, B.size)
}

const GAP_PATTERNS = [
  /remain(s|ed)?\s+(unknown|unclear|unresolved|contested|poorly understood)/i,
  /(has|have)\s+not\s+been\s+(studied|tested|measured|established|explored)/i,
  /(little|no)\s+is\s+known/i,
  /(still|largely)\s+(unclear|unknown|unexplored)/i,
  /(lack|lacks|lacking)\s+(of\s+)?(data|evidence|consensus|understanding)/i,
  /(尚未|仍不清楚|仍是空白|缺乏.{0,6}(证据|共识|数据)|未见报道)/,
]

export function detectGap(text) {
  const src = String(text || '')
  for (const re of GAP_PATTERNS) {
    const m = src.match(re)
    if (m) return { stated: true, evidence: m[0] }
  }
  return { stated: false, evidence: null }
}

/**
 * @param input {title, abstract, keywords, sinceYear, limit}
 * @param deps  {pipeline}
 */
export async function checkNovelty(input = {}, deps = {}) {
  const { pipeline } = deps
  if (!pipeline) throw new Error('检索运行时未就绪，无法做 scoop check')

  const myTokens = titleTokens(`${input.title || ''} ${(input.keywords || []).join(' ')}`)
  const gap = detectGap(input.abstract)
  if (myTokens.length === 0) {
    throw new Error('标题与关键词里没有可检索的实词，先给一个具体标题')
  }

  /* 单块 OR：召回优先，重叠度在后面筛 */
  const blocks = [myTokens.slice(0, 6)]
  const report = await pipeline.search(
    { blocks, yearFrom: input.sinceYear || null, limit: Math.max(10, Math.min(50, input.limit || 20)) },
    { limit: Math.max(10, Math.min(50, input.limit || 20)), persist: true, returnLimit: 40 },
  )

  const scored = (report.records || []).map((r) => ({
    title: r.title,
    doi: r.doi || null,
    year: r.year || null,
    venue: r.venue || null,
    sources: r.sources || [],
    overlap: Math.round(overlap(myTokens, titleTokens(r.title)) * 100) / 100,
  })).sort((a, b) => b.overlap - a.overlap || (b.year || 0) - (a.year || 0))

  const closest = scored.slice(0, 8)
  const maxOverlap = closest.length > 0 ? closest[0].overlap : 0
  const nowYear = new Date().getFullYear()
  const recentHigh = closest.filter((c) => c.overlap >= 0.5 && (c.year || 0) >= nowYear - 2)

  let scoopRisk = 'low'
  if (recentHigh.length > 0) scoopRisk = 'high'
  else if (maxOverlap >= 0.5) scoopRisk = 'medium'
  else if (maxOverlap >= 0.34) scoopRisk = 'low-medium'
  else scoopRisk = 'low'

  const verdict = scoopRisk === 'high'
    ? '近两年存在标题高度重叠的工作：投稿前必须明确差异化（不同人群/机制/量级），并在引言里正面处理'
    : scoopRisk === 'medium'
      ? '存在高度重叠的较旧工作：确认你的增量在哪（新数据/新机制/新条件），别把别人的结论重做一遍'
      : '检索未发现高重叠的近邻工作：gap 站得住，但结论只建立在本次检索的源与时间窗上'

  return {
    scoopRisk,
    verdict,
    maxOverlap,
    gap: { stated: gap.stated, evidence: gap.evidence },
    closest,
    searched: {
      total: report.total,
      ms: report.ms,
      perSource: report.perSource.map((s) => ({ id: s.id, count: s.count, ok: s.ok })),
      sinceYear: input.sinceYear || null,
      tokens: myTokens.slice(0, 6),
    },
    caveat: '只覆盖已接入的十个元数据源；预印本与会议论文的更新时间差可能造成漏检。',
  }
}

export default { checkNovelty, detectGap, overlap, titleTokens }
