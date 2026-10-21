/**
 * 应用内的账号体系：注册、登录、登出、改密码。
 *
 * 为什么要它：DSH 自己的浏览器 cookie 是**设备级**的——本机任何浏览器拿到
 * 启动时的 `?token=` 就进去了，没有"这是谁"的概念。DeepScient 要的是**人级**的
 * 身份：同一个实例上可以有几个不同的使用者，各自的课题与需求书不该混在一起看。
 *
 * 三条纪律：
 *   1. **密码只存 scrypt 派生值**：随机 salt + 64 字节，比较用 timingSafeEqual。
 *      不存明文、不存可逆加密、不自己发明 KDF。
 *   2. **第一个账号是 owner，注册随后关闭**。单人科研工具不需要开放注册；
 *      owner 想把别人加进来是后续功能，这里明确拒绝而不是假装支持。
 *   3. **失败要说清是哪一种**：没登录（401）、密码错（401 + 剩余次数）、
 *      被限流（429）。前端据此显示不同的话，不用猜。
 *
 * 不做什么：不做找回密码邮件（本机没有邮件通道）、不做多因素、不做第三方 OAuth。
 * 这些都需要外部依赖，而这是个跑在本机的科研工具。
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './science.js'

const AUTH = '/deepscient/auth'
const COOKIE = 'deepscient_session'
const SESSION_DAYS = 30
/** 同一个用户名连续失败这么多次就锁一会儿。内存计数器，重启清零——够用。 */
const MAX_FAILS = 8
const LOCK_MS = 15 * 60 * 1000
const SCRYPT_KEYLEN = 64

const fails = new Map()

function authDir() {
  return join(dshHome(), 'science', 'auth')
}

function usersPath() {
  return join(authDir(), 'users.json')
}

function sessionsPath() {
  return join(authDir(), 'sessions.json')
}

function ensureDir() {
  const dir = authDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // 文件坏了不该让整个登录不可用：当作空库，让人能重新注册。坏文件留个备份。
    try {
      writeFileSync(path + '.broken', readFileSync(path))
    } catch {}
    return fallback
  }
}

function writeJson(path, value) {
  ensureDir()
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

/* ── 密码 ──────────────────────────────────────────────────────────────── */

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN)
  return { salt, hash: derived.toString('hex') }
}

function verifyPassword(password, salt, hash) {
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  // 长度相等才比较；timingSafeEqual 长度不等会抛，不能吞掉这个差异。
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/* ── 存储 ──────────────────────────────────────────────────────────────── */

function loadUsers() {
  const data = readJson(usersPath(), { version: 1, users: [] })
  if (!Array.isArray(data.users)) data.users = []
  return data
}

function saveUsers(data) {
  writeJson(usersPath(), data)
}

function loadSessions() {
  const data = readJson(sessionsPath(), { version: 1, sessions: [] })
  if (!Array.isArray(data.sessions)) data.sessions = []
  const now = Date.now()
  data.sessions = data.sessions.filter((s) => s && typeof s.expiresAt === 'number' && s.expiresAt > now)
  return data
}

function saveSessions(data) {
  writeJson(sessionsPath(), data)
}

/** 磁盘上只放 token 的摘要：文件被拷走也换不回可用的 cookie。 */
function tokenDigest(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role || 'member',
    createdAt: user.createdAt ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
  }
}

/* ── cookie ────────────────────────────────────────────────────────────── */

