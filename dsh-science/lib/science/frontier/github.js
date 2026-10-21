/**
 * GitHub 作为「新兴知识」源。
 *
 * 为什么值得接：优化理论这类方向，新方法往往先以 repo 形式出现（Muon 就是先有代码后有论文），
 * 期刊情报层看不到它，检索层只能查到已发表的东西。这一层补的是「还没写成论文的知识」。
 *
 * ## 实测约束（2026-10-20 本机探测，改动前请重测）
 *
 * | 端点 | 配额 | 备注 |
 * |---|---|---|
 * | core（repos/readme/stats/releases） | 60/h 未认证，5000/h 带 token | 次数预算，不是 rps |
 * | search/repositories | 10/min 未认证，30/min 带 token | 一次扫描最多 ~8 个 query |
 * | search/code | **401，需认证** | 不做代码级检索 |
 *
 * ## 搜索语法实测教训
 *
 * - `topic:optimization` 返回 ray / czkawka（去重工具）/ svgo（SVG 优化器）——**topic 标签语义污染，禁用**。
 * - `optimizer in:name language:python stars:>100` → 49 条，干净。
 * - `"muon optimizer"`（带引号的短语）→ 105 条，最干净。
 *
 * 所以模板只用：短语 / `in:name` / 语言 / stars 阈值 / `pushed:` 时间窗。
 */
import { createHash } from 'node:crypto'

export const HOST = 'api.github.com'
export const API = 'https://api.github.com'

/** 未认证与带 token 的配额不同，用于预估一次扫描能不能跑完。 */
export const QUOTA_LIMITS = {
  anonymous: { core: 60, search: 10, searchWindowMs: 60_000 },
  token: { core: 5000, search: 30, searchWindowMs: 60_000 },
}

/**
 * 查询模板。**不要加 `topic:`**——实测语义污染（见文件头）。
 * `{topic}` 由调用方填；`{since}` 是 `pushed:>` 的日期。
 */
export const QUERY_TEMPLATES = [
  {
    id: 'phrase',
    template: '"{topic}"',
    why: '带引号的短语，最贴近方法名本身，噪声最低',
    quality: 'high',
  },
  {
    id: 'name-python',
    template: '{topic} in:name language:python stars:>{minStars}',
    why: '名字里就有该词 + Python 实现，能过滤掉文章类仓库',
    quality: 'high',
  },
  {
    id: 'name-recent',
    template: '{topic} in:name pushed:>{since} stars:>{minStars}',
    why: '名字命中且近期有推送，用来判「还在活跃」',
    quality: 'medium',
  },
  {
    id: 'desc-theory',
    template: '{topic} in:description theorem OR convergence OR bound stars:>{minStars}',
    why: '描述里出现理论词，偏向有数学表述的仓库',
    quality: 'medium',
  },
]

/** 一次扫描最多能发几个 search 请求（留 2 个余量给重试与 probe）。 */
export function searchBudget({ token = null } = {}) {
  const limits = token ? QUOTA_LIMITS.token : QUOTA_LIMITS.anonymous
  return Math.max(1, limits.search - 2)
}

/**
 * 次数预算。与 OpenAlex 的美元预算不同，GitHub 按「次/窗口」计。
 * 每次响应都把 `x-ratelimit-remaining` / `-reset` 吸回来，本地只做兜底。
 */
export function createQuota({ token = null } = {}) {
  const limits = token ? QUOTA_LIMITS.token : QUOTA_LIMITS.anonymous
  const state = {
    token: Boolean(token),
    core: { limit: limits.core, remaining: limits.core, resetAt: null, used: 0 },
    search: { limit: limits.search, remaining: limits.search, resetAt: null, used: 0 },
  }

  /** 从响应头吸收真实余量。headers 是 client 的 makeHeaders 对象，也可能是普通对象。 */
  function absorb(kind, headers) {
    if (!headers) return
    const read = (name) => {
      if (typeof headers.get === 'function') return headers.get(name)
      const lower = name.toLowerCase()
      for (const key of Object.keys(headers)) if (key.toLowerCase() === lower) return headers[key]
      return null
    }
    const remaining = Number(read('x-ratelimit-remaining'))
    const limit = Number(read('x-ratelimit-limit'))
    const reset = Number(read('x-ratelimit-reset'))
    const bucket = state[kind]
    if (!bucket) return
    if (Number.isFinite(remaining)) bucket.remaining = remaining
    if (Number.isFinite(limit) && limit > 0) bucket.limit = limit
    if (Number.isFinite(reset)) bucket.resetAt = reset * 1000
  }

  function canSpend(kind = 'core') {
    const bucket = state[kind]
    if (!bucket) return false
    if (bucket.remaining > 0) return true
    /* 余量为 0 但窗口已过（本地时钟越界或头没吸到）→ 允许一次探测性请求 */
    return bucket.resetAt !== null && Date.now() > bucket.resetAt
  }

  function spend(kind = 'core') {
    const bucket = state[kind]
    if (bucket) {
      bucket.remaining = Math.max(0, bucket.remaining - 1)
      bucket.used += 1
    }
  }

  function snapshot() {
    return {
      authenticated: state.token,
      core: { ...state.core },
      search: { ...state.search },
      exhausted: state.core.remaining <= 0 || state.search.remaining <= 0,
    }
  }

  return { absorb, canSpend, spend, snapshot }
}

