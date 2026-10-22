/**
 * 官网账号的本地半边：只保存它签发的 token，不保存密码。
 *
 * 三条纪律：
 *   1. **密码不进来**：登录走官网授权页（授权码 + PKCE S256），本机只见到 code 与 token。
 *   2. **token 不出服务端**：前端只拿得到用户与余额；token 落在 science/oauth/token.json，
 *      文件按仅当前用户可读写的权限创建。
 *   3. **失效就认账**：官网任何一处 401 都意味着这枚 token 没了，本地立刻清掉并回登录流程。
 *
 * 测试钩子（只影响本机进程）：
 *   - DEEPSCIENT_OAUTH_BASE  把端点指到本地假服务器；
 *   - DEEPSCIENT_OAUTH_SEED  用一段 JSON 直接种下登录态，给 verify 脚本用。
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { dshHome } from './science.js'

const CLIENT_ID = 'deepscient-desktop'
const DEFAULT_BASE = 'https://deepscient.com'
const DEFAULT_TTL = 2592000 * 1000
const CALLBACK_PATH = '/auth/callback'
const COOKIE = 'deepscient_session'
const CODE_TTL_MS = 5 * 60 * 1000

const FALLBACK_ENDPOINTS = {
  authorization_endpoint: '/oauth/authorize',
  token_endpoint: '/api/oauth/token',
  userinfo_endpoint: '/api/oauth/userinfo',
  revocation_endpoint: '/api/oauth/revoke',
}

const state = {
  pending: null, // { verifier, nonce, redirectUri, at }
  auth: null, // { access_token, sessionId, expiresAt, fetchedAt, user }
  endpoints: null,
  error: '',
}

export function oauthDir() {
  return join(dshHome(), 'science', 'oauth')
}

function tokenPath() {
  return join(oauthDir(), 'token.json')
}

function base() {
  const raw = String(process.env.DEEPSCIENT_OAUTH_BASE ?? '').trim().replace(/\/+$/, '')
  return raw || DEFAULT_BASE
}

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

export function normalizeUser(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: raw.id ?? null,
    username: String(raw.username ?? ''),
    email: String(raw.email ?? ''),
    role: String(raw.role ?? 'user'),
    balance: typeof raw.balance === 'number' ? raw.balance : null,
    createdAt: raw.created_at ?? raw.createdAt ?? null,
    disabled: raw.disabled === true,
  }
}

function adopt(body) {
  const seconds = Number(body?.expires_in)
  const ttl = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_TTL
  return {
    access_token: String(body.access_token),
    sessionId: b64url(randomBytes(18)),
    expiresAt: Date.now() + ttl,
    fetchedAt: new Date().toISOString(),
    user: normalizeUser(body.user),
  }
}

function seed() {
  const raw = process.env.DEEPSCIENT_OAUTH_SEED
  if (!raw) return
  try {
    const data = JSON.parse(raw)
    if (!data?.token) return
    state.auth = {
      access_token: String(data.token),
      sessionId: 'seed',
      expiresAt: Date.now() + DEFAULT_TTL,
      fetchedAt: new Date().toISOString(),
      user: normalizeUser(data.user),
    }
  } catch {}
}

/**
 * 登录态以磁盘为准：内存里没有就去读一次文件。
 * 这样重启、或者别处刚写完 token，本进程都能立刻认账。
 */
function read() {
  if (!state.auth) {
    try {
      const raw = JSON.parse(readFileSync(tokenPath(), 'utf8'))
      if (raw && typeof raw.access_token === 'string' && raw.access_token) state.auth = raw
    } catch {}
    if (!state.auth) seed()
  }
  // 文件被删掉（登出、手工清理）时内存里那份也不该继续算数。
  if (state.auth && state.auth.sessionId !== 'seed' && !existsSync(tokenPath())) state.auth = null
  if (state.auth && !(state.auth.expiresAt > Date.now())) forget()
  return state.auth
}

function save() {
  try {
    mkdirSync(oauthDir(), { recursive: true })
    writeFileSync(tokenPath(), JSON.stringify(state.auth, null, 2) + '\n', { mode: 0o600 })
  } catch {}
}

function forget() {
  state.auth = null
  try {
    if (existsSync(tokenPath())) rmSync(tokenPath())
  } catch {}
}

export function clearAuth() {
  forget()
  state.error = ''
}

