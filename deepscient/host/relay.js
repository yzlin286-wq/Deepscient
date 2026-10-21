/**
 * 中转站（un.ccagent.cn）合作方接口的服务端客户端、本地绑定/订单库，以及两个公开 HTTP 入口。
 *
 * 为什么单独成文件：这是「我们 ↔ 中转站」的全部边界。把签名、重试、密钥落盘收在一处，
 * 上层（host/api.js、注册流程）只面对业务语义，不必各自实现一遍 HMAC —— 签名算法抄错一次，
 * 表现只是「偶发 401」，排查成本极高。
 *
 * 四条纪律：
 *   1. **签名只看原始字节**。POST 的 digest 是实际发送出去的 Buffer 的 sha256；先把对象
 *      JSON.stringify 一次，再拿同一份字符串去签名和发送，否则键序/空格差一点就 401。
 *   2. **app_secret 和用户 api_key 都不外流**。secret 只从环境变量或 science/partner-app-secret
 *      读；api_key 用 AES-256-GCM 加密落盘，对外只给掩码，日志只记 event_id / trade_no。
 *   3. **重试是有限且分类的**。429 / 5xx / 网络错误才退避重试（1s、2s、4s），4xx 直接失败；
 *      每次重试重新签 nonce，避免「重放」判定。
 *   4. **Webhook 幂等落在磁盘上**。event_id 与订单写在同一次读-改-写里，重复推送只返回 duplicate。
 *
 * 顶层没有副作用：配置、密钥文件、HTTP 请求都在函数被调用时才发生。
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { scienceRoot } from './science.js'

/** 与中转站文档一致的退避序列；长度即最大重试次数。 */
export const RETRY_DELAYS_MS = [1000, 2000, 4000]

const REQUEST_TIMEOUT_MS = 10_000
const WEBHOOK_MAX_BYTES = 512 * 1024
const WEBHOOK_TOLERANCE_SECONDS = 300
const PLANS_TTL_MS = 60 * 1000
const DEFAULT_API_BASE = 'https://api.ccagent.cn'
const PARTNER_PREFIX = '/partner/v1'
const WEBHOOK_PATH = '/deepscient/partner/webhook'
const RETURN_PATH = '/deepscient/partner/return'

export const PARTNER_DEFAULTS = Object.freeze({
  appId: 'app_ccagent_prod',
  base: 'https://un.ccagent.cn',
  webhookPath: WEBHOOK_PATH,
  returnPath: RETURN_PATH,
})

/* ── 错误 ──────────────────────────────────────────────────────────────── */

/**
 * 中转站调用的统一错误。`code` 是中转站业务码（没有响应正文时为 null），
 * `status` 是 HTTP 状态（网络层失败为 0），`retryable` 供上层决定要不要再试。
 */
export class PartnerError extends Error {
  constructor(message, { code = null, status = 0, retryable = false } = {}) {
    super(message)
    this.name = 'PartnerError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

/* ── 配置 ──────────────────────────────────────────────────────────────── */

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBase(raw) {
  let value = textOf(raw) || PARTNER_DEFAULTS.base
  value = value.replace(/\/+$/, '')
  // 有人会把基址填成带 /partner/v1 的完整地址；这里剥掉，避免拼出 /partner/v1/partner/v1。
  if (value.endsWith(PARTNER_PREFIX)) value = value.slice(0, -PARTNER_PREFIX.length).replace(/\/+$/, '')
  return value
}

function normalizePublicBase(raw) {
  return /^https?:\/\/[^\s]+$/i.test(textOf(raw)) ? textOf(raw).replace(/\/+$/, '') : ''
}

/**
 * 每次调用时现算，而不是模块加载时快照：设置页改完环境变量、或用例注入临时 DSH_HOME 后
 * 不必重启进程。secret 只允许两个来源，顺序固定。
 */
function partnerConfig() {
  const appId = textOf(process.env.CCAGENT_PARTNER_APP_ID) || PARTNER_DEFAULTS.appId

  const envSecret = textOf(process.env.CCAGENT_PARTNER_APP_SECRET)
  let secret = envSecret
  let secretSource = envSecret ? 'env' : null
  if (!secret) {
    try {
      const fileSecret = readFileSync(join(scienceRoot(), 'partner-app-secret'), 'utf8').trim()
      if (fileSecret) {
        secret = fileSecret
        secretSource = 'file'
      }
    } catch {
      // 没配就是没配，交给调用方报「未配置」；不在这里抛，状态页也要能正常渲染。
    }
  }

  const base = normalizeBase(process.env.CCAGENT_PARTNER_BASE)
  const publicBase = normalizePublicBase(process.env.CCAGENT_PARTNER_PUBLIC_BASE)
  const webhookUrl =
    textOf(process.env.CCAGENT_PARTNER_WEBHOOK_URL) ||
    (publicBase ? `${publicBase}${WEBHOOK_PATH}` : WEBHOOK_PATH)

  return { appId, secret, secretSource, base, publicBase, webhookUrl }
}

/* ── 签名 ──────────────────────────────────────────────────────────────── */

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 把 string / URLSearchParams / 普通对象统一摊平成 [key, value] 列表。 */
function queryEntries(query) {
  if (!query) return []
  if (typeof query === 'string') {
    const text = query.startsWith('?') ? query.slice(1) : query
    if (!text) return []
    return [...new URLSearchParams(text).entries()]
  }
  if (query instanceof URLSearchParams) return [...query.entries()]
  if (typeof query === 'object') {
    const out = []
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const item of value) out.push([String(key), String(item)])
      } else {
        out.push([String(key), String(value)])
      }
    }
    return out
  }
  return []
}

