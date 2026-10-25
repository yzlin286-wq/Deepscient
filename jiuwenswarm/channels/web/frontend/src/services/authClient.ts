/**
 * DeepScient 官网账号登录客户端：只做 HTTP 调用，状态在 `stores/authStore.ts`。
 *
 * 两种登录方式共用同一份会话机制（cookie + `X-Auth-Session`）：
 * - 官网授权：`authorize()` 拿地址 → 打开新标签页授权 → 官网回调
 *   → 回到应用后 `claim()` 取回会话；
 * - 账号密码：`passwordLogin()` 直接换会话，授权码流程不受影响。
 *
 * 后端接口见 `gateway/channel_manager/web/web_http_auth.py`。
 *
 * **密码只作为参数传一次**，不落 localStorage / sessionStorage，也不进 store。
 */

import { getApiBase } from '../utils/env';

/**
 * 没有 cookie 的环境回落到请求头带会话 id。
 *
 * 存 `localStorage` 而不是 `sessionStorage`：桌面 WebView 拿不到种在系统浏览器里的 cookie，
 * 只剩这一条路，而 `sessionStorage` 关掉窗口就清空——重开应用会显示未登录，其实网关那边会话还在
 */
const SESSION_HEADER = 'X-Auth-Session';
const SESSION_STORAGE_KEY = 'jiuwenswarm.auth.sessionId';

/**
 * 发起登录 / 认领 / 登出必须带的请求头，与 web_http_auth.AUTH_REQUEST_HEADER 一致：
 * 带自定义头的跨站请求要先过 CORS 预检，Gateway 不放行，别的网页就没法盲发这几个请求。
 */
const AUTH_REQUEST_HEADER = 'X-Jiuwen-Auth';

/** 回调落地页广播用的频道名和消息类型，与 web_http_auth.AUTH_CALLBACK_CHANNEL / AUTH_CALLBACK_MESSAGE 一致。 */
export const AUTH_CALLBACK_CHANNEL = 'jiuwenswarm:auth';
export const AUTH_CALLBACK_MESSAGE = 'jiuwenswarm:auth-callback';

export interface AuthorizeResponse {
  authorizeUrl: string;
  state: string;
  /** 只下发给发起方的认领凭证，不出现在授权 URL 里。 */
  claimToken: string;
  expiresIn?: number;
  redirectUri?: string;
}

export interface AuthStatus {
  islogin: boolean;
  enabled: boolean;
  provider?: string;
  userId?: string | null;
  userName?: string | null;
  email?: string | null;
  role?: string | null;
  balance?: number | null;
  expiresAt?: string | null;
  sessionId?: string;
  accountCenterUrl?: string;
  registerUrl?: string;
  expired?: boolean;
  /** 邮箱是否已验证；官网没给就是 null（后端当前不下发这个字段）。 */
  emailVerified?: boolean | null;
  /** 这次会话是用哪种方式登录的；官网没给就是 null。 */
  loginMethod?: string | null;
}

export interface AuthErrorBody {
  code: string;
  message: string;
}

/** 密码登录 / 重发验证邮件的错误额外字段。 */
interface AuthErrorDetails {
  email?: string | null;
  canResend?: boolean;
  retryAfter?: number | null;
}

export class AuthApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** 403 `email_not_verified` 时官网回带的邮箱，用来展示「重发验证邮件」。 */
  readonly email: string | null;
  /** 官网说这封验证邮件可以重发（`can_resend`）。 */
  readonly canResend: boolean;
  /** 429 时建议等待的秒数（优先取响应头 `Retry-After`）。 */
  readonly retryAfter: number | null;

  constructor(message: string, code: string, status: number, details: AuthErrorDetails = {}) {
    super(message);
    this.name = 'AuthApiError';
    this.code = code;
    this.status = status;
    this.email = details.email ?? null;
    this.canResend = details.canResend === true;
    this.retryAfter =
      typeof details.retryAfter === 'number' && Number.isFinite(details.retryAfter) && details.retryAfter > 0
        ? Math.ceil(details.retryAfter)
        : null;
  }
}

