/**
 * ccagent 中转站本机客户端：只做 HTTP 调用，状态在设置页面板里。
 *
 * 后端接口见 `gateway/channel_manager/web/web_http_partner.py`。会话用 cookie 或
 * `X-Auth-Session` 头带（复用 `authClient` 的存储逻辑）；`X-Jiuwen-Auth: 1`
 * 与登录路由一致，让跨站请求必须先过 CORS 预检。
 *
 * 一次性链接（buy-url / account-url）只在调用方拿到的这一刻打开，不入任何状态。
 */

import { getApiBase } from '../utils/env';
import { authSessionHeaders } from './authClient';

/** 与 web_http_auth.AUTH_REQUEST_HEADER 一致。 */
const AUTH_REQUEST_HEADER = 'X-Jiuwen-Auth';

/** 模型回填结果：`reason` 为 `created/updated/overridden/conflict/no-key/error`。 */
export interface PartnerModelBackfill {
  applied: boolean;
  reason: string;
  modelName: string;
  masked: string;
}

/** 批量下发结果：登录/刷新后由后端写入 `models.defaults`。 */
export interface PartnerModelProvision {
  applied: boolean;
  modelCount?: number;
  modelNames?: string[];
  defaultModel?: string;
  apiBaseUrl?: string;
  maskedKey?: string;
  syncedAt?: string;
  /** 下发失败时的可读原因（不含 Key）。 */
  error?: string;
}

export interface PartnerBinding {
  externalUid: string;
  userId: number | string | null;
  username: string;
  apiBaseUrl: string;
  apiKeyMasked: string;
  hasKey: boolean;
  syncedAt: string | null;
  /** 已落盘的模型下发状态（读 config，不含凭据）。 */
  modelProvision?: PartnerModelProvision;
  /** 旧面板使用的单条目回填状态（兼容保留）。 */
  modelBackfill?: PartnerModelBackfill;
}

/** 上游套餐字段随中转站版本变化，这里保留原样，由展示层归一化。 */
export type PartnerPlan = Record<string, unknown>;

export interface PartnerOrder {
  tradeNo: string;
  externalUid: string;
  userId?: number | string | null;
  planId?: number | null;
  planTitle?: string;
  amount?: string | number;
  currency?: string;
  status?: string;
  startTime?: number;
  endTime?: number;
  eventId?: string | null;
  receivedAt?: string | null;
  source?: string;
}

export interface PartnerStatus {
  configured: boolean;
  appId: string;
  base: string;
  secretPresent: boolean;
  secretSource: 'env' | 'file' | 'bundled' | '';
  webhookUrl: string;
  publicBase: string;
  binding: PartnerBinding | null;
  plans: PartnerPlan[];
  plansError: string;
  orders: PartnerOrder[];
}

export interface PartnerPingResult {
  appId: string;
  ts?: number | string;
  latencyMs: number;
}

export interface PartnerUrlResult {
  url?: string;
  ticket?: string;
  expires_in?: number;
  expiresIn?: number;
  [key: string]: unknown;
}

export interface PartnerOrderResult {
  order: PartnerOrder;
  webhook?: { eventId?: string; status?: string };
}

export class PartnerApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'PartnerApiError';
    this.code = code;
    this.status = status;
  }
}

function partnerUrl(path: string): string {
  return `${getApiBase()}/api/v1/partner${path}`;
}

async function readError(response: Response, fallback: string): Promise<PartnerApiError> {
  let code = `http_${response.status}`;
  let message = fallback;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
      message?: string;
    };
    if (body?.error?.message) {
      message = body.error.message;
      code = body.error.code || code;
    } else if (body?.message) {
      message = body.message;
    }
  } catch {
    /* 非 JSON 响应，用兜底文案 */
  }
  return new PartnerApiError(message, code, response.status);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(partnerUrl(path), {
    credentials: 'include',
    ...init,
    headers: authSessionHeaders({
      Accept: 'application/json',
      [AUTH_REQUEST_HEADER]: '1',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...((init?.headers as Record<string, string>) || {}),
    }),
  });
  if (!response.ok) throw await readError(response, `中转站请求失败（HTTP ${response.status}）`);
  return (await response.json()) as T;
}