/** 文档规定的 canonical_query：key 升序，同 key 再按 value 升序。 */
export function canonicalQuery(query) {
  const entries = queryEntries(query)
  entries.sort((a, b) => (a[0] === b[0] ? compareText(a[1], b[1]) : compareText(a[0], b[0])))
  return entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
}

/**
 * 载荷摘要。带 body 的方法必须对**实际发送的字节**做 sha256 —— 哪怕只是多一个空格，
 * 服务端算出来的摘要也不同，所以调用方只能序列化一次。
 */
export function payloadDigest(method, rawBody, query = '') {
  const verb = String(method || 'GET').toUpperCase()
  if (verb === 'POST' || verb === 'PUT' || verb === 'PATCH') {
    const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? '', 'utf8')
    return createHash('sha256').update(bytes).digest('hex')
  }
  return canonicalQuery(query)
}

/**
 * 生成四个签名头。ts / nonce / secret 可注入，测试才能复算；
 * 生产调用不传时取当前秒与 16 位随机串。
 */
export function signHeaders({ method = 'GET', query = '', rawBody = '', appId, secret, ts, nonce } = {}) {
  const config = appId && secret ? null : partnerConfig()
  const appIdValue = appId ?? config.appId
  const secretValue = secret ?? config.secret
  if (!appIdValue) throw new PartnerError('中转站未配置 app_id', { status: 0 })
  if (!secretValue) throw new PartnerError('中转站未配置 app_secret', { status: 0 })

  const timestamp = ts === undefined || ts === null ? String(Math.floor(Date.now() / 1000)) : String(ts)
  if (!/^\d+$/.test(timestamp)) throw new PartnerError('中转站时间戳不合法', { status: 0 })
  const nonceValue = nonce === undefined || nonce === null ? randomBytes(8).toString('hex') : String(nonce)

  const digest = payloadDigest(method, rawBody, query)
  const signature = createHmac('sha256', secretValue)
    .update(`${appIdValue}\n${timestamp}\n${nonceValue}\n${digest}`, 'utf8')
    .digest('hex')

  return {
    'X-Partner-App-Id': appIdValue,
    'X-Partner-Timestamp': timestamp,
    'X-Partner-Nonce': nonceValue,
    'X-Partner-Signature': signature,
  }
}

/* ── 底层请求 ──────────────────────────────────────────────────────────── */

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function queryString(query) {
  if (!query) return ''
  if (typeof query === 'string') return query.startsWith('?') ? query.slice(1) : query
  if (query instanceof URLSearchParams) return query.toString()
  const params = new URLSearchParams()
  for (const [key, value] of queryEntries(query)) params.append(key, value)
  return params.toString()
}

/**
 * 所有 /partner/v1 调用的唯一出口。
 *
 * 重试只针对「可能自己会好」的失败：429、5xx、网络错误。每次尝试都重新签名，
 * 因为服务端会记 nonce —— 拿同一个 nonce 重放会被判 40103。
 */
