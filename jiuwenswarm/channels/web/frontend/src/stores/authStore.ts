/**
 * DeepScient 官网账号状态：把「点登录 → 开浏览器 → 回到应用 → 拿到会话」收敛成几个可读字段。
 *
 * **不轮询**，只在"授权可能已完成"的时刻认领一次：落地页的 BroadcastChannel 广播（同源才
 * 收得到）、窗口重新获得焦点 / 变为可见、用户点「我已完成登录」。还没好时 claim 返回 202。
 *
 * 账号密码登录（`passwordLogin`）直接换会话，不涉及浏览器跳转，与授权码流程共用同一份
 * 会话机制和 `applyStatus`。
 *
 * 状态放 store 不放组件：关掉登录框授权仍在进行，回来还能看到结果。
 * **密码永远不进 store**——它只在 `passwordLogin` 的调用栈上待一次，由登录框自己持有。
 */

import { create } from 'zustand';
import { webClient } from '../services/webClient';
import {
  AUTH_CALLBACK_CHANNEL,
  AUTH_CALLBACK_MESSAGE,
  AuthApiError,
  AuthStatus,
  authorize,
  cancelLogin as cancelLoginRequest,
  claim,
  logout as logoutRequest,
  openAuthorizeUrl,
  passwordLogin as passwordLoginRequest,
  refreshAccount as refreshAccountRequest,
  resendVerification as resendVerificationRequest,
  status as fetchStatus,
} from '../services/authClient';

/** 登录框展示的登录方式。 */
export type LoginMode = 'authorize' | 'password';

/** 当前会话实际用的登录方式；网页刷新后后端不下发就是 `null`（未知）。 */
export type LoginMethod = 'authorize' | 'password' | null;

/** 查询登录状态的退避重试间隔，累计约 60 秒，覆盖 gateway 慢启动。 */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];

/**
 * - `idle`      未开始 / 已结束
 * - `starting`  正在取授权地址
 * - `waiting`   已打开浏览器，等用户完成授权后回来
 */
export type LoginPhase = 'idle' | 'starting' | 'waiting';

interface AuthState {
  /** 后端是否开启了登录功能（未开启时前端应隐藏登录入口，也不进登录门） */
  enabled: boolean;
  /** DeepScient 官网账号中心地址（管理额度 / 退出官网登录）。 */
  accountCenterUrl: string;
  /** DeepScient 官网注册地址。 */
  registerUrl: string;
  islogin: boolean;
  userId: string | null;
  userName: string | null;
  email: string | null;
  role: string | null;
  /** 账号余额；null = 官网没有给出。 */
  balance: number | null;
  /** 登录有效期（ISO 8601 字符串或 unix 秒）；null = 未知。 */
  expiresAt: string | null;
  /** 邮箱是否已验证；null = 官网没有给出这个字段。 */
  emailVerified: boolean | null;
  /** 登录框当前 Tab；切 Tab 不清空用户名，由登录框自己保留。 */
  loginMode: LoginMode;
  /** 本次会话的登录方式；后端不下发、网页刷新后就是 null（显示「未知」）。 */
  loginMethod: LoginMethod;
  phase: LoginPhase;
  error: string | null;
  /** 失败原因的机器码（`invalid_credentials` / `email_not_verified` / `too_many_requests` …）。 */
  errorCode: string | null;
  /** 403 `email_not_verified` 时官网回带的邮箱——用它发验证邮件，不影响账号字段 `email`。 */
  errorEmail: string | null;
  /** 官网说这封验证邮件可以重发。 */
  canResend: boolean;
  /** 429 建议等待的秒数。 */
  retryAfter: number | null;
  /**
   * 重发验证邮件的冷却截止时间（epoch ms）。
   *
   * **冷却由 store 管截止时间、UI 只负责每秒渲染倒计时**：这样关掉弹窗再打开、
   * 切换 Tab 再回来，冷却都还在，不会给官网重复发信。
   */
  resendCooldownUntil: number;
  /** 密码登录请求在途（登录框据此禁用输入与按钮）。 */
  passwordSubmitting: boolean;
  /** 浏览器被拦截时展示这个地址让用户手动打开 */
  pendingAuthorizeUrl: string | null;
  /** 用户点了「我已完成登录」，但授权其实还没完成：提示他先去完成授权。自动触发的认领不置这个 */
  claimPendingHint: boolean;
  /** 已查过一次状态，用于区分「未登录」和「还没查」 */
  initialized: boolean;

