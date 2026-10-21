/**
 * 文献/检索 API 的接入台账：谁要什么凭据、写到哪、能不能当场验通。
 *
 * 三条纪律：
 *   1. **落点照实写**。dsh-science 的运行时只读 `retrieval.mailto / unpaywallEmail / openalexKey`
 *      （另有 `OPENALEX_KEY` 环境变量兜底），其余字段它是声明了但还没接进 registry。
 *      所以每条都带 `wired` 标记：`runtime` 是真生效，`declared` 是存下来 + 本页可测、工具侧尚未消费。
 *      不把「存了」说成「生效了」。
 *   2. **密钥不回显**。返回值里只有掩码；PUT 收明文但绝不回吐，错误串里也不带。
 *   3. **不合并成一个大 JSON**。科学包的 config.json 里还有 tools/export 等段落，写回时未知键原样保留。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { scienceRoot } from './science.js'

const MAX_VALUE = 512
const VERIFY_TIMEOUT_MS = 8000

export function retrievalConfigPath() {
  return join(scienceRoot(), 'config.json')
}

/**
 * 内置台账。`path` 是 science/config.json 里的点路径；`envName` 是同一凭据的备选环境变量名。
 */
export const SOURCES = Object.freeze([
  {
    id: 'semantic-scholar',
    name: 'Semantic Scholar',
    kind: 'key',
    path: 'retrieval.s2Key',
    envName: 'SEMANTIC_SCHOLAR_KEY',
    wired: 'declared',
    applyUrl: 'https://www.semanticscholar.org/product/api',
    hint: '免费 key 额度不高，但可以显著抬高限速。',
    test: {
      method: 'GET',
      url: 'https://api.semanticscholar.org/graph/v1/paper/search?query=graph%20neural%20network&limit=1&fields=title',
      headers: (key) => ({ 'x-api-key': key }),
    },
  },
  {
    id: 'openalex',
    name: 'OpenAlex',
    kind: 'email',
    path: 'retrieval.mailto',
    envName: 'OPENALEX_KEY',
    wired: 'runtime',
    applyUrl: 'https://openalex.org/our-api',
    hint: '填邮箱即可进 polite pool；同一邮箱也用于 Crossref。',
    test: {
      method: 'GET',
      url: (value) => `https://api.openalex.org/works?search=topology&per-page=1&mailto=${encodeURIComponent(value)}`,
    },
  },
  {
    id: 'core',
    name: 'CORE',
    kind: 'key',
    path: 'retrieval.coreKey',
    envName: 'CORE_API_KEY',
    wired: 'declared',
    applyUrl: 'https://core.ac.uk/services/api',
    hint: '开放获取全文聚合，key 需在 CORE 控制台申请。',
    test: {
      method: 'GET',
      url: 'https://api.core.ac.uk/v3/search/works?q=machine%20learning&limit=1',
      headers: (key) => ({ authorization: `Bearer ${key}` }),
    },
  },
  {
    id: 'unpaywall',
    name: 'Unpaywall',
    kind: 'email',
    path: 'retrieval.unpaywallEmail',
    envName: 'UNPAYWALL_EMAIL',
    wired: 'runtime',
    applyUrl: 'https://unpaywall.org/products/api',
    hint: '只要邮箱，用来查合法开放获取版本。',
    test: {
      method: 'GET',
      url: (value) => `https://api.unpaywall.org/v2/10.1038/nature12373?email=${encodeURIComponent(value)}`,
    },
  },
  {
    id: 'crossref',
    name: 'Crossref',
    kind: 'email',
    path: 'retrieval.mailto',
    envName: 'CROSSREF_MAILTO',
    wired: 'runtime',
    applyUrl: 'https://www.crossref.org/documentation/',
    hint: '与 OpenAlex 共用同一邮箱字段。',
    test: {
      method: 'GET',
      url: (value) => `https://api.crossref.org/works?rows=1&mailto=${encodeURIComponent(value)}`,
    },
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    kind: 'none',
    path: null,
    envName: null,
    wired: 'runtime',
    applyUrl: 'https://info.arxiv.org/help/api/index.html',
    hint: '公开接口，不需要凭据。',
    test: {
      method: 'GET',
      url: 'http://export.arxiv.org/api/query?search_query=all:topology&max_results=1',
    },
  },
  {
    id: 'zotero',
    name: 'Zotero',
    kind: 'key',
    path: 'retrieval.zoteroKey',
    envName: 'ZOTERO_API_KEY',
    wired: 'declared',
    applyUrl: 'https://www.zotero.org/settings/keys',
    hint: '文献库同步；只读权限就够。',
    test: {
      method: 'GET',
      url: 'https://api.zotero.org/keys/current',
      headers: (key) => ({ 'Zotero-API-Key': key }),
    },
  },
  {
    id: 'exa',
    name: 'Exa',
    kind: 'key',
    path: 'retrieval.exaKey',
    envName: 'EXA_API_KEY',
    wired: 'declared',
    applyUrl: 'https://dashboard.exa.ai/api-keys',
    hint: '面向研究者的语义搜索。',
    test: {
      method: 'GET',
      url: 'https://api.exa.ai/search?numResults=1&query=machine%20learning',
      headers: (key) => ({ 'x-api-key': key }),
    },
  },
])