export async function relayRequest(method, path, options = {}) {
  const verb = String(method || 'GET').toUpperCase()
  const { query = '', fetchImpl = globalThis.fetch, sleep = defaultSleep, logger = null } = options
  const config = partnerConfig()
  if (!config.secret) throw new PartnerError('中转站未配置 app_secret', { status: 0 })

  const rawBody =
    options.body === undefined || options.body === null
      ? ''
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body)
  const hasBody = verb !== 'GET' && verb !== 'DELETE' && rawBody !== ''

  const urlPath = path.startsWith('/') ? path : `/${path}`
  const search = queryString(query)
  const url = `${config.base}${urlPath}${search ? `?${search}` : ''}`

  const maxRetries = RETRY_DELAYS_MS.length
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response
    try {
      const headers = signHeaders({
        method: verb,
        query,
        rawBody,
        appId: config.appId,
        secret: config.secret,
      })
      if (hasBody) headers['Content-Type'] = 'application/json'
      response = await fetchImpl(url, {
        method: verb,
        headers,
        body: hasBody ? rawBody : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      // 只报请求方式与路径：错误对象里可能挂着带签名头的 request，不能原样落日志。
      if (attempt < maxRetries) {
        logger?.warn?.(`deepscient: 中转站请求失败，准备重试（${verb} ${urlPath}）`)
        await sleep(RETRY_DELAYS_MS[attempt])
        continue
      }
      throw new PartnerError('中转站请求失败（网络错误）', { status: 0, retryable: true })
    }

    let payload = null
    try {
      const text = await response.text()
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    const code = payload && typeof payload.code === 'number' ? payload.code : null
    const message =
      payload && typeof payload.message === 'string' && payload.message
        ? payload.message
        : `中转站返回 HTTP ${response.status}`

    if (response.ok && code === 0) return payload.data

    const retryable = response.status === 429 || response.status >= 500 || code === 42901 || code === 50001
    if (retryable && attempt < maxRetries) {
      logger?.warn?.(
        `deepscient: 中转站请求失败，准备重试（${verb} ${urlPath} / HTTP ${response.status} / code ${code ?? '-'}）`,
      )
      await sleep(RETRY_DELAYS_MS[attempt])
      continue
    }
    throw new PartnerError(message, { code, status: response.status, retryable })
  }

  // 循环一定会 return 或 throw；这里只为了静态可读性。
  throw new PartnerError('中转站请求失败', { status: 0 })
}

/* ── 八个能力 ──────────────────────────────────────────────────────────── */

export function ping(options = {}) {
  return relayRequest('GET', `${PARTNER_PREFIX}/ping`, options)
}

/**
 * 本机的「人」→ 中转站的 external_uid。
 *
 * 官网账号的 id 可能是数字（`1`），而中转站要的是字符串；直接传数字会在
 * `String(value)` 之前的校验里被当成空值。用户名带点/邮箱时也不能原样当 uid，
 * 所以退路是清洗成 `u_<username>`。
 */
export function externalUidOf(user) {
  const raw = user && typeof user === 'object' ? String(user.id ?? '').trim() : String(user ?? '').trim()
  if (raw) return raw.slice(0, 128)
  const name = String(user?.username ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 120)
  return name ? `u_${name}` : ''
}

/** 同步账号。中转站是幂等的：同一 external_uid 返回同一个 user_id 与 api_key。 */
export async function syncUser(externalUid, { displayName, fetchImpl } = {}) {
  const uid = externalUidOf(externalUid)
  if (!uid) throw new PartnerError('externalUid 不能为空', { status: 0 })

  const body = { external_uid: uid }
  const name = textOf(displayName)
  if (name) body.display_name = name.slice(0, 30)

  const data = await relayRequest('POST', `${PARTNER_PREFIX}/users/sync`, { body, fetchImpl })
  return saveBinding({
    externalUid: uid,
    userId: data?.user_id ?? null,
    username: data?.username ?? '',
    apiKey: data?.api_key ?? '',
    apiBaseUrl: data?.api_base_url ?? '',
    syncedAt: new Date().toISOString(),
  })
}

/** 查询绑定。「没同步过」在中转站是 40401，属于正常业务结果，不往上抛。 */
export async function getUser(externalUid) {
  const uid = textOf(externalUid)
  if (!uid) throw new PartnerError('externalUid 不能为空', { status: 0 })
  try {
    return await relayRequest('GET', `${PARTNER_PREFIX}/users/${encodeURIComponent(uid)}`)
  } catch (error) {
    if (error instanceof PartnerError && error.code === 40401) return { found: false, externalUid: uid }
    throw error
  }
}

let plansCache = { at: 0, items: [] }

/** 套餐缓存 60 秒：购买页会被频繁打开，但中转站套餐不会按秒变。 */
export async function listPlans({ force = false, fetchImpl } = {}) {
  const now = Date.now()
  if (!force && plansCache.at && now - plansCache.at < PLANS_TTL_MS) return [...plansCache.items]
  const data = await relayRequest('GET', `${PARTNER_PREFIX}/plans`, { fetchImpl })
  const items = Array.isArray(data) ? data : []
  plansCache = { at: now, items }
  return [...items]
}

/** 只把合法的 plan_id 与字符串 return_url 放进请求体，避免把 null/NaN 发给中转站。 */
export function createBuyUrl({ externalUid, planId, returnUrl, fetchImpl } = {}) {
  const uid = textOf(externalUid)
  if (!uid) throw new PartnerError('externalUid 不能为空', { status: 0 })

  const body = { external_uid: uid }
  const plan = planId === undefined || planId === null || planId === '' ? null : Number(planId)
  if (Number.isInteger(plan) && plan > 0) body.plan_id = plan
  const back = textOf(returnUrl)
  if (back) body.return_url = back

  return relayRequest('POST', `${PARTNER_PREFIX}/buy-url`, { body, fetchImpl })
}

export function createAccountUrl(externalUid, { fetchImpl } = {}) {
  const uid = textOf(externalUid)
  if (!uid) throw new PartnerError('externalUid 不能为空', { status: 0 })
  return relayRequest('POST', `${PARTNER_PREFIX}/account-url`, { body: { external_uid: uid }, fetchImpl })
}

export function getOrder(tradeNo) {
  const no = textOf(tradeNo)
  if (!no) throw new PartnerError('tradeNo 不能为空', { status: 0 })
  return relayRequest('GET', `${PARTNER_PREFIX}/orders/${encodeURIComponent(no)}`)
}

/**
 * 回跳地址。origin 优先（调用方可能从请求 Host 推），否则用已配置的公网基址；
 * 两者都不是 http(s) 时返回 null，让调用方决定「不提供返回按钮」而不是拼一个坏链接。
 */
export function buildReturnUrl(origin) {
  const base = normalizePublicBase(origin) || normalizePublicBase(process.env.CCAGENT_PARTNER_PUBLIC_BASE)
  return base ? `${base}${RETURN_PATH}` : null
}

/* ── 验签 ──────────────────────────────────────────────────────────────── */

function headerOf(headers, name) {
  if (!headers || typeof headers !== 'object') return ''
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== target) continue
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : ''
    return value === undefined || value === null ? '' : String(value)
  }
  return ''
}