  refresh: () => Promise<void>;
  /** 重新向官网拉一次账号信息；401 时清空登录态。 */
  refreshAccount: () => Promise<void>;
  startLogin: () => Promise<void>;
  /**
   * 去认领一次登录结果。等待授权期间由事件触发，也给「我已完成登录」按钮用；
   * `manual` = 用户亲手点的，授权还没完成时要给出提示，而自动触发时保持安静。
   */
  checkLogin: (manual?: boolean) => Promise<void>;
  cancelLogin: () => void;
  logout: () => Promise<void>;
  clearError: () => void;
  /** 切换登录方式：清掉另一种方式的报错，避免两边文案串台。 */
  setLoginMode: (mode: LoginMode) => void;
  /** 账号密码登录。成功 true；失败设置 error / errorCode / errorEmail / canResend / retryAfter。 */
  passwordLogin: (username: string, password: string) => Promise<boolean>;
  /** 重发邮箱验证邮件，成功返回冷却秒数；失败设置错误并返回 null。 */
  resendVerification: (email: string) => Promise<number | null>;
}

/** 正在等待的那次登录。只在内存里：`claimToken` 是认领凭证，不落任何存储。 */
let pendingLogin: { state: string; claimToken: string } | null = null;
let detachTriggers: (() => void) | null = null;
let claimInFlight = false;
/** 认领进行中又来了新的触发：回调可能恰好在这期间完成，结束后要再认领一次。 */
let claimRequestedAgain = false;
/** 合并进来的那次触发是不是用户点的按钮：切回应用时焦点事件已先发起认领，紧接着的点击会被合并到这里 */
let claimRequestedManually = false;
/** 登录流程代次：发起 / 取消 / 登出都 +1，卡在 `await authorize()` 里的旧流程醒来发现变了就作废。 */
let loginRun = 0;
/** 正在进行的状态查询。多处 UI 同时发现「还没查过」时共用这一次，不各起一条退避重试。 */
let refreshInflight: Promise<void> | null = null;

/** 登出 / 会话失效时要一起清掉的账号字段。 */
const SIGNED_OUT_FIELDS = {
  islogin: false,
  userId: null,
  userName: null,
  email: null,
  role: null,
  balance: null,
  expiresAt: null,
  emailVerified: null,
  loginMethod: null,
} satisfies Partial<AuthState>;

/** 报错相关的字段：换 Tab、重试、登出时一起清，避免旧提示残留。 */
const CLEARED_ERROR_FIELDS = {
  error: null,
  errorCode: null,
  errorEmail: null,
  canResend: false,
  retryAfter: null,
} satisfies Partial<AuthState>;

function stopWaiting(): void {
  loginRun += 1;
  pendingLogin = null;
  claimRequestedAgain = false;
  claimRequestedManually = false;
  detachTriggers?.();
  detachTriggers = null;
}

/** 放弃正在等待的登录：除了本地收尾，还要通知Gateway停止向官网认领。 */
function abandonWaiting(): void {
  if (pendingLogin) void cancelLoginRequest(pendingLogin.state, pendingLogin.claimToken);
  stopWaiting();
}

/**
 * 挂上三个"授权可能已完成"的触发点（见文件头），以及页面关闭：`claimToken` 只在内存里，
 * 页面一关这次登录就不可能再被认领了。
 */