function readStoredSessionId(): string {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeStoredSessionId(sessionId: string): void {
  try {
    if (sessionId) localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* 隐私模式下 localStorage 可能抛错，忽略即可——cookie 仍然生效 */
  }
}

/** 会改登录状态的请求（发起 / 认领 / 刷新 / 登出）用的请求头。 */
function stateChangingHeaders(extra?: Record<string, string>): Record<string, string> {
  return authSessionHeaders({ ...(extra || {}), [AUTH_REQUEST_HEADER]: '1' });
}

/**
 * 本机会话请求头：没有 cookie 的环境（桌面 WebView / TUI）靠 `X-Auth-Session` 带会话。
 * 中转站等其它本机端点复用这一份逻辑，避免各自实现一遍 localStorage 读写。
 */
export function authSessionHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const sessionId = readStoredSessionId();
  if (sessionId) headers[SESSION_HEADER] = sessionId;
  return headers;
}

function authUrl(path: string): string {
  // 登录路由挂在 WebChannel 自己的 FastAPI app 上（见 web_channel_app.
  // register_http_routes），和 WS 同源同端口。getApiBase() 默认空串 = 同源，
  // 与 trajectoryClient 用的是同一套约定。
  return `${getApiBase()}/api/v1/auth${path}`;
}

function positiveSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.ceil(value);
}

/**
 * 解析错误响应。两种形状都要认：
 * - 授权码流程与 `auth_header_required` 等：`{ error: { code, message } }`
 * - 密码登录 / 重发验证邮件（后端 `_flat_error`）：`{ ok: false, message, error: "code", email?, can_resend? }`
 *   429 的等待秒数只在响应头 `Retry-After` 里。
 */
async function readError(response: Response, fallback: string): Promise<AuthApiError> {
  let code = `http_${response.status}`;
  let message = fallback;
  const details: AuthErrorDetails = {};
  try {
    const body = (await response.json()) as {
      error?: AuthErrorBody | string;
      message?: string;
      email?: string;
      can_resend?: boolean;
      retry_after?: number;
    };
    if (typeof body?.error === 'string') {
      code = body.error || code;
      if (body.message) message = body.message;
    } else if (body?.error?.message) {
      message = body.error.message;
      code = body.error.code || code;
    } else if (body?.message) {
      message = body.message;
    }
    if (typeof body?.email === 'string' && body.email.trim()) details.email = body.email.trim();
    if (typeof body?.can_resend === 'boolean') details.canResend = body.can_resend;
    const bodyRetryAfter = positiveSeconds(body?.retry_after);
    if (bodyRetryAfter) details.retryAfter = bodyRetryAfter;
  } catch {
    /* 非 JSON 响应，用兜底文案 */
  }
  const headerRetryAfter = positiveSeconds(Number(response.headers.get('Retry-After')));
  if (headerRetryAfter) details.retryAfter = headerRetryAfter;
  return new AuthApiError(message, code, response.status, details);
}

/** 发起登录：拿到浏览器要打开的授权地址。 */
export async function authorize(): Promise<AuthorizeResponse> {
  const response = await fetch(authUrl('/authorize'), {
    method: 'POST',
    credentials: 'include',
    headers: stateChangingHeaders(),
  });
  if (!response.ok) throw await readError(response, '获取授权地址失败');
  const data = (await response.json()) as AuthorizeResponse;
  if (!data?.authorizeUrl || !data?.state || !data?.claimToken) {
    throw new AuthApiError('授权地址返回不完整', 'authorize_malformed', 500);
  }
  return data;
}

export type ClaimOutcome = { kind: 'pending' } | { kind: 'done'; status: AuthStatus };

/**
 * 取回登录结果。202 = 还没完成授权（不是错误，等下一次触发再来）。
 * 成功后存下 session id：桌面 WebView 拿不到种在系统浏览器里的 cookie，只能靠请求头带会话。
 */
export async function claim(state: string, claimToken: string): Promise<ClaimOutcome> {
  const response = await fetch(authUrl('/claim'), {
    method: 'POST',
    credentials: 'include',
    headers: stateChangingHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ state, claimToken }),
  });
  if (response.status === 202) return { kind: 'pending' };
  if (!response.ok) throw await readError(response, '登录失败，请重试');
  const headerSession = response.headers.get(SESSION_HEADER);
  const data = (await response.json()) as AuthStatus;
  writeStoredSessionId(headerSession || data.sessionId || '');
  // claim 的响应现在带 enabled；老版本不带时按"能认领成功就是开着的"处理
  return { kind: 'done', status: { ...data, enabled: data.enabled !== false } };
}

