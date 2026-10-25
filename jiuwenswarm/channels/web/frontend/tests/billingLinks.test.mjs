/**
 * 计费面板外链校验与文案选择的纯函数测试。
 *
 * 与 Electron 主进程 `desktop:open-external-url` 使用同一套规则；这里固定默认白名单，
 * 另外验证「显式白名单可放行本机地址」这一条例外。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_BILLING_HOSTS,
  billingBalanceKey,
  billingLinkErrorKey,
  formatBillingBalance,
  isAllowedBillingUrl,
  isBalanceKnown,
  isPrivateHost,
} from '../node_modules/.cache/billing-links/billingLinks.mjs';

test('只放行 https，且拒绝带账号密码的链接', () => {
  assert.equal(isAllowedBillingUrl('https://un.ccagent.cn/pay'), true);
  assert.equal(isAllowedBillingUrl('http://un.ccagent.cn/pay'), false);
  assert.equal(isAllowedBillingUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedBillingUrl('data:text/html,hi'), false);
  assert.equal(isAllowedBillingUrl('not a url'), false);
  assert.equal(isAllowedBillingUrl(''), false);
  assert.equal(isAllowedBillingUrl(null), false);
  assert.equal(isAllowedBillingUrl('https://user:pass@un.ccagent.cn/pay'), false);
  assert.equal(isAllowedBillingUrl('https://user@un.ccagent.cn/pay'), false);
});

test('host 必须命中白名单（含子域），伪装的域后缀不算', () => {
  assert.deepEqual(
    [...DEFAULT_BILLING_HOSTS],
    ['deepscient.com', 'un.ccagent.cn', 'api.ccagent.cn'],
  );
  assert.equal(isAllowedBillingUrl('https://deepscient.com/account'), true);
  assert.equal(isAllowedBillingUrl('https://api.ccagent.cn/v1/quota'), true);
  assert.equal(isAllowedBillingUrl('https://evil.com/deepscient.com'), false);
  assert.equal(isAllowedBillingUrl('https://deepscient.com.evil.com/'), false);
  assert.equal(isAllowedBillingUrl('https://ccagent.cn/'), false);
  assert.equal(isAllowedBillingUrl('https://notun.ccagent.cn/'), false);
});

test('https 与 host 大小写、端口、结尾点都不影响判定', () => {
  assert.equal(isAllowedBillingUrl('HTTPS://UN.CCAGENT.CN:443/pay?ticket=abc'), true);
  assert.equal(isAllowedBillingUrl('https://Un.CcAgent.Cn/account'), true);
  assert.equal(isAllowedBillingUrl('https://un.ccagent.cn:8443/pay'), true);
  assert.equal(isAllowedBillingUrl('https://un.ccagent.cn./pay'), true);
});

test('localhost 与内网地址一律拒绝，除非显式写进白名单', () => {
  const blocked = [
    'https://localhost/pay',
    'https://api.localhost/pay',
    'https://127.0.0.1/pay',
    'https://127.1.2.3/pay',
    'https://10.0.0.8/pay',
    'https://172.16.0.1/pay',
    'https://172.31.255.1/pay',
    'https://192.168.1.1/pay',
    'https://169.254.1.1/pay',
    'https://100.64.0.1/pay',
    'https://0.0.0.0/pay',
    'https://[::1]/pay',
  ];
  for (const url of blocked) {
    assert.equal(isAllowedBillingUrl(url), false, url);
  }
  assert.equal(isPrivateHost('127.0.0.1'), true);
  assert.equal(isPrivateHost('192.168.0.10'), true);
  assert.equal(isPrivateHost('un.ccagent.cn'), false);

  // 显式白名单是唯一的例外通道
  assert.equal(isAllowedBillingUrl('https://127.0.0.1:8443/pay', ['127.0.0.1']), true);
});

test('余额未知时使用 balanceUnknown key', () => {
  assert.equal(billingBalanceKey(null), 'settingsPanel.billing.balanceUnknown');
  assert.equal(billingBalanceKey(undefined), 'settingsPanel.billing.balanceUnknown');
  assert.equal(billingBalanceKey(Number.NaN), 'settingsPanel.billing.balanceUnknown');
  assert.equal(billingBalanceKey('12'), 'settingsPanel.billing.balanceUnknown');
  assert.equal(billingBalanceKey(0), 'settingsPanel.billing.balance');
  assert.equal(billingBalanceKey(36.5), 'settingsPanel.billing.balance');

  assert.equal(isBalanceKnown(0), true);
  assert.equal(isBalanceKnown(null), false);
  assert.equal(formatBillingBalance(null, '未知'), '未知');
  assert.equal(formatBillingBalance(36.5, '未知'), '36.5');
  assert.equal(formatBillingBalance(0, '未知'), '0');
});

test('链接错误按未配置 / 链接不合法 / 打开失败区分 key', () => {
  assert.equal(
    billingLinkErrorKey('not-configured'),
    'settingsPanel.billing.errors.notConfigured',
  );
  assert.equal(billingLinkErrorKey('invalid-link'), 'settingsPanel.billing.invalidLink');
  assert.equal(billingLinkErrorKey('open-failed'), 'settingsPanel.billing.openFailed');
});