/**
 * Webhook 验签。必须用原始 Buffer：先 parse 再 stringify 会因键序/空白改变摘要。
 * 时间窗 300 秒是文档要求，用来挡重放。
 */
export function verifyWebhookSignature(rawBody, headers, { appId, secret, now } = {}) {
  const config = appId && secret ? null : partnerConfig()
  const appIdValue = appId ?? config.appId
  const secretValue = secret ?? config.secret
  if (!secretValue) return { ok: false, reason: 'not-configured' }

  const eventId = headerOf(headers, 'x-partner-event-id').trim()
  const timestamp = headerOf(headers, 'x-partner-timestamp').trim()
  const signature = headerOf(headers, 'x-partner-signature').trim().toLowerCase()

  if (!eventId) return { ok: false, reason: 'missing-event-id' }
  if (!timestamp) return { ok: false, reason: 'missing-timestamp' }
  if (!signature) return { ok: false, reason: 'missing-signature' }
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: 'bad-timestamp' }

  const nowSeconds = now === undefined || now === null ? Date.now() / 1000 : Number(now)
  if (!Number.isFinite(nowSeconds)) return { ok: false, reason: 'bad-timestamp' }
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp-out-of-range' }
  }

  const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? '', 'utf8')
  const digest = createHash('sha256').update(bytes).digest('hex')
  const expected = createHmac('sha256', secretValue)
    .update(`${appIdValue}\n${timestamp}\n${eventId}\n${digest}`, 'utf8')
    .digest('hex')

  // 长度不等时 timingSafeEqual 会抛，先挡住；这个分支本身也说明签名是伪造的。
  if (expected.length !== signature.length) return { ok: false, reason: 'bad-signature' }
  const ok = timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'))
  return ok ? { ok: true } : { ok: false, reason: 'bad-signature' }
}

/**
 * 回跳签名。注意它不掺 app_id，原文格式固定为 `return:<trade_no>:<status>`。
 * 回跳参数只是 UX 提示，真正的开通状态仍以 Webhook / 订单查询为准。
 */
export function verifyReturnSign(tradeNo, status, sign, { secret } = {}) {
  const secretValue = secret ?? partnerConfig().secret
  if (!secretValue) return false

  const trade = String(tradeNo ?? '')
  const state = status === undefined || status === null || status === '' ? 'success' : String(status)
  const got = String(sign ?? '').trim().toLowerCase()
  if (!trade || !got) return false

  const expected = createHmac('sha256', secretValue).update(`return:${trade}:${state}`, 'utf8').digest('hex')
  if (expected.length !== got.length) return false
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(got, 'utf8'))
}