function postBody(value?: unknown): RequestInit {
  return value === undefined
    ? { method: 'POST' }
    : { method: 'POST', body: JSON.stringify(value) };
}

/** 配置 + 绑定 + 在售套餐 + 最近订单。 */
export async function fetchPartnerStatus(): Promise<PartnerStatus> {
  const data = await request<{ ok: boolean } & PartnerStatus>('/status', {
    method: 'GET',
  });
  return data;
}

/** 连通自检（耗时由服务端量）。 */
export async function pingPartner(): Promise<PartnerPingResult> {
  return request<PartnerPingResult>('/ping', postBody());
}

/** 同步账号，返回绑定投影（只含 Key 掩码）。 */
export async function syncPartner(displayName?: string): Promise<PartnerBinding | null> {
  const body = displayName ? { displayName } : {};
  const data = await request<{ binding: PartnerBinding | null }>('/sync', postBody(body));
  return data.binding;
}

/** 换一次性购买页地址。 */
export async function createPartnerBuyUrl(planId?: number): Promise<PartnerUrlResult> {
  return request<PartnerUrlResult>(
    '/buy-url',
    postBody(typeof planId === 'number' && Number.isInteger(planId) && planId > 0 ? { planId } : {}),
  );
}

/** 换一次性「我的额度」页地址。 */
export async function createPartnerAccountUrl(): Promise<PartnerUrlResult> {
  return request<PartnerUrlResult>('/account-url', postBody());
}

/** 本地绑定 + 上游是否存在。 */
export async function fetchPartnerBinding(): Promise<{
  binding: PartnerBinding | null;
  remote: Record<string, unknown>;
}> {
  return request<{ binding: PartnerBinding | null; remote: Record<string, unknown> }>(
    '/binding',
    { method: 'GET' },
  );
}

/** 订单查询（本地库合并上游结果）。 */
export async function fetchPartnerOrder(tradeNo: string): Promise<PartnerOrderResult> {
  return request(`/orders/${encodeURIComponent(tradeNo)}`, { method: 'GET' });
}

export interface PartnerBackfillResult extends PartnerModelBackfill {
  binding?: PartnerBinding | null;
}

/**
 * 回填 ccagent 模型条目。服务端会幂等地重新同步账号拿明文 Key 再写 config，
 * 前端始终只看到掩码。
 */
export async function backfillModel(
  options: { modelName?: string; force?: boolean } = {},
): Promise<PartnerBackfillResult> {
  const body: { modelName?: string; force?: boolean } = {};
  if (options.modelName) body.modelName = options.modelName;
  if (options.force) body.force = true;
  return request<{ ok: boolean } & PartnerBackfillResult>('/backfill-model', postBody(body));
}

export interface PartnerRefreshModelsResult {
  modelProvision: PartnerModelProvision;
  binding?: PartnerBinding | null;
}

/**
 * 重新同步账号并下发全部可用模型。服务端幂等地重新调用 `/users/sync` 拿明文
 * Key，前端只看到掩码。
 */
export async function refreshPartnerModels(): Promise<PartnerRefreshModelsResult> {
  return request<{ ok: boolean } & PartnerRefreshModelsResult>('/refresh-models', postBody({}));
}

export interface PartnerModelsResult {
  models: string[];
  apiBaseUrl: string;
}

/** 拉取中转站 `/models` 的候选模型 ID。 */
export async function listModels(): Promise<PartnerModelsResult> {
  const data = await request<{ ok: boolean; models?: unknown; apiBaseUrl?: unknown }>(
    '/models',
    postBody({}),
  );
  const models = Array.isArray(data.models)
    ? data.models.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
  return {
    models,
    apiBaseUrl: typeof data.apiBaseUrl === 'string' ? data.apiBaseUrl : '',
  };
}
