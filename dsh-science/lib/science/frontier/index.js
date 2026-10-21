/**
 * M4 装配层：把 GitHub / arXiv 的「还没写成论文的知识」变成候选清单。
 *
 * 分两段，故意分开：
 *   1. 粗排（只用 search 返回的字段，零额外请求）→ 决定谁值得抓详情
 *   2. 详情（README + 提交 + release，每仓 3 次 core 请求）→ 补上「有没有数学表述」「有没有论文链接」
 *
 * 分开的原因：core 配额 60/h，一次扫描最多只能给 10 个仓抓详情，
 * 抓错对象就等于白烧配额。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  QUERY_TEMPLATES, createQuota, searchBudget, searchRepos, repoDetail,
  credibilityScore, classifyRepo, findPaperLinks, itemId, QUOTA_LIMITS,
} from './github.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SEED_DIR = join(HERE, '..', '..', '..', 'data', 'frontier')
export const DEFAULT_DOMAIN = 'optimization'

/** 5 类缺口。与 data/frontier/*.json 的 contributionHints 键一致。 */
export const GAP_TYPES = ['theory', 'scale', 'transfer', 'reproduction', 'benchmark']

/**
 * 领域词表。GitHub 的搜索**做不到语义限定**——实测 `muon in:name` 返回
 * scverse/muon（单细胞分析）、muon-build/muon（构建系统）、fhunleth/muontrap（Erlang 进程监控）。
 * 所以每条结果都必须过这道领域门，否则候选里一半是别的领域的东西。
 */
export const DOMAIN_LEXICON = [
  'optimizer', 'optimiser', 'optimization', 'optimisation',
  'gradient', 'gradient descent', 'sgd', 'adam', 'adamw',
  'neural', 'deep learning', 'machine learning', 'training', 'pre-training',
  'loss function', 'objective function', 'convergence', 'converges',
  'learning rate', 'weight decay', 'hyperparameter', 'backprop',
  'pytorch', 'tensorflow', 'jax', 'flax', 'torch',
  'scaling law', 'condition number', 'preconditioner', 'hessian',
  '优化', '梯度', '收敛',
]

/** 领域词表 = 通用 ML 词 + 该领域种子的 theorySignals / aliases。 */
export function buildLexicon(seed = null, domain = DEFAULT_DOMAIN) {
  const extra = [
    ...(seed?.domains?.[domain]?.theorySignals || []),
    ...(seed?.domains?.[domain]?.aliases || []),
  ]
  return [...new Set([...DOMAIN_LEXICON, ...extra].map((w) => String(w).toLowerCase()))]
}

/**
 * 领域相关性判定。
 * @returns `{ok, hits[], missing}` —— `hits` 是命中的领域词，便于人工复核为什么它被留下。
 */
export function relevance(text = '', lexicon = DOMAIN_LEXICON) {
  const lower = String(text).toLowerCase()
  const hits = lexicon.filter((w) => lower.includes(w))
  return { ok: hits.length > 0, hits: hits.slice(0, 5), missing: hits.length === 0 }
}

/** 读种子。文件不存在时返回空结构，不抛错——首次安装没有种子也要能跑。 */
export function loadSeed(domain = null) {
  const out = { domains: {}, anchors: [], meta: null, missing: [] }
  const file = join(SEED_DIR, `${domain || DEFAULT_DOMAIN}.json`)
  if (!existsSync(file)) {
    out.missing.push(file)
    return out
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  out.meta = raw.$meta || null
  for (const [id, d] of Object.entries(raw.domains || {})) out.domains[id] = { id, ...d }
  out.anchors = Array.isArray(raw.anchors) ? raw.anchors : []
  return out
}

/** 所有可用领域（扫描 data/frontier 目录）。 */
export function listDomains() {
  const out = []
  let names = []
  try { names = readdirSync(SEED_DIR) } catch { return out }
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const id = name.replace(/\.json$/, '')
    const seed = loadSeed(id)
    out.push({ id, label: seed.domains[id]?.label || id, anchors: seed.anchors.length })
  }
  return out
}

