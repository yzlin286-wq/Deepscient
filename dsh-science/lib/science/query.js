/**
 * 检索式：一份 DSL，翻成每个源的原生语法。
 *
 * DSL 形状：
 *   { blocks: [ ['protein folding', 'protein structure prediction'], ['diffusion model'] ],
 *     filters: { yearFrom, yearTo, oaOnly, lang, type }, limit: 25 }
 * blocks 之间 AND，块内 OR。
 */

const OR_SPLIT = /\s+(?:OR|\|)\s+/i
const AND_SPLIT = /\s*(?:,|;|\bAND\b)\s*/i

/**
 * 把用户的一句话变成 DSL。
 * 规则：逗号/分号/AND = 块间；块内 OR/| = 或。
 * @param input {query?, blocks?, filters?, limit?}
 */
export function buildDsl(input = {}) {
  let blocks = Array.isArray(input.blocks) ? input.blocks.map((b) => (Array.isArray(b) ? b : [b])) : null
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!blocks && query) {
    blocks = query.split(AND_SPLIT)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => chunk.split(OR_SPLIT).map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean))
      .filter((b) => b.length > 0)
  }
  if (!blocks || blocks.length === 0) blocks = query ? [[query]] : []

  const filters = { ...(input.filters || {}) }
  if (Number.isFinite(input.yearFrom) && !filters.yearFrom) filters.yearFrom = input.yearFrom
  if (Number.isFinite(input.yearTo) && !filters.yearTo) filters.yearTo = input.yearTo
  if (input.oaOnly === true) filters.oaOnly = true
  if (input.lang && !filters.lang) filters.lang = input.lang

  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(200, input.limit)) : 25
  return {
    blocks,
    filters,
    limit,
    raw: query,
    terms: blocks.flat(),
  }
}

const q = (s) => encodeURIComponent(String(s).replace(/\s+/g, ' ').trim())

/**
 * 块 -> 检索表达式。
 *
 * 关键取舍：**单 term 块不加引号**。加了就是短语匹配，召回会塌（实测
 * "protein folding diffusion model" 带引号时十个源里只有 4 个有命中）。
 * 只有块内多 term（OR）时才逐个加引号，保证"或"的是概念而不是单词雨水。
 */
function boolBlocks(blocks) {
  return blocks
    .filter((b) => b.length > 0)
    .map((b) => {
      if (b.length === 1) return b[0]
      return '(' + b.map((t) => `"${t}"`).join(' OR ') + ')'
    })
    .join(' AND ')
}

/** PubMed 的字段标签：把多词概念展开成词间 AND，避免被当短语。 */
function pubmedBlocks(blocks) {
  const tagged = (term) => {
    if (!term.includes(' ')) return `"${term}"[tiab]`
    return '(' + term.split(/\s+/).filter(Boolean).map((w) => `"${w}"[tiab]`).join(' AND ') + ')'
  }
  return blocks
    .filter((b) => b.length > 0)
    .map((b) => '(' + b.map(tagged).join(' OR ') + ')')
    .join(' AND ')
}

/** arXiv 同理：all:"a b" 是短语，拆成 all:a AND all:b 更像用户预期。 */
function arxivBlocks(blocks) {
  const one = (term) => {
    if (!term.includes(' ')) return `all:"${term}"`
    return '(' + term.split(/\s+/).filter(Boolean).map((w) => `all:"${w}"`).join(' AND ') + ')'
  }
  return blocks
    .filter((b) => b.length > 0)
    .map((b) => (b.length === 1 ? one(b[0]) : '(' + b.map(one).join(' OR ') + ')'))
    .join(' AND ')
}

/** 纯关键词（不支持布尔或用了会变差的源）。 */
function plainTerms(blocks) {
  return blocks.flat().join(' ')
}

function openAlexDate(filters) {
  const parts = []
  if (filters.yearFrom) parts.push(`from_publication_date:${filters.yearFrom}-01-01`)
  if (filters.yearTo) parts.push(`to_publication_date:${filters.yearTo}-12-31`)
  if (filters.oaOnly) parts.push('is_oa:true')
  if (filters.type) parts.push(`type:${filters.type}`)
  if (filters.lang === 'zh') parts.push('language:zh')
  if (filters.lang === 'en') parts.push('language:en')
  return parts
}

/**
 * 生成某个源的请求描述。
 * @returns {{url:string, method?:string, body?:string, headers?:object}}
 */