/**
 * 账号密码登录（`grant_type=password`）。成功后与 `claim` 一样收下会话：
 * 响应头 / body 里的 session id 写进 localStorage，cookie 由浏览器自己存。
 *
 * 失败时抛 `AuthApiError`，`status` / `code` / `email` / `canResend` / `retryAfter`
 * 都保留着，交给 store 和 UI 决定怎么提示。密码不做任何留存。
 */
export async function passwordLogin(username: string, password: string): Promise<AuthStatus> {
  const response = await fetch(authUrl('/password-login'), {
    method: 'POST',
    credentials: 'include',
    headers: stateChangingHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw await readError(response, '登录失败，请重试');
  const headerSession = response.headers.get(SESSION_HEADER);
  const data = (await response.json()) as AuthStatus;
  writeStoredSessionId(headerSession || data.sessionId || '');
  return { ...data, enabled: data.enabled !== false, islogin: data.islogin !== false };
}

/** 重发邮箱验证邮件。返回冷却秒数（后端缺省 60）。 */
export async function resendVerification(email: string): Promise<{ resendAfter: number }> {
  const response = await fetch(authUrl('/resend-verification'), {
    method: 'POST',
    credentials: 'include',
    headers: stateChangingHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw await readError(response, '发送验证邮件失败，请稍后重试');
  let resendAfter = 60;
  try {
    const data = (await response.json()) as { resend_after?: number };
    const seconds = positiveSeconds(data?.resend_after);
    if (seconds) resendAfter = seconds;
  } catch {
    /* 空响应按默认冷却处理 */
  }
  return { resendAfter };
}

/**
 * 放弃这次登录，让Gateway别再替它向官网认领。发不出去时Gateway也会在state过期后自己停。
 * `keepalive` 让页面关闭时发起的这次请求也能送达。
 */
export async function cancelLogin(state: string, claimToken: string): Promise<void> {
  try {
    await fetch(authUrl('/cancel'), {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: stateChangingHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ state, claimToken }),
    });
  } catch {
    /* 见上 */
  }
}

export function openExternal(url: string): Window | null {
  const opened = window.open(url, '_blank');
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      /* 个别 WebView 不允许改写 */
    }
  }
  return opened;
}

/** 查询当前登录状态。后端未开启登录时返回 `enabled: false`。 */
export async function status(): Promise<AuthStatus> {
  const response = await fetch(authUrl('/status'), {
    method: 'GET',
    credentials: 'include',
    headers: authSessionHeaders({ Accept: 'application/json' }),
  });
  if (!response.ok) throw await readError(response, '获取登录状态失败');
  const data = (await response.json()) as AuthStatus;
  // 会话确实过期了才丢掉本地句柄：它的优先级高于 cookie，留着会把还能用的 cookie 挡住。
  // 未登录状态不算，功能下线时也是未登录，那时清掉，功能恢复后还需要重登一次
  if (data.expired) writeStoredSessionId('');
  return data;
}

/** 重新向 DeepScient 官网拉一次用户信息。未登录 / 已过期时后端回 401。 */
export async function refreshAccount(): Promise<AuthStatus> {
  const response = await fetch(authUrl('/refresh'), {
    method: 'POST',
    credentials: 'include',
    headers: stateChangingHeaders({ Accept: 'application/json' }),
  });
  if (!response.ok) throw await readError(response, '刷新账号信息失败');
  const data = (await response.json()) as AuthStatus;
  return { ...data, enabled: data.enabled !== false };
}

export async function logout(): Promise<void> {
  await fetch(authUrl('/logout'), {
    method: 'POST',
    credentials: 'include',
    headers: stateChangingHeaders(),
  }).catch(() => undefined);
  writeStoredSessionId('');
}

/**
 * 打开新标签页去授权；被拦截时返回 `null`，由调用方展示地址让用户手动打开。
 *
 * **打开后立刻切断 opener**，不让授权窗口拿到能反向导航本页的引用。不直接传 `noopener`：
 * 那样 `window.open` 恒返回 `null`，就判断不了弹窗是否被拦截。
 */
export function openAuthorizeUrl(url: string): Window | null {
  const opened = window.open(url, '_blank');
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      /* 个别 WebView 不允许改写；授权照常进行 */
    }
  }
  return opened;
}