/**
 * 搜仓库。
 * @returns `{ok, status, items[], total, query, error?}`
 */
export async function searchRepos(client, { query, sort = 'stars', order = 'desc', limit = 10, token = null, quota = null, cacheTtlMs = 6 * 3600_000 } = {}) {
  if (!query) return { ok: false, status: 0, items: [], total: 0, error: 'query 为空' }
  if (quota && !quota.canSpend('search')) {
    return { ok: false, status: 0, items: [], total: 0, query, quotaExhausted: true, error: 'search 配额耗尽，等当前分钟窗口过去' }
  }
  const url = `${API}/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=${Math.min(100, limit)}`
  const res = await client.json(url, {
    headers: githubHeaders(token),
    cacheTtlMs,
  })
  if (quota) {
    quota.spend('search')
    quota.absorb('search', res.res?.headers)
  }
  if (!res.ok) {
    /* 403/429 都是配额与限流，不是坏请求 */
    const hint = res.status === 403 || res.status === 429 ? '（GitHub 限流或配额耗尽，不是坏请求）' : ''
    return { ok: false, status: res.status, items: [], total: 0, query, error: `${res.error || `HTTP ${res.status}`}${hint}` }
  }
  const items = Array.isArray(res.data?.items) ? res.data.items : []
  return {
    ok: true,
    status: res.status,
    total: Number(res.data?.total_count) || items.length,
    items: items.map(normalizeRepo),
    query,
    fromCache: res.fromCache === true,
  }
}

/** repos/{full_name} 的字段归一化，只留判断需要的。 */
export function normalizeRepo(r) {
  return {
    fullName: r.full_name,
    url: r.html_url,
    description: r.description || null,
    stars: Number(r.stargazers_count) || 0,
    forks: Number(r.forks_count) || 0,
    openIssues: Number(r.open_issues_count) || 0,
    language: r.language || null,
    topics: Array.isArray(r.topics) ? r.topics : [],
    pushedAt: r.pushed_at ? Date.parse(r.pushed_at) : null,
    createdAt: r.created_at ? Date.parse(r.created_at) : null,
    license: r.license?.spdx_id || null,
    archived: r.archived === true,
    homepage: r.homepage || null,
  }
}

/**
 * 抓单仓详情：readme + 近 52 周提交 + releases。
 * 三次 core 请求，所以只对筛过的 top N 调用。
 */
