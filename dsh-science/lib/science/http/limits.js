/**
 * 限速 / 预算 / 熔断：三个都在「发请求之前」生效。
 *
 * 参数全部来自本机实测（2026-10-20），不是拍脑袋：
 *   - openalex 无 key 有 $0.10/天 预算，响应头能看到剩余额
 *   - semanticscholar 无 key 连第二次就 429
 *   - arxiv 官方要求 3s/次
 *   - CNKI/万方/维普 需要抖动，否则容易触发风控
 */

/** 每 host 的限速表；未列出的用 fallback。 */
export const RATE_TABLE = {
  'api.openalex.org': { rps: 1, burst: 3 },
  'api.crossref.org': { rps: 2, burst: 5 },
  'www.ebi.ac.uk': { rps: 3, burst: 6 },
  'eutils.ncbi.nlm.nih.gov': { rps: 3, burst: 3 },
  'export.arxiv.org': { rps: 0.33, burst: 1 },
  'arxiv.org': { rps: 0.33, burst: 1 },
  'api.biorxiv.org': { rps: 1, burst: 2 },
  'doaj.org': { rps: 1, burst: 3 },
  'api.datacite.org': { rps: 2, burst: 4 },
  // Zenodo 对突发很敏感：同一 URL 单发 200、连发就 403，所以压到 0.5rps/单并发
  'zenodo.org': { rps: 0.5, burst: 1, backoff: [5_000, 15_000] },
  'api.openaire.eu': { rps: 1, burst: 2 },
  'api.semanticscholar.org': { rps: 0.2, burst: 1, backoff: [30_000, 60_000, 120_000] },
  'scholar.google.com': { rps: 0.05, burst: 1, backoff: [60_000] },
  'scholar.archive.org': { rps: 0.5, burst: 1 },
  'chn.oversea.cnki.net': { rps: 0.5, burst: 2, jitterMs: 3000 },
  's.wanfangdata.com.cn': { rps: 0.5, burst: 2, jitterMs: 2000 },
  'www.cqvip.com': { rps: 0.5, burst: 2, jitterMs: 2000 },
  'europepmc.org': { rps: 1, burst: 3 },
  'www.ncbi.nlm.nih.gov': { rps: 2, burst: 3 },
  'sci-hub.st': { rps: 0.2, burst: 1, backoff: [30_000] },
  'sci-hub.ru': { rps: 0.2, burst: 1, backoff: [30_000] },
  // 期刊情报三源（M3）：SciRev 静态页但站点轻，LetPub 反爬较紧故压到 0.3rps
  'scirev.org': { rps: 0.5, burst: 1, jitterMs: 500 },
  'www.letpub.com.cn': { rps: 0.3, burst: 1, jitterMs: 1200, backoff: [8_000, 20_000] },
  'letpub.com.cn': { rps: 0.3, burst: 1, jitterMs: 1200, backoff: [8_000, 20_000] },
  '__default': { rps: 0.5, burst: 2 },
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)) })

/** 令牌桶 + 抖动 + 显式退避窗口。 */
export class RateLimiter {
  constructor({ table = RATE_TABLE, now = () => Date.now() } = {}) {
    this.table = table
    this.now = now
    this.buckets = new Map()
    this.until = new Map()      // host -> 不能请求的时间戳
    this.records = new Map()    // host -> { waits, requests }
  }

  config(host) {
    return this.table[host] || this.table.__default
  }

  bucket(host) {
    let b = this.buckets.get(host)
    if (!b) {
      const cfg = this.config(host)
      b = { tokens: cfg.burst, last: this.now() }
      this.buckets.set(host, b)
    }
    return b
  }

  /** 阻塞直到可以发一个请求。 */
  async acquire(host) {
    const cfg = this.config(host)
    const blockedUntil = this.until.get(host) || 0
    if (blockedUntil > this.now()) await sleep(blockedUntil - this.now())

    const b = this.bucket(host)
    for (;;) {
      const now = this.now()
      const elapsed = (now - b.last) / 1000
      b.tokens = Math.min(cfg.burst, b.tokens + elapsed * cfg.rps)
      b.last = now
      if (b.tokens >= 1) {
        b.tokens -= 1
        break
      }
      const need = (1 - b.tokens) / cfg.rps
      await sleep(Math.ceil(need * 1000))
    }
    if (cfg.jitterMs) await sleep(Math.random() * cfg.jitterMs)

    const rec = this.records.get(host) || { waits: 0, requests: 0 }
    rec.requests += 1
    this.records.set(host, rec)
  }

