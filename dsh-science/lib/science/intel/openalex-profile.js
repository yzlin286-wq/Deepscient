/**
 * OpenAlex 实证偏好画像：该刊近 N 年实际在发什么。
 *
 * 为什么不用 journals.json 的 scopeKeywords：那是期刊"说自己喜欢什么"。
 * 这个模块给的是"它实际发了什么"，可自动更新、可跨刊比较。
 *
 * 实测踩过的两个坑（务必保留）：
 *   1. group_by 模式下 `per-page` 限制的是**返回组数**不是论文数。带 per-page=1 只会得到 1 组，
 *      不带则返回 200 组、覆盖 99.6%。所以这里绝不传 per-page。
 *   2. `sources/{id}.topics` 字段是全历史累计（Nature 的 top3 是 History of Science），
 *      完全不能反映当前偏好。必须走 works + from_publication_date + group_by。
 *   3. `group_by=primary_topic.id` 对 works 覆盖极差（Nature 近两年只 1 组），
 *      子领域级（subfield）才是可靠粒度。
 */

export const source = 'openalex'
export const WINDOW_YEARS = 2
const TOP_N = 30

export function supports(journal) {
  return Boolean(journal && journal.issn)
}

export function windowRange(now = new Date(), years = WINDOW_YEARS) {
  const to = now.toISOString().slice(0, 10)
  const from = new Date(now.getFullYear() - years, now.getMonth(), now.getDate()).toISOString().slice(0, 10)
  return { from, to }
}

/**
 * OpenAlex 的 id 有两种形态：`/works` 与 `/topics` 给完整 URL（`https://openalex.org/subfields/1312`），
 * 而 group_by 的 key 只给尾段（`1312`）。统一取尾段，否则两套数据永远对不上（命中率恒为 0）。
 */
function tidyTopicId(key) {
  const s = String(key || '').replace('https://openalex.org/', '')
  const cut = s.lastIndexOf('/')
  return cut === -1 ? s : s.slice(cut + 1)
}

const round4 = (x) => Math.round(x * 10000) / 10000

/** 载文量与覆盖率共同决定这条画像可信不可信。 */
export function confidenceFor(totalWorks, coverage) {
  if (!Number.isFinite(totalWorks) || totalWorks <= 0) return 'low'
  if (totalWorks >= 500 && coverage >= 0.9) return 'high'
  if (totalWorks >= 100 && coverage >= 0.7) return 'medium'
  return 'low'
}

function shapeGroups(groups, total) {
  const out = []
  let covered = 0
  for (const g of groups) {
    const count = Number(g.count) || 0
    covered += count
    out.push({ id: tidyTopicId(g.key), name: g.key_display_name || null, count, share: total > 0 ? round4(count / total) : 0 })
  }
  out.sort((a, b) => b.count - a.count)
  return { top: out.slice(0, TOP_N), covered, all: out }
}

async function groupBy(client, issn, from, level, mailto, attempts = 3) {
  const url = `https://api.openalex.org/works?filter=primary_location.source.issn:${issn},from_publication_date:${from}`
    + `&group_by=${level}${mailto ? `&mailto=${encodeURIComponent(mailto)}` : ''}`
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await client.json(url, { accept: 'application/json' })
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.error ? ` ${res.error}` : ''}`)
      return { groups: res.data?.group_by || [], total: Number(res.data?.meta?.count) || 0, fromCache: res.fromCache === true }
    } catch (error) {
      lastError = error
      /* 瞬时网络失败（fetch failed）靠短退避重试，不消耗预算：OpenAlex 按请求计费，重试便宜 */
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 700 * attempt))
    }
  }
  throw new Error(`openalex ${level}: ${lastError?.message || 'failed'}`)
}

/**
 * 抓一刊的产出分布。
 * @returns {ok, payload, sampleSize, confidence, windowFrom, windowTo} | {ok:false, error}
 */
export async function fetchOne(journal, { client, mailto = null } = {}) {
  if (!client) return { ok: false, error: 'client-missing' }
  if (!supports(journal)) return { ok: false, error: 'no-issn' }

  const { from, to } = windowRange()
  try {
    const sub = await groupBy(client, journal.issn, from, 'primary_topic.subfield.id', mailto)
    if (sub.total === 0) {
      return { ok: false, error: 'no-works-in-window', windowFrom: from, windowTo: to }
    }
    const shapedSub = shapeGroups(sub.groups, sub.total)
    const coverage = round4(shapedSub.covered / sub.total)

    /* 领域级只是粗粒度兜底，且要额外一次请求。OpenAlex 无 key 每天只有 ~100 次，
       所以只在子领域覆盖不足时才补抓，省下的额度留给更多刊。 */
    let shapedField = { top: [], all: [] }
    if (coverage < 0.8) {
      try {
        const fld = await groupBy(client, journal.issn, from, 'primary_topic.field.id', mailto)
        shapedField = shapeGroups(fld.groups, fld.total)
      } catch { /* 领域级失败不影响主数据 */ }
    }

    const confidence = confidenceFor(sub.total, coverage)

    return {
      ok: true,
      sampleSize: sub.total,
      confidence,
      windowFrom: from,
      windowTo: to,
      payload: {
        window: { from, to },
        totalWorks: sub.total,
        coverage,
        bySubfield: shapedSub.top,
        byField: shapedField.top.slice(0, 15),
      },
    }
  } catch (error) {
    return { ok: false, error: error.message, windowFrom: from, windowTo: to }
  }
}

const MAP_CACHE = new Map()
const MAP_SELECT = 'id,display_name,subfield,field'

async function topicSearch(client, term, mailto, attempts = 3) {
  const url = `https://api.openalex.org/topics?search=${encodeURIComponent(term)}&per-page=8`
    + `&select=${MAP_SELECT}${mailto ? `&mailto=${encodeURIComponent(mailto)}` : ''}`
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await client.json(url, { accept: 'application/json' })
      if (!res.ok) {
        /* 429 是速率限制不是坏请求：退避要够长（3s/8s），否则重试毫无意义 */
        const error = new Error(res.status === 429 ? 'HTTP 429 rate-limited' : `HTTP ${res.status}${res.error ? ` ${res.error}` : ''}`)
        error.status = res.status
        throw error
      }
      return res
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        const wait = error.status === 429 ? (attempt === 1 ? 3000 : 8000) : 600 * attempt
        await new Promise((r) => setTimeout(r, wait))
      }
    }
  }
  throw lastError || new Error('topic-search-failed')
}