/* ── 本地存储 ──────────────────────────────────────────────────────────── */

export function partnerStorePath() {
  return join(scienceRoot(), 'partner.json')
}

export function partnerKeyPath() {
  return join(scienceRoot(), 'partner-key')
}

function emptyStore() {
  return { version: 1, bindings: {}, orders: {}, events: {} }
}

function normalizeStore(raw) {
  const store = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : emptyStore()
  for (const key of ['bindings', 'orders', 'events']) {
    if (!store[key] || typeof store[key] !== 'object' || Array.isArray(store[key])) store[key] = {}
  }
  store.version = 1
  return store
}

function readStore() {
  const path = partnerStorePath()
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return emptyStore()
  }
  try {
    return normalizeStore(JSON.parse(text))
  } catch {
    // 坏文件当空库，但留一份 .broken：里面可能有还没导出的订单，直接覆盖就找不回来了。
    try {
      writeFileSync(`${path}.broken`, text, { encoding: 'utf8', mode: 0o600 })
    } catch {}
    return emptyStore()
  }
}

/** 临时文件 + rename：进程中途挂掉也不会留下半截 JSON。 */
function writeStore(store) {
  const path = partnerStorePath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows 上 chmod 语义有限；能设就设，不因此让保存失败。
  }
}

function readKeyFile() {
  try {
    const text = readFileSync(partnerKeyPath(), 'utf8').trim()
    return /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, 'hex') : null
  } catch {
    return null
  }
}

