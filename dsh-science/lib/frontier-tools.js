/**
 * M4 知识转化层工具（preset 平面）。
 *
 * science_frontier_scan —— 扫 GitHub + arXiv，把「还没写成论文的知识」列成候选。
 *
 * 与已有工具的分工：
 *   - science_search / science_lit_query 查**已发表**的文献；
 *   - science_frontier_scan 查**还没发表**的代码与预印本；
 *   - science_novelty 查「你的稿子会不会被抢发」；
 *   - science_gap_matrix（本层）查「这个方向缺什么」。
 *
 * 全部确定性：同输入同输出（网络可用时），可进 CI。语义判断（这条 claim 成不成立）不在这里做。
 */
import { resolveDshToolsPackage } from './tools.js'
import { scan, persistScan, importSeed, loadSeed, listDomains, DOMAIN_LEXICON, GAP_TYPES } from './science/frontier/index.js'
import { distillClaims, extractLimitations } from './science/frontier/distill.js'
import { buildGapMatrix, pickPrimaryGap, anchorKeywordsFromItem, GAP_PROBES } from './science/frontier/gap.js'
import { designContribution, classifyContribution, loadContributionTypes } from './science/frontier/contribution.js'
import { buildPaperPlan } from './science/frontier/plan.js'
import { loadJournals } from './science/method/journals.js'
import { QUERY_TEMPLATES, QUOTA_LIMITS } from './science/frontier/github.js'

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/frontier-tools: defineTool 不可用')

export const name = 'dsh-science-frontier'
export const inject = ['tools']

function runtimeOf(ctx, { needs = ['client'] } = {}) {
  const rt = ctx.get('scienceRuntime')
  if (!rt) throw new Error('检索运行时未就绪：先跑 science_preflight 看初始化错误')
  const missing = needs.filter((k) => !rt[k])
  if (missing.length > 0) throw new Error(`检索运行时缺少 ${missing.join('/')}：先跑 science_preflight 看初始化错误`)
  return rt
}

const rethrow = (error) => {
  const message = error && error.message ? error.message : String(error)
  throw new Error(`科研工具失败：${message}`)
}

/** 信号数组的 schema 复用一个对象，避免 $ref 在 output.schema 里出问题。 */
function signalSchema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      key: { type: 'string', required: true },
      weight: { type: 'number', required: true },
      value: { type: 'number', required: true },
      note: { type: 'string' },
    },
  }
}

function itemSchema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      itemId: { type: 'string', required: true },
      fullName: { type: 'string', required: true },
      url: { type: 'string' },
      description: { type: 'string' },
      stars: { type: 'integer', required: true },
      credibility: { type: 'number', required: true },
      credibilityNote: { type: 'string', required: true },
      repoKind: { type: 'string' },
      repoKindWhy: { type: 'string' },
      commits52w: { type: 'integer' },
      releases: { type: 'integer' },
      readme: { type: 'boolean' },
      pushedDaysAgo: { type: 'integer' },
      paperLinks: { type: 'array', items: { type: 'string' } },
      relevanceHits: { type: 'array', items: { type: 'string' } },
      signals: { type: 'array', items: signalSchema() },
      detailPartial: { type: 'array', items: { type: 'string' } },
    },
  }
}