const BY_ID = new Map(SOURCES.map((source) => [source.id, source]))

export function readConfig() {
  try {
    const parsed = JSON.parse(readFileSync(retrievalConfigPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeConfig(config) {
  const path = retrievalConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

function getPath(object, path) {
  if (!path) return undefined
  let cursor = object
  for (const key of path.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = cursor[key]
  }
  return cursor
}

function setPath(object, path, value) {
  const keys = path.split('.')
  let cursor = object
  for (const key of keys.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {}
    cursor = cursor[key]
  }
  cursor[keys[keys.length - 1]] = value
}

/** 掩码：key 留头 3 尾 4，邮箱留首字母与域名。 */
export function mask(kind, value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  if (kind === 'email') {
    const at = text.indexOf('@')
    if (at <= 0) return '••••'
    return `${text.slice(0, 1)}•••@${text.slice(at + 1)}`
  }
  if (text.length <= 8) return '••••'
  return `${text.slice(0, 3)}•••${text.slice(-4)}`
}

function envOf(name) {
  if (!name) return ''
  return (process.env[name] || '').trim()
}

/** 一条源的对外视图：值只给掩码，来源说明是 config 还是环境变量。 */
export function sourceRow(source, config) {
  const stored = source.path ? getPath(config, source.path) : ''
  const value = typeof stored === 'string' ? stored.trim() : ''
  const envValue = envOf(source.envName)
  const effective = value || envValue
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    path: source.path,
    envName: source.envName,
    wired: source.wired,
    applyUrl: source.applyUrl,
    hint: source.hint,
    configured: Boolean(effective),
    from: value ? 'config' : envValue ? 'env' : null,
    masked: mask(source.kind, effective),
    // 掩码只用于显示；长度给界面判断「要不要提示太短」。
    length: effective.length,
  }
}

export function listSources() {
  const config = readConfig()
  const items = SOURCES.map((source) => sourceRow(source, config))
  const customs = Array.isArray(getPath(config, 'retrieval.custom'))
    ? getPath(config, 'retrieval.custom').map((row, index) => ({
        id: `custom:${index}`,
        name: typeof row?.name === 'string' ? row.name : `自定义源 ${index + 1}`,
        baseUrl: typeof row?.baseUrl === 'string' ? row.baseUrl : '',
        keyHeader: typeof row?.keyHeader === 'string' ? row.keyHeader : '',
        configured: Boolean(row?.key),
        masked: mask('key', row?.key ?? ''),
        wired: 'declared',
      }))
    : []
  return {
    ok: true,
    path: retrievalConfigPath(),
    exists: Boolean(config && Object.keys(config).length > 0),
    items,
    customs,
    note: '密钥只写入本机 science/config.json；标注「已保存，工具侧尚未读取」的字段当前版本不会自动生效。',
  }
}

function cleanValue(value) {
  if (value === null) return ''
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.length > MAX_VALUE) return null
  return text
}

/**
 * 合并写回。`patch` 形如 `{ items: { 'semantic-scholar': 'xxx', openalex: '' }, custom: [...] }`。
 * @returns {{ok:boolean, changed:string[], rejected:object[], sources:object}}
 */
export function updateSources(patch) {
  const config = readConfig()
  const changed = []
  const rejected = []
  const body = patch && typeof patch === 'object' ? patch : {}

  if (body.items && typeof body.items === 'object') {
    for (const [id, raw] of Object.entries(body.items)) {
      const source = BY_ID.get(id)
      if (!source) {
        rejected.push({ id, reason: '未登记的数据源' })
        continue
      }
      if (!source.path) {
        rejected.push({ id, reason: '该源不需要凭据' })
        continue
      }
      const value = cleanValue(raw)
      if (value === null) {
        rejected.push({ id, reason: `凭据需为不超过 ${MAX_VALUE} 字符的字符串` })
        continue
      }
      if (source.kind === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        rejected.push({ id, reason: '邮箱格式不正确' })
        continue
      }
      if (getPath(config, source.path) !== value) changed.push(id)
      setPath(config, source.path, value)
    }
  }

  if (Array.isArray(body.custom)) {
    const rows = []
    for (const row of body.custom.slice(0, 20)) {
      if (!row || typeof row !== 'object') {
        rejected.push({ id: 'custom', reason: '自定义源需为对象' })
        continue
      }
      const name = cleanValue(row.name) ?? ''
      const baseUrl = cleanValue(row.baseUrl) ?? ''
      const keyHeader = (cleanValue(row.keyHeader) ?? 'authorization').slice(0, 64)
      const key = cleanValue(row.key) ?? ''
      if (!name || !/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
        rejected.push({ id: `custom:${name || '?'}`, reason: '名称必填，地址需为 http(s)' })
        continue
      }
      rows.push({ name, baseUrl, keyHeader, key })
    }
    const before = JSON.stringify(getPath(config, 'retrieval.custom') ?? [])
    setPath(config, 'retrieval.custom', rows)
    if (JSON.stringify(rows) !== before) changed.push('custom')
  }

  if (changed.length > 0) {
    setPath(config, 'updatedAt', new Date().toISOString())
    writeConfig(config)
  }
  return { ok: true, changed, rejected, sources: listSources() }
}

export function clearSource(id) {
  const source = BY_ID.get(id)
  if (!source || !source.path) return { ok: false, error: 'unknown-source', id }
  const config = readConfig()
  setPath(config, source.path, '')
  setPath(config, 'updatedAt', new Date().toISOString())
  writeConfig(config)
  return { ok: true, cleared: id, sources: listSources() }
}

async function hit(test, value, fetchImpl) {
  const url = typeof test.url === 'function' ? test.url(value) : test.url
  const headers = typeof test.headers === 'function' && value ? test.headers(value) : {}
  const started = Date.now()
  try {
    const response = await fetchImpl(url, {
      method: test.method,
      headers: { accept: 'application/json', 'user-agent': 'DeepScient/0.1 (+local)', ...headers },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
    return {
      status: response.ok ? 'ok' : 'fail',
      httpStatus: response.status,
      ms: Date.now() - started,
      hint: response.ok ? '' : response.status === 401 || response.status === 403 ? '凭据被拒（401/403），检查 key 或邮箱是否有效' : `接口返回 ${response.status}`,
    }
  } catch (error) {
    return {
      status: 'fail',
      httpStatus: null,
      ms: Date.now() - started,
      // 只报错误类别，绝不带 URL 上的凭据。
      hint: error?.name === 'TimeoutError' ? '超时（8 秒），可能是网络不可达' : `请求失败：${error?.name ?? 'Error'}`,
    }
  }
}

/**
 * 验一条源。
 * @param opts.dry 只查凭据在不在，不发请求（离线断言与「先存后测」都用它）
 */
export async function verifySource(id, { dry = false, fetchImpl = globalThis.fetch } = {}) {
  const config = readConfig()

  if (id.startsWith('custom:')) {
    const index = Number(id.slice('custom:'.length))
    const row = (getPath(config, 'retrieval.custom') ?? [])[index]
    if (!row) return { id, status: 'no-source', hint: '自定义源不存在' }
    if (dry) return { id, status: row.key ? 'ready' : 'no-credential', hint: row.key ? '' : '还没填凭据' }
    const headers = row.key ? { [row.keyHeader || 'authorization']: row.key } : {}
    return { id, ...(await hit({ method: 'GET', url: row.baseUrl, headers: () => headers }, row.key, fetchImpl)) }
  }

  const source = BY_ID.get(id)
  if (!source) return { id, status: 'unknown-source', hint: '未登记的数据源' }
  if (!source.test) return { id, status: 'no-test', hint: '该源没有可用的探测请求' }

  const value = getPath(config, source.path)
  const effective = (typeof value === 'string' && value.trim()) || envOf(source.envName)
  if (dry) {
    // 免凭据源（arXiv）没有「缺凭据」这回事，dry 下直接就是能发请求。
    if (source.kind === 'none') return { id, status: 'ready', hint: '免凭据源' }
    return { id, status: effective ? 'ready' : 'no-credential', hint: effective ? '' : '还没填凭据' }
  }
  if (source.kind !== 'none' && !effective) {
    return { id, status: 'no-credential', hint: '还没填凭据' }
  }
  return { id, ...(await hit(source.test, effective, fetchImpl)) }
}
