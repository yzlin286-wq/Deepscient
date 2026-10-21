/**
 * 科研检索工具（preset 平面）：薄封装，全部逻辑在 host 平面的 scienceRuntime 里。
 *
 * 工具层只做三件事：把参数变成管线调用、把结果 reshape 成稳定 schema、把人类可读摘要渲染出来。
 * 不复刻限速/缓存逻辑——那样两个工具就会各自烧一份配额。
 */
import { resolveDshToolsPackage } from './tools.js'
import * as openalexIntel from './science/intel/openalex-profile.js'
import * as scirevIntel from './science/intel/scirev.js'
import * as letpubIntel from './science/intel/letpub.js'
import { SOURCE_IDS as INTEL_SOURCE_IDS } from './science/intel/index.js'

const INTEL_PROBES = { openalex: openalexIntel, scirev: scirevIntel, letpub: letpubIntel }

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/science-tools: defineTool 不可用')

export const name = 'dsh-science-search'

export const inject = ['tools']

/** 取 host 平面的检索运行时；没有就抛一条可执行的提示。 */
function runtimeOf(ctx) {
  const rt = ctx.get('scienceRuntime')
  if (!rt || !rt.pipeline) {
    throw new Error('检索运行时未就绪：数据根或 SQLite 初始化失败，先跑 science_preflight 看错误')
  }
  return rt
}

const rethrow = (error) => {
  const message = error && error.message ? error.message : String(error)
  throw new Error(`科研检索失败：${message}`)
}

/** 记录 -> 稳定输出形状（schema 校验只认这些字段）。 */
function shapeRecord(r) {
  return {
    title: r.title || '(无题)',
    doi: r.doi || null,
    arxivId: r.arxivId || null,
    pmid: r.pmid || null,
    pmcid: r.pmcid || null,
    year: Number.isFinite(r.year) ? r.year : null,
    venue: r.venue || null,
    citedByCount: Number.isFinite(r.citedByCount) ? r.citedByCount : null,
    oaStatus: r.oaStatus || null,
    oaPdfUrl: r.oaPdfUrl || null,
    sources: Array.isArray(r.sources) ? r.sources : (r.source ? [r.source] : []),
    score: Number.isFinite(r.score) ? r.score : null,
    citation: r.doi || r.arxivId ? null : null,
  }
}

