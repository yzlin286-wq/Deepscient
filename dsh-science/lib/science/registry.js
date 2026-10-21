/**
 * 源调度：单源执行 + 并发扇出。
 *
 * 所有"这个源现在能不能打"的判断都集中在这里：
 *   熔断中 → 跳过；预算不足 → 跳过；429 → 退避整个 host；403 → 立刻熔断。
 * 扇出时一个源失败不影响其他源，返回里带 skipped/error 原因。
 */
import { SOURCES, getSource } from './sources/free.js'
import { translate } from './query.js'

/** 给 URL 追加 api_key（仅 openalex 用）。 */
function withKey(url, key) {
  if (!key) return url
  const u = new URL(url)
  u.searchParams.set('api_key', key)
  return u.toString()
}

export function createRegistry({ client, limiter, breaker, budget, mailto = '', openalexKey = '', logger = null }) {
  /**
   * 跑一个源。
   * @returns {{id,label,ok,status,ms,count,records,skipped?,error?}}
   */
  async function run(id, dsl, { page = 1, limit } = {}) {
    const src = getSource(id)
    if (!src) return { id, label: id, ok: false, count: 0, records: [], error: '未知源' }

    const base = { id, label: src.label, host: src.host }

    if (breaker.isOpen(id)) {
      return { ...base, ok: false, skipped: 'cooldown', cooldownMs: breaker.snapshot()[id]?.cooldownForMs ?? 0, count: 0, records: [] }
    }
    if (src.needsBudget && budget && !budget.canSpend()) {
      return { ...base, ok: false, skipped: 'budget', count: 0, records: [] }
    }

    let req
    try {
      req = translate(dsl, id, { mailto, page, limit })
      if (id === 'openalex') req.url = withKey(req.url, openalexKey)
    } catch (error) {
      return { ...base, ok: false, error: `检索式翻译失败: ${error.message}`, count: 0, records: [] }
    }

    const started = Date.now()
    const send = () => (src.isXml ? client.text(req.url) : client.json(req.url))
    let res = await send()
    let ms = Date.now() - started

    /* 403 未必是权限问题：Zenodo 这类站点对突发就回 403，退避一次再判死刑 */
    if (res.status === 403) {
      limiter.backoff(src.host, 0)
      res = await send()
      ms = Date.now() - started
    }

    if (res.status === 0) {
      breaker.fail(id, res.error || 'network')
      return { ...base, ok: false, ms, status: 0, error: res.error || '网络失败', count: 0, records: [] }
    }
    if (res.status === 429) {
      const wait = limiter.backoff(src.host)
      breaker.fail(id, 'HTTP 429', { hard: false })
      return { ...base, ok: false, ms, status: 429, skipped: 'ratelimited', cooldownMs: wait, error: '429 rate limited', count: 0, records: [] }
    }
    if (res.status === 403 || res.status === 401) {
      breaker.fail(id, `HTTP ${res.status}`, { hard: true })
      return { ...base, ok: false, ms, status: res.status, error: `被拒 (${res.status})：可能需要代理或 key`, count: 0, records: [] }
    }
    if (!res.ok) {
      breaker.fail(id, `HTTP ${res.status}`)
      return { ...base, ok: false, ms, status: res.status, error: `HTTP ${res.status}`, count: 0, records: [] }
    }

    let records = []
    try {
      records = src.isXml ? src.parse(res.text) : src.parse(res.data)
    } catch (error) {
      breaker.fail(id, `解析失败: ${error.message}`)
      return { ...base, ok: false, ms, status: res.status, error: `解析失败: ${error.message}`, count: 0, records: [] }
    }

    // 两步源（pubmed：esearch 只给 id，再 esummary 补详情）
    if (typeof src.followUp === 'function' && records.length > 0 && records.every((r) => r && r.__id)) {
      try {
        const ids = records.map((r) => r.__id)
        records = await src.followUp(ids, { client, mailto })
      } catch (error) {
        breaker.fail(id, `二次请求失败: ${error.message}`)
        return { ...base, ok: false, ms, status: res.status, error: `二次请求失败: ${error.message}`, count: 0, records: [] }
      }
    }

    const clean = records.filter((r) => r && r.title)
    breaker.ok(id)
    if (logger) logger.debug?.(`science/source ${id}: ${clean.length} 条 / ${ms}ms / ${res.fromCache ? 'cache' : 'net'}`)
    return { ...base, ok: true, ms, status: res.status, count: clean.length, records: clean, fromCache: res.fromCache === true }
  }

  /** 并发扇出；单源异常绝不影响整体。 */
  async function fanout(dsl, { sources, limit, page } = {}) {
    const ids = (sources && sources.length > 0 ? sources : SOURCES.map((s) => s.id))
      .filter((id) => getSource(id))
    const started = Date.now()
    const settled = await Promise.all(ids.map((id) => run(id, dsl, { page, limit })
      .catch((error) => ({ id, label: id, ok: false, count: 0, records: [], error: `未捕获异常: ${error.message}` }))))
    return { results: settled, ms: Date.now() - started }
  }

  /** 探测单个 URL 的健康度（retrieval_doctor 用）。 */
  async function probe(id, { timeoutMs = 15000 } = {}) {
    const src = getSource(id)
    if (!src) return { id, ok: false, error: '未知源' }
    const req = translate({ blocks: [['protein folding']], filters: {}, limit: 1 }, id, { mailto })
    const url = id === 'openalex' ? withKey(req.url, openalexKey) : req.url
    const started = Date.now()
    const send = () => (src.isXml ? client.text(url, { timeoutMs, skipCache: true }) : client.json(url, { timeoutMs, skipCache: true }))
    let res = await send()
    /* 403 先当限流处理，退避一档再试一次（Zenodo 这类站点突发就回 403） */
    if (res.status === 403) {
      limiter.backoff(src.host, 1)
      await new Promise((resolve) => { setTimeout(resolve, Math.min(limiter.blockedFor(src.host), 20_000)) })
      res = await send()
    }
    const ms = Date.now() - started
    let parsed = 0
    let parseError = null
    if (res.ok) {
      try {
        parsed = src.isXml ? src.parse(res.text).length : src.parse(res.data).length
      } catch (error) { parseError = error.message }
    }
    const blocked = /sorry|unusual traffic|captcha|are you a robot/i.test(
      (res.res ? res.res.body?.toString('utf8').slice(0, 2000) : '') || '',
    )
    return {
      id, label: src.label, host: src.host,
      ok: res.ok && parsed > 0,
      status: res.status,
      ms,
      scanned: res.res?.body?.length || 0,
      contentType: res.res?.contentType || '',
      parsed,
      transport: res.res?.transport || null,
      fromCache: res.res?.fromCache === true,
      blockedPage: blocked,
      error: res.error || parseError || null,
    }
  }

  return { run, fanout, probe, list: () => SOURCES }
}

export default { createRegistry }
