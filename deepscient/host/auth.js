/**
 * /deepscient/auth/*：登录态与官网 token 的门口。
 *
 * 账号由 deepscient.com 管理：这里不存密码、不建用户库、不做恢复码。
 * 本机只有两样东西：服务端保存的 access_token，以及浏览器手里那枚会话 cookie。
 *
 * 三条纪律：
 *   1. **密码不进来**（见 oauth.js）；
 *   2. **未登录就是未登录**：不设 bootstrap 例外，登录门自己走 /auth/* 这几个公开端点；
 *   3. **失败要说清是哪一种**：state 失效、用户取消、授权码过期各有各的话。
 */
import { beginLogin, clearAuth, currentUser, finishLogin, logout, refreshUser, status } from './oauth.js'
import { syncUserQuietly } from './relay.js'

const AUTH = '/deepscient/auth'
const COOKIE = 'deepscient_session'

/**
 * 哪些 /deepscient/api 下的路径不需要登录。
 *
 * 判定标准是「这条数据是不是"这个人的"」：
 *   - 能力清单（工具、阶段、流程、源、预设、健康、文档）是这台机器的，不是谁的 → 公开。
 *   - 课题、需求书、概览、设置是某个人的 → 必须登录。
 * 公开不等于无所谓：它们本来就不含密钥（源那页的 key 是掩码）。
 */
const PUBLIC_API = new Set(['health', 'tools', 'workflow', 'stages', 'presets', 'sources', 'docs'])

export function isPublicApi(rest) {
  const head = String(rest ?? '').split('/')[0]
  return PUBLIC_API.has(head)
}

/**
 * WebSocket 升级的人级门。
 *
 * 设备级准入只回答「是不是这台机器上的浏览器」，不回答「登录了没有」。
 * 这层补上后者：cookie 会话有效才放行；程序化客户端带 Authorization 的照旧放行。
 *
 * 关掉：DEEPSCIENT_WS_GATE=0。
 */
export function gateUpgrade(req) {
  if (req?.headers?.authorization) return 'token'
  return currentUser(req) ? 'session' : 'deny'
}

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

function sessionCookie(value, maxAgeSeconds) {
  // SameSite=Lax 而不是 Strict：从官网授权页跳回本机时要能带上 cookie。
  return COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeSeconds
}

function clearCookie() {
  return COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
}

/** 回调地址必须是回环：契约只允许 127.0.0.1 / localhost。 */
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i

function originOf(req, ctx) {
  const host = String(req?.headers?.host ?? '')
  if (LOOPBACK.test(host)) return 'http://' + host
  try {
    const origin = ctx?.webServer?.origin
    if (typeof origin === 'string' && origin) return origin
  } catch {}
  return 'http://127.0.0.1'
}

function page(res, code, heading, body, ok) {
  const color = ok ? '#1f6f5c' : '#b3261e'
  const html = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + heading + ' · DeepScient</title>',
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;',
    'font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#111}',
    'main{max-width:420px;padding:28px}h1{font-size:18px;margin:0 0 8px;color:' + color + '}',
    'p{margin:0 0 18px;opacity:.7}a{color:#1f6f5c}</style></head><body><main>',
    '<h1>' + heading + '</h1><p>' + body + '</p>',
    '<a href="/">返回工作台 · Back to workbench</a>',
    '</main></body></html>',
  ].join('')
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(html)
}

const FAIL_TEXT = {
  access_denied: '你取消了授权 · Authorization was cancelled',
  state_mismatch: '这次登录已失效，请重新发起 · This sign-in attempt is no longer valid',
  invalid_grant: '授权码已过期或已被使用，请重新登录 · The authorization code expired or was already used',
  invalid_request: '官网没有带回授权码 · The website did not return an authorization code',
  unreachable: '连不上官网，检查网络后重试 · Could not reach deepscient.com',
  unauthorized: '官网判定这枚 token 已失效 · The website rejected this token',
}

/** 官网授权回调。路径由契约固定，挂在站点根上。 */
export async function handleCallback(req, res, ctx = null) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const result = await finishLogin(url.searchParams)
  if (!result.ok) {
    page(res, 400, '登录没有完成', FAIL_TEXT[result.error] ?? ('官网没有接受这次登录 · ' + result.error), false)
    return true
  }
  // 登录成功就顺手在中转站静默建号/补同步；失败不能影响登录本身，所以不 await。
  void syncUserQuietly(result.user, ctx?.logger ?? null)
  // 会话号只在这一刻交给浏览器；磁盘上那份 token 仍是服务端独占。
  res.setHeader('set-cookie', sessionCookie(result.sessionId, 30 * 24 * 3600))
  page(res, 200, '登录成功', '可以关掉这一页，回到工作台。 · Signed in. Return to the workbench.', true)
  return true
}

/** 处理 /deepscient/auth/*。返回 true 表示这个请求归它管。 */
export async function handleAuth(req, res, ctx) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  if (path !== AUTH && !path.startsWith(AUTH + '/')) return false

  const rest = path.slice(AUTH.length).replace(/^\/+/, '')
  const method = (req.method ?? 'GET').toUpperCase()

  try {
    if (rest === 'state' && method === 'GET') {
      json(res, 200, { ok: true, ...status() })
      return true
    }

    if (rest === 'authorize' && method === 'POST') {
      const { authorizeUrl } = await beginLogin(originOf(req, ctx))
      json(res, 200, { ok: true, authorizeUrl })
      return true
    }

    if (rest === 'refresh' && method === 'POST') {
      const result = await refreshUser()
      if (!result.ok && result.error === 'auth-required') {
        json(res, 401, { ok: false, error: 'auth-required' }, { 'set-cookie': clearCookie() })
        return true
      }
      if (!result.ok) {
        json(res, 502, { ok: false, error: result.error }, { 'set-cookie': clearCookie() })
        return true
      }
      json(res, 200, { ok: true, ...status() })
      return true
    }

    if (rest === 'logout' && method === 'POST') {
      await logout()
      json(res, 200, { ok: true }, { 'set-cookie': clearCookie() })
      return true
    }

    json(res, 404, { ok: false, error: 'not-found', path })
    return true
  } catch (error) {
    json(res, 500, { ok: false, error: 'oauth-failed', message: error?.message ?? 'unknown' })
    return true
  }
}

export { AUTH, COOKIE, clearAuth, currentUser }
