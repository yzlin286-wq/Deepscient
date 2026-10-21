/**
 * 统一 HTTP 客户端：一个入口，三种传输，全部 Cookie 感知。
 *
 * 为什么不是一个裸 fetch：
 *   - 学术站点大量用 Cookie 门（Springer/Nature 会 302 到 "cookies_not_supported"）
 *   - 部分站点按 TLS/UA 指纹拦截（CNKI 直接 RST），需要能切 curl 子进程带代理
 *   - 缓存与限速必须在发请求之前生效，不能散落在各 adapter
 *
 * 约定：调用方只拿到归一化结果，永远不自己发请求。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
]

/** 极简 CookieJar：按 host 存 name=value，够学术站点用。 */
class CookieJar {
  constructor() { this.byHost = new Map() }

  /** 取某 host 适用的 Cookie 头。 */
  header(host) {
    const parts = []
    for (const [domain, jar] of this.byHost) {
      if (host === domain || host.endsWith('.' + domain)) {
        for (const [name, value] of jar) parts.push(`${name}=${value}`)
      }
    }
    return parts.join('; ')
  }

  absorb(host, setCookieList) {
    if (!setCookieList || setCookieList.length === 0) return
    let jar = this.byHost.get(host)
    if (!jar) { jar = new Map(); this.byHost.set(host, jar) }
    for (const raw of setCookieList) {
      const first = String(raw).split(';')[0]
      const eq = first.indexOf('=')
      if (eq <= 0) continue
      const name = first.slice(0, eq).trim()
      const value = first.slice(eq + 1).trim()
      if (!name) continue
      if (/^(expires|max-age|path|domain|secure|httponly|samesite)$/i.test(name)) continue
      jar.set(name, value)
    }
  }

  snapshot() {
    const out = {}
    for (const [host, jar] of this.byHost) out[host] = Object.fromEntries(jar)
    return out
  }

  load(snapshot) {
    if (!snapshot) return
    for (const [host, pairs] of Object.entries(snapshot)) this.byHost.set(host, new Map(Object.entries(pairs)))
  }
}

/** 响应头归一化：全小写键，多值合成数组，暴露 get()。 */
function makeHeaders(raw) {
  const map = {}
  for (const [name, value] of Object.entries(raw || {})) {
    const key = name.toLowerCase()
    map[key] = Array.isArray(value) ? value : String(value)
  }
  return {
    get(name) {
      const v = map[String(name).toLowerCase()]
      return Array.isArray(v) ? v[0] : (v ?? null)
    },
    all(name) {
      const v = map[String(name).toLowerCase()]
      if (v == null) return []
      return Array.isArray(v) ? v : [v]
    },
    toJSON() { return map },
  }
}

/**
 * @param opts.cache      HttpCache 实例（可为 null）
 * @param opts.limiter    RateLimiter 实例（可为 null）
 * @param opts.budget     Budget 实例（可为 null，仅 openalex 用）
 * @param opts.proxies    string[] 代理池
 * @param opts.transport  'auto' | 'fetch' | 'curl'；auto 时遇到 needsProxy/needsCurl 的 host 自动切 curl
 */
