/**
 * 归一化记录：所有源都吐这一个形状，下游（去重、排序、落库、证据链）只认它。
 *
 * 字段命名对齐 OpenAlex / Crossref 的公共交集，避免每接一个源就改一遍 schema。
 */

const DOI_PREFIX = /^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i

/** DOI 归一：去前缀、去尾部标点、小写。 */
export function normalizeDoi(input) {
  if (!input) return null
  let value = String(input).trim()
  value = value.replace(DOI_PREFIX, '')
  value = value.replace(/^doi:\s*/i, '')
  value = value.replace(/[)\].,;'"\s]+$/, '')
  if (!/^10\.\d{4,9}\/\S+$/.test(value)) return null
  return value.toLowerCase()
}

/** arXiv id 归一：去版本号与 abs/pdf 前缀。 */
export function normalizeArxiv(input) {
  if (!input) return null
  let value = String(input).trim()
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/\.pdf$/i, '')
  const m = value.match(/(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i)
  return m ? m[1].toLowerCase() : null
}

/** 标题指纹：NFKC + 去标签 + 小写 + 前 8 词。 */
export function titleFingerprint(title) {
  if (!title) return null
  const cleaned = String(title)
    .normalize('NFKC')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  const words = cleaned.split(' ').filter(Boolean)
  return words.slice(0, 8).join(' ')
}

/** 作者名归一：兼容 Crossref 的 family/given 与各种字符串形式。 */
export function normalizeAuthors(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (!item) continue
    if (typeof item === 'string') {
      const value = item.trim()
      if (!value) continue
      const parts = value.split(/\s+/)
      out.push({ family: parts.length > 1 ? parts[parts.length - 1] : value, given: parts.slice(0, -1).join(' ') || null, raw: value })
      continue
    }
    const family = item.family || item.last || item.name || null
    const given = item.given || item.first || null
    if (!family && !given) {
      if (item.display_name) out.push({ family: item.display_name, given: null, raw: item.display_name })
      continue
    }
    out.push({ family: family || null, given: given || null, orcid: item.orcid || null, raw: item.raw || null })
  }
  return out
}

/** 年份归一：接受 2024 / "2024-05-01" / "2024/05"。 */
export function normalizeYear(input) {
  if (input == null) return null
  const m = String(input).match(/(1[89]\d{2}|20\d{2})/)
  return m ? Number(m[1]) : null
}

/** 把源产物压成统一记录。 */
export function makeRecord(source, raw = {}) {
  const doi = normalizeDoi(raw.doi)
  const arxivId = normalizeArxiv(raw.arxivId || raw.arxiv_id || (doi && doi.includes('arxiv') ? null : null))
  const title = (raw.title || '').replace(/\s+/g, ' ').trim() || null
  const record = {
    source,
    sourceId: raw.sourceId ? String(raw.sourceId) : null,
    doi,
    arxivId,
    pmid: raw.pmid ? String(raw.pmid) : null,
    pmcid: raw.pmcid ? String(raw.pmcid) : null,
    title,
    authors: normalizeAuthors(raw.authors),
    year: normalizeYear(raw.year),
    venue: raw.venue ? String(raw.venue).trim() : null,
    volume: raw.volume ? String(raw.volume) : null,
    issue: raw.issue ? String(raw.issue) : null,
    pages: raw.pages ? String(raw.pages) : null,
    abstract: raw.abstract ? String(raw.abstract).replace(/\s+/g, ' ').trim().slice(0, 4000) : null,
    lang: raw.lang || null,
    type: raw.type || null,
    oaStatus: raw.oaStatus || null,
    oaPdfUrl: raw.oaPdfUrl || null,
    oaLandingUrl: raw.oaLandingUrl || null,
    citedByCount: Number.isFinite(raw.citedByCount) ? raw.citedByCount : null,
    refCount: Number.isFinite(raw.refCount) ? raw.refCount : null,
    license: raw.license || null,
    url: raw.url || null,
  }
  record.fingerprint = fingerprint(record)
  return record
}

/**
 * 去重键，优先级：DOI → arXiv → 标题指纹+首作者姓+年 → 标题指纹。
 * 返回 {key, kind}，kind 用来在合并时判断哪个更权威。
 */