export function apply(ctx) {
  const logger = ctx.get('logger') || console

  /* ── 1. 前沿扫描 ─────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_frontier_scan',
    description:
      'Scan GitHub and arXiv for knowledge that is not yet a paper: new optimization methods, unpublished algorithms, '
      + 'reference implementations. Returns a ranked candidate list where each repo carries an explainable credibility score '
      + '(stars / 52-week commits / recency / releases / README math / paper links), a repo kind (method, toolkit, tutorial, awesome, benchmark), '
      + 'and any arXiv or DOI links found in its README. '
      + 'Quota reality: unauthenticated GitHub allows 60 core requests per hour and 10 searches per minute, so one scan costs '
      + 'about 3 searches plus 3 requests per repos detailed; set detail=false for a cheap broad look. '
      + 'GitHub search cannot filter by semantics, so every hit passes a domain gate and off-domain repos are listed separately. '
      + 'The score says "worth reading", never "this will get published".',
    parameters: {
      topic: { type: 'string', description: 'Method or topic to scan, e.g. "muon optimizer", "shampoo", "schedule-free". Omit to sweep the domain seeds.' },
      domain: { type: 'string', description: `Domain seed to use, default optimization. Known: ${listDomains().map((d) => d.id).join(', ') || 'optimization'}.` },
      since: { type: 'string', description: 'ISO date for the pushed:> filter, e.g. 2026-01-01. Defaults to 180 days ago.' },
      minStars: { type: 'integer', description: 'Drop repos below this star count. Defaults to 20.' },
      limit: { type: 'integer', description: 'How many candidates to return, 1-20. Defaults to 10.' },
      detail: { type: 'boolean', description: 'Fetch README, 52-week commits and releases for the top candidates (3 core requests each). Defaults to true.' },
      includeArxiv: { type: 'boolean', description: 'Also search arXiv for recent preprints on the same topic, to see whether someone is already writing this paper. Needs topic.' },
      domainFilter: { type: 'boolean', description: 'Drop repos whose description/topics contain no domain vocabulary. Defaults to true; turn off to see the raw result set.' },
      persist: { type: 'boolean', description: 'Write the candidates into the local frontier table. Defaults to true.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', required: true },
          topic: { type: 'string' },
          items: { type: 'array', required: true, items: itemSchema() },
          preprints: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                title: { type: 'string' }, year: { type: 'integer' },
                doi: { type: 'string' }, url: { type: 'string' },
                authors: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          queries: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' }, query: { type: 'string' },
                ok: { type: 'boolean' }, total: { type: 'integer' },
                status: { type: 'integer' }, error: { type: 'string' },
                fromCache: { type: 'boolean' },
              },
            },
          },
          quota: {
            type: 'object', additionalProperties: false,
            properties: {
              authenticated: { type: 'boolean' },
              exhausted: { type: 'boolean' },
              coreRemaining: { type: 'integer' }, coreLimit: { type: 'integer' },
              searchRemaining: { type: 'integer' }, searchLimit: { type: 'integer' },
              resetAt: { type: 'integer' },
            },
          },
          filtered: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                fullName: { type: 'string' }, stars: { type: 'integer' },
                why: { type: 'string' }, note: { type: 'string' },
              },
            },
          },
          filteredTotal: { type: 'integer' },
          candidatesSeen: { type: 'integer' },
          relevantSeen: { type: 'integer' },
          detailCount: { type: 'integer' },
          persisted: { type: 'integer' },
          degraded: { type: 'array', items: { type: 'string' } },
          caveat: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = []
        const q = v.quota || {}
        lines.push(`领域：${v.domain}${v.topic ? ` · 主题「${v.topic}」` : '（按种子方法名铺开）'}`)
        lines.push(`配额：core ${q.coreRemaining ?? '?'}/${q.coreLimit ?? '?'} · search ${q.searchRemaining ?? '?'}/${q.searchLimit ?? '?'}${q.authenticated ? '（已认证）' : '（未认证，配 retrieval.githubToken 可提到 5000/h）'}`)
        lines.push(`候选：搜到 ${v.candidatesSeen ?? '?'} 个，领域内 ${v.relevantSeen ?? '?'} 个，抓详情 ${v.detailCount ?? 0} 个，返回 ${v.items.length} 个`)
        if ((v.filteredTotal || 0) > 0) {
          lines.push(`领域门剔除 ${v.filteredTotal} 个（不是优化方向）：` + (v.filtered || []).slice(0, 5).map((f) => f.fullName).join(' / ') + (v.filteredTotal > 5 ? ' …' : ''))
        }
        lines.push('')
        v.items.forEach((it, i) => {
          const age = it.pushedDaysAgo === null || it.pushedDaysAgo === undefined ? '?' : `${it.pushedDaysAgo}d前`
          lines.push(`${i + 1}. [${it.credibility.toFixed(3)}] ${it.fullName}  ★${it.stars}  ${it.repoKind || ''}${it.repoKindWhy ? `（${it.repoKindWhy}）` : ''}`)
          lines.push(`   ${it.credibilityNote}`)
          lines.push(`   推送 ${age} · 52w提交 ${it.commits52w ?? '-'} · release ${it.releases ?? '-'} · README ${it.readme === null ? '未抓' : it.readme ? '有' : '无'} · 论文链接 ${(it.paperLinks || []).length}`)
          if (it.description) lines.push(`   ${it.description.slice(0, 120)}`)
          if ((it.paperLinks || []).length > 0) lines.push(`   论文：${it.paperLinks.join(' ')}`)
          if ((it.detailPartial || []).length > 0) lines.push(`   缺项：${it.detailPartial.join(', ')}`)
        })
        if (v.items.length === 0) lines.push('（没有候选。看 degraded 里的原因，多半是配额或查询词太窄。）')
        if ((v.preprints || []).length > 0) {
          lines.push('', `arXiv 同题预印本 ${v.preprints.length} 条（有人已经在写就说明这条缺口在收窄）：`)
          for (const p of v.preprints.slice(0, 8)) {
            lines.push(`  ${p.year || '?'}  ${(p.title || '').slice(0, 90)}${p.doi ? `  DOI ${p.doi}` : ''}`)
          }
        }
        if ((v.degraded || []).length > 0) lines.push('', `降级：${v.degraded.join(' · ')}`)
        if (v.caveat) lines.push('', v.caveat)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const rt = runtimeOf(ctx, { needs: args.includeArxiv ? ['client', 'registry'] : ['client'] })
      try {
        const out = await scan({
          client: rt.client,
          registry: rt.registry,
          topic: args.topic || null,
          domain: args.domain || 'optimization',
          since: args.since || null,
          minStars: Number.isInteger(args.minStars) ? args.minStars : 20,
          limit: Math.max(1, Math.min(20, Number.isInteger(args.limit) ? args.limit : 10)),
          detail: args.detail !== false,
          includeArxiv: args.includeArxiv === true,
          domainFilter: args.domainFilter !== false,
          token: rt.config?.retrieval?.githubToken || null,
        })
        let persisted = 0
        if (args.persist !== false && out.items.length > 0) {
          if (!rt.store) throw new Error('检索运行时缺少 store，无法落库；传 persist=false 可只预览')
          persisted = persistScan(rt.store, out).written
        }
        const now = Date.now()
        return {
          domain: out.domain,
          ...(args.topic ? { topic: args.topic } : {}),
          items: out.items.map((it) => ({
            itemId: it.itemId,
            fullName: it.fullName,
            ...(it.url ? { url: it.url } : {}),
            ...(it.description ? { description: it.description } : {}),
            stars: it.stars,
            credibility: it.credibility,
            credibilityNote: it.credibilityNote,
            ...(it.repoKind ? { repoKind: it.repoKind } : {}),
            ...(it.repoKindWhy ? { repoKindWhy: it.repoKindWhy } : {}),
            ...(Number.isFinite(it.commits52w) ? { commits52w: it.commits52w } : {}),
            ...(Number.isFinite(it.releases) ? { releases: it.releases } : {}),
            ...(it.readme === null || it.readme === undefined ? {} : { readme: it.readme }),
            ...(it.pushedAt ? { pushedDaysAgo: Math.round((now - it.pushedAt) / 86400000) } : {}),
            ...((it.paperLinks || []).length > 0 ? { paperLinks: it.paperLinks.map((l) => `${l.kind}:${l.id}`) } : {}),
            ...((it.relevanceHits || []).length > 0 ? { relevanceHits: it.relevanceHits } : {}),
            ...((it.signals || []).length > 0 ? { signals: it.signals.map((s) => ({ key: s.key, weight: s.weight, value: Number(s.value.toFixed(3)), ...(s.note ? { note: s.note } : {}) })) } : {}),
            ...((it.detailPartial || []).length > 0 ? { detailPartial: it.detailPartial } : {}),
          })),
          preprints: (out.preprints || []).map((p) => ({
            ...(p.title ? { title: p.title } : {}),
            ...(Number.isFinite(p.year) ? { year: p.year } : {}),
            ...(p.doi ? { doi: p.doi } : {}),
            ...(p.url ? { url: p.url } : {}),
            ...((p.authors || []).length > 0 ? { authors: p.authors } : {}),
          })),
          queries: out.queries.map((q) => ({
            id: q.id, query: q.query, ok: q.ok, total: q.total,
            ...(Number.isFinite(q.status) ? { status: q.status } : {}),
            ...(q.error ? { error: q.error } : {}),
            ...(q.fromCache ? { fromCache: true } : {}),
          })),
          quota: {
            authenticated: out.quota.authenticated,
            exhausted: out.quota.exhausted,
            coreRemaining: out.quota.core.remaining,
            coreLimit: out.quota.core.limit,
            searchRemaining: out.quota.search.remaining,
            searchLimit: out.quota.search.limit,
            ...(out.quota.core.resetAt ? { resetAt: out.quota.core.resetAt } : {}),
          },
          filtered: (out.filtered || []).map((f) => ({
            fullName: f.fullName, stars: f.stars, why: f.why, ...(f.note ? { note: f.note } : {}),
          })),
          filteredTotal: out.filteredTotal || 0,
          candidatesSeen: out.candidatesSeen,
          relevantSeen: out.relevantSeen,
          detailCount: out.detailCount,
          persisted,
          degraded: out.degraded,
          caveat: out.caveat,
        }
      } catch (error) { rethrow(error) }
    },
  }))

  /* ── 2. claim 提炼 ──────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_knowledge_distill',
    description:
      'Turn a README or abstract into falsifiable claims. Splits the text into sentences, classifies each as '
      + 'theorem / mechanism / result / limitation / marketing, pairs each mechanism sentence with its nearest supporting '
      + 'sentence, and emits claim objects with a mechanism (the ORIGINAL sentence, never rewritten), a prediction, '
      + 'and a falsifier. '
      + 'This only structures the text; it never judges whether a claim is true. Every claim carries needsHumanReview=true '
      + 'and keeps the original excerpt so you can check it yourself. '
      + 'Give an itemId from science_frontier_scan to read the cached README, or pass text / url directly.',
    parameters: {
      itemId: { type: 'string', description: 'Frontier item id from science_frontier_scan, e.g. g:kellerjordan/muon. Reads the cached README excerpt.' },
      text: { type: 'string', description: 'Raw text to distil, if you do not have an itemId.' },
      url: { type: 'string', description: 'Read a URL directly (uses the local HTTP client, no GitHub quota).' },
      maxClaims: { type: 'integer', description: 'Upper bound on claims, 1-10. Defaults to 5.' },
      persist: { type: 'boolean', description: 'Write the claims into the local knowledge_claim table. Defaults to true; needs itemId.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          source: { type: 'string' },
          claims: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' },
                mechanism: { type: 'string', required: true },
                prediction: { type: 'string' },
                falsifier: { type: 'string', required: true },
                evidenceKind: { type: 'string', required: true },
                confidence: { type: 'string', required: true },
                needsHumanReview: { type: 'boolean', required: true },
                excerpt: { type: 'string' },
                supportExcerpt: { type: 'string' },
                note: { type: 'string' },
                derivedFalsifier: { type: 'boolean' },
              },
            },
          },
          sentences: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: { text: { type: 'string' }, kind: { type: 'string' } },
            },
          },
          stats: {
            type: 'object', additionalProperties: false,
            properties: {
              sentences: { type: 'integer' },
              theorems: { type: 'integer' },
              mechanisms: { type: 'integer' },
              results: { type: 'integer' },
              limitations: { type: 'integer' },
              marketing: { type: 'integer' },
            },
          },
          limitations: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
          caveat: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = [`来源：${v.source || '(text)'}`, `句数 ${v.stats.sentences}｜定理 ${v.stats.theorems}｜机制 ${v.stats.mechanisms}｜结果 ${v.stats.results}｜限制 ${v.stats.limitations}｜营销 ${v.stats.marketing}`]
        if (v.warnings.length > 0) lines.push(`提示：${v.warnings.join(' · ')}`)
        lines.push('')
        v.claims.forEach((c, i) => {
          lines.push(`${i + 1}. [${c.evidenceKind}/${c.confidence}]${c.note ? ` ⚠ ${c.note}` : ''}`)
          lines.push(`   机制：${c.mechanism}`)
          if (c.prediction) lines.push(`   支撑：${c.prediction}`)
          lines.push(`   证伪：${c.falsifier}`)
          if (c.id) lines.push(`   已存：${c.id}`)
        })
        if (v.limitations.length > 0) {
          lines.push('', '作者自述的限制（Discussion 直接用）：')
          for (const l of v.limitations) lines.push(`  · ${l}`)
        }
        if (v.caveat) lines.push('', v.caveat)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const rt = runtimeOf(ctx, { needs: ['store'] })
      try {
        let text = args.text || null
        let source = args.text ? '(text)' : null
        let item = null
        if (!text && args.itemId) {
          item = rt.store.getFrontierItem(args.itemId)
          if (!item) throw new Error(`找不到 ${args.itemId}；先跑 science_frontier_scan（persist=true）`)
          text = item.payload?.readmeExcerpt || null
          source = item.url || item.title
          if (!text) {
            throw new Error(`${args.itemId} 没有缓存的 README 正文（当时 detail=false 或抓取失败）。重新 scan 并保持 detail=true，或直接用 url 参数。`)
          }
        }
        if (!text && args.url) {
          const res = await rt.client.text(args.url, { cacheTtlMs: 6 * 3600_000 })
          if (!res.ok) throw new Error(`读取 ${args.url} 失败：${res.error || res.status}`)
          text = res.text
          source = args.url
        }
        if (!text) throw new Error('需要 itemId / text / url 三者之一')

        const out = distillClaims(text, { maxClaims: Math.max(1, Math.min(10, args.maxClaims || 5)), sourceUrl: source })
        let persisted = 0
        if (args.persist !== false && args.itemId && out.claims.length > 0) {
          for (const c of out.claims) {
            const id = rt.store.saveKnowledgeClaim({
              itemId: args.itemId,
              mechanism: c.mechanism,
              prediction: c.prediction,
              falsifier: c.falsifier,
              evidenceKind: c.evidenceKind,
              confidence: c.confidence,
              excerpt: c.excerpt,
              sourceUrl: c.sourceUrl,
            })
            c.id = id
            persisted += 1
          }
        }

        return {
          source: source || '',
          claims: out.claims.map((c) => ({
            ...(c.id ? { id: c.id } : {}),
            mechanism: c.mechanism,
            ...(c.prediction ? { prediction: c.prediction } : {}),
            falsifier: c.falsifier,
            evidenceKind: c.evidenceKind,
            confidence: c.confidence,
            needsHumanReview: true,
            ...(c.excerpt ? { excerpt: c.excerpt } : {}),
            ...(c.supportExcerpt ? { supportExcerpt: c.supportExcerpt } : {}),
            ...(c.note ? { note: c.note } : {}),
            derivedFalsifier: true,
          })),
          sentences: out.sentences,
          stats: {
            sentences: out.stats.sentences,
            theorems: out.stats.theorems || 0,
            mechanisms: out.stats.mechanisms || 0,
            results: out.stats.results || 0,
            limitations: out.stats.limitations || 0,
            marketing: out.stats.marketing || 0,
          },
          limitations: extractLimitations(text),
          warnings: out.warnings,
          caveat: out.caveat + (persisted > 0 ? `（已存 ${persisted} 条到 knowledge_claim）` : ''),
        }
      } catch (error) { rethrow(error) }
    },
  }))

  /* ── 3. 缺口矩阵 ────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_gap_matrix',
    description:
      'Put one claim against the literature and see which of five directions are actually open: theory guarantee, '
      + 'scale validation, cross-domain transfer, independent reproduction, unified benchmark. '
      + 'Each direction runs its own search query and counts how many hits really cover it (title + abstract + venue), '
      + 'then reports gap / thin / crowded with the found papers listed so you can check the call. '
      + 'A search that returns nothing is NOT proof of novelty — read the caveat before believing a gap. '
      + 'This is for choosing a direction; use science_novelty to check whether someone is about to scoop you.',
    parameters: {
      claimId: { type: 'string', description: 'Claim id from science_knowledge_distill. Preferred: searches use the stored mechanism text.' },
      mechanism: { type: 'string', description: 'Inline claim text, if you have no claimId.' },
      evidenceKind: { type: 'string', description: 'theorem | experiment | anecdote | none. Decides whether the theory direction counts as open. Defaults to experiment.' },
      keywords: { type: 'array', description: 'Search keywords, 2-4 English technical terms. Required for Chinese claims — no CJK word segmentation is attempted.', items: { type: 'string' } },
      anchor: { type: 'array', description: 'Anchor keywords naming the object the claim is about (e.g. ["muon"]). Auto-derived from the source repo name when you pass claimId; give it explicitly otherwise, or the search drifts to generic literature.', items: { type: 'string' } },
      limit: { type: 'integer', description: 'Per-source record count, 3-20. Defaults to 8.' },
      persist: { type: 'boolean', description: 'Write the gap rows into the local DB. Defaults to true when claimId is given.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          claimId: { type: 'string' },
          keywords: { type: 'array', items: { type: 'string' } },
          overall: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          needsKeywords: { type: 'boolean' },
          primary: {
            type: 'object', additionalProperties: false,
            properties: {
              gapType: { type: 'string' }, label: { type: 'string' },
              verdict: { type: 'string' }, statement: { type: 'string' },
              whatMissing: { type: 'string' },
            },
          },
          directions: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                gapType: { type: 'string', required: true },
                label: { type: 'string' },
                needed: { type: 'boolean' },
                verdict: { type: 'string', required: true },
                query: { type: 'string' },
                searchedTotal: { type: 'integer' },
                coveredCount: { type: 'integer' },
                statement: { type: 'string' },
                whatMissing: { type: 'string' },
                why: { type: 'string' },
                examples: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      title: { type: 'string' }, year: { type: 'integer' },
                      doi: { type: 'string' }, venue: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          persisted: { type: 'integer' },
          degraded: { type: 'array', items: { type: 'string' } },
          caveat: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = [`总体：${v.overall}`, v.summary]
        if (v.keywords.length > 0) lines.push(`检索词：${v.keywords.join(' + ')}`)
        lines.push('')
        const mark = { gap: '空白', thin: '薄弱', crowded: '拥挤', 'not-needed': '不需要', unknown: '未知' }
        for (const d of v.directions) {
          lines.push(`[${mark[d.verdict] || d.verdict}] ${d.label} — 检索「${d.query}」命中 ${d.searchedTotal ?? 0}，覆盖 ${d.coveredCount ?? 0}`)
          lines.push(`   ${d.statement}`)
          for (const e of (d.examples || []).slice(0, 3)) {
            lines.push(`     · ${(e.title || '').slice(0, 80)}${e.year ? `［${e.year}］` : ''}${e.doi ? ` DOI ${e.doi}` : ''}`)
          }
        }
        if (v.primary) lines.push('', `先补这个：${v.primary.label} → 缺 ${v.primary.whatMissing}`)
        if (v.degraded.length > 0) lines.push('', `降级：${v.degraded.join(' · ')}`)
        if (v.caveat) lines.push('', v.caveat)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const needs = ['pipeline']
      if (args.claimId) needs.push('store')
      const rt = runtimeOf(ctx, { needs })
      try {
        let claim = null
        let anchor = args.anchor && args.anchor.length > 0 ? args.anchor : null
        if (args.claimId) {
          const row = rt.store.getKnowledgeClaim(args.claimId)
          if (!row) throw new Error(`找不到 claim ${args.claimId}；先跑 science_knowledge_distill`)
          claim = {
            id: row.id,
            mechanism: row.mechanism,
            prediction: row.prediction,
            evidenceKind: row.evidence_kind,
            excerpt: row.excerpt,
          }
          /* 自动带上来源仓库名当锚点：claim 句子常只写结果，方法名只在仓库名里 */
          if (!anchor && row.item_id) {
            const item = rt.store.getFrontierItem(row.item_id)
            if (item) {
              const derived = anchorKeywordsFromItem(item)
              if (derived.length > 0) anchor = derived
            }
          }
        } else if (args.mechanism) {
          claim = { mechanism: args.mechanism, prediction: null, evidenceKind: args.evidenceKind || 'experiment', excerpt: null }
        } else {
          throw new Error('需要 claimId 或 mechanism')
        }

        const out = await buildGapMatrix(claim, {
          pipeline: rt.pipeline,
          limit: Math.max(3, Math.min(20, args.limit || 8)),
          keywords: args.keywords && args.keywords.length > 0 ? args.keywords : null,
          anchorKeywords: anchor,
        })

        let persisted = 0
        if (args.persist !== false && args.claimId && out.directions.length > 0 && rt.store) {
          for (const d of out.directions) {
            if (d.verdict === 'unknown' || d.verdict === 'not-needed') continue
            rt.store.saveGap({
              claimId: args.claimId,
              gapType: d.gapType,
              statement: d.statement,
              whatExists: d.coveredCount > 0 ? (d.examples || []).map((e) => e.title).join('；') : null,
              whatMissing: d.whatMissing || '—',
              evidence: (d.covered || d.examples || []).map((e) => ({ source: 'search', title: e.title, year: e.year, doi: e.doi })),
              isPublishable: d.verdict === 'gap',
            })
            persisted += 1
          }
        }

        const primary = pickPrimaryGap(out)
        return {
          ...(args.claimId ? { claimId: args.claimId } : {}),
          keywords: out.keywords,
          overall: out.overall,
          summary: out.summary,
          ...(out.needsKeywords ? { needsKeywords: true } : {}),
          ...(primary ? {
            primary: {
              gapType: primary.gapType,
              label: primary.label,
              verdict: primary.verdict,
              statement: primary.statement,
              ...(primary.whatMissing ? { whatMissing: primary.whatMissing } : {}),
            },
          } : {}),
          directions: out.directions.map((d) => ({
            gapType: d.gapType,
            label: d.label,
            needed: d.needed,
            verdict: d.verdict,
            query: d.query,
            searchedTotal: d.searchedTotal,
            coveredCount: d.coveredCount,
            statement: d.statement,
            ...(d.whatMissing ? { whatMissing: d.whatMissing } : {}),
            why: d.why,
            examples: (d.covered || []).slice(0, 5).map((e) => ({
              ...(e.title ? { title: e.title } : {}),
              ...(Number.isFinite(e.year) ? { year: e.year } : {}),
              ...(e.doi ? { doi: e.doi } : {}),
              ...(e.venue ? { venue: e.venue } : {}),
            })),
          })),
          persisted,
          degraded: out.degraded,
          caveat: out.caveat,
        }
      } catch (error) { rethrow(error) }
    },
  }))

  /* ── 4. 贡献设计 ────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_contribution_design',
    description:
      'Turn a claim plus a gap into a research plan with an evidence checklist. '
      + 'Classifies the claim into one of seven contribution types (new theory, new algorithm, empirical law, negative result, '
      + 'benchmark, unification, systems), then lists exactly what evidence the target band requires — band 3, 4 and 5 get '
      + 'different lists because they demand different things. '
      + 'Items the claim already covers are marked have=true. Reports the gap between where you are and the target band, '
      + 'plus an upward path. '
      + 'Weeks are a rough estimate from summing evidence items, not a commitment; acceptance is never predicted.',
    parameters: {
      claimId: { type: 'string', description: 'Claim id from science_knowledge_distill.' },
      mechanism: { type: 'string', description: 'Inline claim text, if you have no claimId.' },
      evidenceKind: { type: 'string', description: 'theorem | experiment | anecdote | none. Defaults to experiment.' },
      gapId: { type: 'string', description: 'Gap id from science_gap_matrix, used to check that contribution type and gap type fit together.' },
      gapType: { type: 'string', description: 'Inline gap type: theory | scale | transfer | reproduction | benchmark.' },
      targetBand: { type: 'integer', description: 'Target venue band, 3-5 (5 hardest). Defaults to 4.' },
      persist: { type: 'boolean', description: 'Write the plan into contribution_plan. Defaults to true when claimId is given.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          planId: { type: 'string' },
          typeId: { type: 'string', required: true },
          typeLabel: { type: 'string', required: true },
          typeConfidence: { type: 'string', required: true },
          typeWhy: { type: 'string' },
          targetBand: { type: 'integer', required: true },
          bandLabel: { type: 'string' },
          requiredEvidence: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                band: { type: 'integer', required: true },
                kind: { type: 'string', required: true },
                item: { type: 'string', required: true },
                how: { type: 'string' },
                weeks: { type: 'integer' },
                have: { type: 'boolean' },
                isGapToBand: { type: 'boolean' },
              },
            },
          },
          gateGaps: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                kind: { type: 'string' }, band: { type: 'integer' }, statement: { type: 'string' },
              },
            },
          },
          estimatedWeeks: { type: 'integer' },
          weeksNote: { type: 'string' },
          upwardWeeks: { type: 'integer' },
          upwardNote: { type: 'string' },
          gapFit: {
            type: 'object', additionalProperties: false,
            properties: {
              gapType: { type: 'string' }, ok: { type: 'boolean' },
              expectedTypes: { type: 'array', items: { type: 'string' } },
              note: { type: 'string' },
            },
          },
          candidateJournals: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' }, name: { type: 'string' },
                band: { type: 'integer' }, type: { type: 'string' },
                limitation: { type: 'string' },
              },
            },
          },
          journalsNote: { type: 'string' },
          caveat: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = [
          `贡献类型：${v.typeLabel}（${v.typeId}，判定置信 ${v.typeConfidence}）`,
          `目标档位：band ${v.targetBand}${v.bandLabel ? ` — ${v.bandLabel}` : ''}`,
          v.typeWhy ? `判定依据：${v.typeWhy}` : '',
          '',
          '证据清单：',
        ]
        const groups = {}
        for (const e of v.requiredEvidence) (groups[e.band] = groups[e.band] || []).push(e)
        for (const band of Object.keys(groups).sort()) {
          lines.push(`  ── band ${band}${Number(band) === v.targetBand ? '（目标）' : '（上行）'} ──`)
          for (const e of groups[band]) {
            lines.push(`   ${e.have ? '✓' : '○'} [${e.kind}] ${e.item}${e.weeks ? `（≈${e.weeks}周）` : ''}`)
            if (e.how) lines.push(`       ${e.how}`)
          }
        }
        if (v.gateGaps.length > 0) {
          lines.push('', '门槛差距：')
          for (const g of v.gateGaps) lines.push(`  [${g.kind}] ${g.statement}`)
        }
        lines.push('', `工期粗估：${v.estimatedWeeks} 周${v.upwardWeeks ? `（到上一档再加 ≈${v.upwardWeeks} 周）` : ''}`)
        if (v.weeksNote) lines.push(`  ${v.weeksNote}`)
        if (v.gapFit) lines.push('', `${v.gapFit.ok ? '✓' : '⚠'} ${v.gapFit.note}`)
        if (v.candidateJournals.length > 0) {
          lines.push('', '候选刊（band 粗筛）：')
          for (const j of v.candidateJournals) lines.push(`  band${j.band}  ${j.name}${j.limitation ? ` — ${j.limitation}` : ''}`)
          if (v.journalsNote) lines.push(`  ${v.journalsNote}`)
        }
        if (v.caveat) lines.push('', v.caveat)
        return [{ type: 'text', text: lines.filter((l) => l !== '').join('\n') }]
      },
    },
    async execute(args) {
      const rt = runtimeOf(ctx, { needs: args.claimId ? ['store'] : [] })
      try {
        let claim = null
        let gap = null
        if (args.claimId) {
          const row = rt.store.getKnowledgeClaim(args.claimId)
          if (!row) throw new Error(`找不到 claim ${args.claimId}`)
          claim = { id: row.id, mechanism: row.mechanism, prediction: row.prediction, evidenceKind: row.evidence_kind, confidence: row.confidence }
          if (args.gapId) {
            const g = rt.store.gapsForClaim(args.claimId).find((x) => x.id === args.gapId)
            if (g) gap = { gapType: g.gap_type, statement: g.statement, verdict: g.is_publishable ? 'gap' : 'thin' }
          }
        } else if (args.mechanism) {
          claim = { mechanism: args.mechanism, prediction: null, evidenceKind: args.evidenceKind || 'experiment', confidence: 'low' }
        } else {
          throw new Error('需要 claimId 或 mechanism')
        }
        if (!gap && args.gapType) gap = { gapType: args.gapType }

        const { journals } = loadJournals()
        const out = designContribution({
          claim, gap,
          targetBand: args.targetBand || 4,
          journals,
          store: rt.store || null,
        })

        let planId = null
        if (args.persist !== false && args.claimId && rt.store) {
          planId = rt.store.saveContributionPlan({
            claimId: args.claimId,
            gapId: args.gapId || null,
            contributionType: out.typeId,
            targetBand: out.targetBand,
            requiredEvidence: out.requiredEvidence,
            gateGaps: out.gateGaps,
            candidateJournals: out.candidateJournals,
          })
        }

        return {
          ...(planId ? { planId } : {}),
          typeId: out.typeId,
          typeLabel: out.typeLabel,
          typeConfidence: out.typeConfidence,
          typeWhy: out.typeWhy,
          targetBand: out.targetBand,
          ...(out.bandLabel ? { bandLabel: out.bandLabel } : {}),
          requiredEvidence: out.requiredEvidence,
          gateGaps: out.gateGaps,
          estimatedWeeks: out.estimatedWeeks,
          weeksNote: out.weeksNote,
          upwardWeeks: out.upwardWeeks,
          ...(out.upwardNote ? { upwardNote: out.upwardNote } : {}),
          ...(out.gapFit ? { gapFit: out.gapFit } : {}),
          candidateJournals: out.candidateJournals,
          journalsNote: out.journalsNote,
          caveat: out.caveat,
        }
      } catch (error) { rethrow(error) }
    },
  }))

  /* ── 5. 论文骨架 ────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_paper_plan',
    description:
      'Build the manuscript skeleton from a contribution plan: three assertion-style title structures with draft fills, '
      + 'the one-sentence Figure 1, the five abstract slots (each with what it must contain and what could be auto-filled), '
      + 'the experiment and proof checklists, the figure order, structural risks, and the next actions. '
      + 'Titles and Figure 1 come with rough drafts on purpose — they are structural scaffolds, not final prose. '
      + 'Never predicts acceptance. Hand the output to science_top-journal-writing for the actual drafting rules.',
    parameters: {
      planId: { type: 'string', description: 'Contribution plan id from science_contribution_design.' },
      claimId: { type: 'string', description: 'Claim id; used when you have no planId (a plan is computed on the fly).' },
      mechanism: { type: 'string', description: 'Inline claim mechanism, if you have neither id.' },
      prediction: { type: 'string', description: 'Inline claim prediction.' },
      evidenceKind: { type: 'string', description: 'theorem | experiment | anecdote | none. Defaults to experiment.' },
      targetBand: { type: 'integer', description: 'Target band, 3-5. Defaults to the plan value or 4.' },
      journalId: { type: 'string', description: 'Target journal id, used to attach the submission timeline from science_submission_route.' },
      title: { type: 'string', description: 'Working title, if you already have one.' },
      keywords: { type: 'array', description: 'Author keywords.', items: { type: 'string' } },
      field: { type: 'string', description: 'Field label, for the route planner.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          mechanismPresent: { type: 'boolean' },
          titleCandidates: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' }, pattern: { type: 'string' },
                draft: { type: 'string', required: true },
                draftIsRough: { type: 'boolean' },
                fromClaim: { type: 'boolean' },
                why: { type: 'string' },
                example: { type: 'string' },
                checks: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: { q: { type: 'string' }, hint: { type: 'string' } },
                  },
                },
              },
            },
          },
          figure1: {
            type: 'object', additionalProperties: false,
            properties: {
              template: { type: 'string' }, draft: { type: 'string' },
              draftIsRough: { type: 'boolean' }, rule: { type: 'string' }, check: { type: 'string' },
            },
          },
          abstractSlots: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                slot: { type: 'integer', required: true },
                name: { type: 'string', required: true },
                purpose: { type: 'string' },
                mustFill: { type: 'array', items: { type: 'string' } },
                autoFilled: { type: 'string' },
                status: { type: 'string' },
              },
            },
          },
          experimentList: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                order: { type: 'integer' }, band: { type: 'integer' },
                kind: { type: 'string' }, item: { type: 'string' },
                how: { type: 'string' }, weeks: { type: 'integer' }, have: { type: 'boolean' },
              },
            },
          },
          theoryList: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                order: { type: 'integer' }, band: { type: 'integer' },
                item: { type: 'string' }, how: { type: 'string' },
                weeks: { type: 'integer' }, have: { type: 'boolean' },
              },
            },
          },
          figureOrder: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                n: { type: 'integer' }, role: { type: 'string' },
                from: { type: 'string' }, rule: { type: 'string' },
              },
            },
          },
          timeline: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                cumulativeDays: { type: 'integer' }, step: { type: 'string' },
                action: { type: 'string' }, note: { type: 'string' },
              },
            },
          },
          totalDays: { type: 'integer' },
          routeNote: { type: 'string' },
          risks: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                level: { type: 'string' }, risk: { type: 'string' }, action: { type: 'string' },
              },
            },
          },
          nextActions: { type: 'array', items: { type: 'string' } },
          caveat: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = ['标题候选（断言式结构）：']
        v.titleCandidates.forEach((t, i) => {
          lines.push(`${i + 1}. ${t.draft}${t.draftIsRough ? '  ← 草稿，需重写措辞' : ''}`)
          lines.push(`   结构：${t.pattern}${t.fromClaim ? '（claim 原句已可用）' : ''}`)
          if (t.why) lines.push(`   ${t.why}`)
          for (const c of (t.checks || []).slice(0, 3)) lines.push(`   ☐ ${c.q}${c.hint ? ` — ${c.hint}` : ''}`)
        })
        if (v.figure1) {
          lines.push('', `Figure 1：${v.figure1.draft || v.figure1.template}`)
          lines.push(`  ${v.figure1.rule}`)
          lines.push(`  自检：${v.figure1.check}`)
        }
        lines.push('', '摘要五槽：')
        for (const s of v.abstractSlots) {
          lines.push(`  ${s.slot}. ${s.name}［${s.status}］${s.purpose}`)
          if (s.mustFill && s.mustFill.length > 0) lines.push(`     必须填：${s.mustFill.join('、')}`)
          if (s.autoFilled) lines.push(`     已能填：${String(s.autoFilled).slice(0, 110)}`)
        }
        if (v.experimentList.length > 0) {
          lines.push('', `实验清单（${v.experimentList.length} 项）：`)
          for (const e of v.experimentList) lines.push(`  ${e.have ? '✓' : '○'} [band${e.band}/${e.kind}] ${e.item} — ${e.how}`)
        }
        if (v.theoryList.length > 0) {
          lines.push('', `证明清单（${v.theoryList.length} 项）：`)
          for (const e of v.theoryList) lines.push(`  ${e.have ? '✓' : '○'} [band${e.band}] ${e.item} — ${e.how}`)
        }
        if (v.figureOrder.length > 0) {
          lines.push('', '图序：')
          for (const f of v.figureOrder) lines.push(`  Fig ${f.n}（${f.role}）${f.from ? `：${f.from}` : ''}  — ${f.rule}`)
        }
        if (v.risks.length > 0) {
          lines.push('', '结构性风险：')
          for (const r of v.risks) lines.push(`  [${r.level}] ${r.risk}`)
          for (const r of v.risks) if (r.action) lines.push(`      → ${r.action}`)
        }
        if (v.nextActions.length > 0) {
          lines.push('', '下一步：')
          for (const a of v.nextActions) lines.push(`  · ${a}`)
        }
        if (v.timeline && v.timeline.length > 0) {
          lines.push('', `投稿时间线（合计约 ${v.totalDays ?? '?'} 天）：`)
          for (const t of v.timeline.slice(0, 10)) lines.push(`  ${String(t.cumulativeDays).padStart(4)}d  ${t.step}  ${t.action}`)
        } else if (v.routeNote) lines.push('', v.routeNote)
        if (v.caveat) lines.push('', v.caveat)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const rt = runtimeOf(ctx, { needs: args.planId || args.claimId ? ['store'] : [] })
      try {
        let claim = null
        let design = null
        let gap = null

        if (args.planId && rt.store) {
          const plan = rt.store.getContributionPlan(args.planId)
          if (!plan) throw new Error(`找不到方案 ${args.planId}`)
          design = {
            typeId: plan.contributionType,
            typeLabel: loadContributionTypes().types[plan.contributionType]?.label || plan.contributionType,
            targetBand: plan.targetBand,
            requiredEvidence: plan.requiredEvidence,
            gateGaps: plan.gateGaps,
            evidenceCount: {
              atBand: plan.requiredEvidence.filter((e) => e.band === plan.targetBand).length,
              above: plan.requiredEvidence.filter((e) => e.isGapToBand).length,
              have: plan.requiredEvidence.filter((e) => e.have).length,
            },
            candidateJournals: plan.candidateJournals,
            gapFit: null,
          }
          if (plan.claimId) {
            const row = rt.store.getKnowledgeClaim(plan.claimId)
            if (row) claim = { id: row.id, mechanism: row.mechanism, prediction: row.prediction, evidenceKind: row.evidence_kind, confidence: row.confidence }
          }
        } else if (args.claimId && rt.store) {
          const row = rt.store.getKnowledgeClaim(args.claimId)
          if (!row) throw new Error(`找不到 claim ${args.claimId}`)
          claim = { id: row.id, mechanism: row.mechanism, prediction: row.prediction, evidenceKind: row.evidence_kind, confidence: row.confidence }
        } else if (args.mechanism) {
          claim = { mechanism: args.mechanism, prediction: args.prediction || null, evidenceKind: args.evidenceKind || 'experiment', confidence: 'low' }
        } else {
          throw new Error('需要 planId / claimId / mechanism 之一')
        }

        if (!design) {
          const { journals } = loadJournals()
          design = designContribution({ claim, gap, targetBand: args.targetBand || 4, journals, store: rt.store || null })
        }

        const out = buildPaperPlan(design, {
          claim,
          gap,
          journalId: args.journalId || null,
          title: args.title || null,
          keywords: args.keywords || [],
          field: args.field || null,
        })

        return {
          mechanismPresent: out.mechanismPresent,
          titleCandidates: out.titleCandidates.map((t) => ({
            id: t.id,
            pattern: t.pattern,
            draft: t.draft,
            ...(t.draftIsRough ? { draftIsRough: true } : {}),
            ...(t.fromClaim ? { fromClaim: true } : {}),
            ...(t.why ? { why: t.why } : {}),
            ...(t.example ? { example: t.example } : {}),
            checks: t.checks || [],
          })),
          figure1: out.figure1Sentence,
          abstractSlots: out.abstractSlots.map((s) => ({
            slot: s.slot,
            name: s.name,
            purpose: s.purpose,
            mustFill: s.mustFill,
            ...(s.autoFilled ? { autoFilled: String(s.autoFilled) } : {}),
            status: s.status,
          })),
          experimentList: out.experimentList,
          theoryList: out.theoryList,
          figureOrder: out.figureOrder.map((f) => ({
            n: f.n, role: f.role,
            ...(f.from ? { from: f.from } : {}),
            rule: f.rule,
          })),
          ...(out.timeline ? { timeline: out.timeline.map((t) => ({ cumulativeDays: t.cumulativeDays, step: t.step, action: t.action, ...(t.note ? { note: t.note } : {}) })) } : {}),
          ...(out.totalDays !== null ? { totalDays: out.totalDays } : {}),
          ...(out.routeNote ? { routeNote: out.routeNote } : {}),
          risks: out.risks,
          nextActions: out.nextActions,
          caveat: out.caveat,
        }
      } catch (error) { rethrow(error) }
    },
  }))

  logger.info?.('science: 知识转化层工具注册完成（5 个）')
}

export default { name, inject, apply }
