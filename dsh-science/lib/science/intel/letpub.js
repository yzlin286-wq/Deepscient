/**
 * LetPub：中国作者视角的投稿经验（审稿速度、录用比例、分区、版面费）。
 *
 * 站点特征（实测）：
 *   - 纯 HTML + UTF-8，无需 JS 渲染；但必须按 UTF-8 解码（按 GBK 解会全是乱码）
 *   - 搜索页 → journalid，详情页 → 字段区
 *   - 字段区结构：[字段名, "网友分享经验：", 值]；值可能为空（该刊无人分享），空就 null
 *   - 同名歧义严重：搜 "nature" 会先命中 "NATURE REVIEWS MOLECULAR CELL BIOLOGY"，
 *     所以必须用详情页里的刊名回验，不能只信搜索顺序
 *
 * 定位：LetPub 是网友自由文本（"多是约稿"），只作弱信号展示，绝不进阻断逻辑。
 */

export const source = 'letpub'
const BASE = 'https://www.letpub.com.cn/index.php'

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '').replace(/^the/, '')

export function supports() {
  return true
}

function toLines(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 审稿速度自由文本 → 结构化区间。"较慢,6-12周" → {band:'slow', weeksMin:6, weeksMax:12} */
/** 值可能为空或噪声：广告行、破折号、`n/a` 一律当无数据，绝不当 0。 */
const NOISE = /LetPub|助力|润色|套餐|广告|投稿协助|中译英|极速|全流程|毕业|升职|辅助|编辑服务|SCI论文/

export function parseSpeed(text) {
  if (!text) return null
  const raw = String(text).trim()
  if (/^[-/–—]$/.test(raw)) return null
  const band = /较慢|slow/i.test(raw) ? 'slow'
    : /较快|fast/i.test(raw) ? 'fast'
      : /一般|moderate|average/i.test(raw) ? 'moderate' : 'unknown'
  const weeks = raw.match(/(\d+)\s*[-–~]\s*(\d+)\s*(?:周|weeks?)/i)
  const months = raw.match(/(\d+)\s*[-–~]\s*(\d+)\s*个?月/i)
  const singleW = raw.match(/([\d.]+)\s*(?:周|weeks?)/i)
  const singleM = raw.match(/([\d.]+)\s*个?月/i)
  let weeksMin = null
  let weeksMax = null
  if (weeks) { weeksMin = Number(weeks[1]); weeksMax = Number(weeks[2]) }
  else if (months) { weeksMin = Number(months[1]) * 4; weeksMax = Number(months[2]) * 4 }
  else if (singleW) { weeksMin = weeksMax = Number(singleW[1]) }
  else if (singleM) { weeksMin = weeksMax = Number(singleM[1]) * 4 }
  if (band === 'unknown' && weeksMin === null) return null
  return { band, weeksMin, weeksMax, raw }
}

/** 录用比例自由文本 → 分类。自由投稿命中"多是约稿"是极强的择刊信号。 */
export function parseAcceptRate(text) {
  if (!text) return null
  const raw = String(text).trim()
  if (/^[-/–—]$/.test(raw)) return null
  let kind = 'unknown'
  if (/约稿|invited|commissioned/i.test(raw)) kind = 'invited-only'
  else if (/容易|高|easy|high/i.test(raw)) kind = 'relatively-high'
  else if (/较难|难|低|difficult|low|hard/i.test(raw)) kind = 'low'
  else if (/适中|一般|moderate|medium/i.test(raw)) kind = 'medium'
  const pct = raw.match(/([\d.]+)\s*%/)
  const percent = pct ? Number(pct[1]) : null
  if (kind === 'unknown' && percent === null) return null
  return { kind, percent, raw }
}

export function parseDetail(html) {
  const lines = toLines(html)
  const title = (String(html).match(/<title>([^<]{0,200})<\/title>/i)?.[1] || '').trim()
  const journalName = title.match(/】\s*(.+?)\s*影响因子/)?.[1]?.trim() || null

  const after = (label, maxScan = 5) => {
    const i = lines.findIndex((l) => l.includes(label))
    if (i < 0) return null
    for (let k = i + 1; k < Math.min(i + 1 + maxScan, lines.length); k += 1) {
      const line = lines[k]
      if (/^网友分享经验[：:]?$/.test(line) || /^(平均|SCI|影响因子|中科院|版面费|偏重|期刊)/.test(line)) continue
      if (NOISE.test(line)) continue
      if (/^[-/–—]$|^n\/?a$/i.test(line)) return null
      if (line.length <= 40) return line
    }
    return null
  }

  const speedText = after('平均审稿速度')
  const acceptText = after('平均录用比例')
  const impactFactor = Number((String(html).match(/影响因子([\d.]+)分/) || [])[1]) || null
  const casZone = after('中科院分区', 6)
  const sciIndexed = lines.some((l) => /^SCI期刊收录coverage/.test(l)) && lines.some((l) => /^是$/.test(l))

  return {
    journalName,
    reviewSpeed: parseSpeed(speedText),
    acceptRate: parseAcceptRate(acceptText),
    impactFactor,
    casZone: casZone || null,
    sciIndexed: Boolean(sciIndexed),
    raw: { speedText, acceptText, title: title.slice(0, 160) },
  }
}

/** 从搜索页取 (刊名, journalid) 配对。 */
export function parseSearch(html) {
  const out = []
  const re = /<a[^>]*journalid=(\d+)[^>]*>([\s\S]{1,120}?)<\/a>/gi
  let m
  while ((m = re.exec(String(html))) !== null) {
    const name = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
    if (name && name.length >= 3 && /[a-zA-Z]/.test(name)) out.push({ id: m[1], name })
  }
  if (out.length === 0) {
    for (const hit of String(html).matchAll(/journalid=(\d+)/g)) out.push({ id: hit[1], name: null })
  }
  return [...new Map(out.map((o) => [o.id, o])).values()]
}

export async function fetchOne(journal, { client } = {}) {
  if (!client) return { ok: false, error: 'client-missing' }
  const target = norm(journal.name)

  /* ISSN 检索是精确的（实测 searchissn=0028-0836 直接命中 Nature 主刊），
     刊名检索会被同名子刊淹没（搜 "Nature" 前 10 条全是 Nature Reviews *）。 */
  const searchUrls = []
  if (journal.issn) searchUrls.push(`${BASE}?page=journalapp&view=search&searchissn=${encodeURIComponent(journal.issn)}`)
  searchUrls.push(`${BASE}?page=journalapp&view=search&searchname=${encodeURIComponent(journal.name)}`)

  let candidates = []
  for (const searchUrl of searchUrls) {
    try {
      const res = await client.text(searchUrl, { accept: 'text/html' })
      if (!res.ok && res.status !== 200) continue
      const found = parseSearch(res.text)
      if (found.length > 0) { candidates = found; break }
    } catch { /* 试下一个检索方式 */ }
  }
  if (candidates.length === 0) return { ok: false, error: 'no-search-results' }

  /* 先按搜索页刊名精确匹配；匹配不到再用详情页刊名回验，最多试 3 个（0.3rps，代价可控） */
  const exact = candidates.filter((c) => c.name && norm(c.name) === target)
  const queue = (exact.length > 0 ? exact : candidates).slice(0, exact.length > 0 ? 2 : 3)

  for (const cand of queue) {
    try {
      const url = `${BASE}?journalid=${cand.id}&page=journalapp&view=detail`
      const res = await client.text(url, { accept: 'text/html' })
      if (!res.ok && res.status !== 200) continue
      const parsed = parseDetail(res.text)
      if (parsed.journalName && norm(parsed.journalName) !== target) continue
      const hasAny = parsed.reviewSpeed || parsed.acceptRate || parsed.impactFactor !== null
      if (!hasAny) continue
      return {
        ok: true,
        sampleSize: null,      /* LetPub 不公开分享条数 */
        confidence: parsed.reviewSpeed || parsed.acceptRate ? 'medium' : 'low',
        payload: { ...parsed, url, journalId: cand.id },
      }
    } catch { /* 试下一个候选 */ }
  }
  return { ok: false, error: 'no-matching-detail-page' }
}

/** 连通性探针：用 ISSN 检索一本必定收录的刊，确认能拿到解析出的刊名。 */
export async function probe(client, { timeoutMs = 20000 } = {}) {
  const started = Date.now()
  try {
    const res = await client.text('https://www.letpub.com.cn/index.php?page=journalapp&view=search&searchissn=0028-0836', { timeoutMs })
    const text = res.text || ''
    const parsed = /NATURE/i.test(text) ? 1 : 0
    return { ok: res.ok && parsed === 1, ...(Number.isFinite(res.status) ? { status: res.status } : {}), ms: Date.now() - started, parsed }
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error.message }
  }
}

export default { source, supports, fetchOne, parseDetail, parseSearch, parseSpeed, parseAcceptRate, probe }
