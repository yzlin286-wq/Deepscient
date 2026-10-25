import assert from 'node:assert/strict';
import test from 'node:test';

import {
  moduleExpertCount,
  moduleQuickPrompt,
  normalizeScienceModules,
  pickLocalizedText,
  resolveScienceLanguage,
  resolveScienceModuleError,
} from '../node_modules/.cache/science-modules/presentation.mjs';

test('resolves supported languages from i18n tags', () => {
  assert.equal(resolveScienceLanguage('en'), 'en');
  assert.equal(resolveScienceLanguage('en-US'), 'en');
  assert.equal(resolveScienceLanguage('zh-CN'), 'zh');
  assert.equal(resolveScienceLanguage(''), 'zh');
  assert.equal(resolveScienceLanguage(undefined), 'zh');
});

test('picks localized text with language fallback', () => {
  const value = { zh: '文献与选题', en: 'Literature & Framing' };

  assert.equal(pickLocalizedText(value, 'zh-CN'), '文献与选题');
  assert.equal(pickLocalizedText(value, 'en-US'), 'Literature & Framing');
  assert.equal(pickLocalizedText({ zh: '只有中文' }, 'en'), '只有中文');
  assert.equal(pickLocalizedText({ en: 'Only English' }, 'zh'), 'Only English');
  assert.equal(pickLocalizedText({ zh: '  ' }, 'zh', 'fallback'), 'fallback');
  assert.equal(pickLocalizedText(null, 'zh', 'fallback'), 'fallback');
  assert.equal(pickLocalizedText('plain', 'en'), 'plain');
});

test('counts module experts and falls back on quick prompts', () => {
  const module = {
    experts: ['a', 'b', 'c'],
    quickPrompt: { zh: '中文任务', en: 'English task' },
  };

  assert.equal(moduleExpertCount(module), 3);
  assert.equal(moduleExpertCount({ experts: [] }), 0);
  assert.equal(moduleExpertCount(null), 0);
  assert.equal(moduleQuickPrompt(module, 'en'), 'English task');
  assert.equal(moduleQuickPrompt(module, 'zh'), '中文任务');
  assert.equal(moduleQuickPrompt({ quickPrompt: { zh: '中文任务' } }, 'en'), '中文任务');
  assert.equal(moduleQuickPrompt({ quickPrompt: {} }, 'en', 'fallback'), 'fallback');
});

test('selects the error message for the failure state', () => {
  assert.equal(resolveScienceModuleError(new Error('boom'), 'fallback'), 'boom');
  assert.equal(resolveScienceModuleError(' server down ', 'fallback'), 'server down');
  assert.equal(resolveScienceModuleError({ message: 'payload error' }, 'fallback'), 'payload error');
  assert.equal(resolveScienceModuleError(new Error(''), 'fallback'), 'fallback');
  assert.equal(resolveScienceModuleError(null, 'fallback'), 'fallback');
  assert.equal(resolveScienceModuleError(undefined, 'fallback'), 'fallback');
  assert.equal(resolveScienceModuleError({ code: 'x' }, 'fallback'), 'fallback');
});

test('normalizes the science_modules.list payload', () => {
  const modules = normalizeScienceModules({
    modules: [
      {
        id: ' literature ',
        title: { zh: '文献与选题', en: 'Literature & Framing' },
        description: { zh: '说明', en: 'Description' },
        icon: 'book-open',
        agentGroup: 'sci-literature-team',
        experts: ['sci-expert-a', 42, ' sci-expert-b '],
        quickPrompt: { zh: '任务', en: 'Task' },
        tags: ['科研', ''],
        installed: true,
        installedExperts: ['sci-expert-a'],
        source: 'builtin',
      },
      { id: '' },
      null,
    ],
  });

  assert.equal(modules.length, 1);
  assert.equal(modules[0].id, 'literature');
  assert.deepEqual(modules[0].experts, ['sci-expert-a', ' sci-expert-b ']);
  assert.deepEqual(modules[0].tags, ['科研']);
  assert.equal(modules[0].installed, true);
  assert.deepEqual(modules[0].installedExperts, ['sci-expert-a']);
  assert.deepEqual(normalizeScienceModules(null), []);
  assert.deepEqual(normalizeScienceModules({ modules: 'nope' }), []);
});