  /** 429/503 后退避整个 host。 */
  backoff(host, attempt = 0) {
    const cfg = this.config(host)
    const ladder = cfg.backoff || [15_000, 30_000, 60_000]
    const wait = ladder[Math.min(attempt, ladder.length - 1)]
    this.until.set(host, this.now() + wait)
    const rec = this.records.get(host) || { waits: 0, requests: 0 }
    rec.waits += 1
    this.records.set(host, rec)
    return wait
  }

  blockedFor(host) {
    return Math.max(0, (this.until.get(host) || 0) - this.now())
  }

  snapshot() {
    const out = {}
    for (const host of new Set([...this.buckets.keys(), ...this.until.keys()])) {
      const cfg = this.config(host)
      const rec = this.records.get(host) || { waits: 0, requests: 0 }
      out[host] = { rps: cfg.rps, burst: cfg.burst, ...rec, blockedForMs: this.blockedFor(host) }
    }
    return out
  }
}

/**
 * OpenAlex 的美元预算。
 * 实测响应头：X-RateLimit-Limit-USD / -Remaining-USD / -Cost-USD / -Reset(秒)
 * 无 key 时每个 IP 共享 $0.10/天；带 key 是 $1/天。
 */
export class Budget {
  constructor({ floorUsd = 0.005 } = {}) {
    this.floorUsd = floorUsd
    this.limitUsd = null
    this.remainingUsd = null
    this.lastCostUsd = null
    this.resetAt = 0
    this.spentUsd = 0
    this.denied = 0
  }

  absorb(headers) {
    const num = (name) => {
      const raw = headers?.get?.(name)
      if (raw == null) return null
      const v = Number(raw)
      return Number.isFinite(v) ? v : null
    }
    const limit = num('x-ratelimit-limit-usd')
    const remaining = num('x-ratelimit-remaining-usd')
    const cost = num('x-ratelimit-cost-usd')
    const reset = num('x-ratelimit-reset')
    if (limit != null) this.limitUsd = limit
    if (remaining != null) this.remainingUsd = remaining
    if (cost != null) { this.lastCostUsd = cost; this.spentUsd += cost }
    if (reset != null) this.resetAt = Date.now() + reset * 1000
    return this
  }

  /** 还有钱就跑；不知道也跑（首次请求前 remainingUsd 为 null）。 */
  canSpend(estUsd = 0.001) {
    if (this.remainingUsd == null) return true
    const ok = this.remainingUsd - estUsd > this.floorUsd
    if (!ok) this.denied += 1
    return ok
  }

  snapshot() {
    return {
      limitUsd: this.limitUsd,
      remainingUsd: this.remainingUsd,
      spentUsd: Number(this.spentUsd.toFixed(4)),
      lastCostUsd: this.lastCostUsd,
      resetInMs: this.resetAt ? Math.max(0, this.resetAt - Date.now()) : null,
      floorUsd: this.floorUsd,
      denied: this.denied,
    }
  }
}

/** 连续失败就熔断，期间跳过但不报错。 */
export class CircuitBreaker {
  constructor({ threshold = 3, cooldownMs = 300_000 } = {}) {
    this.threshold = threshold
    this.cooldownMs = cooldownMs
    this.map = new Map()
  }

  row(id) {
    let r = this.map.get(id)
    if (!r) {
      r = { failures: 0, cooldownUntil: 0, lastError: null, totalOk: 0, totalFail: 0 }
      this.map.set(id, r)
    }
    return r
  }

  ok(id) {
    const r = this.row(id)
    r.failures = 0
    r.cooldownUntil = 0
    r.totalOk += 1
  }

  /** 返回冷却毫秒数；403/429 记长一点。 */
  fail(id, error, { hard = false } = {}) {
    const r = this.row(id)
    r.failures += 1
    r.totalFail += 1
    r.lastError = String(error || '').slice(0, 200)
    if (r.failures >= this.threshold || hard) {
      r.cooldownUntil = Date.now() + this.cooldownMs
    }
    return Math.max(0, r.cooldownUntil - Date.now())
  }

  isOpen(id) {
    const r = this.map.get(id)
    if (!r) return false
    return r.cooldownUntil > Date.now()
  }

  snapshot() {
    const out = {}
    for (const [id, r] of this.map) {
      out[id] = {
        failures: r.failures,
        totalOk: r.totalOk,
        totalFail: r.totalFail,
        open: r.cooldownUntil > Date.now(),
        cooldownForMs: Math.max(0, r.cooldownUntil - Date.now()),
        lastError: r.lastError,
      }
    }
    return out
  }
}

export default { RateLimiter, Budget, CircuitBreaker, RATE_TABLE }