/** 首次加密时生成 32 字节主密钥。用 wx 打开，避免两个进程同时生成、后写的覆盖先写的。 */
function ensureKey() {
  const existing = readKeyFile()
  if (existing) return existing

  const path = partnerKeyPath()
  mkdirSync(dirname(path), { recursive: true })
  const key = randomBytes(32)
  try {
    writeFileSync(path, `${key.toString('hex')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const raced = readKeyFile()
    if (raced) return raced
    // 文件在但内容坏了：此时旧密文本来也解不开，重建一把并说明后续会解密为空。
    writeFileSync(path, `${key.toString('hex')}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  try {
    chmodSync(path, 0o600)
  } catch {}
  return key
}

/** AES-256-GCM：密文自带完整性校验，改动一个字节就会解密失败而不是得到垃圾明文。 */
export function encryptSecret(plain) {
  const text = typeof plain === 'string' ? plain : ''
  if (!text) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', ensureKey(), iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${body.toString('base64')}`
}

/** 解不开就返回空串：密钥轮换或文件损坏时，界面显示「无 Key」比抛错更可用。 */
export function decryptSecret(cipherText) {
  if (typeof cipherText !== 'string' || !cipherText) return ''
  const parts = cipherText.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') return ''
  const key = readKeyFile()
  if (!key) return ''
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'))
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

/** 展示用掩码：太短的 key 全遮，避免「前 3 后 4」反而暴露大半。 */
export function maskKey(key) {
  const text = typeof key === 'string' ? key.trim() : ''
  if (!text || text.length <= 8) return '••••'
  return `${text.slice(0, 3)}•••${text.slice(-4)}`
}

/* ── 绑定 ──────────────────────────────────────────────────────────────── */

function bindingView(record) {
  if (!record) return null
  const cipher = typeof record.apiKeyCipher === 'string' ? record.apiKeyCipher : ''
  return {
    externalUid: record.externalUid ?? '',
    userId: record.userId ?? null,
    username: record.username ?? '',
    apiBaseUrl: record.apiBaseUrl ?? '',
    hasKey: Boolean(cipher),
    // 这里才解密：调用方拿到的是掩码，明文只在本进程内存里出现一瞬。
    apiKeyMasked: cipher ? maskKey(decryptSecret(cipher)) : '',
    syncedAt: record.syncedAt ?? null,
  }
}

export function readBinding(externalUid) {
  const uid = textOf(externalUid)
  if (!uid) return null
  return bindingView(readStore().bindings[uid])
}

export function listBindings() {
  const store = readStore()
  return Object.values(store.bindings)
    .map(bindingView)
    .filter(Boolean)
    .sort((a, b) => String(b.syncedAt ?? '').localeCompare(String(a.syncedAt ?? '')))
}

/** apiKey 为空表示「这次没拿到新 Key」，保留原密文，避免把已有 Key 抹掉。 */
export function saveBinding({ externalUid, userId = null, username = '', apiKey = '', apiBaseUrl = '', syncedAt = null } = {}) {
  const uid = textOf(externalUid)
  if (!uid) throw new PartnerError('externalUid 不能为空', { status: 0 })

  const store = readStore()
  const previous = store.bindings[uid] ?? null
  const plainKey = typeof apiKey === 'string' ? apiKey.trim() : ''

  store.bindings[uid] = {
    externalUid: uid,
    userId: userId ?? previous?.userId ?? null,
    username: textOf(username) || previous?.username || '',
    apiKeyCipher: plainKey ? encryptSecret(plainKey) : previous?.apiKeyCipher || '',
    apiBaseUrl: textOf(apiBaseUrl) || previous?.apiBaseUrl || '',
    syncedAt: syncedAt || previous?.syncedAt || new Date().toISOString(),
  }
  writeStore(store)
  return bindingView(store.bindings[uid])
}

/* ── 订单与事件 ────────────────────────────────────────────────────────── */

const API_ORDER_FIELDS = [
  ['tradeNo', 'trade_no'],
  ['externalUid', 'external_uid'],
  ['userId', 'user_id'],
  ['planId', 'plan_id'],
  ['planTitle', 'plan_title'],
  ['amount', 'amount'],
  ['currency', 'currency'],
  ['status', 'status'],
  ['startTime', 'start_time'],
  ['endTime', 'end_time'],
  ['group', 'group'],
]

function orderFromApi(data) {
  const source = data && typeof data === 'object' ? data : {}
  const out = {}
  for (const [key, field] of API_ORDER_FIELDS) {
    if (source[field] !== undefined) out[key] = source[field]
  }
  return out
}

function orderView(order) {
  if (!order) return null
  return {
    tradeNo: order.tradeNo ?? '',
    externalUid: order.externalUid ?? '',
    userId: order.userId ?? null,
    planId: order.planId ?? null,
    planTitle: order.planTitle ?? '',
    amount: order.amount ?? '',
    currency: order.currency ?? '',
    status: order.status ?? '',
    startTime: order.startTime ?? 0,
    endTime: order.endTime ?? 0,
    group: order.group ?? '',
    eventId: order.eventId ?? null,
    receivedAt: order.receivedAt ?? null,
    source: order.source ?? '',
  }
}

export function listOrders(limit = 10) {
  const store = readStore()
  const rows = Object.values(store.orders)
    .filter((order) => order && typeof order === 'object')
    .map(orderView)
  rows.sort((a, b) => String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? '')))
  const size = Number(limit)
  return rows.slice(0, Number.isFinite(size) && size >= 0 ? size : 10)
}

export function getLocalOrder(tradeNo) {
  const no = textOf(tradeNo)
  if (!no) return null
  return orderView(readStore().orders[no])
}

/**
 * 把「主动查订单」的结果合并进本地库。
 * 只覆盖接口确实返回的字段，并保留第一次收到该订单的时间与 event_id ——
 * 这样 pending → success 的变化不会把订单「变成一条新记录」。
 */
export function saveOrderFromQuery(order) {
  const data = order && typeof order === 'object' ? order : {}
  const tradeNo = textOf(data.trade_no)
  if (!tradeNo) throw new PartnerError('tradeNo 不能为空', { status: 0 })

  const store = readStore()
  const previous = store.orders[tradeNo] ?? null
  const merged = {
    ...(previous ?? {}),
    ...orderFromApi(data),
    tradeNo,
    eventId: previous?.eventId ?? (typeof data.webhook?.event_id === 'string' ? data.webhook.event_id : null),
    receivedAt: previous?.receivedAt ?? new Date().toISOString(),
    source: 'query',
  }
  store.orders[tradeNo] = merged
  writeStore(store)
  return orderView(merged)
}

/**
 * Webhook 落库。
 *
 * 幂等键是 event_id：同一订单重推时内容完全一致，看到已处理就直接告诉调用方 duplicate。
 * 检查事件、写事件、写订单、更新绑定都在**同一次**读-改-写里完成，避免并发的两次推送都认为自己是第一次。
 */
export function applyPaidEvent(event) {
  const payload = event && typeof event === 'object' ? event : {}
  const eventId = textOf(payload.event_id)
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {}
  const tradeNo = textOf(data.trade_no)
  if (!eventId) throw new PartnerError('event_id 不能为空', { status: 0 })
  if (!tradeNo) throw new PartnerError('trade_no 不能为空', { status: 0 })

  const store = readStore()
  if (store.events[eventId]) {
    return { duplicate: true, order: orderView(store.orders[tradeNo] ?? null) }
  }

  const nowIso = new Date().toISOString()
  const previous = store.orders[tradeNo] ?? null
  const merged = {
    ...(previous ?? {}),
    ...orderFromApi(data),
    tradeNo,
    eventId,
    receivedAt: previous?.receivedAt ?? nowIso,
    source: 'webhook',
  }
  store.orders[tradeNo] = merged
  store.events[eventId] = {
    eventId,
    event: String(payload.event ?? ''),
    occurredAt: payload.occurred_at ?? null,
    tradeNo,
    receivedAt: nowIso,
  }

  const uid = textOf(data.external_uid) || textOf(merged.externalUid)
  if (uid) {
    const prior = store.bindings[uid] ?? null
    const plainKey = typeof data.api_key === 'string' ? data.api_key.trim() : ''
    store.bindings[uid] = {
      externalUid: uid,
      userId: data.user_id ?? prior?.userId ?? null,
      // 事件里没有 username，已有绑定就沿用，不凭空猜。
      username: prior?.username ?? '',
      apiKeyCipher: plainKey ? encryptSecret(plainKey) : prior?.apiKeyCipher || '',
      apiBaseUrl: textOf(data.api_base_url) || prior?.apiBaseUrl || DEFAULT_API_BASE,
      syncedAt: nowIso,
    }
  }

  writeStore(store)
  return { duplicate: false, order: orderView(merged) }
}

/** 状态页数据。只给「有没有 secret / 从哪来」，绝不回传 secret 本身或明文 api_key。 */
export function partnerStatus(externalUid) {
  const config = partnerConfig()
  const uid = textOf(externalUid)
  return {
    configured: Boolean(config.secret),
    appId: config.appId,
    base: config.base,
    secretPresent: Boolean(config.secret),
    secretSource: config.secretSource,
    webhookUrl: config.webhookUrl,
    publicBase: config.publicBase,
    binding: uid ? readBinding(uid) : null,
    orders: listOrders(10),
  }
}

/* ── 公开 HTTP 处理器 ──────────────────────────────────────────────────── */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    if (ch === '"') return '&quot;'
    return '&#39;'
  })
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  })
  res.end(html)
}