function attachTriggers(onTrigger: () => void, onLeave: () => void): () => void {
  // BroadcastChannel 只在同源页面之间传递，别的网站发不进来；消息不带数据，认领要出示 claimToken
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(AUTH_CALLBACK_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === AUTH_CALLBACK_MESSAGE) onTrigger();
    };
  } catch {
    channel = null; // 不支持的环境只靠下面两个触发点
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') onTrigger();
  };
  window.addEventListener('focus', onTrigger);
  document.addEventListener('visibilitychange', onVisible);
  // 进了bfcache（persisted）的页面还会回来，内存里的claimToken也还在，不算离开
  const onPageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) onLeave();
  };
  window.addEventListener('pagehide', onPageHide);
  return () => {
    channel?.close();
    window.removeEventListener('focus', onTrigger);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pagehide', onPageHide);
  };
}

/** 后端下发的登录方式归一成前端认识的两种；认不出来就是未知。 */
function normalizeLoginMethod(value: unknown): LoginMethod {
  if (value === 'password') return 'password';
  if (value === 'authorize' || value === 'authorization_code' || value === 'oauth') return 'authorize';
  return null;
}

function applyStatus(data: AuthStatus): Partial<AuthState> {
  const method = normalizeLoginMethod(data.loginMethod);
  return {
    enabled: data.enabled !== false,
    islogin: Boolean(data.islogin),
    userId: data.userId ?? null,
    userName: data.userName ?? null,
    email: data.email ?? null,
    role: data.role ?? null,
    balance: typeof data.balance === 'number' && Number.isFinite(data.balance) ? data.balance : null,
    expiresAt: data.expiresAt ?? null,
    // 后端当前不下发这两个字段：有就用，没有就沿用已知值，别把密码登录刚拿到的信息抹掉
    ...(typeof data.emailVerified === 'boolean' ? { emailVerified: data.emailVerified } : {}),
    ...(method ? { loginMethod: method } : {}),
    ...(data.accountCenterUrl ? { accountCenterUrl: data.accountCenterUrl } : {}),
    ...(data.registerUrl ? { registerUrl: data.registerUrl } : {}),
    initialized: true,
  };
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof AuthApiError) return error.message;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  enabled: false,
  accountCenterUrl: '',
  registerUrl: '',
  islogin: false,
  userId: null,
  userName: null,
  email: null,
  role: null,
  balance: null,
  expiresAt: null,
  emailVerified: null,
  loginMode: 'authorize',
  loginMethod: null,
  phase: 'idle',
  error: null,
  errorCode: null,
  errorEmail: null,
  canResend: false,
  retryAfter: null,
  resendCooldownUntil: 0,
  passwordSubmitting: false,
  pendingAuthorizeUrl: null,
  claimPendingHint: false,
  initialized: false,

  refresh() {
    // 多处 UI 会同时发现「还没查过」，共用同一次在途查询，不各起一条退避重试
    if (!refreshInflight) {
      refreshInflight = (async () => {
        // 前端常比 gateway 先起来，第一次很可能打在还没监听的端口上：退避重试；
        // 只有明确回 404（没有 /auth 路由）才认定登录功能是关的
        for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt += 1) {
          try {
            set(applyStatus(await fetchStatus()));
            return;
          } catch (error) {
            const definitivelyOff = error instanceof AuthApiError && error.status === 404;
            const lastAttempt = attempt >= RETRY_DELAYS_MS.length;
            if (definitivelyOff || lastAttempt) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
          }
        }
        // Gateway无应答时按"暂时连不上"处理；标签页重新可见时还会再查一次
        set({ enabled: false, initialized: true });
      })().finally(() => {
        refreshInflight = null;
      });
    }
    return refreshInflight;
  },

  async refreshAccount() {
    // 没登录就没有账号信息可刷新，也别去打接口——未登录时它必然 401。
    if (!get().islogin) return;
    try {
      const data = await refreshAccountRequest();
      if (data.islogin === false) {
        set(SIGNED_OUT_FIELDS);
        notifyAuthChanged(false);
        return;
      }
      set({
        email: data.email ?? null,
        role: data.role ?? null,
        balance: typeof data.balance === 'number' && Number.isFinite(data.balance) ? data.balance : null,
        expiresAt: data.expiresAt ?? null,
        ...(typeof data.emailVerified === 'boolean' ? { emailVerified: data.emailVerified } : {}),
      });
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        set(SIGNED_OUT_FIELDS);
        notifyAuthChanged(false);
        return;
      }
      // 刷新失败不该变成弹窗里的报错：账号信息是附加信息，留一条日志方便排查
      console.warn('[auth] 刷新账号信息失败', error);
    }
  },

  async startLogin() {
    if (get().phase !== 'idle') return;
    stopWaiting();
    const run = loginRun;
    set({
      phase: 'starting',
      ...CLEARED_ERROR_FIELDS,
      pendingAuthorizeUrl: null,
      claimPendingHint: false,
    });

    let request;
    try {
      request = await authorize();
    } catch (error) {
      if (run !== loginRun) return;
      set({ phase: 'idle', error: messageOf(error, '无法获取授权地址，请稍后重试') });
      return;
    }
    // 取授权地址期间用户点了取消 / 登出：这一轮作废，别再替他开浏览器；
    // Gateway已经开始替它向官网认领，也通知它停下
    if (run !== loginRun) {
      void cancelLoginRequest(request.state, request.claimToken);
      return;
    }

    pendingLogin = { state: request.state, claimToken: request.claimToken };
    detachTriggers = attachTriggers(
      () => void get().checkLogin(),
      () => get().cancelLogin(),
    );
    const authorizeWindow = openAuthorizeUrl(request.authorizeUrl);
    set({
      phase: 'waiting',
      // 被浏览器拦截时把地址暴露出来，让用户自己复制——比直接失败好
      pendingAuthorizeUrl: authorizeWindow ? null : request.authorizeUrl,
    });
  },

  async checkLogin(manual = false) {
    const current = pendingLogin;
    if (!current) return;
    if (claimInFlight) {
      claimRequestedAgain = true;
      claimRequestedManually = claimRequestedManually || manual;
      return;
    }
    claimInFlight = true;
    claimRequestedAgain = false;
    claimRequestedManually = false;
    let finished = false;
    try {
      const outcome = await claim(current.state, current.claimToken);
      // 认领期间用户取消了 / 又发起了一次新登录：这个结果已经没人要了
      if (pendingLogin !== current) return;
      if (outcome.kind === 'pending') {
        if (manual) set({ claimPendingHint: true });
        return;
      }
      finished = true;
      stopWaiting();
      set({
        ...applyStatus(outcome.status),
        loginMethod: 'authorize',
        phase: 'idle',
        pendingAuthorizeUrl: null,
        ...CLEARED_ERROR_FIELDS,
        claimPendingHint: false,
      });
      // 登录态变了：通知 App 重连 WS 并重拉依赖登录态的列表
      notifyAuthChanged(true);
    } catch (error) {
      // 网络抖动不算失败，等下一个触发点；业务错误（取消授权、链接过期……）直接结束。
      if (pendingLogin !== current || !(error instanceof AuthApiError)) return;
      finished = true;
      stopWaiting();
      set({ phase: 'idle', error: messageOf(error, '登录失败，请重试'), claimPendingHint: false });
    } finally {
      claimInFlight = false;
      if (!finished && claimRequestedAgain) void get().checkLogin(claimRequestedManually);
    }
  },

  cancelLogin() {
    abandonWaiting();
    // 连同上一次的报错一起清掉：取消就是重新开始，再打开登录框不该还挂着旧错误
    set({ phase: 'idle', pendingAuthorizeUrl: null, ...CLEARED_ERROR_FIELDS, claimPendingHint: false });
  },

  async logout() {
    abandonWaiting();
    await logoutRequest();
    set({
      ...SIGNED_OUT_FIELDS,
      phase: 'idle',
      ...CLEARED_ERROR_FIELDS,
      pendingAuthorizeUrl: null,
      claimPendingHint: false,
      // 换了账号，重发冷却也要归零
      resendCooldownUntil: 0,
      passwordSubmitting: false,
    });
    notifyAuthChanged(false);
  },

  clearError() {
    set(CLEARED_ERROR_FIELDS);
  },

  setLoginMode(mode) {
    if (get().loginMode === mode) return;
    // 只清报错，不动用户名（用户名由登录框自己保留），也不打断正在等待的授权
    set({ loginMode: mode, ...CLEARED_ERROR_FIELDS });
  },

  async passwordLogin(username, password) {
    if (get().passwordSubmitting) return false;
    // 之前可能正在等官网授权：密码登录一旦开始，那次等待就没意义了。
    // 顺手让Gateway停止认领，也摘掉焦点 / 可见性触发点，免得它晚一步把结果盖回来。
    abandonWaiting();
    // 密码只作为这次调用的参数，不写进 state
    set({ passwordSubmitting: true, ...CLEARED_ERROR_FIELDS, phase: 'idle' });
    try {
      const data = await passwordLoginRequest(username, password);
      set({
        ...applyStatus({ ...data, islogin: true, enabled: data.enabled !== false }),
        loginMethod: 'password',
        loginMode: 'password',
        passwordSubmitting: false,
        pendingAuthorizeUrl: null,
        claimPendingHint: false,
        ...CLEARED_ERROR_FIELDS,
      });
      notifyAuthChanged(true);
      return true;
    } catch (error) {
      const apiError = error instanceof AuthApiError ? error : null;
      set({
        passwordSubmitting: false,
        error: messageOf(error, '登录失败，请重试'),
        errorCode: apiError?.code ?? null,
        errorEmail: apiError?.email ?? null,
        canResend: apiError?.canResend === true,
        retryAfter: apiError?.retryAfter ?? null,
      });
      return false;
    }
  },

  async resendVerification(email) {
    const target = email.trim();
    if (!target) return null;
    // 冷却里直接不发：重复点不该白打一次接口
    if (get().resendCooldownUntil > Date.now()) return null;
    try {
      const { resendAfter } = await resendVerificationRequest(target);
      set({
        // 保留 errorCode / errorEmail：邮箱仍然没验证，界面要继续显示是哪个邮箱、
        // 只是把「发送失败」清掉并进入冷却
        error: null,
        canResend: false,
        retryAfter: null,
        resendCooldownUntil: Date.now() + resendAfter * 1000,
      });
      return resendAfter;
    } catch (error) {
      const apiError = error instanceof AuthApiError ? error : null;
      const retryAfter = apiError?.retryAfter ?? null;
      set({
        error: messageOf(error, '发送验证邮件失败，请稍后重试'),
        errorCode: apiError?.code ?? null,
        canResend: apiError?.canResend === true,
        retryAfter,
        ...(retryAfter ? { resendCooldownUntil: Date.now() + retryAfter * 1000 } : {}),
      });
      return null;
    }
  },
}));