export async function repoDetail(client, { fullName, token = null, quota = null, cacheTtlMs = 12 * 3600_000 } = {}) {
  const out = { fullName, readme: null, commits52w: null, releases: null, lastReleaseAt: null, partial: [], error: null }
  if (!fullName) return { ...out, error: 'fullName 为空' }

  const guard = (kind = 'core') => {
    if (!quota) return true
    if (!quota.canSpend(kind)) return false
    quota.spend(kind)
    return true
  }

  if (guard()) {
    const res = await client.json(`${API}/repos/${fullName}/readme`, { headers: githubHeaders(token), cacheTtlMs })
    if (quota) quota.absorb('core', res.res?.headers)
    if (res.ok && res.data?.content) {
      try {
        out.readme = Buffer.from(res.data.content, res.data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')
      } catch { out.partial.push('readme-decode') }
    } else {
      out.partial.push(`readme:${res.status || res.error || 'empty'}`)
    }
  } else out.partial.push('readme:quota')

  if (guard()) {
    const res = await client.json(`${API}/repos/${fullName}/stats/participation`, { headers: githubHeaders(token), cacheTtlMs })
    if (quota) quota.absorb('core', res.res?.headers)
    /* 这个端点首次访问常返回 202（GitHub 现算缓存），不是错 */
    if (res.ok && Array.isArray(res.data?.all)) {
      out.commits52w = res.data.all.reduce((sum, n) => sum + (Number(n) || 0), 0)
    } else {
      out.partial.push(res.status === 202 ? 'participation:202-冷缓存' : `participation:${res.status || res.error}`)
    }
  } else out.partial.push('participation:quota')

  if (guard()) {
    const res = await client.json(`${API}/repos/${fullName}/releases?per_page=5`, { headers: githubHeaders(token), cacheTtlMs })
    if (quota) quota.absorb('core', res.res?.headers)
    if (res.ok && Array.isArray(res.data)) {
      out.releases = res.data.length
      const latest = res.data.find((x) => x.published_at)
      out.lastReleaseAt = latest ? Date.parse(latest.published_at) : null
    } else {
      out.partial.push(`releases:${res.status || res.error}`)
    }
  } else out.partial.push('releases:quota')

  return out
}

/** 端点探活：rate_limit 本身不计入 core 配额。 */
export async function probe(client, { timeoutMs = 15000 } = {}) {
  const res = await client.json(`${API}/rate_limit`, { timeoutMs, cacheTtlMs: 0 })
  if (!res.ok) return { ok: false, status: res.status, error: res.error, ms: 0 }
  const core = res.data?.resources?.core
  return {
    ok: true,
    status: res.status,
    remaining: core?.remaining ?? null,
    limit: core?.limit ?? null,
    resetAt: core?.reset ? core.reset * 1000 : null,
  }
}

/**
 * 可信度分：这个 repo 值不值得读。**不是**「这条路能中」。
 *
 * 六项加权，每一项都能在人眼里复核：
 * - stars 0.30（对数，5000 星封顶）
 * - 近 52 周提交 0.22（200 次封顶）
 * - 近期活跃 0.13（90 天内推送满分，365 天线性衰减到 0）
 * - 有 release 0.08（仅当最近一次发布在 12 个月内）
 * - README 有数学表述 0.12（Theorem / convergence / bound / proof / rate / 收敛）
 * - README 有论文链接 0.15（arXiv / DOI —— 「已有论文支撑」的最硬信号）
 *
 * 「有论文」权重高于「有数学词」是有意的：贴了 arXiv 链接说明作者自己认为这是研究成果，
 * 而堆数学词汇的 README 可能只是教程。
 */
export function credibilityScore({ stars = 0, commits52w = null, pushedAt = null, releases = null, lastReleaseAt = null, readme = null, paperLinks = null, archived = false, repoKind = null, now = Date.now() } = {}) {
  const signals = []

  const starScore = clamp01(Math.log10(1 + Math.max(0, stars)) / Math.log10(1 + 5000))
  signals.push({ key: 'stars', weight: 0.30, value: starScore, note: `${stars} 星` })

  const commitScore = commits52w === null || commits52w === undefined
    ? 0
    : clamp01(commits52w / 200)
  signals.push({ key: 'commits52w', weight: 0.22, value: commitScore, note: commits52w === null || commits52w === undefined ? '未取到提交统计' : `近 52 周 ${commits52w} 次提交` })

  let recencyScore = 0
  if (pushedAt) {
    const days = (now - pushedAt) / 86400000
    recencyScore = days <= 90 ? 1 : days >= 365 ? 0 : (365 - days) / (365 - 90)
  }
  signals.push({ key: 'recency', weight: 0.13, value: recencyScore, note: pushedAt ? `最近推送 ${Math.round((now - pushedAt) / 86400000)} 天前` : '无推送时间' })

  const releaseScore = (releases && lastReleaseAt && (now - lastReleaseAt) <= 365 * 86400000) ? 1 : 0
  signals.push({ key: 'release', weight: 0.08, value: releaseScore, note: releases === null ? '未取到发布记录' : `release ${releases} 个${releaseScore ? '（近 12 个月有发布）' : ''}` })

  const mathHits = readme ? countMathSignals(readme) : []
  const mathScore = Math.min(1, mathHits.length / 3)
  signals.push({ key: 'math', weight: 0.12, value: mathScore, note: mathHits.length ? `README 含 ${mathHits.join('/')}` : 'README 无数学表述' })

  const links = paperLinks ?? (readme ? findPaperLinks(readme) : [])
  const paperScore = Math.min(1, links.length / 2)
  signals.push({ key: 'hasPaper', weight: 0.15, value: paperScore, note: links.length ? `README 有 ${links.length} 个论文链接（${links.slice(0, 2).map((l) => l.kind).join(',')}）` : 'README 无论文链接' })

  let score = signals.reduce((sum, s) => sum + s.weight * s.value, 0)

  /* 教程 / 合集类仓库会因更新频繁而虚高，降权而不是剔除——有的教程确实是最好的综述 */
  if (repoKind && REPO_KIND_PENALTY[repoKind]) {
    const f = REPO_KIND_PENALTY[repoKind]
    score *= f
    signals.push({ key: 'repoKind', weight: 0, value: f, note: `被判为 ${repoKind}，分数 ×${f}` })
  }
  if (archived) {
    score *= 0.3
    signals.push({ key: 'archived', weight: 0, value: 0, note: '仓库已归档，分数打三折' })
  }
  score = clamp01(score)

  const note = signals
    .filter((s) => s.weight > 0)
    .map((s) => `${s.key} ${(s.value * 100).toFixed(0)}%×${s.weight}`)
    .join(' + ')

  return { score: Number(score.toFixed(4)), note: `${note} = ${score.toFixed(3)}`, signals }
}

const REPO_KIND_PENALTY = {
  tutorial: 0.6,
  awesome: 0.5,
  toolkit: 0.85,
  benchmark: 0.9,
  method: 1,
  unknown: 1,
}

/**
 * 粗分类：这个仓库是方法本身、工具箱、教程、还是榜单。
 *
 * 只用于降权与提示，**不做剔除**。判错的代价必须是「排序稍差」而不是「看不见」。
 */
export function classifyRepo({ description = '', topics = [], readme = null, fullName = '' } = {}) {
  const head = `${description || ''} ${topics.join(' ')} ${fullName}`.toLowerCase()
  const body = `${head} ${(readme || '').slice(0, 4000).toLowerCase()}`

  if (/\bawesome[- ]|awesome list|curated list of/.test(body)) return { kind: 'awesome', why: 'awesome/清单型' }
  if (/\bguide\b|\btutorial\b|how to use|step[- ]by[- ]step|入门|教程|从零/.test(head + ' ' + (readme || '').slice(0, 1500).toLowerCase())) {
    return { kind: 'tutorial', why: '教程/指南型' }
  }
  if (/\bcollection of\b|\btoolkit\b|\bsuite\b|\blibrary of\b|collections?\b/.test(head)) return { kind: 'toolkit', why: '集合/工具箱型' }
  if (/\bbenchmark\b|\bleaderboard\b|\bevaluation\b|\bbaselines?\b/.test(head)) return { kind: 'benchmark', why: '评测/榜单型' }
  if (/\boptimizer\b|\balgorithm\b|\bwe propose\b|implementation of/.test(body)) return { kind: 'method', why: '方法/实现型' }
  return { kind: 'unknown', why: '无明确信号' }
}

const MATH_PATTERNS = [
  ['Theorem', /\btheorem\b/i],
  ['convergence', /\bconverg(es?|ence)\b/i],
  ['bound', /\bbound(ed|s)?\b/i],
  ['proof', /\bproof\b/i],
  ['rate', /\b(convergence|learning)\s+rate\b/i],
  ['收敛', /收敛/],
]

function countMathSignals(text) {
  const hits = []
  for (const [label, re] of MATH_PATTERNS) {
    if (re.test(text)) hits.push(label)
  }
  return hits
}

/** README 里常出现 arXiv / DOI 链接，是「已有论文支撑」的最强信号。 */
export function findPaperLinks(text = '') {
  const out = []
  const doiRe = /10\.\d{4,9}\/[^\s)\]"'<>]+/g
  const arxivRe = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/gi
  for (const m of text.matchAll(doiRe)) out.push({ kind: 'doi', id: m[0].replace(/[.,;]+$/, '') })
  for (const m of text.matchAll(arxivRe)) out.push({ kind: 'arxiv', id: m[1] })
  const seen = new Set()
  return out.filter((x) => {
    const key = `${x.kind}:${x.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 稳定 id：同一条知识多次扫描不产生重复行。 */
export function itemId(fullName) {
  return `g:${String(fullName || '').toLowerCase()}`
}

/** 仓库名 → 稳定短哈希，给种子文件做去重键。 */
export function repoHash(fullName) {
  return createHash('sha1').update(String(fullName || '').toLowerCase()).digest('hex').slice(0, 12)
}

function githubHeaders(token) {
  const headers = { accept: 'application/vnd.github+json' }
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export default {
  HOST, API, QUOTA_LIMITS, QUERY_TEMPLATES, searchBudget, createQuota,
  searchRepos, normalizeRepo, repoDetail, probe, credibilityScore, classifyRepo,
  findPaperLinks, itemId, repoHash,
}