/**
 * 生成查询串。
 *
 * 配额是硬约束：匿名 search 只有 10 次/分钟，所以「用户给 topic」用 3 个模板深挖，
 * 「只用领域种子」则每个方法名用 1 个模板铺开。
 *
 * 一个实测坑：`in:name` 配多词短语会几乎无结果——`muon optimizer in:name` 要求
 * 仓库名同时含 muon 和 optimizer，实测 total=0。所以 in:name 类模板取 topic 的**首词**，
 * 短语留给 `phrase` 模板。
 */
export function buildQueries({ topic = null, domain = DEFAULT_DOMAIN, seed = null, since = null, minStars = 20, maxQueries = null, templates = null } = {}) {
  const budget = maxQueries ?? 6
  const sinceStr = since || isoDaysAgo(180)
  const nameToken = pickNameToken(topic)
  const pad = (tpl) => {
    const word = tpl.id === 'phrase' ? topic : nameToken
    return tpl.template
      .replace(/\{topic\}/g, word)
      .replace(/\{since\}/g, sinceStr)
      .replace(/\{minStars\}/g, String(minStars))
  }

  if (topic) {
    const picked = (templates || QUERY_TEMPLATES).filter((t) => t.id !== 'desc-theory')
    return picked.slice(0, budget).map((t) => ({ ...t, token: t.id === 'phrase' ? topic : nameToken, query: pad(t) }))
  }

  const seeds = seed?.domains?.[domain]?.querySeeds || []
  const phraseTpl = QUERY_TEMPLATES.find((t) => t.id === 'phrase')
  return seeds.slice(0, budget).map((s) => ({
    ...phraseTpl,
    topic: s,
    token: s,
    query: phraseTpl.template.replace(/\{topic\}/g, s),
  }))
}

/** `in:name` 用的词：多词短语取第一个有意义的词（≥3 字符）。 */
export function pickNameToken(topic) {
  if (!topic) return ''
  const words = String(topic).split(/\s+/).filter((w) => w.length >= 3)
  return words[0] || String(topic)
}

/**
 * 主扫描。**只读**：不改库，调用方决定要不要落库。
 *
 * @returns `{items, queries, quota, degraded, detailCount, detailBudget, domain, caveat}`
 */