/**
 * 模型层报「需要登录」时调这个，直接把登录框顶到用户面前。
 * 事件由 `LoginDialog` 监听，避免和 App.tsx 的状态耦合。
 */
export function requestLogin(reason?: string): void {
  window.dispatchEvent(new CustomEvent('jiuwen:auth-required', { detail: { reason } }));
}

/**
 * 登录态变化后重连 WebSocket。
 *
 * 不是可选的优化：会话 id 只在 **WS 握手**时读一次，不重连的话服务端拿不到新的登录会话，
 * 依赖账号的请求会继续用旧身份。失败不抛：最多退回"下次自然重连后才生效"。
 */
async function reconnectForAuthChange(): Promise<void> {
  try {
    await webClient.reconnect();
  } catch {
    /* 交给 webClient 自己的重连退避 */
  }
}

/** 登录态变化时广播：依赖登录态的列表是 App 启动时的快照，要靠这个事件才会重拉。 */
export function notifyAuthChanged(islogin: boolean): void {
  // **顺序不能反**：重连会取消在途请求，而监听方收到事件就去重拉列表；同时发起的话
  // 重拉多半被取消掉。用 finally 而不是 then：重连失败也要通知，否则列表停在登录前那份。
  void reconnectForAuthChange().finally(() => {
    window.dispatchEvent(new CustomEvent('jiuwen:auth-changed', { detail: { islogin } }));
  });
}
