/**
 * DeepScient 官网账号面板 / 登录框：未登录时是双 Tab 登录引导（官网授权 / 账号密码），
 * 已登录时是账号信息。
 *
 * 两种打开方式：
 * - `variant="dialog"`（默认）：受控传 `open` / `onClose`，或由 `requestLogin()` 派发
 *   `jiuwen:auth-required`；关掉弹窗不中断授权（等待状态在 store 里）。
 * - `variant="screen"`：整页登录（`AuthGate` 用），铺满页面、默认不可关闭。
 *
 * 密码只存在本组件的 state 里：提交后无论成功失败都清空，不进 store、不落任何存储。
 * 重发验证邮件的 60 秒冷却由 store 管截止时间（`resendCooldownUntil`），这里只渲染倒计时。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../stores/authStore';
import { Dialog } from '../ui';
import './LoginDialog.css';

const TITLE_ID = 'login-dialog-title';

interface LoginDialogProps {
  /** 受控打开（仅 dialog 变体）。不传则只响应 `jiuwen:auth-required` 事件。 */
  open?: boolean;
  onClose?: () => void;
  /** `screen` = 整页登录门，不渲染原生 <dialog>。 */
  variant?: 'dialog' | 'screen';
  /** 是否允许关闭；`screen` 默认 false，`dialog` 默认 true。 */
  dismissible?: boolean;
}