export async function scan({ client, topic = null, domain = DEFAULT_DOMAIN, since = null, minStars = 20, limit = 10, includeArxiv = false, registry = null, mailto = null, token = null, cacheTtlMs = 6 * 3600_000, detail = true, domainFilter = true, now = Date.now() } = {}) {
  const quota = createQuota({ token })
  const degraded = []
  const seed = loadSeed(domain)
  if (seed.missing.length > 0) degraded.push(`seed:missing(${domain})`)

  const maxQueries = Math.min(searchBudget({ token }), 6)
  const queries = buildQueries({ topic, domain, seed, since, minStars, maxQueries })
  if (queries.length === 0) {
    return { items: [], queries: [], quota: quota.snapshot(), degraded: [...degraded, 'query:empty'], detailCount: 0, detailBudget: 0, domain, caveat: '没有可用的查询词：请给 topic，或确认 data/frontier 下有该领域的种子。' }
  }

  const byName = new Map()
  const queryLog = []
  for (const q of queries) {
    const res = await searchRepos(client, { query: q.query, limit: Math.max(10, limit * 2), token, quota, cacheTtlMs })
    queryLog.push({ id: q.id, query: q.query, ok: res.ok, total: res.total, status: res.status, error: res.error || null, fromCache: res.fromCache === true })
    if (!res.ok) {
      degraded.push(`github:${q.id}:${res.status || 'err'}`)
      continue
    }
    for (const repo of res.items) {
      if (!repo.fullName) continue
      if (repo.archived) continue
      if (repo.stars < minStars) continue
      const prev = byName.get(repo.fullName)
      /* 同一个仓被多个 query 命中时，取星数高的那条（字段一致，只是避免覆盖顺序随机） */
      if (!prev || repo.stars > prev.stars) byName.set(repo.fullName, repo)
    }
  }

  /* 领域门：搜索本身分不清 "muon" 是优化器还是单细胞工具，这一步必须做 */
  const lexicon = buildLexicon(seed, domain)
  const filtered = []
  const relevant = []
  for (const repo of byName.values()) {
    const text = `${repo.description || ''} ${repo.topics.join(' ')} ${repo.fullName}`
    const rel = relevance(text, lexicon)
    if (domainFilter && !rel.ok) {
      filtered.push({ fullName: repo.fullName, stars: repo.stars, why: 'off-domain', note: 'description/topics 里没有该领域的任何词' })
      continue
    }
    relevant.push({ ...repo, relevanceHits: rel.hits })
  }
  if (filtered.length > 0) degraded.push(`domain-filter:剔除 ${filtered.length} 个领域外仓库`)

  /* 粗排：不含 README 的 math/hasPaper 项，上限 0.70，只用于决定谁值得抓详情 */
  const rough = relevant.map((repo) => {
    const kind = classifyRepo({ description: repo.description, topics: repo.topics, fullName: repo.fullName })
    return {
      repo,
      kind,
      rough: credibilityScore({
        stars: repo.stars, commits52w: null, pushedAt: repo.pushedAt, releases: null,
        readme: null, paperLinks: [], archived: repo.archived, repoKind: kind.kind, now,
      }),
    }
  }).sort((a, b) => b.rough.score - a.rough.score || b.repo.stars - a.repo.stars)

  const detailBudget = detail ? Math.min(limit, Math.floor(quota.snapshot().core.remaining / 3)) : 0
  if (detail && detailBudget < Math.min(limit, rough.length)) {
    degraded.push(`github:core-quota(只能抓 ${detailBudget} 个详情)`)
  }

  const items = []
  for (let i = 0; i < rough.length && items.length < limit; i += 1) {
    const { repo, kind } = rough[i]
    const entry = {
      itemId: itemId(repo.fullName),
      domain,
      ...repo,
      repoKind: kind.kind,
      repoKindWhy: kind.why,
    }
    if (i < detailBudget) {
      const d = await repoDetail(client, { fullName: repo.fullName, token, quota, cacheTtlMs: cacheTtlMs * 2 })
      const links = d.readme ? findPaperLinks(d.readme) : []
      /* 有 README 再判一次类：粗判只看 description，细判能看到正文 */
      const fine = classifyRepo({ description: repo.description, topics: repo.topics, readme: d.readme, fullName: repo.fullName })
      entry.readme = d.readme ? true : false
      /* 存一段正文，离线时 distill 才有原料；不存全文，DB 会爆 */
      entry.readmeExcerpt = d.readme ? d.readme.slice(0, 6000) : null
      entry.commits52w = d.commits52w
      entry.releases = d.releases
      entry.lastReleaseAt = d.lastReleaseAt
      entry.paperLinks = links
      entry.detailPartial = d.partial
      entry.repoKind = fine.kind
      entry.repoKindWhy = fine.why
      const cred = credibilityScore({
        stars: repo.stars, commits52w: d.commits52w, pushedAt: repo.pushedAt,
        releases: d.releases, lastReleaseAt: d.lastReleaseAt, readme: d.readme,
        paperLinks: links, archived: repo.archived, repoKind: fine.kind, now,
      })
      entry.credibility = cred.score
      entry.credibilityNote = cred.note
      entry.signals = cred.signals
    } else {
      /* 没抓详情就明说，不拿粗分冒充完整分 */
      entry.credibility = rough[i].rough.score
      entry.credibilityNote = `${rough[i].rough.note}（未抓详情，math/hasPaper 项缺，分数上限 0.70）`
      entry.signals = rough[i].rough.signals
      entry.readme = null
      entry.paperLinks = []
      entry.detailPartial = ['skipped:budget']
    }
    items.push(entry)
  }

  /* 抓完详情才敢按完整分重排——粗排只看星数和活跃度，会把教程排前面 */
  items.sort((a, b) => b.credibility - a.credibility || b.stars - a.stars)

  /* arXiv 侧：同一 topic 的近期预印本，用来判「是否已有论文在抢同一问题」 */
  let preprints = []
  if (includeArxiv && registry && topic) {
    try {
      const dsl = { blocks: [[topic]], filters: {}, limit: Math.max(5, limit) }
      const res = await registry.run('arxiv', dsl, { limit: Math.max(5, limit) })
      if (res.ok) {
        preprints = res.records.map((r) => ({
          title: r.title,
          year: r.year,
          doi: r.doi,
          url: r.url || r.sourceId,
          authors: (r.authors || []).slice(0, 3).map((a) => a.raw || a.family).filter(Boolean),
        }))
      } else {
        degraded.push(`arxiv:${res.status || res.error || 'err'}`)
      }
    } catch (error) {
      degraded.push(`arxiv:${String(error.message).slice(0, 40)}`)
    }
  } else if (includeArxiv && !topic) {
    degraded.push('arxiv:skip(需要 topic)')
  }

  return {
    items,
    preprints,
    queries: queryLog,
    quota: quota.snapshot(),
    degraded,
    detailCount: Math.min(detailBudget, rough.length),
    detailBudget,
    domain,
    candidatesSeen: byName.size,
    relevantSeen: relevant.length,
    filtered: filtered.slice(0, 10),
    filteredTotal: filtered.length,
    caveat: 'credibility 是「这个仓库值不值得读」，不是「这条路能中」。分数由 stars/提交/活跃/发布/数学表述五项加权，每一项都可在 signals 里复核。',
  }
}