export function fingerprint(record) {
  if (record.doi) return `doi:${record.doi}`
  if (record.arxivId) return `arxiv:${record.arxivId}`
  const title = titleFingerprint(record.title)
  if (!title) return null
  const first = record.authors?.[0]?.family
  if (first) return `title:${title}|${String(first).toLowerCase()}`
  return `title:${title}`
}

/** 合并同一指纹的多条记录：补齐空字段而不是覆盖。 */
export function mergeRecords(records) {
  const base = { ...records[0] }
  const sources = new Set()
  for (const r of records) {
    sources.add(r.source)
    for (const [key, value] of Object.entries(r)) {
      if (key === 'source' || key === 'fingerprint') continue
      const empty = base[key] == null || base[key] === '' || (Array.isArray(base[key]) && base[key].length === 0)
      if (empty && value != null && value !== '') base[key] = value
    }
    // 引用数取最大（不同源统计口径不同，取上界更能反映影响力）
    if (Number.isFinite(r.citedByCount) && Number.isFinite(base.citedByCount)) {
      base.citedByCount = Math.max(base.citedByCount, r.citedByCount)
    }
  }
  base.sources = [...sources]
  return base
}

/**
 * 去重：同指纹合并，保留来源列表。
 * @returns {Array} 合并后的记录，附带 sources[]
 */
export function dedupe(records) {
  const groups = new Map()
  const orphans = []
  for (const r of records) {
    const key = r.fingerprint || fingerprint(r)
    if (!key) { orphans.push(r); continue }
    const bucket = groups.get(key)
    if (bucket) bucket.push(r)
    else groups.set(key, [r])
  }
  const merged = []
  for (const bucket of groups.values()) merged.push(bucket.length === 1 ? { ...bucket[0], sources: [bucket[0].source] } : mergeRecords(bucket))
  return merged.concat(orphans)
}

/**
 * 相关性打分：概念词命中为主，引用数为辅，OA 可获取性加分，年份偏离扣分。
 * 只用于排序，不参与证据判定。
 */
export function scoreRecord(record, dsl = {}, now = new Date().getFullYear()) {
  const concepts = (dsl.blocks || []).flat().map((t) => String(t).toLowerCase())
  const haystack = `${record.title || ''} ${record.abstract || ''}`.toLowerCase()
  let hit = 0
  for (const term of concepts) {
    if (!term) continue
    if (haystack.includes(term)) hit += 1
  }
  const relevance = concepts.length === 0 ? 0.5 : hit / concepts.length
  const cite = Number.isFinite(record.citedByCount) ? Math.log10(1 + record.citedByCount) / 4 : 0
  const oa = record.oaPdfUrl ? 0.2 : (record.oaStatus && record.oaStatus !== 'closed' ? 0.1 : 0)
  const age = record.year ? Math.max(0, now - record.year) : 10
  const recency = Math.max(0, 0.15 - age * 0.01)
  const meta = (record.doi ? 0.05 : 0) + (record.abstract ? 0.05 : 0)
  return Number((relevance * 1.0 + cite + oa + recency + meta).toFixed(4))
}

/** 按分数降序，返回带 score 的新数组。 */
export function rank(records, dsl) {
  return records
    .map((r) => ({ ...r, score: scoreRecord(r, dsl) }))
    .sort((a, b) => b.score - a.score || (b.citedByCount || 0) - (a.citedByCount || 0))
}

/** 参考文献行（GB/T 7714 粗排，M3 会做正式格式化）。 */
export function toGbtCitation(record) {
  const authors = (record.authors || []).map((a) => (a.family ? `${a.family}${a.given ? ' ' + a.given : ''}` : a.raw)).filter(Boolean)
  const authorPart = authors.length > 3 ? `${authors.slice(0, 3).join(', ')}, et al` : authors.join(', ')
  const year = record.year || 'n.d.'
  const venue = record.venue || ''
  const vol = record.volume ? `, ${record.volume}` : ''
  const issue = record.issue ? `(${record.issue})` : ''
  const pages = record.pages ? `: ${record.pages}` : ''
  const doi = record.doi ? ` DOI:${record.doi}.` : ''
  return `${authorPart}. ${record.title || ''}[J]. ${venue}${vol}${issue}${pages}, ${year}.${doi}`.replace(/\s+/g, ' ').trim()
}

export default {
  normalizeDoi, normalizeArxiv, titleFingerprint, normalizeAuthors, normalizeYear,
  makeRecord, fingerprint, dedupe, mergeRecords, scoreRecord, rank, toGbtCitation,
}