/** 有效期可能是 ISO 字符串，也可能是后端直接给的 unix 秒；认不出来就说明未知。 */
function formatExpiresAt(value: string | null, locale: string): string {
  if (!value) return '';
  const raw = String(value);
  const parsed = new Date(/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function LoginDialog({ open, onClose, variant = 'dialog', dismissible }: LoginDialogProps) {
  const { t, i18n } = useTranslation();
  const isScreen = variant === 'screen';
  const canDismiss = dismissible ?? !isScreen;
  const [selfOpen, setSelfOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** 用户名 / 密码都只在组件里；切换 Tab 只清密码与错误，用户名留着方便改。 */
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const enabled = useAuthStore((s) => s.enabled);
  const islogin = useAuthStore((s) => s.islogin);
  const userName = useAuthStore((s) => s.userName);
  const userId = useAuthStore((s) => s.userId);
  const email = useAuthStore((s) => s.email);
  const role = useAuthStore((s) => s.role);
  const balance = useAuthStore((s) => s.balance);
  const expiresAt = useAuthStore((s) => s.expiresAt);
  const accountCenterUrl = useAuthStore((s) => s.accountCenterUrl);
  const registerUrl = useAuthStore((s) => s.registerUrl);
  const phase = useAuthStore((s) => s.phase);
  const error = useAuthStore((s) => s.error);
  const errorCode = useAuthStore((s) => s.errorCode);
  const errorEmail = useAuthStore((s) => s.errorEmail);
  const canResend = useAuthStore((s) => s.canResend);
  const retryAfter = useAuthStore((s) => s.retryAfter);
  const resendCooldownUntil = useAuthStore((s) => s.resendCooldownUntil);
  const passwordSubmitting = useAuthStore((s) => s.passwordSubmitting);
  const loginMode = useAuthStore((s) => s.loginMode);
  const pendingAuthorizeUrl = useAuthStore((s) => s.pendingAuthorizeUrl);
  const initialized = useAuthStore((s) => s.initialized);
  const refresh = useAuthStore((s) => s.refresh);
  const refreshAccount = useAuthStore((s) => s.refreshAccount);
  const startLogin = useAuthStore((s) => s.startLogin);
  const checkLogin = useAuthStore((s) => s.checkLogin);
  const claimPendingHint = useAuthStore((s) => s.claimPendingHint);
  const cancelLogin = useAuthStore((s) => s.cancelLogin);
  const logout = useAuthStore((s) => s.logout);
  const setLoginMode = useAuthStore((s) => s.setLoginMode);
  const passwordLogin = useAuthStore((s) => s.passwordLogin);
  const resendVerification = useAuthStore((s) => s.resendVerification);
  const clearError = useAuthStore((s) => s.clearError);

  const isOpen = isScreen ? true : (open ?? selfOpen);
  const locale = i18n.language || 'zh-CN';

  useEffect(() => {
    if (!initialized) void refresh();
  }, [initialized, refresh]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string }>).detail;
      setReason(detail?.reason ?? null);
      setSelfOpen(true);
    };
    window.addEventListener('jiuwen:auth-required', handler);
    return () => window.removeEventListener('jiuwen:auth-required', handler);
  }, []);

  // 登录**刚刚**成功时自动收起——用户不需要再点一次关闭。
  // 只认 false→true 这一次跳变：已登录状态下点账号是来查看信息的，不能一开就关。
  const wasLoggedIn = useRef(islogin);
  useEffect(() => {
    const justLoggedIn = !wasLoggedIn.current && islogin;
    wasLoggedIn.current = islogin;
    if (justLoggedIn && selfOpen) setSelfOpen(false);
  }, [islogin, selfOpen]);

  // 冷却截止时间变了就重新对表；冷却期间每秒刷新一次倒计时
  useEffect(() => {
    setNowTs(Date.now());
  }, [resendCooldownUntil]);
  const cooldownRemaining = Math.max(0, Math.ceil((resendCooldownUntil - nowTs) / 1000));
  const cooling = cooldownRemaining > 0;
  useEffect(() => {
    if (!cooling) return undefined;
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooling]);

  const close = useCallback(() => {
    setSelfOpen(false);
    onClose?.();
  }, [onClose]);

  const handleRefreshAccount = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAccount();
    } finally {
      setRefreshing(false);
    }
  }, [refreshAccount]);

  /** 切换 Tab：清密码与错误，保留用户名。授权流程在 store 里，切走不打断。 */
  const handleSwitchMode = useCallback(
    (mode: 'authorize' | 'password') => {
      if (mode === loginMode) return;
      setLoginMode(mode);
      setPassword('');
      setFormError(null);
    },
    [loginMode, setLoginMode],
  );

  const handlePasswordSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (passwordSubmitting) return;
      const account = username.trim();
      if (!account || !password) {
        setFormError(t('auth.deepscient.passwordEmpty'));
        return;
      }
      setFormError(null);
      try {
        await passwordLogin(account, password);
      } finally {
        // 提交后无论如何都不在本地留着密码
        setPassword('');
      }
    },
    [password, passwordLogin, passwordSubmitting, t, username],
  );

  const handleResend = useCallback(async () => {
    if (resending || cooling) return;
    const target = (errorEmail || username.trim()).trim();
    if (!target) return;
    setResending(true);
    try {
      await resendVerification(target);
    } finally {
      setResending(false);
    }
  }, [cooling, errorEmail, resending, resendVerification, username]);

  if (!enabled) return null;

  const busy = phase !== 'idle';
  const statusText =
    phase === 'starting'
      ? t('auth.deepscient.statusStarting')
      : phase === 'waiting'
        ? t('auth.deepscient.statusWaiting')
        : '';
  const displayName = userName || email || userId || '';
  const balanceText =
    typeof balance === 'number' && Number.isFinite(balance)
      ? balance.toLocaleString(locale, { maximumFractionDigits: 2 })
      : t('auth.deepscient.balanceUnknown');
  const expiresText = formatExpiresAt(expiresAt, locale) || t('auth.deepscient.expiresNever');

  const emailNotVerified = errorCode === 'email_not_verified';
  const resendEmail = errorEmail || (username.includes('@') ? username.trim() : '');
  // 这几类错误用本地文案（后端文案是中文兜底，切到英文界面会串台）
  const errorText =
    formError ||
    (errorCode === 'email_not_verified'
      ? t('auth.deepscient.emailNotVerified')
      : errorCode === 'too_many_requests'
        ? `${t('auth.deepscient.tooManyRequests')}${
            retryAfter ? ` ${t('auth.deepscient.retryAfter', { seconds: retryAfter })}` : ''
          }`
        : errorCode === 'auth-disabled' || errorCode === 'login_disabled'
          ? t('auth.deepscient.authDisabled')
          : error);

  const tabs = islogin ? null : (
    <div className="login-dialog__tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={loginMode === 'authorize'}
        className={`login-dialog__tab${loginMode === 'authorize' ? ' login-dialog__tab--active' : ''}`}
        onClick={() => handleSwitchMode('authorize')}
        data-testid="auth-tab-authorize"
      >
        {t('auth.deepscient.tabAuthorize')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={loginMode === 'password'}
        className={`login-dialog__tab${loginMode === 'password' ? ' login-dialog__tab--active' : ''}`}
        onClick={() => handleSwitchMode('password')}
        data-testid="auth-tab-password"
      >
        {t('auth.deepscient.tabPassword')}
      </button>
    </div>
  );

  const authorizePanel = (
    <div className="flex flex-col" data-testid="auth-login-panel">
      <h3 id={TITLE_ID} className="text-base font-semibold text-text mb-1">
        {t('auth.deepscient.title')}
      </h3>
      <p className="text-sm text-text-muted mb-4">
        {reason === 'session_expired'
          ? t('auth.deepscient.reasonExpired')
          : reason
            ? t('auth.deepscient.reasonModel')
            : t('auth.deepscient.subtitle')}
      </p>

      {statusText && (
        <p className="text-sm text-text-muted mb-3" data-testid="auth-status">
          {statusText}
        </p>
      )}
      {pendingAuthorizeUrl && (
        <div className="rounded-lg bg-secondary p-3 mb-3">
          <p className="text-xs text-text-muted mb-1">{t('auth.deepscient.popupBlocked')}</p>
          <a
            className="text-xs break-all text-primary underline"
            href={pendingAuthorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {pendingAuthorizeUrl}
          </a>
        </div>
      )}
      {errorText && (
        <p
          className="text-sm text-danger mb-3"
          role="alert"
          data-testid="auth-error"
          data-error-code={errorCode ?? (formError ? 'password_empty' : '')}
        >
          {errorText}
        </p>
      )}
      {phase === 'waiting' && claimPendingHint && (
        <p className="text-sm text-warning mb-3" role="status" data-testid="auth-claim-pending">
          {t('auth.deepscient.claimPendingHint')}
        </p>
      )}

      {/* 机制说明降到小字：用户先要知道"登录能得到什么"，
          "会跳浏览器"只是个别让人意外的提醒，不该占主文案。 */}
      {!busy && !errorText && (
        <p className="text-xs text-text-muted mb-4">{t('auth.deepscient.browserHint')}</p>
      )}

      {registerUrl && (
        <p className="text-xs text-text-muted mb-4">
          {t('auth.deepscient.registerHint')}{' '}
          <a
            className="login-dialog__link"
            href={registerUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="auth-register"
          >
            {t('auth.deepscient.register')}
          </a>
        </p>
      )}

      <div className="flex gap-2 justify-end">
        {/* 不可关闭（整页登录门）时没有「关闭」；只有等授权时可以「取消」以中止这次流程 */}
        {(canDismiss || busy) && (
          <button
            type="button"
            className="btn !px-4 !py-2"
            onClick={busy ? cancelLogin : close}
            data-testid="auth-cancel"
          >
            {busy ? t('auth.deepscient.cancel') : t('auth.deepscient.close')}
          </button>
        )}
        {/* 等待授权时主按钮变成「我已完成登录」：落地页通知不到本页、窗口焦点
            也没切换过（比如授权页开在另一块屏幕上）时，用户可以手动触发一次认领。 */}
        {phase === 'waiting' ? (
          <button
            type="button"
            className="btn primary !px-4 !py-2"
            onClick={() => void checkLogin(true)}
            data-testid="auth-check-login"
          >
            {t('auth.deepscient.checkLogin')}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary !px-4 !py-2"
            disabled={busy}
            onClick={() => void startLogin()}
            data-testid="auth-login"
          >
            {busy ? t('auth.deepscient.loggingIn') : t('auth.deepscient.login')}
          </button>
        )}
      </div>
    </div>
  );

  const passwordPanel = (
    <form className="flex flex-col" onSubmit={handlePasswordSubmit} data-testid="auth-password-panel">
      <h3 id={TITLE_ID} className="text-base font-semibold text-text mb-1">
        {t('auth.deepscient.passwordTitle')}
      </h3>
      <p className="text-sm text-text-muted mb-4">{t('auth.deepscient.passwordSubtitle')}</p>

      <label className="login-dialog__field">
        <span className="login-dialog__label">{t('auth.deepscient.usernameOrEmail')}</span>
        <input
          className="login-dialog__input"
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          disabled={passwordSubmitting}
          onChange={(event) => {
            setUsername(event.target.value);
            setFormError(null);
            if (error || errorCode) clearError();
          }}
          data-testid="auth-password-username"
        />
      </label>

      <label className="login-dialog__field">
        <span className="login-dialog__label">{t('auth.deepscient.password')}</span>
        <input
          className="login-dialog__input"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder={t('auth.deepscient.passwordPlaceholder')}
          value={password}
          disabled={passwordSubmitting}
          onChange={(event) => {
            setPassword(event.target.value);
            setFormError(null);
            if (error || errorCode) clearError();
          }}
          data-testid="auth-password-input"
        />
      </label>

      {errorText && (
        <p
          className="text-sm text-danger mb-3"
          role="alert"
          data-testid="auth-error"
          data-error-code={errorCode ?? (formError ? 'password_empty' : '')}
        >
          {errorText}
        </p>
      )}

      {emailNotVerified && (resendEmail || canResend) && (
        <div className="login-dialog__resend" data-testid="auth-resend">
          {resendEmail && (
            <p className="text-xs text-text-muted" data-testid="auth-resend-email">
              {resendEmail}
            </p>
          )}
          {cooling && (
            <p className="text-xs text-text-muted" data-testid="auth-resend-success">
              {t('auth.deepscient.resendSuccess')} ·{' '}
              <span data-testid="auth-resend-cooldown">
                {t('auth.deepscient.resendIn', { seconds: cooldownRemaining })}
              </span>
            </p>
          )}
          <button
            type="button"
            className="login-dialog__link"
            onClick={() => void handleResend()}
            disabled={resending || cooling || !resendEmail}
            data-testid="auth-resend-button"
          >
            {resending ? t('auth.deepscient.statusStarting') : t('auth.deepscient.resendVerification')}
          </button>
        </div>
      )}

      <button
        type="submit"
        className="btn primary !px-4 !py-2 mt-1"
        disabled={passwordSubmitting}
        data-testid="auth-password-submit"
      >
        {passwordSubmitting ? t('auth.deepscient.passwordLoggingIn') : t('auth.deepscient.passwordLogin')}
      </button>

      {registerUrl && (
        <p className="text-xs text-text-muted mt-3">
          {t('auth.deepscient.registerHint')}{' '}
          <a
            className="login-dialog__link"
            href={registerUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="auth-register"
          >
            {t('auth.deepscient.register')}
          </a>
        </p>
      )}
    </form>
  );

  const accountPanel = (
    /* ── 已登录：账号面板。不再显示登录引导文案 ── */
    <div className="flex flex-col" data-testid="auth-account-panel">
      <h3 id={TITLE_ID} className="text-base font-semibold text-text mb-4">
        {t('auth.deepscient.accountTitle')}
      </h3>

      <div className="flex items-center gap-3 mb-4">
        <span className="w-9 h-9 shrink-0 rounded-full bg-accent/15 text-accent flex items-center justify-center">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="8.5" r="3.75" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M4.75 19.25a7.25 7.25 0 0114.5 0"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="text-sm text-text truncate" title={displayName} data-testid="auth-account-name">
            {displayName}
          </div>
        </div>
      </div>

      <dl className="login-dialog__account">
        <div className="login-dialog__row">
          <dt>{t('auth.deepscient.email')}</dt>
          <dd data-testid="auth-account-email">{email || '—'}</dd>
        </div>
        <div className="login-dialog__row">
          <dt>{t('auth.deepscient.role')}</dt>
          <dd data-testid="auth-account-role">{role || '—'}</dd>
        </div>
        <div className="login-dialog__row">
          <dt>{t('auth.deepscient.balance')}</dt>
          <dd data-testid="auth-account-balance">{balanceText}</dd>
        </div>
        <div className="login-dialog__row">
          <dt>{t('auth.deepscient.expiresAt')}</dt>
          <dd data-testid="auth-account-expires">{expiresText}</dd>
        </div>
      </dl>

      <div className="login-dialog__actions login-dialog__actions--split">
        <div className="login-dialog__links">
          {accountCenterUrl && (
            <a
              className="login-dialog__link"
              href={accountCenterUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="auth-manage"
            >
              {t('auth.deepscient.manageBalance')}
            </a>
          )}
          <button
            type="button"
            className="login-dialog__link"
            onClick={() => void handleRefreshAccount()}
            disabled={refreshing}
            data-testid="auth-refresh-balance"
          >
            {t('auth.deepscient.refreshBalance')}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn !px-4 !py-2"
            onClick={() => void logout()}
            data-testid="auth-logout"
          >
            {t('auth.deepscient.logout')}
          </button>
          {!isScreen && (
            <button
              type="button"
              className="btn primary !px-4 !py-2"
              onClick={close}
              data-testid="auth-done"
            >
              {t('auth.deepscient.done')}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const body = islogin ? (
    accountPanel
  ) : (
    <>
      {tabs}
      {loginMode === 'authorize' ? authorizePanel : passwordPanel}
    </>
  );

  if (isScreen) {
    return (
      <div className="login-dialog__screen" data-testid="auth-login-screen" aria-labelledby={TITLE_ID}>
        {body}
      </div>
    );
  }

  return (
    <Dialog
      open={isOpen}
      titleId={TITLE_ID}
      className="login-dialog"
      closeDisabled={busy || passwordSubmitting || !canDismiss}
      onCancel={close}
      onBackdropClick={canDismiss ? close : undefined}
    >
      {isOpen && (
        <div className="login-dialog__body" data-testid="auth-dialog">
          {body}
        </div>
      )}
    </Dialog>
  );
}

export default LoginDialog;
