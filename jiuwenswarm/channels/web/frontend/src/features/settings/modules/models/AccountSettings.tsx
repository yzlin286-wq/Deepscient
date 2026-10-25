/**
 * 设置页「账号」：DeepScient 官网账号的登录入口、账号信息与余额。
 *
 * 未登录只有一行登录引导；已登录展示账号名 / 邮箱 / 角色 / 余额 / 有效期，
 * 并提供刷新余额与去官网管理额度的入口。打开时若已登录会自动向官网刷新一次。
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Tag } from '../../../../components/ui';
import { useAuthStore } from '../../../../stores/authStore';
import { SettingRow, SettingsSection } from '../../components';
import './AccountSettings.css';

/** 有效期可能是 ISO 字符串，也可能是后端直接给的 unix 秒；认不出来就说明未知。 */
function formatExpiresAt(value: string | null, locale: string): string {
  if (!value) return '';
  const raw = String(value);
  const parsed = new Date(/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function AccountSettings() {
  const { t, i18n } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const requestedAutoRefresh = useRef(false);

  const enabled = useAuthStore((state) => state.enabled);
  const initialized = useAuthStore((state) => state.initialized);
  const islogin = useAuthStore((state) => state.islogin);
  const userName = useAuthStore((state) => state.userName);
  const userId = useAuthStore((state) => state.userId);
  const email = useAuthStore((state) => state.email);
  const role = useAuthStore((state) => state.role);
  const balance = useAuthStore((state) => state.balance);
  const expiresAt = useAuthStore((state) => state.expiresAt);
  const emailVerified = useAuthStore((state) => state.emailVerified);
  const loginMethod = useAuthStore((state) => state.loginMethod);
  const accountCenterUrl = useAuthStore((state) => state.accountCenterUrl);
  const registerUrl = useAuthStore((state) => state.registerUrl);
  const refresh = useAuthStore((state) => state.refresh);
  const refreshAccount = useAuthStore((state) => state.refreshAccount);
  const startLogin = useAuthStore((state) => state.startLogin);
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    if (!initialized) void refresh();
  }, [initialized, refresh]);

  // 打开设置页时刷新一次余额；登录态晚到（状态还在查）时补一次
  useEffect(() => {
    if (requestedAutoRefresh.current || !islogin) return;
    requestedAutoRefresh.current = true;
    void refreshAccount();
  }, [islogin, refreshAccount]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAccount();
    } finally {
      setRefreshing(false);
    }
  };

  if (!enabled) return null;

  const locale = i18n.language || 'zh-CN';
  const displayName = userName || email || userId || '';
  const balanceText =
    typeof balance === 'number' && Number.isFinite(balance)
      ? balance.toLocaleString(locale, { maximumFractionDigits: 2 })
      : t('settingsPanel.account.balanceUnknown');
  const expiresText = formatExpiresAt(expiresAt, locale) || t('auth.deepscient.expiresNever');
  const loginMethodText =
    loginMethod === 'authorize'
      ? t('settingsPanel.account.loginMethodAuthorize')
      : loginMethod === 'password'
        ? t('settingsPanel.account.loginMethodPassword')
        : t('settingsPanel.account.loginMethodUnknown');
  const emailVerifiedText =
    emailVerified === true
      ? t('settingsPanel.account.emailVerifiedYes')
      : emailVerified === false
        ? t('settingsPanel.account.emailVerifiedNo')
        : t('settingsPanel.account.emailVerifiedUnknown');
  const accountMeta = [
    `${t('settingsPanel.account.email')}: ${email || '—'}`,
    `${t('settingsPanel.account.role')}: ${role || '—'}`,
  ].join(' · ');

  return (
    <SettingsSection title={t('settingsPanel.account.title')}>
      <div className="settings-page__item">
        {islogin ? (
          <>
            <SettingRow
              title={displayName}
              meta={
                <Tag variant="success" data-testid="settings-account-signed-in">
                  {t('settingsPanel.account.signedIn')}
                </Tag>
              }
              description={<span data-testid="settings-account-meta">{accountMeta}</span>}
            />
            <SettingRow
              title={t('settingsPanel.account.loginMethod')}
              description={
                <span data-testid="settings-account-login-method">{loginMethodText}</span>
              }
            />
            {/* 官网没下发 emailVerified 时整行不出现，避免显示一个没意义的「未知」 */}
            {emailVerified !== null && (
              <SettingRow
                title={t('settingsPanel.account.emailVerified')}
                meta={
                  <Tag
                    variant={emailVerified ? 'success' : 'warning'}
                    data-testid="settings-account-email-verified"
                  >
                    {emailVerifiedText}
                  </Tag>
                }
              />
            )}
            <SettingRow
              title={t('settingsPanel.account.balance')}
              description={`${t('settingsPanel.account.expiresAt')}: ${expiresText}`}
              controlPlacement="top"
              subSettings={
                <div className="account-settings__actions">
                  <span className="account-settings__balance" data-testid="settings-account-balance">
                    {balanceText}
                  </span>
                  <div className="account-settings__buttons">
                    <Button
                      size="sm"
                      onClick={() => void handleRefresh()}
                      loading={refreshing}
                      data-testid="settings-account-refresh"
                    >
                      {t('settingsPanel.account.refresh')}
                    </Button>
                    {accountCenterUrl && (
                      <a
                        className="account-settings__link"
                        href={accountCenterUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="settings-account-manage"
                      >
                        {t('settingsPanel.account.manage')}
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => void logout()}
                      data-testid="settings-account-logout"
                    >
                      {t('settingsPanel.account.logout')}
                    </Button>
                  </div>
                </div>
              }
            />
          </>
        ) : (
          <SettingRow
            title={t('settingsPanel.account.loginTitle')}
            description={
              <>
                {t('settingsPanel.account.loginDescription')}
                {registerUrl && (
                  <>
                    {' '}
                    <a
                      className="account-settings__link"
                      href={registerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="settings-account-register"
                    >
                      {t('settingsPanel.account.register')}
                    </a>
                  </>
                )}
              </>
            }
          >
            <Button
              size="sm"
              variant="primary"
              onClick={() => void startLogin()}
              data-testid="settings-account-login"
            >
              {t('settingsPanel.account.loginTitle')}
            </Button>
          </SettingRow>
        )}
      </div>
    </SettingsSection>
  );
}
