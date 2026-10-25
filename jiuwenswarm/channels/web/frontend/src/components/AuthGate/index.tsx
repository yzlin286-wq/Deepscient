/**
 * 登录门：登录功能开启且未登录时，整页挡在主界面之前。
 *
 * 三种状态：
 * - `initialized === false`：还没查到登录状态 → 加载页（不渲染 children，避免未登录时
 *   先把主界面挂起来、替没有权限的会话发一堆请求）；
 * - `enabled && !islogin`：整页登录（`LoginDialog variant="screen"`），不渲染 children；
 * - `enabled === false || islogin`：直接渲染 children。
 *
 * 会话过期（`refreshAccount` 401）由 authStore 清掉登录态，这里会**自动**切回登录页；
 * 登录成功后 store 更新 `islogin`，同样立即切进主界面，不需要刷新页面。
 */

import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../stores/authStore';
import { LoginDialog } from '../LoginDialog';
import './AuthGate.css';

/** 品牌标记：内联 SVG，不依赖任何图片资源。 */
function BrandMark() {
  return (
    <svg className="auth-gate__mark" viewBox="0 0 48 48" fill="none" aria-hidden>
      <path
        d="M24 3.5 41.7 13.75v20.5L24 44.5 6.3 34.25v-20.5L24 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="24" r="6.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M24 17.8V9.4M24 30.2v8.4M18.6 20.9 11.3 16.7M29.4 27.1l7.3 4.2M18.6 27.1l-7.3 4.2M29.4 20.9l7.3-4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const initialized = useAuthStore((state) => state.initialized);
  const enabled = useAuthStore((state) => state.enabled);
  const islogin = useAuthStore((state) => state.islogin);
  const refresh = useAuthStore((state) => state.refresh);

  useEffect(() => {
    if (!initialized) void refresh();
  }, [initialized, refresh]);

  if (!initialized) {
    return (
      <div className="auth-gate auth-gate--loading" data-testid="auth-gate-loading">
        <div className="auth-gate__backdrop" aria-hidden />
        <div className="auth-gate__loading-card">
          <span className="auth-gate__mark-wrap">
            <BrandMark />
          </span>
          <span className="auth-gate__spinner" aria-hidden />
          <p className="auth-gate__loading-text" role="status">
            {t('auth.deepscient.gateLoading')}
          </p>
        </div>
      </div>
    );
  }

  if (enabled && !islogin) {
    return (
      <div className="auth-gate" data-testid="auth-gate-screen">
        <div className="auth-gate__backdrop" aria-hidden />
        <div className="auth-gate__content">
          <header className="auth-gate__brand">
            <span className="auth-gate__mark-wrap">
              <BrandMark />
            </span>
            <h1 className="auth-gate__title">
              DeepScient
              <span className="auth-gate__edition">{t('auth.deepscient.brandEdition')}</span>
            </h1>
            <p className="auth-gate__lead" data-testid="auth-gate-title">
              {t('auth.deepscient.loginRequiredTitle')}
            </p>
            <p className="auth-gate__description">{t('auth.deepscient.loginRequiredDescription')}</p>
          </header>
          <LoginDialog variant="screen" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default AuthGate;
