/**
 * 一次检索的完整编排：DSL → 扇出 → 去重 → 排序 → 落库 → 报告。
 *
 * 报告要能回答"这次检索可信吗"：每个源命中多少、谁被跳过、花了多少钱、用了多久。
 */
import { buildDsl } from './query.js'
import { dedupe, rank, toGbtCitation } from './record.js'

export function createPipeline({ registry, store, budget, breaker, limiter, cache, logger = null }) {
  /**
   * @param input  用户输入（{query} 或 {blocks,filters,limit}）
   * @param opts   {projectId, sources, limit, persist, page}
   */
  async function search(input, opts = {}) {
    const dsl = buildDsl(input)
    const startedAt = Date.now()
    const limit = opts.limit || dsl.limit
    const { results, ms } = await registry.fanout(dsl, { sources: opts.sources, limit, page: opts.page })

    const all = []
    const hitsPerSource = {}
    for (const r of results) {
      hitsPerSource[r.id] = r.count || 0
      if (r.records) all.push(...r.records)
    }

    const unique = dedupe(all)
    const ranked = rank(unique, dsl)

    let persisted = { inserted: 0, updated: 0, ids: [] }
    if (opts.persist !== false && store && ranked.length > 0) {
      try {
        persisted = store.upsertPapers(ranked, { projectId: opts.projectId || null })
      } catch (error) {
        if (logger) logger.warn?.(`science/pipeline 落库失败: ${error.message}`)
      }
    }

    if (store) {
      try {
        store.logQuery({
          projectId: opts.projectId,
          dsl,
          sources: results.map((r) => r.id),
          startedAt,
          ms: Date.now() - startedAt,
          hitsPerSource,
          total: ranked.length,
          costUsd: budget ? budget.snapshot().spentUsd : null,
          error: results.filter((r) => r.error).map((r) => `${r.id}:${r.error}`).join('; ') || null,
        })
        store.saveSourceStates(results.map((r) => ({
          id: r.id,
          host: r.host,
          ok: r.ok,
          cooldownUntil: r.cooldownMs ? Date.now() + r.cooldownMs : 0,
          failures: r.ok ? 0 : 1,
          error: r.error || r.skipped || null,
          ms: r.ms,
          count: r.count,
          budgetUsedUsd: budget ? budget.snapshot().spentUsd : null,
        })))
      } catch (error) {
        if (logger) logger.warn?.(`science/pipeline 记日志失败: ${error.message}`)
      }
    }

    return {
      dsl,
      total: ranked.length,
      ms: Date.now() - startedAt,
      perSource: results.map((r) => ({
        id: r.id,
        label: r.label,
        ok: r.ok,
        count: r.count || 0,
        ms: r.ms || 0,
        status: r.status ?? null,
        skipped: r.skipped || null,
        error: r.error || null,
        fromCache: r.fromCache === true,
      })),
      skipped: results.filter((r) => r.skipped).map((r) => ({ id: r.id, reason: r.skipped })),
      failed: results.filter((r) => !r.ok && !r.skipped).map((r) => ({ id: r.id, error: r.error })),
      persisted,
      budget: budget ? budget.snapshot() : null,
      records: ranked.slice(0, opts.returnLimit || 40),
    }
  }

  /** 检索结果的紧凑文本视图（工具 render 用，省 token）。 */
  function summarize(report, { limit = 12, withAbstract = false } = {}) {
    const lines = []
    lines.push(`命中 ${report.total} 篇（去重后）｜耗时 ${report.ms}ms｜落库 +${report.persisted.inserted} ~${report.persisted.updated}`)
    const srcLine = report.perSource
      .map((s) => `${s.id}=${s.skipped ? `跳过(${s.skipped})` : (s.ok ? s.count : 'ERR')}`)
      .join(' ')
    lines.push(`源：${srcLine}`)
    if (report.budget && report.budget.remainingUsd != null) {
      lines.push(`OpenAlex 预算：剩 $${report.budget.remainingUsd.toFixed(3)} / 用掉 $${report.budget.spentUsd}`)
    }
    report.records.slice(0, limit).forEach((r, i) => {
      const bits = [r.year, r.venue, r.citedByCount != null ? `被引${r.citedByCount}` : null, r.oaPdfUrl ? 'OA-PDF' : null]
        .filter(Boolean).join(' · ')
      lines.push(`${i + 1}. ${r.title} [${bits}] <${r.sources.join('+')}>`)
      if (r.doi) lines.push(`   DOI ${r.doi}`)
      else if (r.arxivId) lines.push(`   arXiv ${r.arxivId}`)
      if (withAbstract && r.abstract) lines.push(`   ${r.abstract.slice(0, 300)}${r.abstract.length > 300 ? '…' : ''}`)
    })
    if (report.records.length > limit) lines.push(`…还有 ${report.records.length - limit} 篇`)
    return lines.join('\n')
  }

  /** 一条 GB/T 7714 引用（写作阶段用）。 */
  function cite(record) {
    return toGbtCitation(record)
  }

  return { search, summarize, cite }
}

export default { createPipeline }