export function translate(dsl, sourceId, { mailto = '', page = 1, limit } = {}) {
  const n = limit || dsl.limit || 25
  const f = dsl.filters || {}
  const bools = boolBlocks(dsl.blocks)
  const plain = plainTerms(dsl.blocks)

  switch (sourceId) {
    case 'openalex': {
      const filters = openAlexDate(f)
      const params = new URLSearchParams({
        search: bools || plain,
        'per-page': String(n),
        page: String(page),
        select: 'id,doi,title,display_name,authorships,publication_year,primary_location,best_oa_location,locations,open_access,cited_by_count,abstract_inverted_index,type,language,referenced_works_count',
      })
      if (filters.length > 0) params.set('filter', filters.join(','))
      if (mailto) params.set('mailto', mailto)
      return { url: `https://api.openalex.org/works?${params}` }
    }

    case 'crossref': {
      const params = new URLSearchParams({
        'query.bibliographic': plain,
        rows: String(n),
        offset: String((page - 1) * n),
        // 注意：Crossref 的 select 不接受 'language'（会整条 400 select-not-available）
        select: 'DOI,title,author,issued,container-title,volume,issue,page,abstract,is-referenced-by-count,link,license,type',
      })
      const filters = []
      if (f.yearFrom) filters.push(`from-pub-date:${f.yearFrom}-01-01`)
      if (f.yearTo) filters.push(`until-pub-date:${f.yearTo}-12-31`)
      if (f.type) filters.push(`type:${f.type === 'article' ? 'journal-article' : f.type}`)
      if (filters.length > 0) params.set('filter', filters.join(','))
      if (mailto) params.set('mailto', mailto)
      return { url: `https://api.crossref.org/works?${params}` }
    }

    case 'europepmc': {
      const parts = [bools || plain]
      if (f.oaOnly) parts.push('OPEN_ACCESS:y')
      if (f.yearFrom || f.yearTo) {
        const from = f.yearFrom || 1800
        const to = f.yearTo || new Date().getFullYear()
        parts.push(`(FIRST_PDATE:[${from}-01-01 TO ${to}-12-31])`)
      }
      const params = new URLSearchParams({
        query: parts.join(' AND '),
        format: 'json',
        pageSize: String(n),
        resultType: 'core',
      })
      return { url: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}` }
    }

    case 'pubmed': {
      const term = [pubmedBlocks(dsl.blocks) || plain]
      if (f.yearFrom || f.yearTo) term.push(`("${f.yearFrom || 1800}"[dp] : "${f.yearTo || 3000}"[dp])`)
      if (f.oaOnly) term.push('"free full text"[sb]')
      const params = new URLSearchParams({
        db: 'pubmed', term: term.join(' AND '), retmax: String(n), retmode: 'json', sort: 'relevance',
      })
      return { url: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params}` }
    }

    case 'arxiv': {
      const params = new URLSearchParams({
        search_query: arxivBlocks(dsl.blocks),
        start: String((page - 1) * n),
        max_results: String(n),
        sortBy: 'relevance',
      })
      return { url: `http://export.arxiv.org/api/query?${params}` }
    }

    case 'doaj': {
      const parts = [bools || plain]
      if (f.yearFrom || f.yearTo) parts.push(`year:${f.yearFrom || 1800} TO ${f.yearTo || new Date().getFullYear()}`)
      return { url: `https://doaj.org/api/search/articles/${q(parts.join(' AND '))}?pageSize=${n}` }
    }

    case 'datacite': {
      const params = new URLSearchParams({ query: plain, 'page[size]': String(n) })
      return { url: `https://api.datacite.org/dois?${params}` }
    }

    case 'zenodo': {
      const params = new URLSearchParams({ q: plain, size: String(n), sort: 'mostrecent' })
      return { url: `https://zenodo.org/api/records?${params}` }
    }

    case 'openaire': {
      const params = new URLSearchParams({ keywords: plain, format: 'json', size: String(n), page: String(page) })
      return { url: `https://api.openaire.eu/search/publications?${params}` }
    }

    default:
      throw new Error(`未知检索源: ${sourceId}`)
  }
}

/** 把 openalex 的 abstract_inverted_index 还原成文本。 */
export function invertAbstract(index) {
  if (!index || typeof index !== 'object') return null
  const slots = []
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions || []) slots[pos] = word
  }
  const text = slots.filter(Boolean).join(' ').trim()
  return text || null
}

/** 剥掉摘要里的 JATS/HTML 标签。 */
export function stripTags(input) {
  if (!input) return null
  return String(input)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#x2019;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || null
}

export default { buildDsl, translate, invertAbstract, stripTags }
