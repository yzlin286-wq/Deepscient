/**
 * 计费面板的外链校验与文案选择。
 *
 * 购买 / 我的额度都是中转站下发的一次性链接：跳转前先在前端校验一次协议与 host，
 * Electron 主进程（`desktop:open-external-url`）还会用同一套规则再校验一次。
 * 这里刻意不引 React / i18n，测试可以直接跑这些函数。
 */

/** 与 Electron 主进程 `DEEPSCIENT_EXTERNAL_HOSTS` 的默认值保持一致。 */
export const DEFAULT_BILLING_HOSTS: readonly string[] = [
  'deepscient.com',
  'un.ccagent.cn',
  'api.ccagent.cn',
];

export type BillingLinkErrorKind = 'not-configured' | 'invalid-link' | 'open-failed';

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, '');
}

function isIpv4(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

/** 本机 / 内网地址：默认不放行，只有显式写进白名单才允许。 */
export function isPrivateHost(host: string): boolean {
  const value = normalizeHost(host);
  if (!value) return true;
  const bare = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  if (bare === '::1' || bare === '::' || bare === '0.0.0.0') return true;
  // 唯一本地 / 链路本地 IPv6
  if (bare.includes(':') && /^(?:fc|fd|fe[89ab])/.test(bare)) return true;
  if (isIpv4(bare)) {
    const [a, b] = bare.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function matchesHost(host: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((entry) => {
    const target = normalizeHost(entry);
    return Boolean(target) && (host === target || host.endsWith(`.${target}`));
  });
}

/**
 * 是否允许把该链接交给系统浏览器打开。
 *
 * 只放行 https、不带账号密码、host 命中白名单（含子域）；
 * 本机 / 内网地址即使符合上面的形态也一律拒绝，除非它被显式写进白名单。
 */
export function isAllowedBillingUrl(
  rawUrl: unknown,
  allowedHosts: readonly string[] = DEFAULT_BILLING_HOSTS,
): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  let target: URL;
  try {
    target = new URL(rawUrl.trim());
  } catch {
    return false;
  }
  if (target.protocol !== 'https:') return false;
  if (target.username || target.password) return false;
  const host = normalizeHost(target.hostname);
  if (!host) return false;
  const whitelisted = matchesHost(host, allowedHosts);
  // 本机 / 内网地址只有被显式写进白名单才放行。
  if (isPrivateHost(host) && !whitelisted) return false;
  return whitelisted;
}

/** 官网余额是否可用（null / NaN / 字符串都算未知）。 */
export function isBalanceKnown(balance: unknown): balance is number {
  return typeof balance === 'number' && Number.isFinite(balance);
}

/** 余额展示使用的文案 key：有值用 `balance`，没有用 `balanceUnknown`。 */
export function billingBalanceKey(balance: unknown): string {
  return isBalanceKnown(balance)
    ? 'settingsPanel.billing.balance'
    : 'settingsPanel.billing.balanceUnknown';
}

/** 余额文本：未知时显示调用方给的占位，数字原样展示。 */
export function formatBillingBalance(balance: unknown, unknownText: string): string {
  if (!isBalanceKnown(balance)) return unknownText;
  return String(balance);
}

/** 链接相关错误 → i18n key（未配置 / 链接不合法 / 打开失败）。 */
export function billingLinkErrorKey(kind: BillingLinkErrorKind): string {
  const keys: Record<BillingLinkErrorKind, string> = {
    'not-configured': 'settingsPanel.billing.errors.notConfigured',
    'invalid-link': 'settingsPanel.billing.invalidLink',
    'open-failed': 'settingsPanel.billing.openFailed',
  };
  return keys[kind];
}
