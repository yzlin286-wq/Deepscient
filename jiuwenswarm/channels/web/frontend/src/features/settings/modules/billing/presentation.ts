/**
 * 计费面板的纯展示逻辑：套餐表归一化、订单状态、错误分类。
 *
 * 刻意不引 React / i18n：文案与单位由调用方传入，测试可以直接跑这些函数。
 */

export type PartnerErrorKind =
  | 'not-configured'
  | 'rate-limited'
  | 'not-found'
  | 'relay'
  | 'network'
  | 'unknown';

export type PartnerOrderStatusKind = 'paid' | 'pending' | 'failed' | 'unknown';

export interface PartnerPlanRow {
  planId: number | null;
  title: string;
  price: string;
  duration: string;
  quota: string;
}

export interface PlanRowOptions {
  /** 字段缺失时的占位（默认 `—`）。 */
  empty?: string;
  /** 套餐没写币种时的兜底（默认 `CNY`）。 */
  currencyFallback?: string;
  /** 时长的单位词（如「天」/「days」）；空串则只显示数字。 */
  dayUnit?: string;
}

const PLAN_ID_KEYS = ['plan_id', 'planId', 'id'] as const;
const TITLE_KEYS = ['title', 'name', 'plan_title'] as const;
const PRICE_KEYS = ['amount', 'price', 'sale_price'] as const;
const DAYS_KEYS = ['duration_days', 'durationDays'] as const;
const DURATION_KEYS = ['duration', 'period_days', 'period'] as const;
const QUOTA_KEYS = ['quota', 'tokens', 'credits', 'quota_text'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/** 统一成展示文本：数字保留原值（不本地化），字符串去空白。 */
export function toDisplayText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

function toPlanId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** 上游套餐 → 表格行。价格/时长/额度都取自上游，前端不硬编码。 */
export function buildPlanRows(plans: unknown, options: PlanRowOptions = {}): PartnerPlanRow[] {
  if (!Array.isArray(plans)) return [];
  const empty = options.empty ?? '—';
  const currencyFallback = options.currencyFallback ?? 'CNY';
  const dayUnit = options.dayUnit ?? '';

  return plans.filter(isRecord).map((plan) => {
    const planId = toPlanId(pick(plan, PLAN_ID_KEYS));
    const title = toDisplayText(pick(plan, TITLE_KEYS)) || (planId ? `#${planId}` : empty);

    const amount = toDisplayText(pick(plan, PRICE_KEYS));
    const currency = toDisplayText(pick(plan, ['currency'])) || currencyFallback;
    const price = amount ? `${amount} ${currency}`.trim() : empty;

    const days = toDisplayText(pick(plan, DAYS_KEYS));
    const duration = days
      ? `${days}${dayUnit ? ` ${dayUnit}` : ''}`
      : toDisplayText(pick(plan, DURATION_KEYS)) || empty;

    return {
      planId,
      title,
      price,
      duration,
      quota: toDisplayText(pick(plan, QUOTA_KEYS)) || empty,
    };
  });
}

/** 订单状态归一化；认不出的状态按 unknown 展示，不猜「已支付」。 */
export function orderStatusKey(status: unknown): PartnerOrderStatusKind {
  const text = toDisplayText(status).toLowerCase();
  if (['success', 'paid', 'completed', 'paid_success'].includes(text)) return 'paid';
  if (['pending', 'created', 'waiting', 'unpaid', 'processing'].includes(text)) return 'pending';
  if (['failed', 'closed', 'canceled', 'cancelled', 'refunded', 'expired'].includes(text)) {
    return 'failed';
  }
  return 'unknown';
}

/** 订单状态对应的 i18n key。 */
export function orderStatusLabelKey(status: unknown): string {
  return `settingsPanel.billing.orderStatus.${orderStatusKey(status)}`;
}

/** 金额 + 币种（币种缺省 CNY）。 */
export function formatOrderAmount(amount: unknown, currency: unknown, empty = '—'): string {
  const text = toDisplayText(amount);
  if (!text) return empty;
  const unit = toDisplayText(currency) || 'CNY';
  return `${text} ${unit}`;
}

/** 时间：ISO / unix 秒都能认，认不出就显示占位。 */
export function formatPartnerTime(value: unknown, locale = 'zh-CN', empty = '—'): string {
  if (value === undefined || value === null || value === '') return empty;
  const raw = typeof value === 'number' ? value : String(value).trim();
  const parsed = new Date(
    typeof raw === 'number' || /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : raw,
  );
  if (Number.isNaN(parsed.getTime())) return empty;
  return parsed.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** 把后端错误映射成面板上的语义类别。 */
export function classifyPartnerError(error: unknown): PartnerErrorKind {
  const source =
    typeof error === 'object' && error !== null
      ? (error as { status?: unknown; code?: unknown })
      : {};
  const status = Number(source.status) || 0;
  const code = typeof source.code === 'string' ? source.code : '';

  if (status === 409 || code === 'partner-not-configured' || code === 'not_configured') {
    return 'not-configured';
  }
  if (status === 429 || code === 'relay-rate-limited' || code === 'rate_limited') {
    return 'rate-limited';
  }
  if (status === 404 || code === 'not-found' || code === '40401' || code === '40403') {
    return 'not-found';
  }
  if (code === 'network_error' || code === 'network') return 'network';
  if (status >= 500 || code === 'relay-error') return 'relay';
  if (!status && !code && error instanceof Error) return 'network';
  return 'unknown';
}

/** 语义类别 → i18n key。 */
export function partnerErrorKey(kind: PartnerErrorKind): string {
  const suffix: Record<PartnerErrorKind, string> = {
    'not-configured': 'notConfigured',
    'rate-limited': 'rateLimited',
    'not-found': 'notFound',
    relay: 'relay',
    network: 'network',
    unknown: 'unknown',
  };
  return `settingsPanel.billing.errors.${suffix[kind]}`;
}

/** 与 `partnerClient.PartnerModelBackfill` 同形（这里不引服务层，保持可独立测试）。 */
export interface PartnerModelBackfillState {
  applied: boolean;
  reason: string;
  modelName: string;
  masked: string;
}

/** 回填状态文案 key：未回填 / 已回填 / 冲突。 */
export function backfillStatusKey(result?: PartnerModelBackfillState | null): string {
  if (!result) return 'partner.notBackfilled';
  if (result.reason === 'conflict') return 'partner.conflict';
  return result.applied ? 'partner.backfilled' : 'partner.notBackfilled';
}

/** 回填提示文案 key：冲突给覆盖警告、失败给失败说明；正常状态无需提示。 */
export function backfillHintKey(result?: PartnerModelBackfillState | null): string {
  if (result?.reason === 'conflict') return 'partner.conflictHint';
  if (result?.reason === 'error') return 'partner.backfillFailed';
  return '';
}