export function apply(ctx) {
  /* ── 1. 统一多源检索 ─────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_search',
    description:
      'Search ten key-free scholarly sources at once (OpenAlex, Crossref, Europe PMC, PubMed, arXiv, DOAJ, '
      + 'DataCite, Zenodo, OpenAIRE) and return deduplicated, ranked records with per-source hit counts. '
      + 'Use this before claiming any gap in the literature: it tells you what each source returned, '
      + 'which sources were rate-limited or skipped, and how much OpenAlex budget the call consumed. '
      + 'Persist results so later science_lit_query can reuse them instead of re-searching.',
    parameters: {
      query: {
        type: 'string',
        description: 'Natural-language query. Commas or AND separate concept blocks; OR or | separates synonyms inside a block.',
      },
      blocks: {
        type: 'array',
        description: 'Explicit concept blocks: outer array is AND, inner array is OR. Overrides query when present.',
        items: { type: 'array', items: { type: 'string' } },
      },
      yearFrom: { type: 'integer', description: 'Earliest publication year (inclusive).' },
      yearTo: { type: 'integer', description: 'Latest publication year (inclusive).' },
      oaOnly: { type: 'boolean', description: 'Restrict to open-access records where the source supports it.' },
      limit: { type: 'integer', description: 'Records requested per source, 1-100. Defaults to 25.' },
      returnLimit: { type: 'integer', description: 'How many ranked records to return, 1-60. Defaults to 25.' },
      sources: {
        type: 'array',
        description: 'Restrict to these source ids (openalex, crossref, europepmc, pubmed, arxiv, doaj, datacite, zenodo, openaire).',
        items: { type: 'string' },
      },
      projectId: { type: 'string', description: 'Attach every persisted record to this project id.' },
      withAbstract: { type: 'boolean', description: 'Include a 300-character abstract preview in the rendered summary.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          ms: { type: 'integer', required: true },
          persisted: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              inserted: { type: 'integer', required: true },
              updated: { type: 'integer', required: true },
            },
          },
          perSource: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                count: { type: 'integer', required: true },
                ok: { type: 'boolean', required: true },
                ms: { type: 'integer', required: true },
                skipped: { type: 'string' },
                error: { type: 'string' },
              },
            },
          },
          skipped: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                reason: { type: 'string', required: true },
              },
            },
          },
          budgetRemainingUsd: { type: 'number' },
          records: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                doi: { type: 'string' },
                arxivId: { type: 'string' },
                pmid: { type: 'string' },
                pmcid: { type: 'string' },
                year: { type: 'integer' },
                venue: { type: 'string' },
                citedByCount: { type: 'integer' },
                oaStatus: { type: 'string' },
                oaPdfUrl: { type: 'string' },
                sources: { type: 'array', required: true, items: { type: 'string' } },
                score: { type: 'number' },
              },
            },
          },
        },
      },
      render: (args, value) => {
        const lines = [
          `命中 ${value.total} 篇（去重后）｜${value.ms}ms｜落库 +${value.persisted.inserted} ~${value.persisted.updated}`,
          '源：' + value.perSource
            .map((s) => `${s.id}=${s.skipped ? `跳过(${s.skipped})` : (s.ok ? s.count : `ERR:${s.error || '?'}`)}`)
            .join(' '),
        ]
        if (typeof value.budgetRemainingUsd === 'number') {
          lines.push(`OpenAlex 预算剩余 $${value.budgetRemainingUsd.toFixed(3)}`)
        }
        value.records.slice(0, args.returnLimit || 25).forEach((r, i) => {
          const meta = [r.year, r.venue, r.citedByCount != null ? `被引${r.citedByCount}` : null, r.oaPdfUrl ? 'OA-PDF' : null]
            .filter(Boolean).join(' · ')
          lines.push(`${i + 1}. ${r.title}${meta ? `［${meta}］` : ''} <${r.sources.join('+')}>`)
          const id = r.doi ? `DOI ${r.doi}` : (r.arxivId ? `arXiv ${r.arxivId}` : (r.pmid ? `PMID ${r.pmid}` : null))
          if (id) lines.push(`   ${id}`)
        })
        if (value.skipped.length > 0) {
          lines.push('注意：' + value.skipped.map((s) => `${s.id} 因 ${s.reason} 被跳过`).join('；'))
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const rt = runtimeOf(ctx)
      try {
        const report = await rt.pipeline.search(
          { query: args.query, blocks: args.blocks, yearFrom: args.yearFrom, yearTo: args.yearTo, oaOnly: args.oaOnly, limit: args.limit },
          {
            projectId: args.projectId,
            sources: args.sources,
            limit: args.limit,
            returnLimit: args.returnLimit || 25,
            persist: true,
          },
        )
        return {
          total: report.total,
          ms: report.ms,
          persisted: { inserted: report.persisted.inserted, updated: report.persisted.updated },
          perSource: report.perSource.map((s) => ({
            id: s.id, count: s.count, ok: s.ok, ms: s.ms,
            ...(s.skipped ? { skipped: s.skipped } : {}),
            ...(s.error ? { error: String(s.error).slice(0, 200) } : {}),
          })),
          skipped: report.skipped,
          ...(report.budget && report.budget.remainingUsd != null ? { budgetRemainingUsd: report.budget.remainingUsd } : {}),
          records: report.records.map(shapeRecord),
        }
      } catch (error) { rethrow(error) }
    },
  }))

  /* ── 2. 本地库查询（先查库再检索） ──────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_lit_query',
    description:
      'Query the local literature library (SQLite + FTS5) before hitting the network. '
      + 'Returns stored records with DOI, venue, open-access PDF link and source list, so you can reuse '
      + 'work already done instead of burning source budgets again.',
    parameters: {
      q: { type: 'string', description: 'Full-text query over stored titles and abstracts. Omit to list recent records.' },
      projectId: { type: 'string', description: 'Restrict to one project id.' },
      yearFrom: { type: 'integer', description: 'Earliest year (inclusive).' },
      oaOnly: { type: 'boolean', description: 'Only records that have an open-access PDF link.' },
      limit: { type: 'integer', description: 'Max rows, 1-200. Defaults to 30.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          rows: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                doi: { type: 'string' },
                year: { type: 'integer' },
                venue: { type: 'string' },
                citedByCount: { type: 'integer' },
                oaPdfUrl: { type: 'string' },
                sources: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.count === 0) return [{ type: 'text', text: '本地库没有命中：这是新方向，可以放心去检索。' }]
        const lines = [`本地库命中 ${value.count} 篇：`]
        value.rows.forEach((r, i) => {
          lines.push(`${i + 1}. ${r.title}［${[r.year, r.venue, r.citedByCount != null ? `被引${r.citedByCount}` : null].filter(Boolean).join(' · ')}］`)
          if (r.doi) lines.push(`   DOI ${r.doi}${r.oaPdfUrl ? ' · 有 OA PDF' : ''}`)
        })
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const rt = runtimeOf(ctx)
      try {
        const rows = rt.store.searchPapers({
          q: args.q || null,
          projectId: args.projectId || null,
          yearFrom: args.yearFrom || null,
          oaOnly: args.oaOnly === true,
          limit: args.limit || 30,
        })
        return {
          count: rows.length,
          rows: rows.map((r) => ({
            id: r.id,
            title: r.title || '(无题)',
            ...(r.doi ? { doi: r.doi } : {}),
            ...(r.year ? { year: r.year } : {}),
            ...(r.venue ? { venue: r.venue } : {}),
            ...(Number.isFinite(r.cited_by_count) ? { citedByCount: r.cited_by_count } : {}),
            ...(r.oa_pdf_url ? { oaPdfUrl: r.oa_pdf_url } : {}),
            sources: Array.isArray(r.sources) ? r.sources : [],
          })),
        }
      } catch (error) { rethrow(error) }
    },
  }))

  /* ── 3. 渠道健康矩阵 ──────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_source_status',
    description:
      'Report the health of every retrieval channel: last status, hits, error, cooldown, OpenAlex dollar budget left, '
      + 'per-host rate limits and circuit-breaker state. Check this before a big search or when results look thin.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          schemaVersion: { type: 'integer', required: true },
          papers: { type: 'integer', required: true },
          openalexBudget: {
            type: 'object', additionalProperties: false,
            properties: {
              remainingUsd: { type: 'number' },
              spentUsd: { type: 'number' },
              limitUsd: { type: 'number' },
              resetInMs: { type: 'integer' },
            },
          },
          sources: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                host: { type: 'string', required: true },
                capabilities: { type: 'array', required: true, items: { type: 'string' } },
                lastOk: { type: 'boolean' },
                lastError: { type: 'string' },
                cooldownForMs: { type: 'integer' },
                totalRuns: { type: 'integer' },
                totalHits: { type: 'integer' },
                limitation: { type: 'string' },
              },
            },
          },
          cache: {
            type: 'object', additionalProperties: false,
            properties: {
              entries: { type: 'integer' },
              bytes: { type: 'integer' },
              hits: { type: 'integer' },
              misses: { type: 'integer' },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [`渠道矩阵（schema v${value.schemaVersion}，本地 ${value.papers} 篇）`]
        if (value.openalexBudget?.remainingUsd != null) {
          const b = value.openalexBudget
          lines.push(`OpenAlex 预算：剩 $${b.remainingUsd.toFixed(3)} / 上限 $${(b.limitUsd ?? 0).toFixed(2)}；已用 $${b.spentUsd}；${Math.round((b.resetInMs || 0) / 60000)} 分钟后重置`)
        }
        for (const s of value.sources) {
          const state = s.cooldownForMs > 0 ? `冷却 ${Math.round(s.cooldownForMs / 1000)}s` : (s.lastOk === false ? `故障：${s.lastError || '未知'}` : (s.lastOk ? 'ok' : '未使用'))
          lines.push(`- ${s.id.padEnd(11)} ${state.padEnd(22)} 累计 ${s.totalHits ?? 0} 命中 / ${s.totalRuns ?? 0} 次　能力 ${s.capabilities.join(',')}`)
        }
        if (value.cache) lines.push(`缓存：${value.cache.entries} 条 / ${(value.cache.bytes / 1048576).toFixed(1)}MB（命中 ${value.cache.hits} 次）`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute() {
      const rt = runtimeOf(ctx)
      try {
        const states = new Map(rt.store.sourceStates().map((row) => [row.id, row]))
        const breakers = rt.breaker.snapshot()
        const budget = rt.budget.snapshot()
        const caps = (s) => Object.entries(s.capabilities || {}).filter(([, v]) => v).map(([k]) => k)
        return {
          schemaVersion: rt.store.version(),
          papers: rt.store.stats().papers,
          ...(budget.remainingUsd != null ? {
            openalexBudget: {
              remainingUsd: budget.remainingUsd,
              spentUsd: budget.spentUsd,
              ...(budget.limitUsd != null ? { limitUsd: budget.limitUsd } : {}),
              ...(budget.resetInMs != null ? { resetInMs: budget.resetInMs } : {}),
            },
          } : {}),
          sources: rt.sources.map((s) => {
            const row = states.get(s.id)
            const br = breakers[s.id]
            return {
              id: s.id,
              label: s.label,
              host: s.host,
              capabilities: caps(s),
              ...(row ? { lastOk: row.ok === 1 } : {}),
              ...(br?.lastError || row?.last_error ? { lastError: String(br?.lastError || row.last_error).slice(0, 160) } : {}),
              ...(br?.cooldownForMs ? { cooldownForMs: br.cooldownForMs } : {}),
              ...(row ? { totalRuns: row.total_runs, totalHits: row.total_hits } : {}),
              ...(s.limitation ? { limitation: s.limitation } : {}),
            }
          }),
          cache: rt.cache.stats(),
        }
      } catch (error) { rethrow(error) }
    },
  }))

  /* ── 4. 渠道体检（真发请求） ───────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_retrieval_doctor',
    description:
      'Probe every retrieval channel with one real request and report the true status code, latency, parsed record count '
      + 'and whether the response was a bot-check page. Use it when a search returns suspiciously little, to tell '
      + '"source broke" apart from "query too narrow". With include:"intel" it probes the three journal-intel sources '
      + '(OpenAlex profile, SciRev, LetPub) instead, each with one real request.',
    parameters: {
      sources: {
        type: 'array',
        description: 'Subset of source ids to probe. Defaults to all of them.',
        items: { type: 'string' },
      },
      include: {
        type: 'string',
        description: 'retrieval (default) probes the ten paper sources; intel probes openalex/scirev/letpub; all probes both.',
      },
      timeoutMs: { type: 'integer', description: 'Per-request timeout, 3000-60000. Defaults to 15000.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          okCount: { type: 'integer', required: true },
          total: { type: 'integer', required: true },
          probes: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                ok: { type: 'boolean', required: true },
                status: { type: 'integer' },
                ms: { type: 'integer' },
                parsed: { type: 'integer' },
                blockedPage: { type: 'boolean' },
                transport: { type: 'string' },
                error: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [`探针 ${value.okCount}/${value.total} 可用`]
        for (const p of value.probes) {
          const verdict = p.ok ? `ok(${p.parsed} 条)` : (p.blockedPage ? '被反爬页面拦截' : `失败${p.status ? ` ${p.status}` : ''}`)
          lines.push(`- ${p.id.padEnd(11)} ${String(verdict).padEnd(20)} ${String(p.ms ?? 0).padStart(6)}ms ${p.transport || ''}${p.error ? ` ${p.error.slice(0, 80)}` : ''}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const rt = runtimeOf(ctx)
      const ids = (args.sources && args.sources.length > 0 ? args.sources : rt.sources.map((s) => s.id))
      try {
        /* 串行错峰：并发打九个源会让 Zenodo 这类站点把整轮判成突发流量 */
        const probes = []
        for (const id of ids) {
          try {
            const p = await rt.registry.probe(id, { timeoutMs: args.timeoutMs || 15000 })
            probes.push({
              id: p.id,
              ok: p.ok === true,
              ...(Number.isFinite(p.status) ? { status: p.status } : {}),
              ...(Number.isFinite(p.ms) ? { ms: p.ms } : {}),
              ...(Number.isFinite(p.parsed) ? { parsed: p.parsed } : {}),
              ...(p.blockedPage ? { blockedPage: true } : {}),
              ...(p.transport ? { transport: p.transport } : {}),
              ...(p.error ? { error: String(p.error).slice(0, 160) } : {}),
            })
          } catch (error) {
            probes.push({ id, ok: false, error: String(error.message || error).slice(0, 160) })
          }
          await new Promise((resolve) => { setTimeout(resolve, 250) })
        }
        return { okCount: probes.filter((p) => p.ok).length, total: probes.length, probes }
      } catch (error) { rethrow(error) }
    },
  }))

  ctx.logger?.info?.('science: 检索工具已注册（search / lit_query / source_status / retrieval_doctor）')
}

export default { name, inject, apply }