export function createClient(opts = {}) {
  const {
    cache = null,
    limiter = null,
    budget = null,
    proxies = [],
    transport = 'auto',
    timeoutMs = 25000,
    logger = null,
    curlHosts = new Set(),
  } = opts

  const jar = new CookieJar()
  let proxyIndex = 0
  const stats = { requests: 0, cacheHits: 0, failures: 0, curlRuns: 0, byHost: {} }

  function pickProxy() {
    if (proxies.length === 0) return null
    const proxy = proxies[proxyIndex % proxies.length]
    proxyIndex += 1
    return proxy
  }

  function bump(host, field) {
    const row = stats.byHost[host] || (stats.byHost[host] = { requests: 0, failures: 0, ms: 0, cacheHits: 0 })
    row[field] += 1
  }

  async function viaCurl(url, requestHeaders, method, body, proxy, timeout) {
    const dir = mkdtempSync(join(tmpdir(), 'dshsci-'))
    const bodyFile = join(dir, 'body.bin')
    const headFile = join(dir, 'head.txt')
    const jarFile = join(dir, 'jar.txt')
    const cookieIn = jar.header(new URL(url).host)
    if (cookieIn) writeFileSync(jarFile, `${cookieIn}\n`)
    const args = [
      '-s', '-L', '--compressed',
      '--max-time', String(Math.ceil(timeout / 1000)),
      '-A', requestHeaders['user-agent'],
      '-D', headFile, '-o', bodyFile,
      '-c', jarFile, '-b', jarFile,
      '-w', '%{http_code}|%{content_type}|%{url_effective}',
    ]
    if (proxy) args.push('--proxy', proxy)
    if (method && method !== 'GET') args.push('-X', method)
    for (const [name, value] of Object.entries(requestHeaders)) {
      if (name.toLowerCase() === 'user-agent') continue
      args.push('-H', `${name}: ${value}`)
    }
    if (body) args.push('--data-binary', body)
    args.push(url)
    stats.curlRuns += 1
    try {
      const { stdout } = await execFileAsync('curl', args, { timeout: timeout + 5000, windowsHide: true, maxBuffer: 1 << 20 })
      const [codeRaw, contentType, finalUrl] = String(stdout).trim().split('|')
      const headRaw = readFileSync(headFile, 'utf8')
      const rawHeaders = {}
      for (const line of headRaw.split(/\r?\n/)) {
        const idx = line.indexOf(':')
        if (idx <= 0) continue
        const name = line.slice(0, idx).trim().toLowerCase()
        const value = line.slice(idx + 1).trim()
        if (!name || name.startsWith('http/')) continue
        if (rawHeaders[name]) rawHeaders[name] = [].concat(rawHeaders[name], value)
        else rawHeaders[name] = value
      }
      const bodyBuf = readFileSync(bodyFile)
      const setCookie = [].concat(rawHeaders['set-cookie'] || [])
      jar.absorb(new URL(url).host, setCookie)
      return {
        status: Number(codeRaw) || 0,
        headers: makeHeaders(rawHeaders),
        body: bodyBuf,
        contentType: contentType || rawHeaders['content-type'] || '',
        finalUrl: finalUrl || url,
        transport: 'curl',
        proxy,
      }
    } finally {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }

  async function viaFetch(url, requestHeaders, method, body, timeout) {
    const res = await fetch(url, {
      method: method || 'GET',
      headers: requestHeaders,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    })
    const ab = await res.arrayBuffer()
    const rawHeaders = {}
    const setCookie = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
    for (const [name, value] of res.headers.entries()) rawHeaders[name] = value
    jar.absorb(new URL(url).host, setCookie)
    return {
      status: res.status,
      headers: makeHeaders(rawHeaders),
      body: Buffer.from(ab),
      contentType: res.headers.get('content-type') || '',
      finalUrl: res.url || url,
      transport: 'fetch',
      proxy: null,
    }
  }

  /**
   * 发一个请求。
   * @param url
   * @param opts.method / headers / body / timeoutMs / proxy / forceTransport / cacheTtlMs / skipCache
   */
  async function request(url, opts = {}) {
    const parsed = new URL(url)
    const host = parsed.host
    const method = opts.method || 'GET'
    const timeout = opts.timeoutMs || timeoutMs
    const skipCache = opts.skipCache === true || method !== 'GET'

    if (!skipCache && cache) {
      const hit = cache.get(url, opts.headers)
      if (hit) {
        stats.cacheHits += 1
        bump(host, 'cacheHits')
        return { ...hit, fromCache: true, ms: 0 }
      }
    }

    if (limiter) await limiter.acquire(host)

    const ua = UA_POOL[Math.floor(Math.random() * UA_POOL.length)]
    const headers = {
      'user-agent': ua,
      'accept': opts.accept || 'application/json,text/xml,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      ...(opts.headers || {}),
    }
    const cookie = jar.header(host)
    if (cookie) headers.cookie = cookie

    const wantCurl = opts.forceTransport === 'curl'
      || (transport === 'auto' && (curlHosts.has(host) || (opts.useProxy && proxies.length > 0)))
    const proxy = opts.proxy !== undefined ? opts.proxy : (opts.useProxy ? pickProxy() : null)

    const started = Date.now()
    stats.requests += 1
    bump(host, 'requests')

    let result
    try {
      result = wantCurl
        ? await viaCurl(url, headers, method, opts.body, proxy, timeout)
        : await viaFetch(url, headers, method, opts.body, timeout)
    } catch (error) {
      stats.failures += 1
      bump(host, 'failures')
      const message = error && error.message ? String(error.message) : String(error)
      if (logger) logger.warn?.(`science/http ${host} 失败: ${message}`)
      return {
        status: 0,
        headers: makeHeaders({}),
        body: Buffer.alloc(0),
        contentType: '',
        finalUrl: url,
        transport: wantCurl ? 'curl' : 'fetch',
        proxy,
        error: message,
        ms: Date.now() - started,
        fromCache: false,
      }
    }

    result.ms = Date.now() - started
    bump(host, 'ms')
    stats.byHost[host].ms += result.ms

    if (budget && host === 'api.openalex.org') budget.absorb(result.headers)

    if (!skipCache && cache && result.status >= 200 && result.status < 300) {
      cache.put(url, {
        status: result.status,
        headers: result.headers.toJSON(),
        body: result.body,
        contentType: result.contentType,
        finalUrl: result.finalUrl,
        ttlMs: opts.cacheTtlMs,
      }, opts.headers)
    }

    return { ...result, fromCache: false }
  }

  /** 便捷方法：JSON。 */
  async function json(url, opts = {}) {
    const res = await request(url, { ...opts, accept: 'application/json' })
    const fromCache = res.fromCache === true
    if (res.status === 0) return { ok: false, status: 0, error: res.error, res, fromCache }
    const text = res.body.toString('utf8')
    if (!res.contentType.includes('json') && !text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) {
      return { ok: false, status: res.status, error: `非 JSON 响应 (${res.contentType || 'unknown'})`, res, fromCache }
    }
    try {
      return { ok: res.status >= 200 && res.status < 300, status: res.status, data: JSON.parse(text), res, fromCache }
    } catch (error) {
      return { ok: false, status: res.status, error: `JSON 解析失败: ${error.message}`, res, fromCache }
    }
  }

  /** 便捷方法：文本/XML。 */
  async function text(url, opts = {}) {
    const res = await request(url, { ...opts, accept: opts.accept || 'application/xml,text/xml,text/html,*/*;q=0.8' })
    return { ok: res.status >= 200 && res.status < 300, status: res.status, text: res.body.toString('utf8'), res, fromCache: res.fromCache === true }
  }

  return {
    request, json, text,
    jar,
    stats: () => ({ ...stats, byHost: { ...stats.byHost } }),
    cookieSnapshot: () => jar.snapshot(),
    loadCookies: (snapshot) => jar.load(snapshot),
    addCurlHosts: (hosts) => { for (const h of hosts) curlHosts.add(h) },
  }
}

export default { createClient }
