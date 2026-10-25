/**
 * 设置页「计费 → 中转站」：配置状态、绑定信息、在售套餐、额度入口与最近订单。
 *
 * 三条约定：
 * 1. 未配置 secret 时只说明「未配置」与需要的环境变量名，不摆出错误样式；
 * 2. `buy-url` / `account-url` 是一次性链接，拿到就立刻 `window.open`，绝不入 state；
 * 3. 失败只用语义色提示（`--color-feedback-danger*` / `--color-feedback-warning*`），
 *    不把上游原文当样式开关。
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Select, Tag } from '../../../../components/ui';
import {
  backfillModel,
  createPartnerAccountUrl,
  createPartnerBuyUrl,
  fetchPartnerOrder,
  fetchPartnerStatus,
  listModels,
  pingPartner,
  syncPartner,
  type PartnerBinding,
  type PartnerModelBackfill,
  type PartnerOrder,
  type PartnerStatus,
} from '../../../../services/partnerClient';
import { useAuthStore } from '../../../../stores/authStore';
import { SettingRow, SettingsSection } from '../../components';
import {
  backfillHintKey,
  backfillStatusKey,
  buildPlanRows,
  classifyPartnerError,
  formatOrderAmount,
  formatPartnerTime,
  orderStatusLabelKey,
  partnerErrorKey,
} from './presentation';
import './PartnerSettings.css';

interface OrderDetail {
  tradeNo: string;
  statusKey: string;
  amount: string;
  time: string;
}

export function PartnerSettings() {
  const { t, i18n } = useTranslation();
  const userName = useAuthStore((state) => state.userName);

  const [status, setStatus] = useState<PartnerStatus | null>(null);
  const [binding, setBinding] = useState<PartnerBinding | null>(null);
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [errorKey, setErrorKey] = useState('');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [backfill, setBackfill] = useState<PartnerModelBackfill | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');

  const locale = i18n.language || 'zh-CN';

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPartnerStatus();
      setStatus(data);
      setBinding(data.binding ?? null);
      setBackfill(data.binding?.modelBackfill ?? null);
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setErrorKey('');
    } catch (error) {
      setErrorKey(partnerErrorKey(classifyPartnerError(error)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const reportError = (error: unknown) => {
    setErrorKey(partnerErrorKey(classifyPartnerError(error)));
  };

  const handlePing = async () => {
    setBusy('ping');
    setErrorKey('');
    setLatencyMs(null);
    try {
      const result = await pingPartner();
      setLatencyMs(typeof result.latencyMs === 'number' ? result.latencyMs : 0);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy('');
    }
  };

  const handleSync = async () => {
    setBusy('sync');
    setErrorKey('');
    try {
      const next = await syncPartner(userName || undefined);
      setBinding(next);
      // 同步成功会顺手回填模型；冲突也在这里如实展示。
      setBackfill(next?.modelBackfill ?? null);
      const data = await fetchPartnerStatus();
      setStatus(data);
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy('');
    }
  };

  /** 回填：冲突提示出现后再点一次即覆盖（force）。 */
  const handleBackfill = async () => {
    setBusy('backfill');
    setErrorKey('');
    try {
      const result = await backfillModel({
        modelName: selectedModel || undefined,
        force: backfill?.reason === 'conflict',
      });
      setBackfill(result);
      if (result.binding) setBinding(result.binding);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy('');
    }
  };

  const handleFetchModels = async () => {
    setBusy('models');
    setErrorKey('');
    try {
      const result = await listModels();
      setModels(result.models);
      setModelsFetched(true);
      setSelectedModel((current) =>
        current && result.models.includes(current) ? current : result.models[0] ?? '',
      );
    } catch (error) {
      reportError(error);
    } finally {
      setBusy('');
    }
  };

  /** 一次性链接：拿到即打开，失败只提示，不缓存 URL。 */
  const openOnce = async (kind: 'buy' | 'account', planId?: number) => {
    const tag = kind === 'buy' ? `buy:${planId ?? ''}` : 'account';
    setBusy(tag);
    setErrorKey('');
    try {
      const result = kind === 'buy' ? await createPartnerBuyUrl(planId) : await createPartnerAccountUrl();
      const url = typeof result?.url === 'string' ? result.url.trim() : '';
      if (!url) {
        setErrorKey('settingsPanel.billing.errors.linkFailed');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      reportError(error);
    } finally {
      setBusy('');
    }
  };

  const handleQueryOrder = async (tradeNo: string) => {
    setBusy(`order:${tradeNo}`);
    setErrorKey('');
    try {
      const result = await fetchPartnerOrder(tradeNo);
      const order = result.order || ({} as PartnerOrder);
      setOrderDetail({
        tradeNo: order.tradeNo || tradeNo,
        statusKey: orderStatusLabelKey(order.status),
        amount: formatOrderAmount(order.amount, order.currency),
        time: formatPartnerTime(order.startTime || order.receivedAt, locale),
      });
    } catch (error) {
      reportError(error);
    } finally {
      setBusy('');
    }
  };

  if (!status) {
    return (
      <SettingsSection title={t('settingsPanel.billing.title')}>
        <div className="settings-page__item">
          <SettingRow
            title={loading ? t('settingsPanel.billing.loading') : t('settingsPanel.billing.title')}
            description={
              loading ? undefined : (
                <span className="partner-settings__error" data-testid="partner-error">
                  {t(errorKey || 'settingsPanel.billing.errors.unknown')}
                </span>
              )
            }
            meta={
              loading ? undefined : (
                <Button
                  size="sm"
                  onClick={() => void loadStatus()}
                  data-testid="partner-retry"
                >
                  {t('settingsPanel.feedback.retry')}
                </Button>
              )
            }
          />
        </div>
      </SettingsSection>
    );
  }

  if (!status.configured) {
    return (
      <SettingsSection
        title={t('settingsPanel.billing.title')}
        description={t('settingsPanel.billing.subtitle')}
      >
        <div className="settings-page__item">
          <SettingRow
            title={t('settingsPanel.billing.notConfigured')}
            description={
              <span data-testid="partner-not-configured">
                {t('settingsPanel.billing.secretEnv')}: <code>CCAGENT_PARTNER_APP_SECRET</code>
              </span>
            }
          />
        </div>
      </SettingsSection>
    );
  }

  const planRows = buildPlanRows(status.plans, {
    empty: t('settingsPanel.billing.empty'),
    dayUnit: t('settingsPanel.billing.dayUnit'),
  });
  const secretSource =
    status.secretSource === 'env'
      ? t('settingsPanel.billing.secretSourceEnv')
      : status.secretSource === 'file'
        ? t('settingsPanel.billing.secretSourceFile')
        : status.secretSource === 'bundled'
          ? t('settingsPanel.billing.secretSourceBundled')
          : '';

  return (
    <>
      <SettingsSection
        title={t('settingsPanel.billing.title')}
        description={t('settingsPanel.billing.subtitle')}
      >
        <div className="settings-page__item">
          <SettingRow
            title={status.appId}
            meta={
              <Tag variant="success" data-testid="partner-configured">
                {secretSource
                  ? `${t('settingsPanel.billing.secretSource')}: ${secretSource}`
                  : t('settingsPanel.billing.testConnection')}
              </Tag>
            }
            description={
              <span className="partner-settings__meta" data-testid="partner-status">
                {status.base}
                {status.webhookUrl
                  ? ` · ${t('settingsPanel.billing.webhook')}: ${status.webhookUrl}`
                  : ''}
              </span>
            }
            controlPlacement="top"
            subSettings={
              <div className="partner-settings__actions">
                <Button
                  size="sm"
                  onClick={() => void handlePing()}
                  loading={busy === 'ping'}
                  data-testid="partner-test-connection"
                >
                  {t(
                    busy === 'ping'
                      ? 'settingsPanel.billing.testing'
                      : 'settingsPanel.billing.testConnection',
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => void handleSync()}
                  loading={busy === 'sync'}
                  data-testid="partner-sync-account"
                >
                  {t(
                    busy === 'sync'
                      ? 'settingsPanel.billing.syncing'
                      : 'settingsPanel.billing.syncAccount',
                  )}
                </Button>
                {latencyMs !== null && (
                  <span className="partner-settings__ok" data-testid="partner-latency">
                    {t('settingsPanel.billing.latency', { ms: latencyMs })}
                  </span>
                )}
                {errorKey && (
                  <span className="partner-settings__error" data-testid="partner-error">
                    {t(errorKey)}
                  </span>
                )}
              </div>
            }
          />
        </div>
      </SettingsSection>

      <SettingsSection title={t('settingsPanel.billing.binding')}>
        <div className="settings-page__item">
          {binding ? (
            <dl className="partner-settings__kv" data-testid="partner-binding">
              <div>
                <dt>{t('settingsPanel.billing.userId')}</dt>
                <dd data-testid="partner-binding-user-id">{binding.userId ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('settingsPanel.billing.username')}</dt>
                <dd data-testid="partner-binding-username">{binding.username || '—'}</dd>
              </div>
              <div>
                <dt>{t('settingsPanel.billing.apiBaseUrl')}</dt>
                <dd data-testid="partner-binding-api-base">{binding.apiBaseUrl || '—'}</dd>
              </div>
              <div>
                <dt>{t('settingsPanel.billing.apiKey')}</dt>
                <dd data-testid="partner-binding-api-key">{binding.apiKeyMasked || '—'}</dd>
              </div>
              <div>
                <dt>{t('settingsPanel.billing.syncedAt')}</dt>
                <dd data-testid="partner-binding-synced-at">
                  {formatPartnerTime(binding.syncedAt, locale)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="partner-settings__hint" data-testid="partner-binding-empty">
              {t('settingsPanel.billing.noBinding')}
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('partner.modelBackfillTitle')}
        description={t('partner.modelBackfillHint')}
      >
        <div className="settings-page__item">
          <dl className="partner-settings__kv" data-testid="partner-backfill-state">
            <div>
              <dt>{t('partner.modelBackfillTitle')}</dt>
              <dd>
                <Tag
                  variant={
                    backfill?.reason === 'conflict'
                      ? 'warning'
                      : backfill?.applied
                        ? 'success'
                        : 'neutral'
                  }
                  data-testid="partner-backfill-status"
                >
                  {t(backfillStatusKey(backfill))}
                </Tag>
              </dd>
            </div>
            <div>
              <dt>{t('partner.modelName')}</dt>
              <dd data-testid="partner-backfill-model">{backfill?.modelName || '—'}</dd>
            </div>
            <div>
              <dt>{t('partner.maskedKey')}</dt>
              <dd data-testid="partner-backfill-masked">
                {backfill?.masked || binding?.apiKeyMasked || '—'}
              </dd>
            </div>
          </dl>
          <div className="partner-settings__actions partner-settings__actions--start">
            <Button
              size="sm"
              onClick={() => void handleBackfill()}
              loading={busy === 'backfill'}
              data-testid="partner-backfill"
            >
              {t('partner.backfill')}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => void handleFetchModels()}
              loading={busy === 'models'}
              data-testid="partner-refetch-models"
            >
              {t('partner.refetchModels')}
            </Button>
            {models.length > 0 ? (
              <Select
                options={models.map((name) => ({ value: name, label: name }))}
                value={selectedModel}
                onChange={setSelectedModel}
                aria-label={t('partner.modelName')}
                data-testid="partner-model-select"
              />
            ) : (
              modelsFetched && (
                <span className="partner-settings__hint" data-testid="partner-models-empty">
                  {t('partner.modelsEmpty')}
                </span>
              )
            )}
          </div>
          {backfillHintKey(backfill) && (
            <p className="partner-settings__warning" data-testid="partner-backfill-hint">
              {t(backfillHintKey(backfill))}
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settingsPanel.billing.plans')}>
        <div className="settings-page__item">
          <div className="partner-settings__actions partner-settings__actions--start">
            <Button
              size="sm"
              variant="quiet"
              onClick={() => void openOnce('account')}
              loading={busy === 'account'}
              data-testid="partner-account-page"
            >
              {t('settingsPanel.billing.accountPage')}
            </Button>
          </div>
          {planRows.length === 0 ? (
            <p className="partner-settings__hint" data-testid="partner-plans-empty">
              {t('settingsPanel.billing.plansEmpty')}
            </p>
          ) : (
            <table className="partner-settings__table" data-testid="partner-plans">
              <thead>
                <tr>
                  <th>{t('settingsPanel.billing.planTitle')}</th>
                  <th>{t('settingsPanel.billing.planPrice')}</th>
                  <th>{t('settingsPanel.billing.planDuration')}</th>
                  <th>{t('settingsPanel.billing.planQuota')}</th>
                  <th aria-label={t('settingsPanel.billing.buy')} />
                </tr>
              </thead>
              <tbody>
                {planRows.map((row, index) => {
                  const tag = `buy:${row.planId ?? ''}`;
                  return (
                    <tr key={row.planId ?? index} data-testid="partner-plan-row">
                      <td>{row.title}</td>
                      <td>{row.price}</td>
                      <td>{row.duration}</td>
                      <td>{row.quota}</td>
                      <td className="partner-settings__cell--action">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={row.planId === null}
                          loading={busy === tag}
                          onClick={() => void openOnce('buy', row.planId ?? undefined)}
                          data-testid={`partner-plan-buy-${row.planId ?? 'none'}`}
                        >
                          {t('settingsPanel.billing.buy')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {status.plansError && (
            <span className="partner-settings__warning" data-testid="partner-plans-error">
              {status.plansError}
            </span>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settingsPanel.billing.orders')}>
        <div className="settings-page__item">
          {orders.length === 0 ? (
            <p className="partner-settings__hint" data-testid="partner-orders-empty">
              {t('settingsPanel.billing.empty')}
            </p>
          ) : (
            <table className="partner-settings__table" data-testid="partner-orders">
              <thead>
                <tr>
                  <th>{t('settingsPanel.billing.tradeNo')}</th>
                  <th>{t('settingsPanel.billing.status')}</th>
                  <th>{t('settingsPanel.billing.amount')}</th>
                  <th>{t('settingsPanel.billing.time')}</th>
                  <th aria-label={t('settingsPanel.billing.query')} />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.tradeNo} data-testid="partner-order-row">
                    <td className="partner-settings__mono">{order.tradeNo}</td>
                    <td>{t(orderStatusLabelKey(order.status))}</td>
                    <td>{formatOrderAmount(order.amount, order.currency)}</td>
                    <td>{formatPartnerTime(order.receivedAt || order.startTime, locale)}</td>
                    <td className="partner-settings__cell--action">
                      <Button
                        size="sm"
                        variant="quiet"
                        loading={busy === `order:${order.tradeNo}`}
                        onClick={() => void handleQueryOrder(order.tradeNo)}
                        data-testid={`partner-order-query-${order.tradeNo}`}
                      >
                        {t('settingsPanel.billing.query')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {orderDetail && (
            <span className="partner-settings__ok" data-testid="partner-order-detail">
              {orderDetail.tradeNo} · {t(orderDetail.statusKey)} · {orderDetail.amount} ·{' '}
              {orderDetail.time}
            </span>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