/** 回跳页：不加载脚本，动态值一律转义。 */
function renderResult({ title, lines }) {
  const body = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(title)} · DeepScient</title>` +
    '<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f7f9;color:#1e2329}' +
    'main{max-width:560px;margin:12vh auto;padding:32px;background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.06)}' +
    'h1{font-size:22px;margin:0 0 16px}p{line-height:1.7;margin:6px 0;color:#3c4450}' +
    'a{display:inline-block;margin-top:20px;color:#1d6fd8;text-decoration:none}a:hover{text-decoration:underline}</style></head>' +
    `<body><main><h1>${escapeHtml(title)}</h1>${body}<p><a href="/">返回应用</a></p></main></body></html>`
  )
}

/**
 * 读取原始请求体。上限之内的字节原样拼起来，验签只看这些字节。
 * 超限后继续把流读干（不再入数组），这样能正常回 413 而不是让连接悬着。
 */
async function readRawBody(req, limit) {
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
    // 单测里的最小 mock 或已被上游缓冲过的请求。
    const buffered = req?.body
    if (Buffer.isBuffer(buffered)) return { raw: buffered, tooLarge: buffered.length > limit }
    if (typeof buffered === 'string') {
      const raw = Buffer.from(buffered, 'utf8')
      return { raw, tooLarge: raw.length > limit }
    }
    return { raw: Buffer.alloc(0), tooLarge: false }
  }

  const chunks = []
  let size = 0
  let tooLarge = false
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      tooLarge = true
      continue
    }
    chunks.push(chunk)
  }
  return { raw: Buffer.concat(chunks), tooLarge }
}

async function handleWebhook(req, res, logger) {
  const body = await readRawBody(req, WEBHOOK_MAX_BYTES)
  if (body.tooLarge) {
    sendJson(res, 413, { ok: false, error: 'payload-too-large' })
    return
  }

  const config = partnerConfig()
  if (!config.secret) {
    sendJson(res, 503, { ok: false, error: 'partner-not-configured' })
    return
  }

  const verdict = verifyWebhookSignature(body.raw, req.headers ?? {}, {
    appId: config.appId,
    secret: config.secret,
  })
  if (!verdict.ok) {
    sendJson(res, 400, { ok: false, error: 'bad-signature', reason: verdict.reason })
    return
  }

  let payload
  try {
    payload = JSON.parse(body.raw.toString('utf8'))
  } catch {
    sendJson(res, 400, { ok: false, error: 'bad-json' })
    return
  }

  const headerEventId = headerOf(req.headers ?? {}, 'x-partner-event-id').trim()
  const bodyEventId = textOf(payload?.event_id)
  // 头与正文必须指向同一个事件；只验签不核对，会让「合法签名 + 换正文」有缝可钻。
  if (headerEventId !== bodyEventId) {
    sendJson(res, 400, { ok: false, error: 'event-id-mismatch' })
    return
  }

  if (payload?.event !== 'subscription.paid' || payload?.data?.status !== 'success') {
    logger?.info?.(`deepscient: 忽略中转站事件 ${bodyEventId}`)
    sendJson(res, 200, { ok: true, ignored: true })
    return
  }

  const tradeNo = textOf(payload?.data?.trade_no)
  try {
    const result = applyPaidEvent(payload)
    logger?.info?.(`deepscient: 中转站支付事件 ${bodyEventId} ${tradeNo} duplicate=${result.duplicate}`)
    sendJson(res, 200, { ok: true, duplicate: result.duplicate })
  } catch {
    // 落库失败要回 5xx：中转站会按 10s/60s/... 重推，这比我们自己吞掉错误更可靠。
    logger?.warn?.(`deepscient: 中转站支付事件落库失败 ${bodyEventId} ${tradeNo}`)
    sendJson(res, 500, { ok: false, error: 'store-failed' })
  }
}

async function handleReturn(url, res, logger) {
  const tradeNo = textOf(url.searchParams.get('trade_no'))
  const status = textOf(url.searchParams.get('status')) || 'success'
  const sign = textOf(url.searchParams.get('sign'))
  const config = partnerConfig()

  if (!config.secret) {
    sendHtml(res, 503, renderResult({ title: '中转站未配置', lines: ['服务端还没有配置合作方密钥，暂时无法确认订单。'] }))
    return
  }

  if (!verifyReturnSign(tradeNo, status, sign, { secret: config.secret })) {
    sendHtml(res, 400, renderResult({ title: '签名校验失败', lines: ['这个回跳链接的签名不对，已停止处理。'] }))
    return
  }

  // 回跳参数只是提示，真正的状态以订单查询为准；查不到就先显示「待确认」，不报 500。
  let remote = null
  try {
    remote = await getOrder(tradeNo)
  } catch (error) {
    const code = error instanceof PartnerError ? (error.code ?? error.status ?? 'error') : error?.name ?? 'error'
    logger?.warn?.(`deepscient: 回跳查询订单失败 ${tradeNo} ${code}`)
  }

  const paid = status === 'success' && remote?.status === 'success'
  const title = paid ? '开通成功' : '待确认'
  const lines = [paid ? `订单 ${tradeNo} 已支付并开通。` : `订单 ${tradeNo} 的状态还在确认中，请稍后刷新。`]
  if (remote?.plan_title) lines.push(`套餐：${remote.plan_title}`)
  if (remote?.amount) lines.push(`金额：${remote.amount} ${remote.currency ?? 'CNY'}`)

  sendHtml(res, 200, renderResult({ title, lines }))
}

/**
 * 只接管两个公开路径。返回 true 表示已经写过响应；false 让上层继续路由。
 * 这是 Webhook 与浏览器回跳的入口，所以不要求登录 —— 安全性由签名保证。
 */
export async function handlePartnerPublic(req, res, { logger } = {}) {
  const url = new URL(req?.url ?? '/', 'http://127.0.0.1')
  const method = String(req?.method ?? 'GET').toUpperCase()

  if (url.pathname === PARTNER_DEFAULTS.webhookPath && method === 'POST') {
    await handleWebhook(req, res, logger)
    return true
  }
  if (url.pathname === PARTNER_DEFAULTS.returnPath && method === 'GET') {
    await handleReturn(url, res, logger)
    return true
  }
  return false
}

/**
 * 登录成功后的静默同步。业务主流程不该因为中转站挂了而失败，所以这里永不抛；
 * 失败只留一条不含任何 key 的 warn，等下次登录/购买前再兜底同步。
 */
export async function syncUserQuietly(user, logger) {
  const uid = externalUidOf(user)
  if (!uid) return
  try {
    if (!partnerConfig().secret) return
    const displayName = textOf(user?.displayName) || textOf(user?.username) || undefined
    await syncUser(uid, { displayName })
  } catch (error) {
    const code = error instanceof PartnerError ? (error.code ?? error.status ?? 'error') : error?.name ?? 'error'
    logger?.warn?.(`deepscient: 中转站账号同步失败（${code}）`)
  }
}