/** 落库。重复扫描只更新，不产生重复行（id 由 fullName 决定）。 */
export function persistScan(store, result) {
  let written = 0
  for (const item of result.items) {
    store.saveFrontierItem({
      id: item.itemId,
      source: 'github',
      kind: 'repo',
      title: item.fullName,
      url: item.url,
      author: item.fullName.split('/')[0],
      stars: item.stars,
      forks: item.forks,
      pushedAt: item.pushedAt,
      createdAt: item.createdAt,
      commits52w: item.commits52w ?? null,
      releases: item.releases ?? null,
      topics: item.topics,
      description: item.description,
      domain: item.domain,
      credibility: item.credibility,
      credibilityNote: item.credibilityNote,
      payload: {
        language: item.language,
        license: item.license,
        paperLinks: item.paperLinks,
        detailPartial: item.detailPartial,
        signals: item.signals,
        readmeExcerpt: item.readmeExcerpt || null,
      },
    })
    written += 1
  }
  return { written }
}

/** 导入种子锚点。种子里的 stars 是历史值，导入时只当起点，credibility 按「数据新不新」打折。 */
export function importSeed(store, seed = null) {
  const s = seed || loadSeed(DEFAULT_DOMAIN)
  let loaded = 0
  let skipped = 0
  for (const a of s.anchors) {
    const id = itemId(a.fullName)
    if (store.getFrontierItem(id)) { skipped += 1; continue }
    const observedAt = a.observedAt ? Date.parse(a.observedAt) : null
    const ageDays = observedAt ? (Date.now() - observedAt) / 86400000 : 999
    const cred = credibilityScore({
      stars: a.stars || 0,
      commits52w: null,
      pushedAt: a.pushedAt ? Date.parse(a.pushedAt) : null,
      releases: null,
      readme: null,
      now: Date.now(),
    })
    /* 种子超过 30 天，分数乘一个衰减因子，避免把旧星数当当前热度 */
    const decay = ageDays <= 30 ? 1 : ageDays >= 180 ? 0.5 : 1 - 0.5 * ((ageDays - 30) / 150)
    store.saveFrontierItem({
      id,
      source: 'github',
      kind: 'repo',
      title: a.fullName,
      url: a.url,
      author: a.fullName.split('/')[0],
      stars: a.stars ?? null,
      forks: a.forks ?? null,
      pushedAt: a.pushedAt ? Date.parse(a.pushedAt) : null,
      createdAt: null,
      commits52w: null,
      releases: null,
      topics: a.topics || [],
      description: a.description || null,
      domain: a.domain || DEFAULT_DOMAIN,
      credibility: Number((cred.score * decay).toFixed(4)),
      credibilityNote: `种子锚点（观测于 ${a.observedAt || '未知'}，衰减 ×${decay.toFixed(2)}）：${cred.note}`,
      payload: { why: a.why || null, seed: true, observedAt: a.observedAt || null },
    })
    loaded += 1
  }
  return { loaded, skipped, anchors: s.anchors.length }
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

export { QUOTA_LIMITS, QUERY_TEMPLATES, createQuota, credibilityScore, classifyRepo, findPaperLinks, itemId }

export default { scan, persistScan, importSeed, loadSeed, listDomains, buildQueries, pickNameToken, GAP_TYPES }
