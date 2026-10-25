import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.cache/chat-error/vite',
  server: { middlewareMode: true, hmr: false, watch: null },
});
let describeChatError;
try {
  ({ describeChatError } = await vite.ssrLoadModule('/src/features/chatErrors.ts'));
} finally {
  await vite.close();
}

const t = (key) => `<${key}>`;
const RAW = "[181001] model call failed: Error code: 401 - {'error_code': 'APIG.0305'}";

test('model_not_configured is replaced by the setup guidance', () => {
  assert.equal(describeChatError({ code: 'model_not_configured' }, 'x', t), '<chat.modelNotConfigured>');
});

test('session lifecycle codes are replaced by their localized text', () => {
  for (const [code, key] of [
    ['SESSION_ARCHIVED', 'chat.sessionArchived'],
    ['NOT_FOUND', 'chat.sessionDeleted'],
    ['OPERATION_IN_PROGRESS', 'chat.sessionOperationInProgress'],
  ]) {
    assert.equal(describeChatError({ code }, RAW, t), `<${key}>`);
  }
});

test('errors without a known code are shown as-is', () => {
  assert.equal(describeChatError({}, RAW, t), RAW);
  assert.equal(describeChatError({ code: 'something_else' }, RAW, t), RAW);
  assert.equal(describeChatError({ code: 'login_required' }, RAW, t), RAW);
});