function parseCookies(req) {
  const raw = req.headers?.cookie
  if (!raw) return {}
  const out = {}
  for (const part of String(raw).split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

function sessionCookie(token, maxAgeSeconds) {
  // SameSite=Lax 而不是 Strict：登录后从外部链接回到本机首页要能带上 cookie。
  // HttpOnly 一定要有——前端不需要读它，能读就多一条 XSS 偷走的路。
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

/* ── 会话 ──────────────────────────────────────────────────────────────── */

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url')
  const data = loadSessions()
  const now = Date.now()
  data.sessions.push({
    digest: tokenDigest(token),
    userId,
    createdAt: now,
    expiresAt: now + SESSION_DAYS * 24 * 3600 * 1000,
  })
  // 每个用户只保留最近 5 个会话，避免文件无限长。
  const mine = data.sessions.filter((s) => s.userId === userId)
  if (mine.length > 5) {
    const drop = new Set(mine.slice(0, mine.length - 5).map((s) => s.digest))
    data.sessions = data.sessions.filter((s) => !drop.has(s.digest))
  }
  saveSessions(data)
  return token
}

export function destroySession(token) {
  if (!token) return
  const digest = tokenDigest(token)
  const data = loadSessions()
  const before = data.sessions.length
  data.sessions = data.sessions.filter((s) => s.digest !== digest)
  if (data.sessions.length !== before) saveSessions(data)
}

/** 从请求里认出人。认证是同步的：文件已在内存里够快，读盘一次也不会卡。 */
export function currentUser(req) {
  const token = parseCookies(req)[COOKIE]
  if (!token) return null
  const digest = tokenDigest(token)
  const data = loadSessions()
  const session = data.sessions.find((s) => s.digest === digest)
  if (!session) return null
  const users = loadUsers()
  const user = users.users.find((u) => u.id === session.userId)
  return user ?? null
}

/* ── 限流 ──────────────────────────────────────────────────────────────── */

function lockedFor(username) {
  const entry = fails.get(username)
  if (!entry) return 0
  if (entry.until && entry.until > Date.now()) return Math.ceil((entry.until - Date.now()) / 1000)
  return 0
}

function noteFail(username) {
  const entry = fails.get(username) ?? { count: 0, until: 0 }
  entry.count += 1
  if (entry.count >= MAX_FAILS) {
    entry.until = Date.now() + LOCK_MS
    entry.count = 0
  }
  fails.set(username, entry)
  return MAX_FAILS - entry.count
}

function clearFails(username) {
  fails.delete(username)
}

/* ── HTTP 小工具 ───────────────────────────────────────────────────────── */

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

function checkCredentials(username, password) {
  const name = String(username ?? '').trim()
  if (name.length < 2 || name.length > 32) return '用户名要 2–32 个字符'
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return '用户名只能用字母、数字、下划线、点和横线'
  const pwd = String(password ?? '')
  if (pwd.length < 8) return '密码至少 8 位'
  if (pwd.length > 200) return '密码太长'
  return null
}

/* ── 路由 ──────────────────────────────────────────────────────────────── */

/**
 * 处理 /deepscient/auth/*。返回 true 表示这个请求归它管。
 * 路由表刻意小：状态、注册、登录、登出、改密码、列用户。
 */
export async function handleAuth(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  if (path !== AUTH && !path.startsWith(AUTH + '/')) return false

  const rest = path.slice(AUTH.length).replace(/^\/+/, '')
  const method = (req.method ?? 'GET').toUpperCase()

  try {
    if (rest === 'state' && method === 'GET') {
      const users = loadUsers()
      const user = currentUser(req)
      json(res, 200, {
        hasUsers: users.users.length > 0,
        user: publicUser(user),
        // 前端据此决定显示登录还是"创建第一个账号"
        registrationOpen: users.users.length === 0,
        sessionDays: SESSION_DAYS,
      })
      return true
    }

    if (rest === 'register' && method === 'POST') {
      const body = await readBody(req)
      const users = loadUsers()
      if (users.users.length > 0) {
        return json(res, 403, { error: 'registration-closed', message: '这个实例已经有账号了。注册只对第一个账号开放。' }), true
      }
      const problem = checkCredentials(body.username, body.password)
      if (problem) return json(res, 400, { error: 'bad-credentials', message: problem }), true

      const username = String(body.username).trim()
      const { salt, hash } = hashPassword(String(body.password))
      const user = {
        id: 'u-' + randomBytes(6).toString('hex'),
        username,
        displayName: String(body.displayName ?? '').trim() || username,
        salt,
        hash,
        role: 'owner',
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      }
      users.users.push(user)
      saveUsers(users)
      clearFails(username)
      const token = createSession(user.id)
      json(res, 201, { user: publicUser(user) }, { 'set-cookie': sessionCookie(token, SESSION_DAYS * 24 * 3600) })
      return true
    }

    if (rest === 'login' && method === 'POST') {
      const body = await readBody(req)
      const username = String(body.username ?? '').trim()
      const locked = lockedFor(username)
      if (locked > 0) {
        json(res, 429, { error: 'rate-limited', retryAfter: locked, message: `失败次数太多，${Math.ceil(locked / 60)} 分钟后再试。` })
        return true
      }
      const users = loadUsers()
      const user = users.users.find((u) => u.username === username)
      // 用户不存在与密码错给同一句话：不告诉外面"这个用户名存在"。
      const ok = user ? verifyPassword(String(body.password ?? ''), user.salt, user.hash) : false
      if (!ok) {
        const left = noteFail(username)
        json(res, 401, { error: 'bad-login', remaining: Math.max(left, 0), message: '用户名或密码不对。' })
        return true
      }
      clearFails(username)
      user.lastLoginAt = new Date().toISOString()
      saveUsers(users)
      const token = createSession(user.id)
      json(res, 200, { user: publicUser(user) }, { 'set-cookie': sessionCookie(token, SESSION_DAYS * 24 * 3600) })
      return true
    }

    if (rest === 'logout' && method === 'POST') {
      const token = parseCookies(req)[COOKIE]
      destroySession(token)
      json(res, 200, { ok: true }, { 'set-cookie': clearCookie() })
      return true
    }

    if (rest === 'password' && method === 'POST') {
      const user = currentUser(req)
      if (!user) return json(res, 401, { error: 'auth-required' }), true
      const body = await readBody(req)
      if (!verifyPassword(String(body.current ?? ''), user.salt, user.hash)) {
        json(res, 401, { error: 'bad-login', message: '当前密码不对。' })
        return true
      }
      const problem = checkCredentials(user.username, body.next)
      if (problem) return json(res, 400, { error: 'bad-credentials', message: problem }), true

      const users = loadUsers()
      const target = users.users.find((u) => u.id === user.id)
      const { salt, hash } = hashPassword(String(body.next))
      target.salt = salt
      target.hash = hash
      saveUsers(users)
      // 改密码后把所有会话清掉，再用当前这枚换新——别的设备随即失效。
      const data = loadSessions()
      data.sessions = data.sessions.filter((s) => s.userId !== user.id)
      saveSessions(data)
      const token = createSession(user.id)
      json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(token, SESSION_DAYS * 24 * 3600) })
      return true
    }

    if (rest === 'users' && method === 'GET') {
      const user = currentUser(req)
      if (!user) return json(res, 401, { error: 'auth-required' }), true
      const users = loadUsers()
      json(res, 200, { items: users.users.map(publicUser) })
      return true
    }

    json(res, 404, { error: 'not-found', path })
    return true
  } catch (error) {
    json(res, 400, { error: 'bad-request', message: error.message })
    return true
  }
}

/**
 * 哪些 /deepscient/api 下的路径不需要登录。
 *
 * 判定标准是「这条数据是不是"这个人的"」：
 *   - 能力清单（工具、阶段、流程、源、预设、健康）是这台机器的，不是谁的 → 公开。
 *   - 课题、需求书、概览、设置是某个人的 → 必须登录。
 * 公开不等于无所谓：它们本来就不含密钥（源那页的 key 是掩码）。
 */
const PUBLIC_API = new Set(['health', 'tools', 'workflow', 'stages', 'presets', 'sources', 'docs'])

export function isPublicApi(rest) {
  const head = String(rest ?? '').split('/')[0]
  return PUBLIC_API.has(head)
}

export { AUTH, COOKIE }