/**
 * 把稿件映射到 OpenAlex 子领域：用 topics search 拿最相关的 topic，取其 subfield。
 * 一次调用与刊数无关，结果在进程内缓存。
 *
 * 长 query 会拖慢/打挂 search（实测 40 词的拼接 query 直接 fetch failed），
 * 所以先截断，失败再退回只用标题前 12 个词。
 */
export async function mapManuscript(doc = {}, { client, mailto = null } = {}) {
  const q = [doc.title, ...(doc.keywords || [])].filter(Boolean).join(' ').trim()
  if (!q) return { subfields: [], topics: [], query: '' }
  if (!client) return { subfields: [], topics: [], query: q, error: 'client-missing' }

  const key = q.toLowerCase().replace(/\s+/g, ' ').slice(0, 180)
  if (MAP_CACHE.has(key)) return MAP_CACHE.get(key)

  /* OpenAlex topics search 对长串几乎不返回结果：先用短关键词，再退标题片段，最后才用整串 */
  const tries = []
  const kws = (doc.keywords || []).filter(Boolean).map((k) => String(k).toLowerCase())
  if (kws.length > 0) tries.push(kws.slice(0, 4).join(' ').slice(0, 120))
  const titleWords = String(doc.title || '').split(/\s+/).filter(Boolean)
  if (titleWords.length > 2) tries.push(titleWords.slice(0, 9).join(' ').toLowerCase().slice(0, 120))
  tries.push(key)

  let res = null
  let error = null
  let usedTerm = null
  for (const term of [...new Set(tries)]) {
    try {
      const r = await topicSearch(client, term, mailto)
      if ((r.data?.results || []).length > 0) { res = r; usedTerm = term; error = null; break }
      res = r
      usedTerm = term
    } catch (e) {
      error = e.message
    }
  }
  if (!res) return { subfields: [], topics: [], query: key, error }

  const topics = (res.data?.results || []).map((t) => ({
    id: tidyTopicId(t.id),
    name: t.display_name,
    subfield: t.subfield ? { id: tidyTopicId(t.subfield.id), name: t.subfield.display_name } : null,
    field: t.field ? { id: tidyTopicId(t.field.id), name: t.field.display_name } : null,
    score: Number(t.score) || null,
  }))
  const subfields = [...new Map(topics.filter((t) => t.subfield).map((t) => [t.subfield.id, t.subfield])).values()]
  const out = { subfields, topics, query: usedTerm || key, ...(topics.length === 0 ? { error: 'no-topic-match' } : {}) }
  MAP_CACHE.set(key, out)
  return out
}

/** 子领域 id 的规范形（纯尾段）。历史数据存过 `subfields/1312`，比较时必须先归一化。 */
export function normSubfieldId(id) {
  const s = String(id || '')
  const cut = s.lastIndexOf('/')
  return cut === -1 ? s : s.slice(cut + 1)
}

/** 稿件子领域命中该刊分布的比例。 */
export function hitShare(profile, manuscriptMap) {
  const dist = new Map((profile?.bySubfield || []).map((s) => [normSubfieldId(s.id), s]))
  const hits = []
  for (const sf of manuscriptMap?.subfields || []) {
    const row = dist.get(normSubfieldId(sf.id))
    if (row) hits.push({ id: normSubfieldId(sf.id), name: row.name || sf.name, share: row.share, count: row.count })
  }
  hits.sort((a, b) => b.share - a.share)
  return { share: round4(hits.reduce((s, h) => s + h.share, 0)), hits }
}

/** 连通性探针：查一个固定 DOI。比打 group_by 便宜（1 次请求 vs 2 次）。 */
export async function probe(client, { mailto = null, timeoutMs = 15000 } = {}) {
  const started = Date.now()
  const url = 'https://api.openalex.org/works?filter=doi:10.1038/nature12373&select=id,doi&per-page=1'
    + (mailto ? `&mailto=${encodeURIComponent(mailto)}` : '')
  try {
    const res = await client.json(url, { accept: 'application/json', timeoutMs })
    const parsed = (res.data?.results || []).length
    return { ok: res.ok && parsed > 0, ...(Number.isFinite(res.status) ? { status: res.status } : {}), ms: Date.now() - started, parsed }
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error.message }
  }
}

export default { source, supports, fetchOne, mapManuscript, hitShare, windowRange, confidenceFor, normSubfieldId, probe, WINDOW_YEARS }