function parseCookies(req) {
  const raw = req?.headers?.cookie
  if (!raw) return {}
  const out = {}
  for (const part of String(raw).split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

/**
 * 桌面形态标记：由 `desktop/deepscient-desktop.ps1` 写进环境变量。
 *
 * 桌面壳转发请求时用设备 cookie 覆盖 Cookie 头（`forwardWebRequest`），OAuth 回调又落在
 * 系统浏览器里，`deepscient_session` 根本没有通路进到后端。桌面形态本来就是「单用户、
 * 本机、设备级 cookie 已由桌面壳认证」，所以这里以磁盘 token 作为本机身份；
 * Web 形态（未设该变量）行为完全不变。
 */
export function desktopDevice() {
  return String(process.env.DEEPSCIENT_DESKTOP ?? '').trim() === '1'
}

/** cookie 里的会话号必须和磁盘上那份 token 记录对得上，才算这个浏览器登录了。 */
export function currentLogin(req) {
  const auth = read()
  if (!auth) return null
  const token = parseCookies(req)[COOKIE]
  if (token && token === auth.sessionId) return auth
  return desktopDevice() ? auth : null
}

export function currentUser(req) {
  return currentLogin(req)?.user ?? null
}

/** 发现文档只用来取端点；拿不到就按契约里的固定路径走。 */
async function endpointsOf() {
  if (state.endpoints) return state.endpoints
  let found = null
  try {
    const response = await fetch(base() + '/.well-known/deepscient-oauth', { signal: AbortSignal.timeout(4000) })
    if (response.ok) found = await response.json()
  } catch {}
  const endpoints = {}
  for (const [key, fallback] of Object.entries(FALLBACK_ENDPOINTS)) {
    const value = typeof found?.[key] === 'string' && found[key] ? found[key] : fallback
    endpoints[key] = value.startsWith('http') ? value : base() + value
  }
  state.endpoints = endpoints
  return endpoints
}

/** 发起一次授权：旧的 pending 直接作废，只保留最后一次。 */
export async function beginLogin(origin) {
  const endpoints = await endpointsOf()
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const nonce = b64url(randomBytes(18))
  const redirectUri = String(origin ?? '').replace(/\/+$/, '') + CALLBACK_PATH
  state.pending = { verifier, nonce, redirectUri, at: Date.now() }
  state.error = ''
  const url = new URL(endpoints.authorization_endpoint)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', nonce)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return { authorizeUrl: url.toString(), redirectUri }
}

/** 回调换 token。失败一律返回机器码，界面据此说一句人话。 */
export async function finishLogin(query) {
  const failed = (code) => {
    state.error = code
    return { ok: false, error: code }
  }

  const denied = query?.get?.('error')
  if (denied) return failed(String(denied))

  const nonce = String(query?.get?.('state') ?? '')
  const code = String(query?.get?.('code') ?? '')
  const pending = state.pending
  state.pending = null
  if (!pending || !nonce || nonce !== pending.nonce) return failed('state_mismatch')
  if (Date.now() - pending.at > CODE_TTL_MS) return failed('invalid_grant')
  if (!code) return failed('invalid_request')

  const endpoints = await endpointsOf()
  let status = 0
  let body = null
  try {
    const response = await fetch(endpoints.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: pending.redirectUri,
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(10000),
    })
    status = response.status
    body = await response.json().catch(() => null)
  } catch {
    return failed('unreachable')
  }
  if (status !== 200 || !body?.access_token) return failed(body?.error || 'token_exchange_failed')
  state.auth = adopt(body)
  save()
  return { ok: true, user: state.auth.user, sessionId: state.auth.sessionId }
}

/** 官网说 401 就等于这枚 token 不存在了：本地立刻清掉。 */
export async function refreshUser() {
  const auth = read()
  if (!auth) return { ok: false, error: 'auth-required' }
  const endpoints = await endpointsOf()
  let response
  try {
    response = await fetch(endpoints.userinfo_endpoint, {
      headers: { authorization: 'Bearer ' + auth.access_token },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return { ok: false, error: 'unreachable' }
  }
  if (response.status === 401) {
    forget()
    state.error = 'unauthorized'
    return { ok: false, error: 'unauthorized' }
  }
  if (!response.ok) return { ok: false, error: 'userinfo_failed' }
  const body = await response.json().catch(() => null)
  const user = normalizeUser(body?.user)
  if (user) {
    auth.user = user
    auth.fetchedAt = new Date().toISOString()
    save()
  }
  return { ok: true, user: auth.user }
}

/** 登出先撤销官网那枚 token（失败也不挡），再清本地。 */
export async function logout() {
  const auth = read()
  if (!auth) {
    forget()
    return
  }
  try {
    const endpoints = await endpointsOf()
    await fetch(endpoints.revocation_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.access_token },
      body: JSON.stringify({ token: auth.access_token }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {}
  forget()
}

/** 给界面看的登录态：没有 token、只剩余额，永远没有 token 本身。 */
export function status() {
  const auth = read()
  return {
    loggedIn: Boolean(auth),
    user: auth?.user ?? null,
    balance: auth?.user?.balance ?? null,
    expiresAt: auth ? new Date(auth.expiresAt).toISOString() : null,
    fetchedAt: auth?.fetchedAt ?? null,
    error: state.error,
    site: { base: base() },
  }
}

export { COOKIE, CLIENT_ID, CALLBACK_PATH }
