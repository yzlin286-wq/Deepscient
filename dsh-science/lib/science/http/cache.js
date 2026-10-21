/**
 * HTTP 响应缓存：SQLite 存元信息，body 落文件。
 *
 * 规则：
 *   - 只缓存 2xx（403/429 不缓存，否则一次失败会污染整轮回归）
 *   - key 含传输参数指纹，换 UA/代理不会串味
 *   - TTL 分级：元数据 7 天，全文 PDF 30 天，HTML 1 天
 */
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TTL = {
  json: 7 * 86_400_000,
  xml: 7 * 86_400_000,
  pdf: 30 * 86_400_000,
  html: 86_400_000,
}

function headersView(map) {
  const normalized = {}
  for (const [name, value] of Object.entries(map || {})) normalized[String(name).toLowerCase()] = value
  return {
    get(name) {
      const v = normalized[String(name).toLowerCase()]
      return Array.isArray(v) ? v[0] : (v ?? null)
    },
    all(name) {
      const v = normalized[String(name).toLowerCase()]
      if (v == null) return []
      return Array.isArray(v) ? v : [v]
    },
    toJSON() { return normalized },
  }
}

export class HttpCache {
  /**
   * @param db  已打开的 DatabaseSync
   * @param dir body 存放目录
   */
  constructor({ db, dir, defaultTtlMs = TTL.json, maxBytes = 4 * 1024 ** 3 } = {}) {
    this.db = db
    this.dir = dir
    this.defaultTtlMs = defaultTtlMs
    this.maxBytes = maxBytes
    this.hits = 0
    this.misses = 0
    this.stores = 0
    if (this.dir) mkdirSync(this.dir, { recursive: true })
    this.ensure()
  }

  ensure() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS http_cache(
        key TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        status INTEGER NOT NULL,
        headers_json TEXT,
        body_path TEXT,
        bytes INTEGER,
        content_type TEXT,
        final_url TEXT,
        fetched_at INTEGER NOT NULL,
        ttl INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS http_cache_fetched ON http_cache(fetched_at);
    `)
  }

  key(url, headerFingerprint) {
    const extra = headerFingerprint ? JSON.stringify(headerFingerprint) : ''
    return createHash('sha256').update(`${url}|${extra}`).digest('hex').slice(0, 32)
  }

  pathFor(key) {
    const bucket = key.slice(0, 2)
    mkdirSync(join(this.dir, bucket), { recursive: true })
    return join(this.dir, bucket, `${key}.bin`)
  }

  ttlFor(entry) {
    if (entry.ttlMs) return entry.ttlMs
    const ct = String(entry.contentType || '')
    if (ct.includes('pdf')) return TTL.pdf
    if (ct.includes('html')) return TTL.html
    if (ct.includes('xml')) return TTL.xml
    return this.defaultTtlMs
  }

  get(url, headerFingerprint) {
    const key = this.key(url, headerFingerprint)
    const row = this.db.prepare('SELECT * FROM http_cache WHERE key = ?').get(key)
    if (!row) { this.misses += 1; return null }
    if (Date.now() - row.fetched_at > row.ttl) {
      this.db.prepare('DELETE FROM http_cache WHERE key = ?').run(key)
      this.misses += 1
      return null
    }
    if (!row.body_path || !existsSync(row.body_path)) {
      this.db.prepare('DELETE FROM http_cache WHERE key = ?').run(key)
      this.misses += 1
      return null
    }
    this.hits += 1
    return {
      status: row.status,
      headers: headersView(JSON.parse(row.headers_json || '{}')),
      body: readFileSync(row.body_path),
      contentType: row.content_type || '',
      finalUrl: row.final_url || row.url,
      fetchedAt: row.fetched_at,
    }
  }

  put(url, entry, headerFingerprint) {
    const key = this.key(url, headerFingerprint)
    const path = this.pathFor(key)
    writeFileSync(path, entry.body)
    this.db.prepare(`
      INSERT INTO http_cache(key,url,status,headers_json,body_path,bytes,content_type,final_url,fetched_at,ttl)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET
        status=excluded.status, headers_json=excluded.headers_json, body_path=excluded.body_path,
        bytes=excluded.bytes, content_type=excluded.content_type, final_url=excluded.final_url,
        fetched_at=excluded.fetched_at, ttl=excluded.ttl
    `).run(
      key, url, entry.status, JSON.stringify(entry.headers || {}), path,
      entry.body.length, entry.contentType || '', entry.finalUrl || url,
      Date.now(), this.ttlFor(entry),
    )
    this.stores += 1
    return key
  }

  /** 清过期条目与孤儿文件，返回释放的字节数。 */
  prune() {
    const now = Date.now()
    const expired = this.db.prepare('SELECT key, body_path, bytes FROM http_cache WHERE ? - fetched_at > ttl').all(now)
    let freed = 0
    for (const row of expired) {
      if (row.body_path && existsSync(row.body_path)) {
        try { freed += statSync(row.body_path).size; rmSync(row.body_path, { force: true }) } catch { /* ignore */ }
      }
      this.db.prepare('DELETE FROM http_cache WHERE key = ?').run(row.key)
    }
    return { removed: expired.length, freedBytes: freed }
  }

  stats() {
    const row = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes),0) AS bytes FROM http_cache').get()
    return { entries: row.n, bytes: row.bytes, hits: this.hits, misses: this.misses, stores: this.stores }
  }
}

export { TTL, headersView }
export default { HttpCache, TTL, headersView }
