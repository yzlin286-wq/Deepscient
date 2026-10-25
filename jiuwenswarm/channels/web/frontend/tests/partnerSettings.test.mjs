/**
 * 计费面板的纯展示逻辑：套餐表归一化、订单状态、错误分类。
 *
 * 这些函数不依赖 React / i18n，所以能直接在 node 里跑；
 * 文案与单位由调用方传入，测试固定使用中文标签。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  backfillHintKey,
  backfillStatusKey,
  buildPlanRows,
  classifyPartnerError,
  formatOrderAmount,
  formatPartnerTime,
  orderStatusKey,
  orderStatusLabelKey,
  partnerErrorKey,
} from '../node_modules/.cache/partner-settings/presentation.mjs';

test('buildPlanRows 归一化上游套餐字段', () => {
  const rows = buildPlanRows(
    [
      {
        plan_id: 1,
        title: '轻享版',
        amount: '19.90',
        currency: 'CNY',
        duration_days: 30,
        quota: '100万 tokens',
      },
      { planId: 2, name: '标准版', price: 69.9, duration_days: 90, tokens: 5000000 },
    ],
    { dayUnit: '天' },
  );

  assert.deepEqual(rows, [
    { planId: 1, title: '轻享版', price: '19.90 CNY', duration: '30 天', quota: '100万 tokens' },
    { planId: 2, title: '标准版', price: '69.9 CNY', duration: '90 天', quota: '5000000' },
  ]);
});

test('buildPlanRows 对缺字段与非数组输入保守处理', () => {
  assert.deepEqual(buildPlanRows(null), []);
  assert.deepEqual(buildPlanRows({ plan_id: 1 }), []);

  const [row] = buildPlanRows([{ plan_id: 0, duration: '一个月' }], { empty: '-' });
  assert.deepEqual(row, { planId: null, title: '-', price: '-', duration: '一个月', quota: '-' });
});

test('订单状态只认明确取值，其余按 unknown', () => {
  assert.equal(orderStatusKey('success'), 'paid');
  assert.equal(orderStatusKey('PAID'), 'paid');
  assert.equal(orderStatusKey('pending'), 'pending');
  assert.equal(orderStatusKey('closed'), 'failed');
  assert.equal(orderStatusKey('mystery'), 'unknown');
  assert.equal(orderStatusKey(undefined), 'unknown');
  assert.equal(orderStatusLabelKey('success'), 'settingsPanel.billing.orderStatus.paid');
  assert.equal(orderStatusLabelKey('nope'), 'settingsPanel.billing.orderStatus.unknown');
});

test('金额与时间展示', () => {
  assert.equal(formatOrderAmount('19.90', 'CNY'), '19.90 CNY');
  assert.equal(formatOrderAmount(69.9, ''), '69.9 CNY');
  assert.equal(formatOrderAmount('', 'CNY', '-'), '-');
  assert.equal(formatPartnerTime('2026-01-02T03:04:05Z', 'zh-CN'), new Date('2026-01-02T03:04:05Z').toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }));
  assert.equal(formatPartnerTime(1767323045, 'zh-CN'), new Date(1767323045 * 1000).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }));
  assert.equal(formatPartnerTime('not-a-date', 'zh-CN', '-'), '-');
  assert.equal(formatPartnerTime(null, 'zh-CN', '-'), '-');
});

test('classifyPartnerError 覆盖后端错误映射', () => {
  assert.equal(
    classifyPartnerError({ code: 'partner-not-configured', status: 409 }),
    'not-configured',
  );
  assert.equal(classifyPartnerError({ code: 'relay-rate-limited', status: 429 }), 'rate-limited');
  assert.equal(classifyPartnerError({ code: 'not-found', status: 404 }), 'not-found');
  assert.equal(classifyPartnerError({ code: '40403', status: 404 }), 'not-found');
  assert.equal(classifyPartnerError({ code: 'relay-error', status: 502 }), 'relay');
  assert.equal(classifyPartnerError({ code: 'network_error', status: 0 }), 'network');
  assert.equal(classifyPartnerError(new Error('boom')), 'network');
  assert.equal(classifyPartnerError(null), 'unknown');
});

test('partnerErrorKey 给出面板使用的 i18n key', () => {
  assert.equal(
    partnerErrorKey('not-configured'),
    'settingsPanel.billing.errors.notConfigured',
  );
  assert.equal(partnerErrorKey('rate-limited'), 'settingsPanel.billing.errors.rateLimited');
  assert.equal(partnerErrorKey('not-found'), 'settingsPanel.billing.errors.notFound');
  assert.equal(partnerErrorKey('relay'), 'settingsPanel.billing.errors.relay');
  assert.equal(partnerErrorKey('network'), 'settingsPanel.billing.errors.network');
  assert.equal(partnerErrorKey('unknown'), 'settingsPanel.billing.errors.unknown');
});

test('backfillStatusKey 区分未回填 / 已回填 / 冲突', () => {
  assert.equal(backfillStatusKey(null), 'partner.notBackfilled');
  assert.equal(backfillStatusKey(undefined), 'partner.notBackfilled');
  assert.equal(
    backfillStatusKey({ applied: false, reason: 'no-key', modelName: '', masked: '' }),
    'partner.notBackfilled',
  );
  assert.equal(
    backfillStatusKey({
      applied: true,
      reason: 'created',
      modelName: 'deepseek-chat',
      masked: 'sk-•••7890',
    }),
    'partner.backfilled',
  );
  assert.equal(
    backfillStatusKey({ applied: false, reason: 'conflict', modelName: '', masked: '' }),
    'partner.conflict',
  );
});

test('backfillHintKey 只在冲突 / 失败时给提示', () => {
  assert.equal(backfillHintKey(null), '');
  assert.equal(
    backfillHintKey({ applied: true, reason: 'updated', modelName: 'm', masked: '' }),
    '',
  );
  assert.equal(
    backfillHintKey({ applied: false, reason: 'conflict', modelName: 'm', masked: '' }),
    'partner.conflictHint',
  );
  assert.equal(
    backfillHintKey({ applied: false, reason: 'error', modelName: '', masked: '' }),
    'partner.backfillFailed',
  );
});
